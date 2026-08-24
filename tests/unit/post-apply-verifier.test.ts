import { describe, it, expect } from "vitest";
import { PostgresMcpService } from "../../lib/mcp/postgres.js";
import { PostApplyVerifier } from "../../lib/safety/post-apply-verifier.js";
import { MigrationPlan, SchemaSnapshot } from "../../lib/domain/contracts.js";

describe("PostApplyVerifier - Deterministic Invariant Checks", () => {
  const postgresMcp = new PostgresMcpService();
  const verifier = new PostApplyVerifier(postgresMcp);

  const plan: MigrationPlan = {
    id: "plan_test_verify",
    sessionId: "sess_test_verify",
    targetId: "staging-demo",
    userPrompt: "Add status to orders",
    rawSql: "ALTER TABLE orders ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending'; CREATE INDEX idx_orders_status ON orders(status);",
    riskLevel: "HIGH",
    riskFactors: [],
    affectedTables: ["orders"],
    createdAt: new Date().toISOString(),
  };

  it("verifies pre-existing tables, columns, indexes, and application queries", async () => {
    const preSnapshot = await postgresMcp.inspectSchema("staging-demo");
    const result = await verifier.verify("staging-demo", plan, preSnapshot);

    expect(result.checks.length).toBeGreaterThanOrEqual(4);
    expect(result.checks.some((c) => c.name === "SCHEMA_INTROSPECTION" && c.passed)).toBe(true);
    expect(result.checks.some((c) => c.name.includes("APPLICATION_SMOKE_QUERY") && c.passed)).toBe(true);
  });

  it("detects unintended table drops between pre and post snapshots", async () => {
    const fakePreSnapshot: SchemaSnapshot = {
      targetId: "staging-demo",
      timestamp: new Date().toISOString(),
      tables: [
        {
          tableName: "users",
          columns: [],
          primaryKeys: [],
          foreignKeys: [],
          indexes: [],
          estimatedRows: 0,
        },
        {
          tableName: "orders",
          columns: [],
          primaryKeys: [],
          foreignKeys: [],
          indexes: [],
          estimatedRows: 0,
        },
        {
          tableName: "unintended_dropped_table",
          columns: [],
          primaryKeys: [],
          foreignKeys: [],
          indexes: [],
          estimatedRows: 0,
        },
      ],
    };

    const result = await verifier.verify("staging-demo", plan, fakePreSnapshot);
    expect(result.status).toBe("failed");
    expect(result.failures.some((f) => f.includes("Unexpected table drops detected"))).toBe(true);
  });

  it("permits explicitly declared table drops in DROP TABLE migration", async () => {
    const dropPlan: MigrationPlan = {
      id: "plan_drop_test",
      sessionId: "sess_drop_test",
      targetId: "staging-demo",
      userPrompt: "Drop legacy table",
      rawSql: "DROP TABLE IF EXISTS legacy_table;",
      riskLevel: "HIGH",
      riskFactors: [],
      affectedTables: ["legacy_table"],
      createdAt: new Date().toISOString(),
    };

    const fakePreSnapshot: SchemaSnapshot = {
      targetId: "staging-demo",
      timestamp: new Date().toISOString(),
      tables: [
        {
          tableName: "users",
          columns: [],
          primaryKeys: [],
          foreignKeys: [],
          indexes: [],
          estimatedRows: 0,
        },
        {
          tableName: "orders",
          columns: [],
          primaryKeys: [],
          foreignKeys: [],
          indexes: [],
          estimatedRows: 0,
        },
        {
          tableName: "legacy_table",
          columns: [],
          primaryKeys: [],
          foreignKeys: [],
          indexes: [],
          estimatedRows: 0,
        },
      ],
    };

    const result = await verifier.verify("staging-demo", dropPlan, fakePreSnapshot);
    const dropCheck = result.checks.find((c) => c.name === "UNEXPECTED_SCHEMA_MUTATION_CHECK");
    expect(dropCheck?.passed).toBe(true);
  });
});
