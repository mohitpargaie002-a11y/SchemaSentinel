import { describe, it, expect } from "vitest";
import { ApprovalGate, ApprovalGateError } from "../../lib/safety/approval-gate.js";
import { MigrationPlan } from "../../lib/domain/contracts.js";

describe("ApprovalGate - Cryptographic Token & Tamper Defense", () => {
  const gate = new ApprovalGate();
  const plan: MigrationPlan = {
    id: "plan_123",
    sessionId: "sess_456",
    targetId: "demo-postgres",
    userPrompt: "Add test column",
    rawSql: "ALTER TABLE orders ADD COLUMN test_col INT;",
    riskLevel: "LOW",
    riskFactors: [],
    affectedTables: ["orders"],
    createdAt: new Date().toISOString(),
  };

  it("generates a valid signed approval checkpoint", () => {
    const checkpoint = gate.grantApproval("sess_456", plan, "admin@example.com");
    expect(checkpoint.approved).toBe(true);
    expect(checkpoint.token).toMatch(/^sat_[a-f0-9]{32}$/);
    expect(checkpoint.sqlFingerprint).toBe(
      gate.computeFingerprint("sess_456", "plan_123", "demo-postgres", plan.rawSql)
    );
  });

  it("deterministically derives approval token from immutable session and SQL inputs", () => {
    const checkpoint1 = gate.grantApproval("sess_456", plan, "admin@example.com");
    const checkpoint2 = gate.grantApproval("sess_456", plan, "admin@example.com");
    expect(checkpoint1.token).toBe(checkpoint2.token);
    expect(checkpoint1.sqlFingerprint).toBe(checkpoint2.sqlFingerprint);
  });

  it("verifies genuine approval token successfully", () => {
    const checkpoint = gate.grantApproval("sess_456", plan);
    const verified = gate.verifyApproval(
      checkpoint.token,
      "sess_456",
      "plan_123",
      "demo-postgres",
      plan.rawSql
    );
    expect(verified.approved).toBe(true);
  });

  it("rejects token when SQL has been tampered with after approval", () => {
    const checkpoint = gate.grantApproval("sess_456", plan);
    const tamperedSql = plan.rawSql + " DROP TABLE users;";
    expect(() =>
      gate.verifyApproval(
        checkpoint.token,
        "sess_456",
        "plan_123",
        "demo-postgres",
        tamperedSql
      )
    ).toThrow(ApprovalGateError);
  });

  it("rejects invalid or unknown tokens", () => {
    expect(() =>
      gate.verifyApproval(
        "sat_non_existent_token",
        "sess_456",
        "plan_123",
        "demo-postgres",
        plan.rawSql
      )
    ).toThrow(ApprovalGateError);
  });
});
