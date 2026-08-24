import { describe, it, expect } from "vitest";
import { classifyMigrationRisk } from "../../lib/domain/risk-classifier.js";

describe("RiskClassifier - DDL Hazard Evaluation", () => {
  it("classifies safe column addition as LOW risk", () => {
    const sql = "ALTER TABLE users ADD COLUMN nickname VARCHAR(64);";
    const result = classifyMigrationRisk(sql);
    expect(result.level).toBe("LOW");
    expect(result.requiresStagedRollout).toBe(false);
  });

  it("classifies NOT NULL column with default as HIGH risk due to table lock", () => {
    const sql = "ALTER TABLE orders ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending';";
    const result = classifyMigrationRisk(sql);
    expect(result.level).toBe("HIGH");
    expect(result.requiresStagedRollout).toBe(true);
    expect(result.factors[0]).toContain("table rewrites and exclusive locks");
  });

  it("flags non-concurrent index creation", () => {
    const sql = "CREATE INDEX idx_orders_user ON orders(user_id);";
    const result = classifyMigrationRisk(sql);
    expect(result.level).toBe("MEDIUM");
    expect(result.factors[0]).toContain("SHARE lock");
  });

  it("flags destructive DROP TABLE operations as HIGH risk", () => {
    const sql = "DROP TABLE deprecated_logs;";
    const result = classifyMigrationRisk(sql);
    expect(result.level).toBe("HIGH");
    expect(result.requiresStagedRollout).toBe(true);
  });
});
