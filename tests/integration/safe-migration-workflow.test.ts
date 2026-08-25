import { describe, it, expect } from "vitest";
import { TrueForgeOrchestrator } from "../../lib/agent/orchestrator.js";
import { defaultPostgresMcpService } from "../../lib/mcp/postgres.js";
import { GithubMcpService } from "../../lib/mcp/github.js";
import { ApprovalGate } from "../../lib/safety/approval-gate.js";
import { FileSessionStore } from "../../lib/agent/session-store.js";
import path from "path";
import os from "os";

describe("Safe Migration End-to-End Workflow Integration Tests", () => {
  it("executes full workflow: Review -> Generate Safe Proposal -> Sandbox Validate -> Operator Approve -> GitHub PR Opened", async () => {
    const tempDir = path.join(os.tmpdir(), `schemasentinel_safeflow_test_${Date.now()}`);
    const sessionStore = new FileSessionStore(tempDir);
    const githubMcp = new GithubMcpService();
    const approvalGate = new ApprovalGate();

    const orchestrator = new TrueForgeOrchestrator(
      defaultPostgresMcpService,
      githubMcp,
      approvalGate,
      sessionStore
    );

    const sessionId = `sess_safe_e2e_${Date.now()}`;

    // 1. Execute initial Safety Review on risky migration
    const reviewResult = await orchestrator.executeReviewWorkflow({
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Analyze risky migration 0038_add_order_status.sql",
    });

    expect(reviewResult.context.status).toBe("AWAITING_APPROVAL");
    expect(reviewResult.riskAnalysis.overallRisk).toBe("HIGH");

    // 2. Trigger Safe Migration Generation
    const safeGenResult = await orchestrator.generateSafeMigrationWorkflow(sessionId);

    expect(safeGenResult.proposal).toBeDefined();
    expect(safeGenResult.proposal.remediationSteps.length).toBeGreaterThanOrEqual(4);
    expect(safeGenResult.proposal.riskReductionSummary.afterRisk).toBe("LOW");
    expect(safeGenResult.proposal.sandboxValidation?.success).toBe(true);
    expect(safeGenResult.proposal.approvalToken).toMatch(/^sat_safe_/);
    expect(safeGenResult.sessionState.status).toBe("AWAITING_SAFE_MIGRATION_APPROVAL");

    // Verify Evidence Provenance items
    const evidenceTypes = safeGenResult.sessionState.evidenceItems.map((e) => e.sourceType);
    expect(evidenceTypes).toContain("SAFE_MIGRATION_SQL");
    expect(evidenceTypes).toContain("MIGRATION_DIFF");
    expect(evidenceTypes).toContain("SAFE_SANDBOX_EVAL");

    // 3. Human Operator grants approval to create GitHub PR
    const prResult = await orchestrator.approveAndCreatePrWorkflow({
      sessionId,
      approvedBy: "lead-dba@schemasentinel.dev",
      approvalToken: safeGenResult.proposal.approvalToken,
      baseBranch: "master",
    });

    expect(prResult.githubPr).toBeDefined();
    expect(prResult.githubPr.prNumber).toBeGreaterThan(0);
    expect(prResult.githubPr.branch).toBe(`schemasentinel/migration/${sessionId}`);
    expect(prResult.githubPr.commitSha).toBeDefined();
    expect(prResult.githubPr.qodoStatus).toBe("WAITING_FOR_REVIEW");
    expect(prResult.sessionState.status).toBe("PR_CREATED");
    expect(prResult.sessionState.isReadOnly).toBe(true);

    // Verify PR Evidence item recorded
    const finalEvidenceTypes = prResult.sessionState.evidenceItems.map((e) => e.sourceType);
    expect(finalEvidenceTypes).toContain("GITHUB_PR");
  }, 120000);
});
