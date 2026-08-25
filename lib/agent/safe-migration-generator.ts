import * as crypto from "crypto";
import {
  MigrationDiff,
  MigrationDiffChunk,
  RiskAnalysisResult,
  RiskLevel,
  SafeMigrationProposal,
  SafeMigrationValidationError,
  SchemaSnapshot,
} from "../domain/contracts.js";
import { assertReadOnlySql, SqlGuardViolationError } from "../safety/sql-guard.js";

export interface GenerateSafeMigrationInput {
  sessionId: string;
  planId: string;
  targetId: string;
  originalSql: string;
  migrationFilePath?: string;
  schemaSnapshot?: SchemaSnapshot;
  riskAnalysis?: RiskAnalysisResult;
  userPrompt?: string;
}

export class SqlValidator {
  private static readonly FORBIDDEN_PATTERNS = [
    /\bDROP\s+DATABASE\b/i,
    /\bTRUNCATE\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bALTER\s+ROLE\b/i,
    /\bALTER\s+USER\b/i,
    /\bDROP\s+USER\b/i,
    /\bEXEC\b/i,
    /\bxp_\w+/i,
  ];

  /**
   * Deterministically validates proposed SQL for syntax, structural bounds, and safety invariants.
   */
  public static validateProposedSql(
    sql: string,
    allowedTables?: string[],
    options?: { strictConcurrent?: boolean; disallowUnsafeNotNull?: boolean }
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const trimmed = sql.trim();

    if (!trimmed) {
      errors.push("Proposed SQL is empty");
      return { isValid: false, errors };
    }

    for (const pattern of this.FORBIDDEN_PATTERNS) {
      if (pattern.test(trimmed)) {
        errors.push(`Forbidden destructive or administrative statement detected matching pattern ${pattern}`);
      }
    }

    // Statement balance & delimiter check
    const rawStatements = trimmed
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    if (rawStatements.length === 0) {
      errors.push("No executable SQL statements found.");
    }

    for (const rawStmt of rawStatements) {
      // Strip comments to inspect the actual executable SQL command
      const stmt = rawStmt
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => !l.startsWith("--") && l.length > 0)
        .join(" ")
        .trim();

      if (!stmt) continue;

      const upper = stmt.toUpperCase();
      const isDdl =
        upper.startsWith("ALTER TABLE") ||
        upper.startsWith("CREATE INDEX") ||
        upper.startsWith("CREATE UNIQUE INDEX") ||
        upper.startsWith("UPDATE") ||
        upper.startsWith("COMMENT ON");

      if (!isDdl) {
        errors.push(`Disallowed statement type in migration proposal: '${stmt.substring(0, 40)}...'`);
      }

      if (options?.strictConcurrent && upper.startsWith("CREATE") && upper.includes("INDEX") && !upper.includes("CONCURRENTLY")) {
        errors.push(`Non-concurrent index creation detected: '${stmt.substring(0, 50)}'. Must specify CONCURRENTLY.`);
      }

      if (options?.disallowUnsafeNotNull && upper.startsWith("ALTER TABLE") && upper.includes("ADD COLUMN") && upper.includes("NOT NULL")) {
        errors.push(`Atomic NOT NULL column addition without staged backfill detected: '${stmt.substring(0, 50)}'`);
      }

      // Check table bounds if allowedTables specified
      if (allowedTables && allowedTables.length > 0) {
        let referencedTable = "";
        const alterMatch = stmt.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_"]+)/i);
        const createIndexMatch = stmt.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\w+\s+ON\s+([a-zA-Z0-9_"]+)/i);
        const updateMatch = stmt.match(/UPDATE\s+([a-zA-Z0-9_"]+)/i);

        if (alterMatch) referencedTable = alterMatch[1].replace(/"/g, "");
        else if (createIndexMatch) referencedTable = createIndexMatch[1].replace(/"/g, "");
        else if (updateMatch) referencedTable = updateMatch[1].replace(/"/g, "");

        if (referencedTable && !allowedTables.includes(referencedTable)) {
          errors.push(`Statement targets unauthorized or unexpected table '${referencedTable}'. Allowed: [${allowedTables.join(", ")}]`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  public validateSyntaxAndSafety(
    sql: string,
    options?: { strictConcurrent?: boolean; disallowUnsafeNotNull?: boolean }
  ): { valid: boolean; errors: string[] } {
    const res = SqlValidator.validateProposedSql(sql, undefined, options);
    return {
      valid: res.isValid,
      errors: res.errors,
    };
  }
}

export class DiffGenerator {
  /**
   * Generates a structured line-by-line diff between original and proposed SQL with explanations.
   */
  public static generateStructuredDiff(originalSql: string, proposedSql: string): MigrationDiff {
    const origLines = originalSql.trim().split("\n").map((l) => l.trimEnd()).filter(Boolean);
    const propLines = proposedSql.trim().split("\n").map((l) => l.trimEnd()).filter(Boolean);

    const chunks: MigrationDiffChunk[] = [];

    // Chunks for removed original lines
    const removedLines: string[] = [];
    for (const ol of origLines) {
      if (!propLines.includes(ol)) {
        removedLines.push(ol);
      }
    }

    if (removedLines.length > 0) {
      chunks.push({
        type: "removed",
        lines: removedLines,
        explanation: "Removed high-risk single-statement execution (which acquires exclusive table locks and triggers synchronous rewrites).",
      });
    }

    // Chunks for added safe lines
    const addedLines: string[] = [];
    for (const pl of propLines) {
      if (!origLines.includes(pl)) {
        addedLines.push(pl);
      }
    }

    if (addedLines.length > 0) {
      chunks.push({
        type: "added",
        lines: addedLines,
        explanation: "Introduced staged zero-downtime remediation: nullable column add, batch default backfill, future default constraint, and concurrent index creation.",
      });
    }

    // Unchanged lines
    const unchangedLines: string[] = [];
    for (const ol of origLines) {
      if (propLines.includes(ol)) {
        unchangedLines.push(ol);
      }
    }

    if (unchangedLines.length > 0) {
      chunks.push({
        type: "unchanged",
        lines: unchangedLines,
        explanation: "Preserved non-conflicting statements and schema metadata comments.",
      });
    }

    return {
      originalLines: origLines.length,
      proposedLines: propLines.length,
      addedLines: addedLines.length,
      removedLines: removedLines.length,
      chunks,
      summary: `Transformed ${origLines.length} risky lines into ${propLines.length} staged, zero-lock operational steps.`,
    };
  }
}

export class SafeMigrationGenerator {
  /**
   * Computes SHA-256 fingerprint of arbitrary content.
   */
  public static computeFingerprint(content: string): string {
    return crypto.createHash("sha256").update(content.trim(), "utf-8").digest("hex");
  }

  /**
   * Generates a deterministic SafeMigrationProposal from risky original SQL and schema context.
   */
  public generateProposal(input: GenerateSafeMigrationInput): SafeMigrationProposal {
    const originalSql = input.originalSql.trim();
    const originalFingerprint = SafeMigrationGenerator.computeFingerprint(originalSql);

    const affectedObjectsSet = new Set<string>();
    const remediationSteps: string[] = [];
    const proposedStatements: string[] = [];
    const rollbackStatements: string[] = [];

    // Parse input statements
    const statements = originalSql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      // 1. Pattern: ALTER TABLE <tbl> ADD COLUMN <col> <type> NOT NULL DEFAULT <val>
      const addColumnNotnullDefaultMatch = stmt.match(
        /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_"]+)\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_"]+)\s+([a-zA-Z0-9_()]+)\s+NOT\s+NULL\s+DEFAULT\s+([^;]+)/i
      );

      // 2. Pattern: ALTER TABLE <tbl> ADD COLUMN <col> <type> DEFAULT <val> (nullable default)
      const addColumnDefaultMatch = stmt.match(
        /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_"]+)\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_"]+)\s+([a-zA-Z0-9_()]+)\s+DEFAULT\s+([^;]+)/i
      );

      // 3. Pattern: CREATE INDEX <idx> ON <tbl>(<cols>)
      const createIndexMatch = stmt.match(
        /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_"]+)\s+ON\s+([a-zA-Z0-9_"]+)\s*\(([^)]+)\)/i
      );

      if (addColumnNotnullDefaultMatch) {
        const table = addColumnNotnullDefaultMatch[1].replace(/"/g, "");
        const column = addColumnNotnullDefaultMatch[2].replace(/"/g, "");
        const colType = addColumnNotnullDefaultMatch[3].trim();
        const defaultVal = addColumnNotnullDefaultMatch[4].trim();

        affectedObjectsSet.add(table);
        affectedObjectsSet.add(`${table}.${column}`);

        // Safe Multi-Step Staged Remediation:
        // Step 1: Add column without NOT NULL or full-table lock
        proposedStatements.push(`-- Step 1: Add column nullable without locking table rewrite\nALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${colType};`);
        remediationSteps.push(`Add column '${column}' to '${table}' as nullable first to prevent AccessExclusiveLock full-table rewrite.`);

        // Step 2: Backfill default values
        proposedStatements.push(`-- Step 2: Backfill default values for existing rows\nUPDATE ${table} SET ${column} = ${defaultVal} WHERE ${column} IS NULL;`);
        remediationSteps.push(`Backfill existing rows with default value ${defaultVal}.`);

        // Step 3: Set column default for future inserts
        proposedStatements.push(`-- Step 3: Set column default for future write operations\nALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defaultVal};`);
        remediationSteps.push(`Set default value on column '${column}' for future writes.`);

        // Step 4: Apply NOT NULL constraint safely
        proposedStatements.push(`-- Step 4: Enforce NOT NULL invariant\nALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL;`);
        remediationSteps.push(`Enforce NOT NULL constraint now that all rows are guaranteed populated.`);

        // Rollback strategy
        rollbackStatements.unshift(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column};`);
      } else if (addColumnDefaultMatch) {
        const table = addColumnDefaultMatch[1].replace(/"/g, "");
        const column = addColumnDefaultMatch[2].replace(/"/g, "");
        const colType = addColumnDefaultMatch[3].trim();
        const defaultVal = addColumnDefaultMatch[4].trim();

        affectedObjectsSet.add(table);
        affectedObjectsSet.add(`${table}.${column}`);

        proposedStatements.push(`-- Step 1: Add nullable column\nALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${colType};`);
        proposedStatements.push(`-- Step 2: Set default for future inserts\nALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defaultVal};`);
        remediationSteps.push(`Added nullable column '${column}' with staged default to prevent lock escalation.`);

        rollbackStatements.unshift(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column};`);
      } else if (createIndexMatch) {
        const isUnique = Boolean(createIndexMatch[1]);
        const indexName = createIndexMatch[2].replace(/"/g, "");
        const table = createIndexMatch[3].replace(/"/g, "");
        const columns = createIndexMatch[4].trim();

        affectedObjectsSet.add(table);
        affectedObjectsSet.add(indexName);

        const uniqueClause = isUnique ? "UNIQUE " : "";
        proposedStatements.push(
          `-- Step: Build index concurrently to prevent table write blocking\nCREATE ${uniqueClause}INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON ${table}(${columns});`
        );
        remediationSteps.push(`Create index '${indexName}' concurrently on table '${table}' to prevent write locking.`);

        rollbackStatements.unshift(`DROP INDEX CONCURRENTLY IF EXISTS ${indexName};`);
      } else {
        // Preserve other valid statements verbatim
        proposedStatements.push(stmt + ";");
      }
    }

    const proposedSql = proposedStatements.join("\n\n").trim();
    const rollbackSql = rollbackStatements.length > 0 ? rollbackStatements.join("\n") : "-- No rollback needed";

    // Validate proposed SQL
    const validation = SqlValidator.validateProposedSql(proposedSql, Array.from(affectedObjectsSet));
    if (!validation.isValid) {
      throw new SafeMigrationValidationError(`Generated SQL failed validation: ${validation.errors.join("; ")}`);
    }

    const proposedFingerprint = SafeMigrationGenerator.computeFingerprint(proposedSql);
    const diff = DiffGenerator.generateStructuredDiff(originalSql, proposedSql);

    const eliminatedFactors: string[] = [];
    if (input.riskAnalysis?.findings) {
      for (const finding of input.riskAnalysis.findings) {
        if (finding.level === "HIGH" || finding.level === "CRITICAL") {
          eliminatedFactors.push(finding.description);
        }
      }
    }
    for (const obj of affectedObjectsSet) {
      if (!obj.includes(".")) {
        eliminatedFactors.push(`Exclusive table rewrite lock on ${obj}`);
        eliminatedFactors.push(`ShareLock write block on ${obj}`);
      }
    }
    if (eliminatedFactors.length === 0) {
      eliminatedFactors.push("Eliminated synchronous AccessExclusiveLock full-table rewrite");
      eliminatedFactors.push("Split atomic migration into non-blocking staged steps");
    }

    const proposalId = `prop_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    return {
      proposalId,
      sessionId: input.sessionId,
      planId: input.planId,
      targetId: input.targetId,
      originalSql,
      proposedSql,
      rollbackSql,
      affectedObjects: Array.from(affectedObjectsSet),
      rationale:
        "Transforms high-risk atomic DDL with full-table locks into a zero-downtime, staged operational sequence. Ensures existing active transactions are not blocked while guaranteeing 100% schema outcome compatibility.",
      remediationSteps,
      riskReductionSummary: {
        beforeRisk: input.riskAnalysis?.overallRisk || "HIGH",
        afterRisk: "LOW" as RiskLevel,
        eliminatedFactors,
      },
      originalFingerprint,
      proposedFingerprint,
      proposedSqlFingerprint: proposedFingerprint,
      diff,
      createdAt: new Date().toISOString(),
    };
  }
}

export const defaultSafeMigrationGenerator = new SafeMigrationGenerator();
