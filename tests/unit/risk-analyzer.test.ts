import { describe, it, expect } from "vitest";
import { MigrationRiskAnalyzer } from "../../lib/agent/risk-analyzer.js";

describe("MigrationRiskAnalyzer - Deep Risk & Locking Evaluation", () => {
  const analyzer = new MigrationRiskAnalyzer();

  it("detects table rewrite and exclusive lock on NOT NULL column with default", () => {
    const dangerousSql = "ALTER TABLE orders ADD COLUMN fulfillment_status VARCHAR(32) NOT NULL DEFAULT 'pending';";
    const report = analyzer.analyzeRisk(dangerousSql);

    expect(report.overallRisk).toBe("HIGH");
    expect(report.lockRisk).toBe("HIGH");
    expect(report.tableRewriteExpected).toBe(true);
    expect(report.requiresStagedRollout).toBe(true);
    expect(report.remediatedStagedSql).toBeDefined();
    expect(report.remediatedStagedSql).toContain("Phase 1: Expand");
    expect(report.remediatedStagedSql).toContain("CREATE INDEX CONCURRENTLY");
  });

  it("detects blocking share lock on non-concurrent index creation", () => {
    const sql = "CREATE INDEX idx_orders_status ON orders(status);";
    const report = analyzer.analyzeRisk(sql);

    expect(report.overallRisk).toBe("MEDIUM");
    expect(report.lockRisk).toBe("MEDIUM");
    expect(report.findings[0].code).toBe("HAZARD_NON_CONCURRENT_INDEX");
  });

  it("flags destructive DROP TABLE as CRITICAL and IRREVERSIBLE", () => {
    const destructiveSql = "DROP TABLE deprecated_orders;";
    const report = analyzer.analyzeRisk(destructiveSql);

    expect(report.overallRisk).toBe("CRITICAL");
    expect(report.rollbackFeasibility).toBe("IRREVERSIBLE");
    expect(report.findings[0].code).toBe("HAZARD_DESTRUCTIVE_DROP");
  });

  it("classifies safe column additions as LOW risk", () => {
    const safeSql = "ALTER TABLE users ADD COLUMN bio TEXT;";
    const report = analyzer.analyzeRisk(safeSql);

    expect(report.overallRisk).toBe("LOW");
    expect(report.tableRewriteExpected).toBe(false);
    expect(report.requiresStagedRollout).toBe(false);
  });
});
