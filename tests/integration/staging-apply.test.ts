import { describe, it, expect, beforeEach } from "vitest";
import { TrueForgeMigrationSession } from "../../lib/agent/session.js";
import { defaultSessionStore } from "../../lib/agent/session-store.js";
import { defaultPostgresMcpService } from "../../lib/mcp/postgres.js";

describe("StagingApply - Controlled Staging Apply & Resume Workflow", () => {
  const sessionRunner = new TrueForgeMigrationSession(defaultPostgresMcpService);

  it("executes full lifecycle: review → halt → persist → reload → resume → apply to staging-demo → verify → complete", async () => {
    const sessionId = "sess_integration_staging_01";
    const userRequest = {
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review and apply migration 0038_add_order_status.sql to staging-demo.",
    };

    // Step 1: Initial review pipeline
    const reviewResult = await sessionRunner.executeReviewWorkflow(userRequest);
    expect(reviewResult.context.status).toBe("AWAITING_APPROVAL");
    expect(reviewResult.approvalPacket.status).toBe("AWAITING_HUMAN_APPROVAL");

    // Step 2: Confirm persisted in session store
    const persisted = await defaultSessionStore.loadSession(sessionId);
    expect(persisted).toBeDefined();
    expect(persisted?.sessionId).toBe(sessionId);
    expect(persisted?.status).toBe("AWAITING_APPROVAL");

    // Step 3: Resume the SAME session with approved decision
    const resumeResult = await sessionRunner.resumeAndApplyWorkflow({
      sessionId,
      humanDecision: "APPROVED",
      approvalToken: persisted!.approvalPacket!.approvalToken,
      approvedBy: "lead-dba@schemasentinel.dev",
    });

    expect(resumeResult.sessionState.sessionId).toBe(sessionId);
    expect(resumeResult.sessionState.status).toBe("COMPLETED");
    expect(resumeResult.applyResult?.status).toBe("COMPLETED");
    expect(resumeResult.applyResult?.success).toBe(true);
    expect(resumeResult.verificationResult?.status).toBe("passed");

    // Verify timeline preserves complete history
    const timelineSteps = resumeResult.sessionState.timeline.map((t) => t.step);
    expect(timelineSteps).toContain("REQUEST_RECEIVED");
    expect(timelineSteps).toContain("APPROVAL_REQUESTED");
    expect(timelineSteps).toContain("APPROVED");
    expect(timelineSteps).toContain("STAGING_APPLY_STARTED");
    expect(timelineSteps).toContain("STAGING_APPLY_COMPLETED");
    expect(timelineSteps).toContain("VERIFICATION_COMPLETED");
    expect(timelineSteps).toContain("SESSION_COMPLETED");
  });

  it("handles operator rejection: transitions to REJECTED with zero mutation applied", async () => {
    const sessionId = "sess_integration_staging_reject_02";
    const userRequest = {
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration 0038_add_order_status.sql.",
    };

    await sessionRunner.executeReviewWorkflow(userRequest);

    const rejectResult = await sessionRunner.resumeAndApplyWorkflow({
      sessionId,
      humanDecision: "REJECTED",
      approvedBy: "security-team@schemasentinel.dev",
    });

    expect(rejectResult.sessionState.status).toBe("REJECTED");
    expect(rejectResult.applyResult).toBeUndefined();
  });
});
