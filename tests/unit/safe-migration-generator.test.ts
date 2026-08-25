import { describe, it, expect } from "vitest";
import { SafeMigrationGenerator } from "../../lib/agent/safe-migration-generator.js";
import { SafeMigrationValidationError } from "../../lib/domain/contracts.js";

describe("SafeMigrationGenerator Unit Tests", () => {
  const generator = new SafeMigrationGenerator();

  it("transforms an atomic NOT NULL DEFAULT column addition into zero-downtime staged SQL", () => {
    const inputSql = `ALTER TABLE orders ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending';`;
    const proposal = generator.generateProposal({
      sessionId: "test-session-1",
      planId: "plan-1",
      targetId: "staging-demo",
      originalSql: inputSql,
      migrationFilePath: "migrations/0038_add_order_status.sql",
    });

    expect(proposal.proposalId).toBeDefined();
    expect(proposal.remediationSteps.length).toBeGreaterThanOrEqual(4);
    expect(proposal.proposedSql).toContain("ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(32);");
    expect(proposal.proposedSql).toContain("UPDATE orders SET status = 'pending' WHERE status IS NULL;");
    expect(proposal.proposedSql).toContain("ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';");
    expect(proposal.proposedSql).toContain("ALTER TABLE orders ALTER COLUMN status SET NOT NULL;");
    expect(proposal.rollbackSql).toContain("ALTER TABLE orders DROP COLUMN IF EXISTS status;");

    expect(proposal.riskReductionSummary.beforeRisk).toBe("HIGH");
    expect(proposal.riskReductionSummary.afterRisk).toBe("LOW");
    expect(proposal.riskReductionSummary.eliminatedFactors).toContain("Exclusive table rewrite lock on orders");

    expect(proposal.diff.addedLines).toBeGreaterThan(0);
    expect(proposal.diff.removedLines).toBeGreaterThan(0);
    expect(proposal.proposedSqlFingerprint).toHaveLength(64);
  });

  it("converts CREATE INDEX to CREATE INDEX CONCURRENTLY IF NOT EXISTS", () => {
    const inputSql = `CREATE INDEX idx_users_email ON users(email);`;
    const proposal = generator.generateProposal({
      sessionId: "test-session-2",
      planId: "plan-2",
      targetId: "staging-demo",
      originalSql: inputSql,
      migrationFilePath: "migrations/0039_idx_users_email.sql",
    });

    expect(proposal.proposedSql).toContain("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);");
    expect(proposal.rollbackSql).toContain("DROP INDEX CONCURRENTLY IF EXISTS idx_users_email;");
    expect(proposal.riskReductionSummary.eliminatedFactors).toContain("ShareLock write block on users");
  });

  it("handles complex multi-statement migrations with both table alteration and index creation", () => {
    const inputSql = `
      ALTER TABLE payments ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'unpaid';
      CREATE UNIQUE INDEX idx_payments_tx ON payments(tx_id);
    `;
    const proposal = generator.generateProposal({
      sessionId: "test-session-3",
      planId: "plan-3",
      targetId: "staging-demo",
      originalSql: inputSql,
      migrationFilePath: "migrations/0040_payments.sql",
    });

    expect(proposal.affectedObjects).toContain("payments");
    expect(proposal.proposedSql).toContain("ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(32);");
    expect(proposal.proposedSql).toContain("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_tx ON payments(tx_id);");
    expect(proposal.rollbackSql).toContain("DROP INDEX CONCURRENTLY IF EXISTS idx_payments_tx;");
    expect(proposal.rollbackSql).toContain("ALTER TABLE payments DROP COLUMN IF EXISTS status;");
  });

  it("rejects empty SQL with SafeMigrationValidationError", () => {
    expect(() => {
      generator.generateProposal({
        sessionId: "test-empty",
        planId: "plan-empty",
        targetId: "staging-demo",
        originalSql: "   ",
        migrationFilePath: "migrations/empty.sql",
      });
    }).toThrow(SafeMigrationValidationError);
  });
});
