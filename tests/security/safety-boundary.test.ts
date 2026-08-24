import { describe, it, expect } from "vitest";
import { PostgresMcpService } from "../../lib/mcp/postgres.js";
import { ApprovalGate, ApprovalGateError } from "../../lib/safety/approval-gate.js";
import { TargetNotAllowedError } from "../../lib/safety/target-allowlist.js";
import { MigrationPlan } from "../../lib/domain/contracts.js";

describe("SafetyBoundary - Security Controls & Unauthorized Mutation Rejection", () => {
  const approvalGate = new ApprovalGate();
  const postgresMcp = new PostgresMcpService(undefined, approvalGate);

  const testPlan: MigrationPlan = {
    id: "plan_sec_01",
    sessionId: "sess_sec_01",
    targetId: "demo-postgres",
    userPrompt: "Security test migration",
    rawSql: "ALTER TABLE orders ADD COLUMN sec_tag VARCHAR(16);",
    riskLevel: "LOW",
    riskFactors: [],
    affectedTables: ["orders"],
    createdAt: new Date().toISOString(),
  };

  it("blocks applyMigration when no approval token is provided", async () => {
    await expect(
      postgresMcp.applyMigration(
        "demo-postgres",
        "sess_sec_01",
        "plan_sec_01",
        testPlan.rawSql,
        "invalid_token"
      )
    ).rejects.toThrow(ApprovalGateError);
  });

  it("blocks connection to unregistered / arbitrary database targets", async () => {
    await expect(
      postgresMcp.inspectSchema("unauthorized-hostile-db")
    ).rejects.toThrow(TargetNotAllowedError);
  });

  it("permits applyMigration ONLY with valid approval token and retires token upon apply", async () => {
    const checkpoint = approvalGate.grantApproval(
      "sess_sec_01",
      testPlan,
      "sec_admin@example.com"
    );

    const result = await postgresMcp.applyMigration(
      "demo-postgres",
      "sess_sec_01",
      "plan_sec_01",
      testPlan.rawSql,
      checkpoint.token
    );

    expect(result.success).toBe(true);
    expect(result.verificationPassed).toBe(true);

    // Verify token replay attack is rejected (token must be consumed)
    await expect(
      postgresMcp.applyMigration(
        "demo-postgres",
        "sess_sec_01",
        "plan_sec_01",
        testPlan.rawSql,
        checkpoint.token
      )
    ).rejects.toThrow(ApprovalGateError);
  });
});
