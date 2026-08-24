import { RiskLevel } from "./contracts.js";

export interface RiskAnalysis {
  level: RiskLevel;
  factors: string[];
  remediationSuggestions: string[];
  requiresStagedRollout: boolean;
}

export function classifyMigrationRisk(rawSql: string): RiskAnalysis {
  const sql = rawSql.toUpperCase();
  const factors: string[] = [];
  const remediationSuggestions: string[] = [];

  // Check 1: Adding NOT NULL column with default
  if (/ALTER\s+TABLE\s+.*ADD\s+COLUMN\s+.*NOT\s+NULL.*DEFAULT/i.test(sql)) {
    factors.push(
      "Adding a NOT NULL column with a DEFAULT can trigger table rewrites and exclusive locks on large tables."
    );
    remediationSuggestions.push(
      "Staged approach: 1) Add column as nullable, 2) Set default for new rows, 3) Backfill in batches, 4) Apply NOT NULL constraint."
    );
  }

  // Check 2: Non-concurrent index creation
  if (/CREATE\s+INDEX\s+/i.test(sql) && !/CREATE\s+INDEX\s+CONCURRENTLY/i.test(sql)) {
    factors.push(
      "Standard 'CREATE INDEX' acquires a SHARE lock, blocking write operations on the target table."
    );
    remediationSuggestions.push(
      "Use 'CREATE INDEX CONCURRENTLY' to prevent blocking concurrent write traffic."
    );
  }

  // Check 3: Dropping tables or columns
  if (/DROP\s+TABLE/i.test(sql) || /DROP\s+COLUMN/i.test(sql)) {
    factors.push(
      "Destructive DROP operation detected. Data loss and immediate application incompatibility risk."
    );
    remediationSuggestions.push(
      "Ensure column/table is completely unused by active application code across all deployments before dropping."
    );
  }

  // Check 4: Type alteration
  if (/ALTER\s+TABLE\s+.*ALTER\s+COLUMN\s+.*TYPE/i.test(sql)) {
    factors.push(
      "Changing column type requires full table scan/rewrite and ACCESS EXCLUSIVE lock."
    );
    remediationSuggestions.push(
      "Add new column with target type, dual-write, backfill, and swap column names."
    );
  }

  let level: RiskLevel = "LOW";
  if (factors.length >= 3 || /DROP\s+DATABASE/i.test(sql)) {
    level = "CRITICAL";
  } else if (factors.length >= 2 || /DROP\s+TABLE/i.test(sql) || (/ALTER\s+TABLE/i.test(sql) && /NOT\s+NULL/i.test(sql))) {
    level = "HIGH";
  } else if (factors.length === 1) {
    level = "MEDIUM";
  }

  return {
    level,
    factors: factors.length > 0 ? factors : ["Standard non-blocking DDL detected."],
    remediationSuggestions:
      remediationSuggestions.length > 0
        ? remediationSuggestions
        : ["No remediation required for safe operations."],
    requiresStagedRollout: level === "HIGH" || level === "CRITICAL",
  };
}
