import { describe, it, expect } from "vitest";
import { TrueForgeMigrationSession } from "../../lib/agent/session.js";
import { PostgresMcpService } from "../../lib/mcp/postgres.js";
import { ApprovalGate, ApprovalGateError } from "../../lib/safety/approval-gate.js";

describe("ApprovalCheckpoint - Hard Security Boundaries", () => {
  const approvalGate = new ApprovalGate();
  const postgresMcp = new PostgresMcpService(undefined, approvalGate);
  const session = new TrueForgeMigrationSession(postgresMcp, undefined, undefined, undefined, approvalGate);

  it("strictly halts at approval checkpoint without mutating target database", async () => {
    const userRequest = {
      sessionId: "sess_security_test_01",
      targetId: "demo-postgres",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration 0038_add_order_status.sql before production.",
    };

    const result = await session.executeReviewWorkflow(userRequest);

    expect(result.context.status).toBe("AWAITING_APPROVAL");

    // Verify target database was NOT mutated: fulfillment_status column should NOT exist on target yet
    const schemaAfterReview = await postgresMcp.inspectSchema("demo-postgres");
    const ordersTable = schemaAfterReview.tables.find((t) => t.tableName === "orders");
    const hasNewColumn = ordersTable?.columns.some((c) => c.name === "fulfillment_status");
    expect(hasNewColumn).toBe(false);
  });

  it("rejects execution when SQL payload is tampered after approval packet creation", async () => {
    const userRequest = {
      sessionId: "sess_security_test_02",
      targetId: "demo-postgres",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration 0038_add_order_status.sql before production.",
    };

    const result = await session.executeReviewWorkflow(userRequest);
    const tamperedSql = result.context.plan!.rawSql + "\n-- Injected Malicious DDL";

    expect(() =>
      approvalGate.verifyApproval(
        result.approvalPacket.approvalToken,
        result.context.sessionId,
        result.context.plan!.id,
        result.context.targetId,
        tamperedSql
      )
    ).toThrow(ApprovalGateError);
  });
});
