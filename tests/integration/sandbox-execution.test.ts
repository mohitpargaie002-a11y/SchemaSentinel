import { describe, it, expect } from "vitest";
import { PGliteSandboxRunner } from "../../lib/sandbox/pglite-runner.js";

describe("SandboxExecution - PGlite Ephemeral Isolation", () => {
  const runner = new PGliteSandboxRunner();

  it("successfully applies DDL and verifies schema invariants in sandbox", async () => {
    const baselineSchema = `
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(100) NOT NULL,
        amount NUMERIC(10, 2) NOT NULL
      );
    `;

    const candidateSql = `
      ALTER TABLE orders ADD COLUMN order_status VARCHAR(32) DEFAULT 'pending';
      CREATE INDEX idx_orders_status ON orders(order_status);
    `;

    const rollbackSql = `
      DROP INDEX IF EXISTS idx_orders_status;
      ALTER TABLE orders DROP COLUMN IF EXISTS order_status;
    `;

    const result = await runner.validateMigration(
      "plan_test_01",
      candidateSql,
      rollbackSql,
      {
        initialSchemaSql: baselineSchema,
        seedDataSql: "INSERT INTO orders (customer_name, amount) VALUES ('Alice', 100.00);",
        testQueries: ["SELECT * FROM orders WHERE order_status = 'pending';"],
      }
    );

    expect(result.success).toBe(true);
    expect(result.rollbackSuccessful).toBe(true);
    expect(result.assertionsPassed.length).toBeGreaterThan(2);
    expect(result.assertionsFailed.length).toBe(0);
  });

  it("catches syntax and constraint failures in candidate SQL", async () => {
    const invalidSql = "ALTER TABLE non_existent_table ADD COLUMN test INT;";
    const result = await runner.validateMigration("plan_invalid", invalidSql);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBeDefined();
    expect(result.assertionsFailed.length).toBeGreaterThan(0);
  });
});
