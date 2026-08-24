import { IPostgresMcpService } from "../mcp/postgres.js";
import { MigrationPlan, VerificationResult, VerificationCheck, SchemaSnapshot } from "../domain/contracts.js";

export interface IPostApplyVerifier {
  verify(
    targetId: string,
    plan: MigrationPlan,
    preSnapshot?: SchemaSnapshot
  ): Promise<VerificationResult>;
}

function normalizePostgresType(type: string): string {
  const t = type.toLowerCase().trim();
  if (t.startsWith("varchar") || t.startsWith("character varying")) return "varchar";
  if (t.startsWith("int8") || t.startsWith("bigint")) return "bigint";
  if (t.startsWith("int4") || t.startsWith("integer") || t === "int") return "integer";
  if (t.startsWith("int2") || t.startsWith("smallint")) return "smallint";
  if (t.startsWith("bool")) return "boolean";
  if (t.startsWith("text")) return "text";
  if (t.startsWith("timestamp")) return "timestamp";
  if (t.startsWith("jsonb")) return "jsonb";
  if (t.startsWith("json")) return "json";
  return t.replace(/\([^)]*\)/g, "").trim();
}

export class PostApplyVerifier implements IPostApplyVerifier {
  private postgresMcp: IPostgresMcpService;

  constructor(postgresMcp: IPostgresMcpService) {
    this.postgresMcp = postgresMcp;
  }

  /**
   * Deterministically verifies that the applied migration matches expectations and did not degrade database integrity.
   */
  public async verify(
    targetId: string,
    plan: MigrationPlan,
    preSnapshot?: SchemaSnapshot
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const checks: VerificationCheck[] = [];
    const failures: string[] = [];

    try {
      // Check 1: Post-apply live catalog introspection
      const postSnapshot = await this.postgresMcp.inspectSchema(targetId);
      checks.push({
        name: "SCHEMA_INTROSPECTION",
        passed: true,
        details: `Successfully introspected ${postSnapshot.tables.length} tables in target catalog '${targetId}'.`,
      });

      // Check 2: Verify Affected Tables Exist (unless explicitly dropped in SQL)
      const explicitlyDroppedTables = new Set<string>();
      const dropMatches = plan.rawSql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_"]+)/gi);
      for (const dm of dropMatches) {
        explicitlyDroppedTables.add(dm[1].replace(/['"`]/g, "").toLowerCase());
      }

      for (const tableName of plan.affectedTables) {
        if (explicitlyDroppedTables.has(tableName.toLowerCase())) {
          continue;
        }
        const table = postSnapshot.tables.find((t) => t.tableName.toLowerCase() === tableName.toLowerCase());
        if (table) {
          checks.push({
            name: `TABLE_EXISTS_${tableName.toUpperCase()}`,
            passed: true,
            details: `Table '${tableName}' verified in post-migration schema.`,
          });
        } else {
          const failMsg = `Affected table '${tableName}' missing from post-migration schema.`;
          failures.push(failMsg);
          checks.push({
            name: `TABLE_EXISTS_${tableName.toUpperCase()}`,
            passed: false,
            details: failMsg,
          });
        }
      }

      // Check 3: Verify Column Additions and Data Types (if ADD COLUMN in rawSql)
      const addColumnMatches = plan.rawSql.matchAll(/ALTER\s+TABLE\s+([^\s;]+)\s+ADD\s+COLUMN\s+([^\s;]+)\s+([^\s;]+)/gi);
      for (const match of addColumnMatches) {
        const tableName = match[1].replace(/['"`]/g, "").toLowerCase();
        const colName = match[2].replace(/['"`]/g, "").toLowerCase();
        const rawExpectedType = match[3].replace(/['"`]/g, "").toLowerCase();

        const table = postSnapshot.tables.find((t) => t.tableName.toLowerCase() === tableName);
        const column = table?.columns.find((c) => c.name.toLowerCase() === colName);

        if (!column) {
          const failMsg = `Expected column '${colName}' was NOT found on '${tableName}'.`;
          failures.push(failMsg);
          checks.push({
            name: `COLUMN_STRUCTURE_${tableName}_${colName}`,
            passed: false,
            details: failMsg,
          });
        } else {
          const expectedNorm = normalizePostgresType(rawExpectedType);
          const liveNorm = normalizePostgresType(column.type);
          if (expectedNorm !== liveNorm) {
            const failMsg = `Column '${colName}' on '${tableName}' has mismatched datatype: expected '${rawExpectedType}' (norm: ${expectedNorm}), found '${column.type}' (norm: ${liveNorm}).`;
            failures.push(failMsg);
            checks.push({
              name: `COLUMN_STRUCTURE_${tableName}_${colName}`,
              passed: false,
              details: failMsg,
            });
          } else {
            checks.push({
              name: `COLUMN_STRUCTURE_${tableName}_${colName}`,
              passed: true,
              details: `Column '${colName}' found on '${tableName}' with validated type '${column.type}'.`,
            });
          }
        }
      }

      // Check 4: Verify Created Indexes (if CREATE INDEX in rawSql)
      const createIndexMatches = plan.rawSql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?([^\s;]+)\s+ON\s+([^\s;(]+)/gi);
      for (const match of createIndexMatches) {
        const indexName = match[1].replace(/['"`]/g, "").toLowerCase();
        const tableName = match[2].replace(/['"`]/g, "").toLowerCase();

        const table = postSnapshot.tables.find((t) => t.tableName.toLowerCase() === tableName);
        const index = table?.indexes.find((i) => i.name.toLowerCase() === indexName);

        if (index) {
          checks.push({
            name: `INDEX_EXISTS_${indexName}`,
            passed: true,
            details: `Index '${indexName}' verified on table '${tableName}'.`,
          });
        } else {
          const failMsg = `Expected index '${indexName}' was NOT found on table '${tableName}'.`;
          failures.push(failMsg);
          checks.push({
            name: `INDEX_EXISTS_${indexName}`,
            passed: false,
            details: failMsg,
          });
        }
      }

      // Check 5: Representative Application Smoke Queries
      const smokeQueries = [
        "SELECT COUNT(*) AS count FROM users;",
        "SELECT COUNT(*) AS count FROM orders;",
        "SELECT o.id, u.email FROM orders o JOIN users u ON o.user_id = u.id LIMIT 5;",
      ];

      for (let i = 0; i < smokeQueries.length; i++) {
        const query = smokeQueries[i];
        try {
          const rows = await this.postgresMcp.executeReadOnly(targetId, query);
          checks.push({
            name: `APPLICATION_SMOKE_QUERY_${i + 1}`,
            passed: true,
            details: `Query '${query}' executed successfully (${rows.length} rows returned).`,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const failMsg = `Application smoke query '${query}' failed: ${msg}`;
          failures.push(failMsg);
          checks.push({
            name: `APPLICATION_SMOKE_QUERY_${i + 1}`,
            passed: false,
            details: failMsg,
          });
        }
      }

      // Check 6: Validate No Unintended Table Deletions
      if (preSnapshot) {
        const preTableNames = preSnapshot.tables.map((t) => t.tableName.toLowerCase());
        const postTableNames = postSnapshot.tables.map((t) => t.tableName.toLowerCase());
        const droppedTables = preTableNames.filter((t) => !postTableNames.includes(t));
        const unexpectedDrops = droppedTables.filter((t) => !explicitlyDroppedTables.has(t));

        if (unexpectedDrops.length === 0) {
          checks.push({
            name: "UNEXPECTED_SCHEMA_MUTATION_CHECK",
            passed: true,
            details: "No unintended tables or objects were dropped during migration.",
          });
        } else {
          const failMsg = `Unexpected table drops detected: ${unexpectedDrops.join(", ")}`;
          failures.push(failMsg);
          checks.push({
            name: "UNEXPECTED_SCHEMA_MUTATION_CHECK",
            passed: false,
            details: failMsg,
          });
        }
      }

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`Verification engine encountered unexpected error: ${msg}`);
    }

    const executionDurationMs = Date.now() - startTime;
    const status = failures.length === 0 ? "passed" : "failed";

    return {
      status,
      checks,
      failures,
      executionDurationMs,
      timestamp: new Date().toISOString(),
    };
  }
}
