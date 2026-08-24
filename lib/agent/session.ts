import {
  AgentContext,
  AgentTimelineEvent,
} from "./types.js";
import { IPostgresMcpService, defaultPostgresMcpService } from "../mcp/postgres.js";
import { IGithubMcpService, defaultGithubMcpService } from "../mcp/github.js";
import { ISandboxRunner, defaultSandboxRunner } from "../sandbox/pglite-runner.js";
import { BASELINE_ECOMMERCE_SCHEMA, BASELINE_SEED_DATA, SAMPLE_REPRESENTATIVE_QUERIES } from "../sandbox/fixtures.js";
import { IApprovalGate, defaultApprovalGate } from "../safety/approval-gate.js";
import { IRiskAnalyzer, defaultRiskAnalyzer, ComprehensiveRiskReport } from "./risk-analyzer.js";
import { ISessionStore, defaultSessionStore, PersistedSessionState } from "./session-store.js";
import {
  MigrationPlan,
  SandboxValidationResult,
  SchemaSnapshot,
  ApplyResult,
  VerificationResult,
} from "../domain/contracts.js";

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
  private postgresMcp: IPostgresMcpService;
  private githubMcp: IGithubMcpService;
  private sandboxRunner: ISandboxRunner;
  private riskAnalyzer: IRiskAnalyzer;
  private approvalGate: IApprovalGate;
  private sessionStore: ISessionStore;

  constructor(
    postgresMcp: IPostgresMcpService = defaultPostgresMcpService,
    githubMcp: IGithubMcpService = defaultGithubMcpService,
    sandboxRunner: ISandboxRunner = defaultSandboxRunner,
    riskAnalyzer: IRiskAnalyzer = defaultRiskAnalyzer,
    approvalGate: IApprovalGate = defaultApprovalGate,
    sessionStore: ISessionStore = defaultSessionStore
  ) {
    this.postgresMcp = postgresMcp;
    this.githubMcp = githubMcp;
    this.sandboxRunner = sandboxRunner;
    this.riskAnalyzer = riskAnalyzer;
    this.approvalGate = approvalGate;
    this.sessionStore = sessionStore;
  }

  /**
   * Dynamically parses affected tables, created indexes/columns, and generates a reversible rollback script.
   */
  private parsePlanMetadata(rawSql: string, migrationFilePath: string): {
    affectedTables: string[];
    migrationSummary: string;
    rollbackSql: string;
  } {
    const tableSet = new Set<string>();
    const rollbackStatements: string[] = [];
    const summaryParts: string[] = [];

    // Parse CREATE INDEX
    const indexMatches = rawSql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?([^\s;]+)\s+ON\s+([^\s;(]+)/gi);
    for (const match of indexMatches) {
      const indexName = match[1].replace(/['"`]/g, "");
      const tableName = match[2].replace(/['"`]/g, "");
      tableSet.add(tableName);
      rollbackStatements.unshift(`DROP INDEX IF EXISTS ${indexName};`);
      summaryParts.push(`Create index ${indexName} on ${tableName}`);
    }

    // Parse ALTER TABLE ... ADD COLUMN
    const addColMatches = rawSql.matchAll(/ALTER\s+TABLE\s+([^\s;]+)\s+ADD\s+COLUMN\s+([^\s;]+)/gi);
    for (const match of addColMatches) {
      const tableName = match[1].replace(/['"`]/g, "");
      const colName = match[2].replace(/['"`]/g, "");
      tableSet.add(tableName);
      rollbackStatements.push(`ALTER TABLE ${tableName} DROP COLUMN IF EXISTS ${colName};`);
      summaryParts.push(`Add column ${colName} to ${tableName}`);
    }

    // Parse generic ALTER TABLE
    const alterTableMatches = rawSql.matchAll(/ALTER\s+TABLE\s+([^\s;]+)/gi);
    for (const match of alterTableMatches) {
      tableSet.add(match[1].replace(/['"`]/g, ""));
    }

    // Parse DROP TABLE
    const dropTableMatches = rawSql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)/gi);
    for (const match of dropTableMatches) {
      tableSet.add(match[1].replace(/['"`]/g, ""));
      summaryParts.push(`Drop table ${match[1]}`);
    }

    const affectedTables = tableSet.size > 0 ? Array.from(tableSet) : ["unspecified_schema"];
    const migrationSummary = summaryParts.length > 0 ? summaryParts.join(", ") : `Execute migration on ${affectedTables.join(", ")}`;
    const rollbackSql = `-- Rollback for ${migrationFilePath}\n${rollbackStatements.join("\n") || "-- No automated rollback statements generated"}`;

    return {
      affectedTables,
      migrationSummary,
      rollbackSql,
    };
  }

  /**
   * Executes the full TrueForge migration review pipeline up to the Human Approval Checkpoint.
   * Persists session state and STOPS AT THE APPROVAL POINT.
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
    recordEvent("REQUEST_RECEIVED", "COMPLETED", `Received migration review request for target '${params.targetId}' and file '${params.migrationFilePath}'.`);

    // STEP 2: Read Migration via GitHub MCP
    recordEvent("MIGRATION_READ", "STARTED", `Fetching migration file '${params.migrationFilePath}' from '${params.repo}' via GitHub MCP...`);
    const rawSql = await this.githubMcp.readMigrationFile(params.repo, params.migrationFilePath);
    recordEvent("MIGRATION_READ", "COMPLETED", `Successfully retrieved migration payload (${rawSql.length} bytes).`);

    // STEP 3: Inspect Database Schema via PostgreSQL MCP
    recordEvent("SCHEMA_INSPECTED", "STARTED", `Inspecting target PostgreSQL database '${params.targetId}' via Postgres MCP...`);
    const schemaSnapshot: SchemaSnapshot = await this.postgresMcp.inspectSchema(params.targetId);
    recordEvent(
      "SCHEMA_INSPECTED",
      "COMPLETED",
      `Schema snapshot completed: Discovered ${schemaSnapshot.tables.length} tables (${schemaSnapshot.tables.map((t) => t.tableName).join(", ")}).`
    );

    // STEP 4: Analyze Migration Risk & Locking Hazards
    recordEvent("ANALYSIS_COMPLETED", "STARTED", "Running SchemaSentinel safety analysis (locking, rewrites, constraints)...");
    const riskReport = this.riskAnalyzer.analyzeRisk(rawSql, schemaSnapshot);
    recordEvent(
      "ANALYSIS_COMPLETED",
      "COMPLETED",
      `Risk Analysis Complete: Overall Risk = ${riskReport.overallRisk}, Lock Risk = ${riskReport.lockRisk}, Findings = ${riskReport.findings.length}.`
    );

    // STEP 5: Generate Candidate Migration Plan
    const planId = `plan_${Date.now()}`;
    const { affectedTables, migrationSummary, rollbackSql } = this.parsePlanMetadata(rawSql, params.migrationFilePath);

    const plan: MigrationPlan = {
      id: planId,
      sessionId: params.sessionId,
      targetId: params.targetId,
      userPrompt: params.userPrompt,
      rawSql,
      riskLevel: riskReport.overallRisk,
      riskFactors: riskReport.findings.map((f) => `[${f.code}] ${f.title}: ${f.description}`),
      affectedTables,
      rollbackSql,
      createdAt: new Date().toISOString(),
    };

    // STEP 6: Execute in Isolated TrueForge Sandbox (PGlite)
    recordEvent("SANDBOX_COMPLETED", "STARTED", "Spinning up isolated PGlite PostgreSQL sandbox environment...");
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
      "SANDBOX_COMPLETED",
      sandboxResult.success ? "COMPLETED" : "FAILED",
      `Sandbox validation ${sandboxResult.success ? "PASSED" : "FAILED"} in ${sandboxResult.executionDurationMs}ms (Rollback: ${sandboxResult.rollbackSuccessful ? "PASS" : "FAIL"}).`
    );

    // STEP 7: Native TrueForge Human Approval Checkpoint
    recordEvent(
      "APPROVAL_REQUESTED",
      "PAUSED_FOR_APPROVAL",
      "HALTING EXECUTION: Production database mutation blocked. Human approval checkpoint required."
    );

    // Generate signed approval token and fingerprint
    const checkpoint = this.approvalGate.grantApproval(params.sessionId, plan);
    const dataIntegrityPassed = sandboxResult.success && sandboxResult.assertionsFailed.length === 0 && sandboxResult.assertionsPassed.length > 0;

    const approvalPacket: TrueForgeApprovalPacket = {
      sessionId: params.sessionId,
      planId: plan.id,
      targetId: params.targetId,
      targetEnvironment: "staging-demo",
      migrationFilename: params.migrationFilePath,
      migrationSummary,
      riskLevel: riskReport.overallRisk,
      lockRisk: riskReport.lockRisk,
      tableRewriteExpected: riskReport.tableRewriteExpected,
      affectedObjects: plan.affectedTables,
      sandboxStatus: sandboxResult.success ? "PASS" : "FAIL",
      rollbackStatus: sandboxResult.rollbackSuccessful ? "PASS" : "FAIL",
      dataIntegrityStatus: dataIntegrityPassed ? "PASS" : "FAIL",
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

    // STEP 8: Persist Session State
    await this.sessionStore.saveSession({
      sessionId: params.sessionId,
      targetId: params.targetId,
      repo: params.repo,
      migrationFilePath: params.migrationFilePath,
      userPrompt: params.userPrompt,
      status: "AWAITING_APPROVAL",
      currentStep: "APPROVAL_REQUESTED",
      schemaSnapshot,
      plan,
      riskReport,
      sandboxResult,
      approvalCheckpoint: checkpoint,
      approvalPacket,
      timeline,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return {
      context,
      riskReport,
      approvalPacket,
    };
  }

  /**
   * Resumes the SAME logical TrueForge session after human decision.
   * If APPROVED, applies migration to allowlisted staging target and verifies invariants.
   * If REJECTED, transitions to REJECTED with zero mutation.
   */
  public async resumeAndApplyWorkflow(params: {
    sessionId: string;
    humanDecision: "APPROVED" | "REJECTED";
    approvalToken?: string;
    approvedBy?: string;
  }): Promise<{
    sessionState: PersistedSessionState;
    applyResult?: ApplyResult;
    verificationResult?: VerificationResult;
  }> {
    // 1. Reconstruct logical session from persistent store
    const session = await this.sessionStore.loadSession(params.sessionId);
    if (!session) {
      throw new Error(`[Session Error]: Session '${params.sessionId}' not found in persistent store.`);
    }

    if (session.status !== "AWAITING_APPROVAL") {
      throw new Error(`[Session Error]: Session '${params.sessionId}' is in state '${session.status}' and cannot be resumed.`);
    }

    const recordEvent = (step: string, status: AgentTimelineEvent["status"], details: string) => {
      session.timeline.push({
        timestamp: new Date().toISOString(),
        step,
        status,
        details,
      });
    };

    // 2. Handle Rejection Flow
    if (params.humanDecision === "REJECTED") {
      recordEvent("APPROVAL_REJECTED", "COMPLETED", `Operator '${params.approvedBy || "operator"}' rejected migration plan '${session.plan?.id}'. Zero mutation applied.`);
      session.status = "REJECTED";
      session.currentStep = "APPROVAL_REJECTED";
      await this.sessionStore.saveSession(session);
      return { sessionState: session };
    }

    // 3. Handle Approval Flow
    if (!params.approvalToken) {
      throw new Error("[Approval Error]: Missing required approval token for approved migration.");
    }

    recordEvent("APPROVED", "COMPLETED", `Human operator '${params.approvedBy || "operator@schemasentinel.dev"}' granted approval.`);
    session.status = "APPLYING";

    // 4. Staging Apply Step
    recordEvent("STAGING_APPLY_STARTED", "STARTED", `Applying approved migration plan '${session.plan?.id}' to target '${session.targetId}'...`);
    
    let applyResult: ApplyResult;
    try {
      applyResult = await this.postgresMcp.applyMigration(
        session.targetId,
        session.sessionId,
        session.plan!.id,
        session.plan!.rawSql,
        params.approvalToken
      );
    } catch (err: any) {
      recordEvent("APPLY_BLOCKED", "FAILED", `Apply blocked by safety boundary: ${err.message}`);
      session.status = "FAILED";
      session.currentStep = "APPLY_BLOCKED";
      session.errorMessage = err.message;
      await this.sessionStore.saveSession(session);
      throw err;
    }

    session.applyResult = applyResult;
    recordEvent("STAGING_APPLY_COMPLETED", applyResult.success ? "COMPLETED" : "FAILED", `DDL execution finished with status '${applyResult.status}'.`);

    // 5. Post-Apply Verification Step
    if (applyResult.verificationResult) {
      session.verificationResult = applyResult.verificationResult;
      recordEvent("VERIFICATION_STARTED", "STARTED", "Running deterministic post-apply verification queries...");

      if (applyResult.verificationResult.status === "passed") {
        recordEvent("VERIFICATION_COMPLETED", "COMPLETED", `All ${applyResult.verificationResult.checks.length} post-apply checks PASSED.`);
        recordEvent("SESSION_COMPLETED", "COMPLETED", `Session '${session.sessionId}' successfully completed.`);
        session.status = "COMPLETED";
        session.currentStep = "SESSION_COMPLETED";
      } else {
        recordEvent("VERIFICATION_FAILED", "FAILED", `Post-apply verification failed: ${applyResult.verificationResult.failures.join("; ")}`);
        session.status = "FAILED";
        session.currentStep = "VERIFICATION_FAILED";
        session.errorMessage = "Post-apply verification failed.";
      }
    } else {
      session.status = applyResult.success ? "COMPLETED" : "FAILED";
    }

    // 6. Persist Final State
    await this.sessionStore.saveSession(session);

    return {
      sessionState: session,
      applyResult,
      verificationResult: session.verificationResult,
    };
  }
}

export const defaultMigrationSession = new TrueForgeMigrationSession();
