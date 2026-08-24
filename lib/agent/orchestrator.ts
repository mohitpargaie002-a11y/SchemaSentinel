import { IGithubMcpService, defaultGithubMcpService } from "../mcp/github.js";
import { IPostgresMcpService, defaultPostgresMcpService } from "../mcp/postgres.js";
import { IApprovalGate, defaultApprovalGate } from "../safety/approval-gate.js";
import { ISessionStore, defaultSessionStore, PersistedSessionState } from "./session-store.js";
import { IPostApplyVerifier, PostApplyVerifier } from "../safety/post-apply-verifier.js";
import {
  ISchemaAnalystSubagent,
  SchemaAnalystSubagent,
} from "./subagents/schema-analyst.js";
import {
  IRiskAnalystSubagent,
  RiskAnalystSubagent,
} from "./subagents/risk-analyst.js";
import {
  ISandboxValidatorSubagent,
  SandboxValidatorSubagent,
} from "./subagents/sandbox-validator.js";
import {
  IReviewSynthesizerSubagent,
  ReviewSynthesizerSubagent,
} from "./subagents/review-synthesizer.js";
import {
  AgentActivityEvent,
  AgentContext,
  AgentRole,
  AgentTimelineEvent,
  ApplyResult,
  MigrationPlan,
  MigrationReviewReport,
  RiskAnalysisResult,
  SandboxValidationOutput,
  SandboxValidationResult,
  SchemaAnalysisResult,
  SchemaSnapshot,
  TrueForgeApprovalPacket,
  VerificationResult,
} from "../domain/contracts.js";
import { ComprehensiveRiskReport } from "./risk-analyzer.js";

export interface OrchestrationResult {
  context: AgentContext;
  riskReport: ComprehensiveRiskReport;
  approvalPacket: TrueForgeApprovalPacket;
  schemaAnalysis: SchemaAnalysisResult;
  riskAnalysis: RiskAnalysisResult;
  sandboxOutput: SandboxValidationOutput;
  reviewReport: MigrationReviewReport;
  activityEvents: AgentActivityEvent[];
}

export class TrueForgeOrchestrator {
  private postgresMcp: IPostgresMcpService;
  private githubMcp: IGithubMcpService;
  private approvalGate: IApprovalGate;
  private sessionStore: ISessionStore;
  private verifier: IPostApplyVerifier;

  // Specialized Subagents
  private schemaAnalyst: ISchemaAnalystSubagent;
  private riskAnalyst: IRiskAnalystSubagent;
  private sandboxValidator: ISandboxValidatorSubagent;
  private reviewSynthesizer: IReviewSynthesizerSubagent;

  constructor(
    postgresMcp: IPostgresMcpService = defaultPostgresMcpService,
    githubMcp: IGithubMcpService = defaultGithubMcpService,
    approvalGate: IApprovalGate = defaultApprovalGate,
    sessionStore: ISessionStore = defaultSessionStore,
    schemaAnalyst?: ISchemaAnalystSubagent,
    riskAnalyst?: IRiskAnalystSubagent,
    sandboxValidator?: ISandboxValidatorSubagent,
    reviewSynthesizer?: IReviewSynthesizerSubagent,
    verifier?: IPostApplyVerifier
  ) {
    this.postgresMcp = postgresMcp;
    this.githubMcp = githubMcp;
    this.approvalGate = approvalGate;
    this.sessionStore = sessionStore;
    this.verifier = verifier || new PostApplyVerifier(postgresMcp);

    this.schemaAnalyst = schemaAnalyst || new SchemaAnalystSubagent(postgresMcp);
    this.riskAnalyst = riskAnalyst || new RiskAnalystSubagent();
    this.sandboxValidator = sandboxValidator || new SandboxValidatorSubagent();
    this.reviewSynthesizer = reviewSynthesizer || new ReviewSynthesizerSubagent(approvalGate);
  }

  /**
   * Helper to dynamically parse plan metadata and rollback script.
   */
  private parsePlanMetadata(rawSql: string, migrationFilePath: string): {
    affectedTables: string[];
    migrationSummary: string;
    rollbackSql: string;
  } {
    const tableSet = new Set<string>();
    const tableMatches = rawSql.matchAll(/(?:ALTER|CREATE|DROP)\s+TABLE\s+(?:IF\s+(?:EXISTS|NOT\s+EXISTS)\s+)?([a-zA-Z0-9_"]+)/gi);
    for (const m of tableMatches) {
      tableSet.add(m[1].replace(/['"`]/g, "").toLowerCase());
    }

    const affectedTables = tableSet.size > 0 ? Array.from(tableSet) : ["orders"];

    const addedColumns: string[] = [];
    const colMatches = Array.from(rawSql.matchAll(/ALTER\s+TABLE\s+([^\s;]+)\s+ADD\s+COLUMN\s+([^\s;]+)/gi));
    for (const m of colMatches) {
      addedColumns.push(`${m[2]} to ${m[1]}`);
    }

    const createdIndexes: string[] = [];
    const idxMatches = Array.from(rawSql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?([^\s;]+)\s+ON\s+([^\s;(]+)/gi));
    for (const m of idxMatches) {
      createdIndexes.push(`${m[1]} on ${m[2]}`);
    }

    let summaryParts: string[] = [];
    if (addedColumns.length > 0) summaryParts.push(`Add column ${addedColumns.join(", ")}`);
    if (createdIndexes.length > 0) summaryParts.push(`Create index ${createdIndexes.join(", ")}`);
    if (summaryParts.length === 0) summaryParts.push(`Schema modification in ${migrationFilePath}`);
    const migrationSummary = summaryParts.join("; ");

    const rollbackStatements: string[] = [];
    for (const idx of idxMatches) {
      rollbackStatements.unshift(`DROP INDEX IF EXISTS ${idx[1]};`);
    }
    for (const col of colMatches) {
      rollbackStatements.push(`ALTER TABLE ${col[1]} DROP COLUMN IF EXISTS ${col[2]};`);
    }
    const rollbackSql = rollbackStatements.length > 0 ? rollbackStatements.join("\n") : "-- No rollback script needed.";

    return { affectedTables, migrationSummary, rollbackSql };
  }

  /**
   * Executes the multi-subagent TrueForge Migration Review pipeline.
   * Emits fine-grained activity events and halts at the human approval gate.
   */
  public async executeReviewWorkflow(params: {
    sessionId: string;
    targetId: string;
    repo: string;
    migrationFilePath: string;
    userPrompt: string;
  }): Promise<OrchestrationResult> {
    const timeline: AgentTimelineEvent[] = [];
    const activityEvents: AgentActivityEvent[] = [];

    const emitActivity = (
      actor: AgentRole,
      status: AgentActivityEvent["status"],
      phase: string,
      message: string,
      evidence?: Record<string, unknown>,
      durationMs?: number,
      toolName?: string
    ) => {
      const event: AgentActivityEvent = {
        id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        sessionId: params.sessionId,
        phase,
        actor,
        status,
        message,
        evidence,
        durationMs,
        toolName,
      };
      activityEvents.push(event);
    };

    const recordTimeline = (step: string, status: AgentTimelineEvent["status"], details: string) => {
      timeline.push({
        timestamp: new Date().toISOString(),
        step,
        status,
        details,
      });
    };

    // 1. ORCHESTRATOR: Initialize
    recordTimeline("REQUEST_RECEIVED", "COMPLETED", `Received migration review request for target '${params.targetId}' and file '${params.migrationFilePath}'.`);
    emitActivity("ORCHESTRATOR", "COMPLETED", "INIT", `Initialized TrueForge review pipeline for target '${params.targetId}'`);

    // 2. MIGRATION READ: Fetch SQL
    recordTimeline("MIGRATION_READ", "STARTED", `Fetching migration file '${params.migrationFilePath}' from '${params.repo}' via GitHub MCP...`);
    emitActivity("ORCHESTRATOR", "RUNNING", "FETCH_MIGRATION", `Reading migration file '${params.migrationFilePath}'`, undefined, undefined, "github.get_file_contents");
    
    const migrationContent = await this.githubMcp.readMigrationFile(params.repo, params.migrationFilePath);
    recordTimeline("MIGRATION_READ", "COMPLETED", `Successfully retrieved migration payload (${migrationContent.length} bytes).`);
    emitActivity("ORCHESTRATOR", "COMPLETED", "FETCH_MIGRATION", `Retrieved ${migrationContent.length} bytes from GitHub MCP`, {
      path: params.migrationFilePath,
      sizeBytes: migrationContent.length,
    });

    const { affectedTables, migrationSummary, rollbackSql } = this.parsePlanMetadata(
      migrationContent,
      params.migrationFilePath
    );

    const plan: MigrationPlan = {
      id: `plan_${Date.now()}`,
      sessionId: params.sessionId,
      targetId: params.targetId,
      userPrompt: params.userPrompt,
      rawSql: migrationContent,
      riskLevel: "HIGH",
      riskFactors: [],
      affectedTables,
      rollbackSql,
      createdAt: new Date().toISOString(),
    };

    // 3. SUBAGENT 1: Schema Analyst
    recordTimeline("SCHEMA_INSPECTED", "STARTED", `Inspecting target PostgreSQL database '${params.targetId}' via Schema Analyst subagent...`);
    emitActivity("SCHEMA_ANALYST", "RUNNING", "SCHEMA_INSPECTION", `Inspecting catalog for target '${params.targetId}'`, undefined, undefined, "postgres.inspect_schema");
    
    const schemaStart = Date.now();
    const { snapshot: schemaSnapshot, analysis: schemaAnalysis } = await this.schemaAnalyst.analyzeSchema(
      params.targetId,
      affectedTables
    );
    const schemaDuration = Date.now() - schemaStart;
    
    recordTimeline("SCHEMA_INSPECTED", "COMPLETED", `Schema snapshot completed: Discovered ${schemaSnapshot.tables.length} tables (${schemaSnapshot.tables.map(t => t.tableName).join(", ")}).`);
    emitActivity("SCHEMA_ANALYST", "COMPLETED", "SCHEMA_INSPECTION", schemaAnalysis.summary, {
      tableCount: schemaAnalysis.tableCount,
      indexCount: schemaAnalysis.totalIndexCount,
      affectedTables: schemaAnalysis.affectedTables,
    }, schemaDuration);

    // 4. SUBAGENT 2: Risk Analyst
    recordTimeline("ANALYSIS_COMPLETED", "STARTED", `Running SchemaSentinel safety analysis via Risk Analyst subagent...`);
    emitActivity("RISK_ANALYST", "RUNNING", "RISK_ANALYSIS", `Evaluating locking risks, table rewrites, and constraint hazards`, undefined, undefined, "risk_engine.evaluate");
    
    const riskStart = Date.now();
    const { riskReport, riskAnalysis } = await this.riskAnalyst.analyzeMigrationRisk(
      plan.id,
      plan.rawSql,
      schemaAnalysis
    );
    const riskDuration = Date.now() - riskStart;

    plan.riskLevel = riskReport.overallRisk;
    plan.riskFactors = riskReport.findings.map((f) => f.title);

    recordTimeline("ANALYSIS_COMPLETED", "COMPLETED", `Risk Analysis Complete: Overall Risk = ${riskReport.overallRisk}, Lock Risk = ${riskReport.lockRisk}, Findings = ${riskReport.findings.length}.`);
    emitActivity("RISK_ANALYST", "COMPLETED", "RISK_ANALYSIS", riskAnalysis.summary, {
      overallRisk: riskAnalysis.overallRisk,
      lockRisk: riskAnalysis.lockRisk,
      tableRewriteExpected: riskAnalysis.tableRewriteExpected,
      findingsCount: riskAnalysis.findings.length,
    }, riskDuration);

    // 5. SUBAGENT 3: Sandbox Validator
    recordTimeline("SANDBOX_COMPLETED", "STARTED", `Spinning up isolated PGlite PostgreSQL sandbox environment via Sandbox Validator...`);
    emitActivity("SANDBOX_VALIDATOR", "RUNNING", "SANDBOX_VALIDATION", `Executing candidate migration inside isolated PGlite sandbox`, undefined, undefined, "pglite.dry_run");
    
    const sandboxStart = Date.now();
    const { sandboxResult, sandboxOutput } = await this.sandboxValidator.validateInSandbox(
      plan.id,
      plan.rawSql,
      plan.rollbackSql
    );
    const sandboxDuration = Date.now() - sandboxStart;

    recordTimeline("SANDBOX_COMPLETED", "COMPLETED", `Sandbox validation ${sandboxResult.success ? "PASSED" : "FAILED"} in ${sandboxResult.executionDurationMs}ms (Rollback: ${sandboxResult.rollbackSuccessful ? "PASS" : "FAIL"}).`);
    emitActivity("SANDBOX_VALIDATOR", "COMPLETED", "SANDBOX_VALIDATION", `Sandbox validation ${sandboxResult.success ? "PASSED" : "FAILED"}: ${sandboxResult.assertionsPassed.length} assertion(s) passed`, {
      assertionsPassed: sandboxResult.assertionsPassed,
      rollbackSuccessful: sandboxResult.rollbackSuccessful,
    }, sandboxDuration);

    // 6. SUBAGENT 4: Review Synthesizer
    emitActivity("REVIEW_SYNTHESIZER", "RUNNING", "SYNTHESIS", `Synthesizing multi-agent evidence and generating TrueForge approval packet`);
    const { reviewReport, approvalPacket } = await this.reviewSynthesizer.synthesizeReview({
      sessionId: params.sessionId,
      plan,
      targetId: params.targetId,
      targetEnvironment: "staging-demo",
      migrationFilePath: params.migrationFilePath,
      migrationSummary,
      schemaAnalysis,
      riskReport,
      riskAnalysis,
      sandboxOutput,
    });
    emitActivity("REVIEW_SYNTHESIZER", "COMPLETED", "SYNTHESIS", `Review synthesis complete. Generated approval token and staged plan.`);

    // 7. ORCHESTRATOR: Halt at Human Approval Checkpoint
    recordTimeline("APPROVAL_REQUESTED", "PAUSED_FOR_APPROVAL", `HALTING EXECUTION: Production database mutation blocked. Human approval checkpoint required.`);
    emitActivity("ORCHESTRATOR", "WAITING", "APPROVAL_CHECKPOINT", `HALTED: Awaiting human operator approval for plan '${plan.id}' on '${params.targetId}'`, {
      approvalTokenRedacted: `sat_...${approvalPacket.approvalToken.slice(-6)}`,
      fingerprint: approvalPacket.sqlFingerprint,
    });

    const context: AgentContext = {
      sessionId: params.sessionId,
      targetId: params.targetId,
      status: "AWAITING_APPROVAL",
      userPrompt: params.userPrompt,
      schemaSnapshot,
      plan,
      sandboxResult,
      approvalCheckpoint: {
        sessionId: params.sessionId,
        planId: plan.id,
        targetId: params.targetId,
        sqlFingerprint: approvalPacket.sqlFingerprint,
        approved: true,
        token: approvalPacket.approvalToken,
        timestamp: new Date().toISOString(),
      },
      timeline,
    };

    // 8. Persist Full Session State
    const sessionState: PersistedSessionState = {
      sessionId: params.sessionId,
      targetId: params.targetId,
      repo: params.repo,
      migrationFilePath: params.migrationFilePath,
      userPrompt: params.userPrompt,
      status: "AWAITING_APPROVAL",
      currentStep: "APPROVAL_REQUESTED",
      schemaSnapshot,
      schemaAnalysis,
      plan,
      riskReport,
      riskAnalysis,
      sandboxResult,
      sandboxOutput,
      reviewReport,
      approvalCheckpoint: context.approvalCheckpoint,
      approvalPacket,
      timeline,
      activityEvents,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.sessionStore.saveSession(sessionState);

    return {
      context,
      riskReport,
      approvalPacket,
      schemaAnalysis,
      riskAnalysis,
      sandboxOutput,
      reviewReport,
      activityEvents,
    };
  }

  /**
   * Resumes the SAME logical TrueForge session after human decision.
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
    const session = await this.sessionStore.loadSession(params.sessionId);
    if (!session) {
      throw new Error(`[Session Error]: Session '${params.sessionId}' not found in persistent store.`);
    }

    if (session.status !== "AWAITING_APPROVAL") {
      throw new Error(`[Session Error]: Session '${params.sessionId}' is in state '${session.status}' and cannot be resumed.`);
    }

    if (session.approvalCheckpoint) {
      this.approvalGate.restoreCheckpoint(session.approvalCheckpoint);
    }

    const recordEvent = (step: string, status: AgentTimelineEvent["status"], details: string) => {
      session.timeline.push({
        timestamp: new Date().toISOString(),
        step,
        status,
        details,
      });
    };

    const emitActivity = (
      actor: AgentRole,
      status: AgentActivityEvent["status"],
      phase: string,
      message: string,
      evidence?: Record<string, unknown>
    ) => {
      if (!session.activityEvents) session.activityEvents = [];
      session.activityEvents.push({
        id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        sessionId: params.sessionId,
        phase,
        actor,
        status,
        message,
        evidence,
      });
    };

    // Rejection Flow
    if (params.humanDecision === "REJECTED") {
      recordEvent("APPROVAL_REJECTED", "COMPLETED", `Operator '${params.approvedBy || "operator"}' rejected migration plan '${session.plan?.id}'. Zero mutation applied.`);
      emitActivity("HUMAN", "COMPLETED", "HUMAN_REJECTION", `Human operator rejected migration. Zero mutations applied.`);
      session.status = "REJECTED";
      session.currentStep = "APPROVAL_REJECTED";
      await this.sessionStore.saveSession(session);
      return { sessionState: session };
    }

    // Approval Flow
    if (!params.approvalToken) {
      throw new Error("[Approval Error]: Missing required approval token for approved migration.");
    }

    recordEvent("APPROVED", "COMPLETED", `Human operator '${params.approvedBy || "operator@schemasentinel.dev"}' granted approval.`);
    emitActivity("HUMAN", "COMPLETED", "HUMAN_APPROVAL", `Human operator approved plan '${session.plan?.id}'. Authorizing controlled staging apply.`);
    
    // Concurrency Lock: Transition & persist to APPLYING
    session.status = "APPLYING";
    session.currentStep = "APPLYING";
    await this.sessionStore.saveSession(session);

    recordEvent("STAGING_APPLY_STARTED", "STARTED", `Applying approved migration plan '${session.plan?.id}' to target '${session.targetId}'...`);
    emitActivity("ORCHESTRATOR", "RUNNING", "STAGING_APPLY", `Executing DDL against allowlisted staging target '${session.targetId}'`);

    let applyResult: ApplyResult;
    try {
      applyResult = await this.postgresMcp.applyMigration(
        session.targetId,
        session.sessionId,
        session.plan!.id,
        session.plan!.rawSql,
        params.approvalToken,
        session.plan
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      recordEvent("APPLY_BLOCKED", "FAILED", `Apply blocked by safety boundary: ${msg}`);
      emitActivity("ORCHESTRATOR", "BLOCKED", "STAGING_APPLY", `Apply blocked: ${msg}`);
      session.status = "FAILED";
      session.currentStep = "APPLY_BLOCKED";
      session.errorMessage = msg;
      await this.sessionStore.saveSession(session);
      throw err;
    }

    session.applyResult = applyResult;
    recordEvent("STAGING_APPLY_COMPLETED", applyResult.success ? "COMPLETED" : "FAILED", `DDL execution finished with status '${applyResult.status}'.`);
    emitActivity("ORCHESTRATOR", applyResult.success ? "COMPLETED" : "FAILED", "STAGING_APPLY", `DDL execution finished with status '${applyResult.status}'`);

    // Verification Step
    if (applyResult.verificationResult) {
      session.verificationResult = applyResult.verificationResult;
      recordEvent("VERIFICATION_STARTED", "STARTED", "Running deterministic post-apply verification queries...");
      emitActivity("SYSTEM", "RUNNING", "VERIFICATION", `Running ${applyResult.verificationResult.checks.length} live post-apply invariant checks`);

      if (applyResult.verificationResult.status === "passed") {
        recordEvent("VERIFICATION_COMPLETED", "COMPLETED", `All ${applyResult.verificationResult.checks.length} post-apply checks PASSED.`);
        recordEvent("SESSION_COMPLETED", "COMPLETED", `Session '${session.sessionId}' successfully completed.`);
        emitActivity("SYSTEM", "COMPLETED", "VERIFICATION", `All post-apply verification checks PASSED`);
        emitActivity("ORCHESTRATOR", "COMPLETED", "COMPLETE", `Session '${session.sessionId}' completed successfully with full verification`);
        session.status = "COMPLETED";
        session.currentStep = "SESSION_COMPLETED";
      } else {
        recordEvent("VERIFICATION_FAILED", "FAILED", `Post-apply verification failed: ${applyResult.verificationResult.failures.join("; ")}`);
        emitActivity("SYSTEM", "FAILED", "VERIFICATION", `Post-apply verification failed with ${applyResult.verificationResult.failures.length} errors`);
        session.status = "FAILED";
        session.currentStep = "VERIFICATION_FAILED";
        session.errorMessage = "Post-apply verification failed.";
      }
    } else {
      session.status = applyResult.success ? "COMPLETED" : "FAILED";
    }

    await this.sessionStore.saveSession(session);

    return {
      sessionState: session,
      applyResult,
      verificationResult: session.verificationResult,
    };
  }
}

export const defaultOrchestrator = new TrueForgeOrchestrator();
