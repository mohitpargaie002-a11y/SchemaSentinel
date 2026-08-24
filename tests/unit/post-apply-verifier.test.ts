import { describe, it, expect } from "vitest";
import { PostgresMcpService } from "../../lib/mcp/postgres.js";
import { PostApplyVerifier } from "../../lib/safety/post-apply-verifier.js";
import { MigrationPlan } from "../../lib/domain/contracts.js";

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
});
