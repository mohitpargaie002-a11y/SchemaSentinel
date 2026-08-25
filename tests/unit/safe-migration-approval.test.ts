import { describe, it, expect } from "vitest";
import { ApprovalGate, ApprovalGateError } from "../../lib/safety/approval-gate.js";

describe("Safe Migration Approval Gate Unit Tests", () => {
  const gate = new ApprovalGate();
  const sessionId = "sess-safe-123";
  const planId = "plan-safe-123";
  const targetId = "staging-demo";
  const proposedSql = `
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(32);
    UPDATE orders SET status = 'pending' WHERE status IS NULL;
    ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';
    ALTER TABLE orders ALTER COLUMN status SET NOT NULL;
  `.trim();

  it("grants a cryptographically signed approval token for safe migration proposal", () => {
    const checkpoint = gate.grantSafeMigrationApproval(sessionId, planId, targetId, proposedSql, "lead-dba@schemasentinel.dev");

    expect(checkpoint.token).toMatch(/^sat_safe_[a-f0-9]{27}$/);
    expect(checkpoint.sessionId).toBe(sessionId);
    expect(checkpoint.planId).toBe(planId);
    expect(checkpoint.targetId).toBe(targetId);
    expect(checkpoint.approved).toBe(true);
    expect(checkpoint.approvedBy).toBe("lead-dba@schemasentinel.dev");
  });

  it("verifies valid safe migration approval token successfully", () => {
    const checkpoint = gate.grantSafeMigrationApproval(sessionId, planId, targetId, proposedSql);
    const verified = gate.verifyApproval(checkpoint.token, sessionId, planId, targetId, proposedSql);

    expect(verified).toBeDefined();
    expect(verified.token).toBe(checkpoint.token);
  });

  it("fails verification if proposed SQL was tampered with", () => {
    const checkpoint = gate.grantSafeMigrationApproval(sessionId, planId, targetId, proposedSql);
    const tamperedSql = proposedSql + "\nDROP TABLE orders;";

    expect(() => {
      gate.verifyApproval(checkpoint.token, sessionId, planId, targetId, tamperedSql);
    }).toThrow(ApprovalGateError);
  });

  it("fails verification if target database ID is swapped", () => {
    const checkpoint = gate.grantSafeMigrationApproval(sessionId, planId, targetId, proposedSql);

    expect(() => {
      gate.verifyApproval(checkpoint.token, sessionId, planId, "prod-postgres", proposedSql);
    }).toThrow(ApprovalGateError);
  });

  it("restores checkpoint into fresh ApprovalGate instance across process restarts", () => {
    const originalGate = new ApprovalGate();
    const checkpoint = originalGate.grantSafeMigrationApproval(sessionId, planId, targetId, proposedSql);

    // Simulate new fresh instance after restart
    const freshGate = new ApprovalGate();
    freshGate.restoreCheckpoint(checkpoint);

    const verified = freshGate.verifyApproval(checkpoint.token, sessionId, planId, targetId, proposedSql);
    expect(verified.token).toBe(checkpoint.token);
  });
});
