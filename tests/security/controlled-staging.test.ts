import { describe, it, expect } from "vitest";
import { TrueForgeMigrationSession } from "../../lib/agent/session.js";
import { PostgresMcpService } from "../../lib/mcp/postgres.js";
import { ApprovalGate, ApprovalGateError } from "../../lib/safety/approval-gate.js";
import { TargetRegistry, TargetNotAllowedError } from "../../lib/safety/target-allowlist.js";

describe("ControlledStaging - Security Controls & Target Allowlisting", () => {
  const targetRegistry = new TargetRegistry();
  const approvalGate = new ApprovalGate();
  const postgresMcp = new PostgresMcpService(targetRegistry, approvalGate);
  const sessionRunner = new TrueForgeMigrationSession(postgresMcp, undefined, undefined, undefined, approvalGate);

  it("strictly blocks mutation on production target (prod-postgres)", async () => {
    const userRequest = {
      sessionId: "sess_sec_prod_block_01",
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
    const sessionId = "sess_sec_token_reuse_02";
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

  it("rejects unauthorized / unallowlisted targets", () => {
    expect(() => targetRegistry.getTarget("arbitrary-external-db.com")).toThrow(TargetNotAllowedError);
  });
});
