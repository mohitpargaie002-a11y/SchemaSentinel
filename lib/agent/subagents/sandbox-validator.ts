import { ISandboxRunner, defaultSandboxRunner } from "../../sandbox/pglite-runner.js";
import { BASELINE_ECOMMERCE_SCHEMA, BASELINE_SEED_DATA, SAMPLE_REPRESENTATIVE_QUERIES } from "../../sandbox/fixtures.js";
import { SandboxValidationResult, SandboxValidationOutput } from "../../domain/contracts.js";

export interface ISandboxValidatorSubagent {
  validateInSandbox(
    planId: string,
    rawSql: string,
    rollbackSql?: string
  ): Promise<{
    sandboxResult: SandboxValidationResult;
    sandboxOutput: SandboxValidationOutput;
  }>;
}

export class SandboxValidatorSubagent implements ISandboxValidatorSubagent {
  private sandboxRunner: ISandboxRunner;

  constructor(sandboxRunner: ISandboxRunner = defaultSandboxRunner) {
    this.sandboxRunner = sandboxRunner;
  }

  /**
   * Executes candidate migration in an isolated ephemeral PGlite sandbox.
   * Runs schema assertions, test queries, and rollback validation.
   * MUST NEVER touch staging or production databases.
   */
  public async validateInSandbox(
    planId: string,
    rawSql: string,
    rollbackSql?: string
  ): Promise<{
    sandboxResult: SandboxValidationResult;
    sandboxOutput: SandboxValidationOutput;
  }> {
    const sandboxResult = await this.sandboxRunner.validateMigration(
      planId,
      rawSql,
      rollbackSql,
      {
        initialSchemaSql: BASELINE_ECOMMERCE_SCHEMA,
        seedDataSql: BASELINE_SEED_DATA,
        testQueries: SAMPLE_REPRESENTATIVE_QUERIES,
      }
    );

    const smokeQueryResults = sandboxResult.smokeQueryResults || [];

    const sandboxOutput: SandboxValidationOutput = {
      planId,
      success: sandboxResult.success,
      executionDurationMs: sandboxResult.executionDurationMs,
      schemaDiffSummary: sandboxResult.schemaDiffSummary,
      assertionsPassed: sandboxResult.assertionsPassed,
      assertionsFailed: sandboxResult.assertionsFailed,
      rollbackSuccessful: sandboxResult.rollbackSuccessful,
      smokeQueryResults,
      errorMessage: sandboxResult.errorMessage,
    };

    return { sandboxResult, sandboxOutput };
  }
}
