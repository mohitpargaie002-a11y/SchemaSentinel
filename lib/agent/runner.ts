import { AgentContext } from "./types.js";
import { PostgresMcpService, defaultPostgresMcpService } from "../mcp/postgres.js";
import { PGliteSandboxRunner, defaultSandboxRunner } from "../sandbox/pglite-runner.js";
import { ApprovalGate, defaultApprovalGate } from "../safety/approval-gate.js";
import { classifyMigrationRisk } from "../domain/risk-classifier.js";
import { MigrationPlan } from "../domain/contracts.js";

export class SchemaSentinelAgentHarness {
  private postgresMcp: PostgresMcpService;
  private sandboxRunner: PGliteSandboxRunner;
  private approvalGate: ApprovalGate;

  constructor(
    postgresMcp: PostgresMcpService = defaultPostgresMcpService,
    sandboxRunner: PGliteSandboxRunner = defaultSandboxRunner,
    approvalGate: ApprovalGate = defaultApprovalGate
  ) {
    this.postgresMcp = postgresMcp;
    this.sandboxRunner = sandboxRunner;
    this.approvalGate = approvalGate;
  }

  /**
   * Initializes a new migration investigation session.
   */
  public createSession(
    sessionId: string,
    targetId: string,
    userPrompt: string
  ): AgentContext {
    return {
      sessionId,
      targetId,
      status: "IDLE",
      userPrompt,
      timeline: [
        {
          timestamp: new Date().toISOString(),
          step: "SESSION_INIT",
          status: "COMPLETED",
          details: `Session '${sessionId}' initialized for target '${targetId}'.`,
        },
      ],
    };
  }

  /**
   * Runs the pre-approval investigation pipeline:
   * 1. Inspect schema via Postgres MCP
   * 2. Formulate candidate migration & classify risk
   * 3. Validate in isolated PGlite sandbox
   * 4. Halt at Human Approval Checkpoint
   */
  public async runPreApprovalPipeline(context: AgentContext): Promise<AgentContext> {
    // 1. Inspect Schema
    context.status = "INSPECTING";
    context.timeline.push({
      timestamp: new Date().toISOString(),
      step: "SCHEMA_INSPECTION",
      status: "STARTED",
      details: "Inspecting PostgreSQL schema via Postgres MCP...",
    });

    const schema = await this.postgresMcp.inspectSchema(context.targetId);
    context.schemaSnapshot = schema;
    context.timeline.push({
      timestamp: new Date().toISOString(),
      step: "SCHEMA_INSPECTION",
      status: "COMPLETED",
      details: `Discovered ${schema.tables.length} tables in target '${context.targetId}'.`,
    });

    // 2. Formulate Migration Plan & Analyze Risk
    context.status = "PLANNING";
    const planId = `plan_${Date.now()}`;
    const candidateSql = `ALTER TABLE orders ADD COLUMN fulfillment_status VARCHAR(32) NOT NULL DEFAULT 'pending';\nCREATE INDEX idx_orders_fulfillment_status ON orders(fulfillment_status);`;
    const rollbackSql = `DROP INDEX IF EXISTS idx_orders_fulfillment_status;\nALTER TABLE orders DROP COLUMN IF EXISTS fulfillment_status;`;

    const risk = classifyMigrationRisk(candidateSql);

    const plan: MigrationPlan = {
      id: planId,
      sessionId: context.sessionId,
      targetId: context.targetId,
      userPrompt: context.userPrompt,
      rawSql: candidateSql,
      riskLevel: risk.level,
      riskFactors: risk.factors,
      affectedTables: ["orders"],
      rollbackSql,
      createdAt: new Date().toISOString(),
    };
    context.plan = plan;

    // 3. Sandbox Validation
    context.status = "SANDBOXING";
    context.timeline.push({
      timestamp: new Date().toISOString(),
      step: "SANDBOX_VALIDATION",
      status: "STARTED",
      details: "Running candidate DDL inside isolated PGlite sandbox...",
    });

    const baselineSchema = `
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        user_id INT,
        total_amount NUMERIC(10, 2)
      );
    `;

    const sandboxResult = await this.sandboxRunner.validateMigration(
      plan.id,
      plan.rawSql,
      plan.rollbackSql,
      {
        initialSchemaSql: baselineSchema,
        seedDataSql: `INSERT INTO orders (user_id, total_amount) VALUES (1, 99.99), (2, 149.50);`,
        testQueries: [`SELECT * FROM orders WHERE total_amount > 50;`],
      }
    );
    context.sandboxResult = sandboxResult;

    context.timeline.push({
      timestamp: new Date().toISOString(),
      step: "SANDBOX_VALIDATION",
      status: sandboxResult.success ? "COMPLETED" : "FAILED",
      details: `Sandbox validation ${sandboxResult.success ? "PASSED" : "FAILED"} in ${sandboxResult.executionDurationMs}ms.`,
    });

    // 4. Halt at Human Approval Checkpoint
    context.status = "AWAITING_APPROVAL";
    context.timeline.push({
      timestamp: new Date().toISOString(),
      step: "APPROVAL_GATE",
      status: "PAUSED_FOR_APPROVAL",
      details: `Execution halted. Risk Level: ${plan.riskLevel}. Irreversible apply blocked pending human authorization.`,
    });

    return context;
  }

  /**
   * Resumes execution after human grants approval token.
   */
  public async runApprovedApply(
    context: AgentContext,
    approvalToken: string
  ): Promise<AgentContext> {
    if (context.status !== "AWAITING_APPROVAL") {
      throw new Error(
        `Cannot execute apply: Session is in '${context.status}' state, expected 'AWAITING_APPROVAL'.`
      );
    }

    if (!context.plan) {
      throw new Error("Cannot execute apply: No migration plan found in session context.");
    }

    context.status = "APPLYING";
    context.timeline.push({
      timestamp: new Date().toISOString(),
      step: "APPLY_MIGRATION",
      status: "STARTED",
      details: "Applying approved migration to target database...",
    });

    const applyResult = await this.postgresMcp.applyMigration(
      context.targetId,
      context.sessionId,
      context.plan.id,
      context.plan.rawSql,
      approvalToken
    );

    context.applyResult = applyResult;
    context.status = "COMPLETED";
    context.timeline.push({
      timestamp: new Date().toISOString(),
      step: "APPLY_MIGRATION",
      status: "COMPLETED",
      details: `Applied successfully in ${applyResult.executionDurationMs}ms. Schema verified.`,
    });

    return context;
  }
}

export const defaultAgentHarness = new SchemaSentinelAgentHarness();
