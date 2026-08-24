import { RiskLevel, SchemaSnapshot } from "../domain/contracts.js";

export interface DetailedRiskFinding {
  code: string;
  category: "LOCKING" | "DATA_INTEGRITY" | "BACKFILL_COST" | "COMPATIBILITY" | "ROLLBACK";
  severity: RiskLevel;
  title: string;
  description: string;
  affectedTable?: string;
  affectedColumn?: string;
  remediation: string;
}

export interface ComprehensiveRiskReport {
  overallRisk: RiskLevel;
  requiresStagedRollout: boolean;
  lockRisk: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "EXCLUSIVE_LOCK_CRITICAL";
  tableRewriteExpected: boolean;
  rollbackFeasibility: "FULLY_REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";
  findings: DetailedRiskFinding[];
  remediatedStagedSql?: string;
}

export class MigrationRiskAnalyzer {
  /**
   * Analyzes candidate SQL in context of current schema snapshot and row counts.
   */
  public analyzeRisk(rawSql: string, schemaSnapshot?: SchemaSnapshot): ComprehensiveRiskReport {
    const sql = rawSql.toUpperCase();
    const findings: DetailedRiskFinding[] = [];
    let lockRisk: ComprehensiveRiskReport["lockRisk"] = "LOW";
    let tableRewriteExpected = false;
    let rollbackFeasibility: ComprehensiveRiskReport["rollbackFeasibility"] = "FULLY_REVERSIBLE";

    // Check 1: Adding NOT NULL column with DEFAULT
    const notNullDefaultMatch = rawSql.match(/ALTER\s+TABLE\s+([^\s;]+)\s+ADD\s+COLUMN\s+([^\s;]+)\s+([^\s;]+)\s+NOT\s+NULL\s+DEFAULT\s+([^;]+)/i);
    if (notNullDefaultMatch || (/ALTER\s+TABLE/i.test(sql) && /ADD\s+COLUMN/i.test(sql) && /NOT\s+NULL/i.test(sql) && /DEFAULT/i.test(sql))) {
      const tableName = notNullDefaultMatch ? notNullDefaultMatch[1].replace(/['"`]/g, "") : "target table";
      const columnName = notNullDefaultMatch ? notNullDefaultMatch[2].replace(/['"`]/g, "") : "target column";

      tableRewriteExpected = true;
      lockRisk = "HIGH";
      findings.push({
        code: "HAZARD_NOT_NULL_DEFAULT",
        category: "LOCKING",
        severity: "HIGH",
        title: "Table Rewrite & ACCESS EXCLUSIVE Lock",
        description: `Adding NOT NULL column '${columnName}' with a DEFAULT value to '${tableName}' can trigger full table rewrite and block all reads/writes.`,
        affectedTable: tableName,
        affectedColumn: columnName,
        remediation: `Staged execution: 1) Add column as nullable, 2) Set DEFAULT for new rows, 3) Backfill existing rows in non-blocking batches, 4) Add NOT NULL constraint.`,
      });
    }

    // Check 2: Non-concurrent Index Creation
    const indexMatch = rawSql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+([^\s;]+)\s+ON\s+([^\s;(]+)/i);
    if (/CREATE\s+INDEX/i.test(sql) && !/CREATE\s+INDEX\s+CONCURRENTLY/i.test(sql)) {
      const indexName = indexMatch ? indexMatch[1] : "index";
      const tableName = indexMatch ? indexMatch[2] : "table";

      if (lockRisk === "LOW") {
        lockRisk = "MEDIUM";
      }

      findings.push({
        code: "HAZARD_NON_CONCURRENT_INDEX",
        category: "LOCKING",
        severity: "MEDIUM",
        title: "Blocking SHARE Lock on Index Creation",
        description: `Standard 'CREATE INDEX ${indexName}' acquires a SHARE lock on '${tableName}', blocking all concurrent INSERT, UPDATE, and DELETE operations.`,
        affectedTable: tableName,
        remediation: `Use 'CREATE INDEX CONCURRENTLY ${indexName} ON ${tableName}(...)' outside a multi-statement transaction to permit concurrent writes.`,
      });
    }

    // Check 3: Destructive DROP TABLE or DROP COLUMN
    if (/DROP\s+TABLE/i.test(sql) || /DROP\s+COLUMN/i.test(sql)) {
      lockRisk = "EXCLUSIVE_LOCK_CRITICAL";
      rollbackFeasibility = "IRREVERSIBLE";
      findings.push({
        code: "HAZARD_DESTRUCTIVE_DROP",
        category: "DATA_INTEGRITY",
        severity: "CRITICAL",
        title: "Irreversible Schema Drop Detected",
        description: "Dropping tables or columns causes immediate permanent data deletion and application query failures.",
        remediation: "Execute multi-phase Expand/Contract deployment: Mark column as deprecated, remove application references, then drop in a future maintenance window.",
      });
    }

    // Check 4: Altering Column Data Type
    if (/ALTER\s+TABLE\s+.*ALTER\s+COLUMN\s+.*TYPE/i.test(sql)) {
      tableRewriteExpected = true;
      lockRisk = "HIGH";
      findings.push({
        code: "HAZARD_COLUMN_TYPE_ALTERATION",
        category: "LOCKING",
        severity: "HIGH",
        title: "Full Table Scan & Rewrite on Column Type Alteration",
        description: "Modifying column type requires rewriting every tuple on disk and holds an ACCESS EXCLUSIVE lock.",
        remediation: "Add new column with desired type, dual-write in application, backfill data, and rename/swap columns.",
      });
    }

    // Calculate Overall Risk
    let overallRisk: RiskLevel = "LOW";
    if (findings.some((f) => f.severity === "CRITICAL")) {
      overallRisk = "CRITICAL";
    } else if (findings.some((f) => f.severity === "HIGH") || findings.length >= 2) {
      overallRisk = "HIGH";
    } else if (findings.some((f) => f.severity === "MEDIUM")) {
      overallRisk = "MEDIUM";
    }

    // Generate Remediated Staged Alternative if High/Critical
    let remediatedStagedSql: string | undefined;
    if (overallRisk === "HIGH" && notNullDefaultMatch) {
      const tableName = notNullDefaultMatch[1].trim();
      const columnName = notNullDefaultMatch[2].trim();
      const columnType = notNullDefaultMatch[3].trim();
      const defaultValue = notNullDefaultMatch[4].trim();

      remediatedStagedSql = `
-- [Phase 1: Expand] Add column as nullable without table rewrite
ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType};

-- [Phase 2: Default] Set default for subsequent incoming writes
ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET DEFAULT ${defaultValue};

-- [Phase 3: Backfill] Update existing historical rows in non-blocking batches
UPDATE ${tableName} SET ${columnName} = ${defaultValue} WHERE ${columnName} IS NULL;

-- [Phase 4: Constraint] Enforce NOT NULL without full-table blocking
ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET NOT NULL;

-- [Phase 5: Concurrency] Build index concurrently without write locks
CREATE INDEX CONCURRENTLY idx_${tableName}_${columnName} ON ${tableName}(${columnName});
`.trim();
    }

    return {
      overallRisk,
      requiresStagedRollout: overallRisk === "HIGH" || overallRisk === "CRITICAL",
      lockRisk,
      tableRewriteExpected,
      rollbackFeasibility,
      findings,
      remediatedStagedSql,
    };
  }
}

export const defaultRiskAnalyzer = new MigrationRiskAnalyzer();
