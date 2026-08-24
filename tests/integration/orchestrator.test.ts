import { describe, it, expect } from "vitest";
import { TrueForgeOrchestrator } from "../../lib/agent/orchestrator.js";
import { defaultPostgresMcpService } from "../../lib/mcp/postgres.js";
import { defaultGithubMcpService } from "../../lib/mcp/github.js";
import { defaultApprovalGate } from "../../lib/safety/approval-gate.js";
import { FileSessionStore } from "../../lib/agent/session-store.js";
import path from "path";
import os from "os";

describe("Orchestrator - Multi-Agent Integration & Event Emission", () => {
  it("orchestrates subagents, emits activity events, halts at approval gate, and resumes with verification", async () => {
    const tempDir = path.join(os.tmpdir(), `schemasentinel_orch_test_${Date.now()}`);
    const sessionStore = new FileSessionStore(tempDir);
    const orchestrator = new TrueForgeOrchestrator(
      defaultPostgresMcpService,
      defaultGithubMcpService,
      defaultApprovalGate,
      sessionStore
    );

    const sessionId = `sess_orch_${Date.now()}`;
    const result = await orchestrator.executeReviewWorkflow({
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration 0038_add_order_status.sql",
    });

    // Verify subagent collaboration and review outputs
    expect(result.context.status).toBe("AWAITING_APPROVAL");
    expect(result.approvalPacket.status).toBe("AWAITING_HUMAN_APPROVAL");
    expect(result.schemaAnalysis.tableCount).toBeGreaterThan(0);
    expect(result.riskAnalysis.overallRisk).toBe("HIGH");
    expect(result.sandboxOutput.success).toBe(true);
    expect(result.reviewReport.recommendedPlan.length).toBeGreaterThan(0);

    // Verify Activity Events stream
    expect(result.activityEvents.length).toBeGreaterThanOrEqual(6);
    const actors = result.activityEvents.map((e) => e.actor);
    expect(actors).toContain("ORCHESTRATOR");
    expect(actors).toContain("SCHEMA_ANALYST");
    expect(actors).toContain("RISK_ANALYST");
    expect(actors).toContain("SANDBOX_VALIDATOR");
    expect(actors).toContain("REVIEW_SYNTHESIZER");

    // Verify Session Persistence
    const saved = await sessionStore.loadSession(sessionId);
    expect(saved).not.toBeNull();
    expect(saved?.status).toBe("AWAITING_APPROVAL");
    expect(saved?.activityEvents.length).toBeGreaterThanOrEqual(6);

    // Resume same session and apply to staging
    const resumeResult = await orchestrator.resumeAndApplyWorkflow({
      sessionId,
      humanDecision: "APPROVED",
      approvalToken: result.approvalPacket.approvalToken,
      approvedBy: "lead-dba@schemasentinel.dev",
    });

    expect(resumeResult.sessionState.status).toBe("COMPLETED");
    expect(resumeResult.applyResult?.success).toBe(true);
    expect(resumeResult.verificationResult?.status).toBe("passed");
    expect(resumeResult.sessionState.timeline.some((t) => t.step === "SESSION_COMPLETED")).toBe(true);
  });
});
