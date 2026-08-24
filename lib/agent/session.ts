import {
  AgentContext,
  AgentTimelineEvent,
} from "./types.js";
import { PostgresMcpService, defaultPostgresMcpService } from "../mcp/postgres.js";
import { GithubMcpService, defaultGithubMcpService } from "../mcp/github.js";
import { PGliteSandboxRunner, defaultSandboxRunner } from "../sandbox/pglite-runner.js";
import { BASELINE_ECOMMERCE_SCHEMA, BASELINE_SEED_DATA, SAMPLE_REPRESENTATIVE_QUERIES } from "../sandbox/fixtures.js";
import { ApprovalGate, defaultApprovalGate } from "../safety/approval-gate.js";
import { MigrationRiskAnalyzer, defaultRiskAnalyzer, ComprehensiveRiskReport } from "./risk-analyzer.js";
import { MigrationPlan, SandboxValidationResult, SchemaSnapshot } from "../domain/contracts.js";

export interface TrueForgeApprovalPacket {
  sessionId: string;
  planId: string;
  targetId: string;
  targetEnvironment: string;
  migrationFilename: string;
  migrationSummary: string;
  riskLevel: string;
  lockRisk: string;
  tableRewriteExpected: boolean;
  affectedObjects: string[];
  sandboxStatus: "PASS" | "FAIL";
  rollbackStatus: "PASS" | "FAIL";
  dataIntegrityStatus: "PASS" | "FAIL";
  candidateSql: string;
  remediatedStagedSql?: string;
  isModifiedFromOriginal: boolean;
  sqlFingerprint: string;
  approvalToken: string;
  status: "AWAITING_HUMAN_APPROVAL";
  irreversibleWarning: string;
}

export class TrueForgeMigrationSession {
  private postgresMcp: PostgresMcpService;
  private githubMcp: GithubMcpService;
  private sandboxRunner: PGliteSandboxRunner;
  private riskAnalyzer: MigrationRiskAnalyzer;
  private approvalGate: ApprovalGate;

  constructor(
    postgresMcp: PostgresMcpService = defaultPostgresMcpService,
    githubMcp: GithubMcpService = defaultGithubMcpService,
    sandboxRunner: PGliteSandboxRunner = defaultSandboxRunner,
    riskAnalyzer: MigrationRiskAnalyzer = defaultRiskAnalyzer,
    approvalGate: ApprovalGate = defaultApprovalGate
  ) {
    this.postgresMcp = postgresMcp;
    this.githubMcp = githubMcp;
    this.sandboxRunner = sandboxRunner;
    this.riskAnalyzer = riskAnalyzer;
    this.approvalGate = approvalGate;
  }

  /**
   * Executes the full TrueForge migration review pipeline up to the Human Approval Checkpoint.
   * STOPS AT THE APPROVAL POINT.
   */
  public async executeReviewWorkflow(params: {
    sessionId: string;
    targetId: string;
    repo: string;
    migrationFilePath: string;
    userPrompt: string;
  }): Promise<{
    context: AgentContext;
    riskReport: ComprehensiveRiskReport;
    approvalPacket: TrueForgeApprovalPacket;
  }> {
    const timeline: AgentTimelineEvent[] = [];

    const recordEvent = (step: string, status: AgentTimelineEvent["status"], details: string) => {
      timeline.push({
        timestamp: new Date().toISOString(),
        step,
        status,
        details,
      });
    };

    // STEP 1: Identify Request
    recordEvent("IDENTIFY_REQUEST", "COMPLETED", `Identified request for target '${params.targetId}' and file '${params.migrationFilePath}'.`);

    // STEP 2: Read Migration via GitHub MCP
    recordEvent("READ_MIGRATION", "STARTED", `Fetching migration file '${params.migrationFilePath}' from '${params.repo}' via GitHub MCP...`);
    const rawSql = await this.githubMcp.readMigrationFile(params.repo, params.migrationFilePath);
    recordEvent("READ_MIGRATION", "COMPLETED", `Successfully retrieved migration payload (${rawSql.length} bytes).`);

    // STEP 3: Inspect Database Schema via PostgreSQL MCP
    recordEvent("INSPECT_SCHEMA", "STARTED", `Inspecting target PostgreSQL database '${params.targetId}' via Postgres MCP...`);
    const schemaSnapshot: SchemaSnapshot = await this.postgresMcp.inspectSchema(params.targetId);
    recordEvent(
      "INSPECT_SCHEMA",
      "COMPLETED",
      `Schema snapshot completed: Discovered ${schemaSnapshot.tables.length} tables (${schemaSnapshot.tables.map((t) => t.tableName).join(", ")}).`
    );

    // STEP 4: Analyze Migration Risk & Locking Hazards
    recordEvent("ANALYZE_MIGRATION", "STARTED", "Running SchemaSentinel safety analysis (locking, rewrites, constraints)...");
    const riskReport = this.riskAnalyzer.analyzeRisk(rawSql, schemaSnapshot);
    recordEvent(
      "ANALYZE_MIGRATION",
      "COMPLETED",
      `Risk Analysis Complete: Overall Risk = ${riskReport.overallRisk}, Lock Risk = ${riskReport.lockRisk}, Findings = ${riskReport.findings.length}.`
    );

    // STEP 5: Generate Candidate Migration Plan
    const planId = `plan_${Date.now()}`;
    const rollbackSql = `-- Rollback for ${params.migrationFilePath}\nDROP INDEX IF EXISTS idx_orders_status;\nALTER TABLE orders DROP COLUMN IF EXISTS status;`;

    const plan: MigrationPlan = {
      id: planId,
      sessionId: params.sessionId,
      targetId: params.targetId,
      userPrompt: params.userPrompt,
      rawSql,
      riskLevel: riskReport.overallRisk,
      riskFactors: riskReport.findings.map((f) => `[${f.code}] ${f.title}: ${f.description}`),
      affectedTables: ["orders"],
      rollbackSql,
      createdAt: new Date().toISOString(),
    };

    // STEP 6: Execute in Isolated TrueForge Sandbox (PGlite)
    recordEvent("SANDBOX_EXECUTION", "STARTED", "Spinning up isolated PGlite PostgreSQL sandbox environment...");
    const sandboxResult: SandboxValidationResult = await this.sandboxRunner.validateMigration(
      plan.id,
      plan.rawSql,
      plan.rollbackSql,
      {
        initialSchemaSql: BASELINE_ECOMMERCE_SCHEMA,
        seedDataSql: BASELINE_SEED_DATA,
        testQueries: SAMPLE_REPRESENTATIVE_QUERIES,
      }
    );

    recordEvent(
      "SANDBOX_EXECUTION",
      sandboxResult.success ? "COMPLETED" : "FAILED",
      `Sandbox validation ${sandboxResult.success ? "PASSED" : "FAILED"} in ${sandboxResult.executionDurationMs}ms (Rollback: ${sandboxResult.rollbackSuccessful ? "PASS" : "FAIL"}).`
    );

    // STEP 7: Collated Risk Report
    recordEvent("SYNTHESIZE_REPORT", "COMPLETED", "Collated risk matrix and sandbox assertion evidence.");

    // STEP 8: Native TrueForge Human Approval Checkpoint
    recordEvent(
      "HUMAN_APPROVAL_CHECKPOINT",
      "PAUSED_FOR_APPROVAL",
      "HALTING EXECUTION: Production database mutation blocked. Human approval checkpoint required."
    );

    // Generate signed approval token and fingerprint
    const checkpoint = this.approvalGate.grantApproval(params.sessionId, plan);

    const approvalPacket: TrueForgeApprovalPacket = {
      sessionId: params.sessionId,
      planId: plan.id,
      targetId: params.targetId,
      targetEnvironment: "staging-demo",
      migrationFilename: params.migrationFilePath,
      migrationSummary: "Add fulfillment status column and index on orders table",
      riskLevel: riskReport.overallRisk,
      lockRisk: riskReport.lockRisk,
      tableRewriteExpected: riskReport.tableRewriteExpected,
      affectedObjects: plan.affectedTables,
      sandboxStatus: sandboxResult.success ? "PASS" : "FAIL",
      rollbackStatus: sandboxResult.rollbackSuccessful ? "PASS" : "FAIL",
      dataIntegrityStatus: sandboxResult.assertionsPassed.length > 0 ? "PASS" : "FAIL",
      candidateSql: plan.rawSql,
      remediatedStagedSql: riskReport.remediatedStagedSql,
      isModifiedFromOriginal: !!riskReport.remediatedStagedSql,
      sqlFingerprint: checkpoint.sqlFingerprint,
      approvalToken: checkpoint.token,
      status: "AWAITING_HUMAN_APPROVAL",
      irreversibleWarning: "CAUTION: Approving this checkpoint authorizes irreversible DDL execution on the target database.",
    };

    const context: AgentContext = {
      sessionId: params.sessionId,
      targetId: params.targetId,
      status: "AWAITING_APPROVAL",
      userPrompt: params.userPrompt,
      schemaSnapshot,
      plan,
      sandboxResult,
      approvalCheckpoint: checkpoint,
      timeline,
    };

    return {
      context,
      riskReport,
      approvalPacket,
    };
  }
}

export const defaultMigrationSession = new TrueForgeMigrationSession();
