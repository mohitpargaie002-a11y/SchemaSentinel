import { describe, it, expect } from "vitest";
import { TrueForgeMigrationSession } from "../../lib/agent/session.js";

describe("AgentSession - End-to-End Migration Review Vertical Slice", () => {
  const session = new TrueForgeMigrationSession();

  it("executes complete review workflow and stops at TrueForge approval checkpoint", async () => {
    const userRequest = {
      sessionId: "sess_integration_test_01",
      targetId: "demo-postgres",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration 0038_add_order_status.sql before production.",
    };

    const result = await session.executeReviewWorkflow(userRequest);

    // 1. Session Context
    expect(result.context.status).toBe("AWAITING_APPROVAL");
    expect(result.context.schemaSnapshot?.tables.length).toBeGreaterThan(0);
    expect(result.context.plan?.rawSql).toBeDefined();

    // 2. Timeline Verification
    const stepNames = result.context.timeline.map((t) => t.step);
    expect(stepNames).toContain("REQUEST_RECEIVED");
    expect(stepNames).toContain("MIGRATION_READ");
    expect(stepNames).toContain("SCHEMA_INSPECTED");
    expect(stepNames).toContain("ANALYSIS_COMPLETED");
    expect(stepNames).toContain("SANDBOX_COMPLETED");
    expect(stepNames).toContain("APPROVAL_REQUESTED");

    // 3. Sandbox Invariant Validation
    expect(result.approvalPacket.sandboxStatus).toBe("PASS");
    expect(result.approvalPacket.rollbackStatus).toBe("PASS");
    expect(result.context.sandboxResult?.assertionsPassed.length).toBeGreaterThan(2);

    // 4. Approval Packet & Dynamic Metadata Verification
    expect(result.approvalPacket.status).toBe("AWAITING_HUMAN_APPROVAL");
    expect(result.approvalPacket.targetId).toBe("demo-postgres");
    expect(result.approvalPacket.approvalToken).toMatch(/^sat_[a-f0-9]{32}$/);
    expect(result.approvalPacket.sqlFingerprint.length).toBe(64);
    expect(result.approvalPacket.affectedObjects).toContain("orders");
    expect(result.context.plan?.rollbackSql).toContain("DROP COLUMN IF EXISTS status");
    expect(result.context.plan?.rollbackSql).toContain("DROP INDEX IF EXISTS idx_orders_status");
    expect(result.approvalPacket.migrationSummary).toContain("Add column status to orders");
    expect(result.approvalPacket.dataIntegrityStatus).toBe("PASS");
  });
});
