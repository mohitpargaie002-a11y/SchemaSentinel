import { describe, it, expect } from "vitest";
import { TrueForgeMigrationSession } from "../../lib/agent/session.js";
import { PostgresMcpService } from "../../lib/mcp/postgres.js";
import { ApprovalGate, ApprovalGateError } from "../../lib/safety/approval-gate.js";
import { TargetRegistry, TargetNotAllowedError } from "../../lib/safety/target-allowlist.js";
import { FileSessionStore } from "../../lib/agent/session-store.js";
import { MigrationPlan } from "../../lib/domain/contracts.js";

describe("ControlledStaging - Security Controls & Target Allowlisting", () => {
  const targetRegistry = new TargetRegistry();
  const approvalGate = new ApprovalGate();
  const sessionStore = new FileSessionStore();
  const postgresMcp = new PostgresMcpService(targetRegistry, approvalGate);
  const sessionRunner = new TrueForgeMigrationSession(postgresMcp, undefined, undefined, undefined, approvalGate, sessionStore);

  it("strictly blocks mutation on production target (prod-postgres)", async () => {
    const userRequest = {
      sessionId: `sess_sec_prod_block_${Date.now()}_01`,
      targetId: "prod-postgres",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Try to apply to production.",
    };

    // Review succeeds up to approval checkpoint
    const reviewResult = await sessionRunner.executeReviewWorkflow(userRequest);
    expect(reviewResult.context.status).toBe("AWAITING_APPROVAL");

    // Attempting to resume and apply to production must fail closed
    await expect(
      sessionRunner.resumeAndApplyWorkflow({
        sessionId: userRequest.sessionId,
        humanDecision: "APPROVED",
        approvalToken: reviewResult.approvalPacket.approvalToken,
      })
    ).rejects.toThrow(TargetNotAllowedError);
  });

  it("rejects token reuse (single-use token enforcement)", async () => {
    const sessionId = `sess_sec_token_reuse_${Date.now()}_02`;
    const userRequest = {
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review and apply.",
    };

    const reviewResult = await sessionRunner.executeReviewWorkflow(userRequest);
    const token = reviewResult.approvalPacket.approvalToken;

    // First apply succeeds and retires token
    await sessionRunner.resumeAndApplyWorkflow({
      sessionId,
      humanDecision: "APPROVED",
      approvalToken: token,
    });

    // Replay attack with same token on a new session must fail
    expect(() =>
      approvalGate.verifyApproval(
        token,
        "sess_sec_token_reuse_03",
        reviewResult.context.plan!.id,
        "staging-demo",
        reviewResult.context.plan!.rawSql
      )
    ).toThrow(ApprovalGateError);
  });

  it("retires approval token immediately even when DDL execution throws/fails", async () => {
    const brokenPlan: MigrationPlan = {
      id: "plan_fail_test",
      sessionId: `sess_fail_test_${Date.now()}`,
      targetId: "staging-demo",
      userPrompt: "Broken migration",
      rawSql: "ALTER TABLE non_existent_table_xyz ADD COLUMN bad_col INT;",
      riskLevel: "LOW",
      riskFactors: [],
      affectedTables: ["non_existent_table_xyz"],
      createdAt: new Date().toISOString(),
    };

    const checkpoint = approvalGate.grantApproval(
      brokenPlan.sessionId,
      brokenPlan,
      "operator@schemasentinel.dev"
    );

    const applyResult = await postgresMcp.applyMigration(
      "staging-demo",
      brokenPlan.sessionId,
      "plan_fail_test",
      brokenPlan.rawSql,
      checkpoint.token,
      brokenPlan
    );

    expect(applyResult.status).toBe("APPLY_FAILED");
    expect(applyResult.success).toBe(false);

    // Verify token was retired and cannot be replayed after failed DDL
    expect(() =>
      approvalGate.verifyApproval(
        checkpoint.token,
        brokenPlan.sessionId,
        "plan_fail_test",
        "staging-demo",
        brokenPlan.rawSql
      )
    ).toThrow(ApprovalGateError);
  });

  it("restores approval checkpoint when resuming in a fresh session runner instance", async () => {
    const sessionId = `sess_fresh_restore_${Date.now()}_01`;
    const userRequest = {
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Fresh restore test",
    };

    const reviewResult = await sessionRunner.executeReviewWorkflow(userRequest);
    const token = reviewResult.approvalPacket.approvalToken;

    // Create a brand new fresh session runner with empty in-memory approval gate
    const freshApprovalGate = new ApprovalGate();
    const freshPostgresMcp = new PostgresMcpService(targetRegistry, freshApprovalGate);
    const freshSessionRunner = new TrueForgeMigrationSession(
      freshPostgresMcp,
      undefined,
      undefined,
      undefined,
      freshApprovalGate,
      sessionStore
    );

    // Resuming on the fresh runner must successfully restore the checkpoint and apply
    const resumeResult = await freshSessionRunner.resumeAndApplyWorkflow({
      sessionId,
      humanDecision: "APPROVED",
      approvalToken: token,
    });

    expect(resumeResult.sessionState.status).toBe("COMPLETED");
    expect(resumeResult.applyResult?.success).toBe(true);
  });

  it("rejects unauthorized / unallowlisted targets", async () => {
    const unallowlistedRequest = {
      sessionId: `sess_unauthorized_${Date.now()}`,
      targetId: "evil-foreign-database",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review evil database.",
    };

    await expect(sessionRunner.executeReviewWorkflow(unallowlistedRequest)).rejects.toThrow(
      TargetNotAllowedError
    );
  });
});
