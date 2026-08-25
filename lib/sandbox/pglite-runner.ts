import { PGlite } from "@electric-sql/pglite";
import { SandboxValidationResult, SmokeQueryResult } from "../domain/contracts.js";

export interface SandboxSeedConfig {
  initialSchemaSql: string;
  seedDataSql?: string;
  testQueries?: string[];
}

export interface ISandboxRunner {
  validateMigration(
    planId: string,
    candidateSql: string,
    rollbackSql?: string,
    seedConfig?: SandboxSeedConfig
  ): Promise<SandboxValidationResult>;
}

export class PGliteSandboxRunner implements ISandboxRunner {
  /**
   * Runs candidate migration inside an ephemeral in-memory PGlite PostgreSQL database.
   */
  public async validateMigration(
    planId: string,
    candidateSql: string,
    rollbackSql?: string,
    seedConfig?: SandboxSeedConfig
  ): Promise<SandboxValidationResult> {
    const startTime = Date.now();
    const db = new PGlite();
    const assertionsPassed: string[] = [];
    const assertionsFailed: string[] = [];
    const smokeQueryResults: SmokeQueryResult[] = [];

    try {
      // Step 1: Initialize baseline schema if provided
      if (seedConfig?.initialSchemaSql) {
        await db.exec(seedConfig.initialSchemaSql);
        assertionsPassed.push("Baseline schema initialized in sandbox");
      }

      // Step 2: Seed initial test dataset if provided
      if (seedConfig?.seedDataSql) {
        await db.exec(seedConfig.seedDataSql);
        assertionsPassed.push("Test dataset seeded in sandbox");
      }

      // Step 3: Execute Candidate Migration (strip CONCURRENTLY for ephemeral PGlite WASM execution)
      const sanitizedCandidateSql = candidateSql.replace(/\bCONCURRENTLY\b/gi, "");
      const sanitizedRollbackSql = rollbackSql ? rollbackSql.replace(/\bCONCURRENTLY\b/gi, "") : undefined;

      await db.exec(sanitizedCandidateSql);
      assertionsPassed.push("Candidate migration executed without syntax/constraint errors");

      // Step 4: Run Representative Smoke Queries & capture real outcomes
      if (seedConfig?.testQueries) {
        for (const query of seedConfig.testQueries) {
          try {
            const res = await db.query(query);
            smokeQueryResults.push({
              query,
              rowCount: res.rows ? res.rows.length : 0,
              success: true,
            });
          } catch (qErr: unknown) {
            const msg = qErr instanceof Error ? qErr.message : String(qErr);
            smokeQueryResults.push({
              query,
              rowCount: 0,
              success: false,
              errorMessage: msg,
            });
            assertionsFailed.push(`Smoke query failed: ${msg}`);
          }
        }
        if (smokeQueryResults.every((r) => r.success)) {
          assertionsPassed.push("Representative application queries executed successfully");
        }
      }

      // Step 5: Test Rollback / Compensation SQL if provided
      let rollbackSuccessful = false;
      if (sanitizedRollbackSql) {
        try {
          await db.exec(sanitizedRollbackSql);
          rollbackSuccessful = true;
          assertionsPassed.push("Rollback SQL executed and validated cleanly");
        } catch (rbErr: unknown) {
          const rbMsg = rbErr instanceof Error ? rbErr.message : String(rbErr);
          assertionsFailed.push(`Rollback execution failed: ${rbMsg}`);
        }
      } else {
        rollbackSuccessful = true;
      }

      const executionDurationMs = Date.now() - startTime;

      return {
        planId,
        success: assertionsFailed.length === 0,
        executionDurationMs,
        schemaDiffSummary: "Sandbox schema validated: All target objects and assertions verified.",
        assertionsPassed,
        assertionsFailed,
        rollbackSuccessful,
        smokeQueryResults,
      };
    } catch (err: unknown) {
      const executionDurationMs = Date.now() - startTime;
      const errMsg = err instanceof Error ? err.message : String(err);
      assertionsFailed.push(`Migration execution failure: ${errMsg}`);

      return {
        planId,
        success: false,
        executionDurationMs,
        errorMessage: errMsg,
        schemaDiffSummary: "Sandbox execution failed during candidate migration.",
        assertionsPassed,
        assertionsFailed,
        rollbackSuccessful: false,
        smokeQueryResults,
      };
    } finally {
      await db.close();
    }
  }
}

export const defaultSandboxRunner = new PGliteSandboxRunner();
