import { describe, it, expect } from "vitest";
import { PostgresMcpService } from "../../lib/mcp/postgres.js";

describe("PostgresMCP - Live Schema Introspection & Diagnostics", () => {
  const service = new PostgresMcpService();

  it("inspects registered target schema and extracts table metadata", async () => {
    const snapshot = await service.inspectSchema("demo-postgres");
    expect(snapshot.targetId).toBe("demo-postgres");
    expect(snapshot.tables.length).toBeGreaterThan(0);

    const tableNames = snapshot.tables.map((t) => t.tableName);
    expect(tableNames).toContain("users");
    expect(tableNames).toContain("orders");
  });

  it("executes safe read-only queries", async () => {
    const rows = await service.executeReadOnly(
      "demo-postgres",
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
