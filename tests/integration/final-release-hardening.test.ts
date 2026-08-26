import { describe, it, expect } from "vitest";
import { TrueForgeOrchestrator } from "../../lib/agent/orchestrator.js";
import { defaultPostgresMcpService } from "../../lib/mcp/postgres.js";
import { GithubMcpService } from "../../lib/mcp/github.js";
import { ApprovalGate } from "../../lib/safety/approval-gate.js";
import { FileSessionStore } from "../../lib/agent/session-store.js";
import { TargetRegistry, TargetNotAllowedError } from "../../lib/safety/target-allowlist.js";
import path from "path";
import os from "os";

describe("Phase 7 Final Hardening & Release Verification", () => {
  const tempDir = path.join(os.tmpdir(), `schemasentinel_hardening_${Date.now()}`);
  const sessionStore = new FileSessionStore(tempDir);
  const githubMcp = new GithubMcpService();
  const approvalGate = new ApprovalGate();

  const orchestrator = new TrueForgeOrchestrator(
    defaultPostgresMcpService,
    githubMcp,
    approvalGate,
    sessionStore
  );

  it("strictly blocks mutation on production target and unknown targets", async () => {
    const prodSessionId = `sess_prod_${Date.now()}`;
    const reviewResult = await orchestrator.executeReviewWorkflow({
      sessionId: prodSessionId,
      targetId: "prod-postgres",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration for production",
    });

    // Attempting to apply on production target must fail-closed with TargetNotAllowedError
    await expect(
      orchestrator.resumeAndApplyWorkflow({
        sessionId: prodSessionId,
        humanDecision: "APPROVED",
        approvalToken: reviewResult.approvalPacket.approvalToken,
        approvedBy: "operator@schemasentinel.dev",
      })
    ).rejects.toThrow(TargetNotAllowedError);

    const unknownSessionId = `sess_unk_${Date.now()}`;
    await expect(
      orchestrator.executeReviewWorkflow({
        sessionId: unknownSessionId,
        targetId: "external-hacked-db",
        repo: "mohitpargaie002-a11y/SchemaSentinel",
        migrationFilePath: "migrations/0038_add_order_status.sql",
        userPrompt: "Review migration for external db",
      })
    ).rejects.toThrow(TargetNotAllowedError);
  }, 90000);

  it("preserves approval checkpoints and session state across simulated process restarts", async () => {
    const sessionId = `sess_restart_${Date.now()}`;

    // 1. Initial Review
    const reviewResult = await orchestrator.executeReviewWorkflow({
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Test process restart resilience",
    });

    expect(reviewResult.context.status).toBe("AWAITING_APPROVAL");
    const token = reviewResult.approvalPacket.approvalToken;

    // 2. Simulate fresh orchestrator instance reading from durable session store
    const freshGate = new ApprovalGate();
    const freshOrchestrator = new TrueForgeOrchestrator(
      defaultPostgresMcpService,
      githubMcp,
      freshGate,
      sessionStore
    );

    // 3. Resume with approval in fresh instance
    const resumed = await freshOrchestrator.resumeAndApplyWorkflow({
      sessionId,
      humanDecision: "APPROVED",
      approvalToken: token,
      approvedBy: "lead-dba@schemasentinel.dev",
    });

    expect(resumed.applyResult?.success).toBe(true);
    expect(resumed.sessionState.status).toBe("COMPLETED");
    expect(resumed.sessionState.isReadOnly).toBe(true);
  }, 90000);

  it("generates safe proposal with explicit operational backfill caveats", async () => {
    const sessionId = `sess_caveat_${Date.now()}`;

    await orchestrator.executeReviewWorkflow({
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Analyze order status migration",
    });

    const safeGen = await orchestrator.generateSafeMigrationWorkflow(sessionId);
    expect(safeGen.proposal.proposedSql).toContain("UPDATE orders SET status = 'pending' WHERE status IS NULL;");
    expect(safeGen.proposal.remediationSteps.some((s) => s.includes("Operational Caveat"))).toBe(true);
  }, 90000);
});
