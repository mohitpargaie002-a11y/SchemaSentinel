export class SqlGuardViolationError extends Error {
  constructor(message: string) {
    super(`[SqlGuard Violation]: ${message}`);
    this.name = "SqlGuardViolationError";
  }
}

/**
 * Validates whether a SQL query is strictly read-only (SELECT / EXPLAIN / SHOW).
 * Rejects any DDL or DML mutations (INSERT, UPDATE, DELETE, ALTER, DROP, TRUNCATE, CREATE, etc.).
 */
export function assertReadOnlySql(sql: string): void {
  const cleaned = sql
    .replace(/--.*$/gm, "") // remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, "") // remove multi-line comments
    .trim();

  if (!cleaned) {
    throw new SqlGuardViolationError("Empty SQL query is not allowed.");
  }

  // Reject multiple statements separated by semicolon if any statement is destructive
  const statements = cleaned
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const destructiveKeywords = [
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "TRUNCATE",
    "CREATE",
    "GRANT",
    "REVOKE",
    "REPLACE",
    "EXECUTE",
    "CALL",
    "COPY",
    "LOCK",
  ];

  for (const statement of statements) {
    const firstWord = statement.split(/\s+/)[0].toUpperCase();

    if (!["SELECT", "EXPLAIN", "SHOW", "WITH"].includes(firstWord)) {
      throw new SqlGuardViolationError(
        `Statement starting with '${firstWord}' is not permitted in read-only diagnostic mode.`
      );
    }

    // Check for nested mutation keywords (e.g. within CTEs or subqueries like WITH x AS (DELETE ...))
    for (const keyword of destructiveKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(statement)) {
        throw new SqlGuardViolationError(
          `Mutation keyword '${keyword}' detected in read-only SQL.`
        );
      }
    }
  }
}
