import * as crypto from "crypto";
import { IGithubMcpService, defaultGithubMcpService } from "../mcp/github.js";
import { IPostgresMcpService, defaultPostgresMcpService } from "../mcp/postgres.js";
import { IApprovalGate, defaultApprovalGate } from "../safety/approval-gate.js";
import { ISessionStore, defaultSessionStore, PersistedSessionState } from "./session-store.js";
import { IPostApplyVerifier, PostApplyVerifier } from "../safety/post-apply-verifier.js";
import { TargetRegistry, defaultTargetRegistry } from "../safety/target-allowlist.js";
import { SessionEventBroadcaster } from "./event-stream.js";
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
  EvidenceItem,
  EvidenceSourceType,
  MigrationPlan,
  MigrationReviewReport,
  RiskAnalysisResult,
  SandboxValidationOutput,
  SandboxValidationResult,
  SchemaAnalysisResult,
  SchemaSnapshot,
  TrueForgeApprovalPacket,
  VerificationResult,
  transitionSessionState,
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
  evidenceItems: EvidenceItem[];
}

export class TrueForgeOrchestrator {
  private postgresMcp: IPostgresMcpService;
  private githubMcp: IGithubMcpService;
  private approvalGate: IApprovalGate;
  private sessionStore: ISessionStore;
  private targetRegistry: TargetRegistry;
  private verifier: IPostApplyVerifier;
  private broadcaster: SessionEventBroadcaster;

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
    verifier?: IPostApplyVerifier,
    targetRegistry?: TargetRegistry,
    broadcaster?: SessionEventBroadcaster
  ) {
    this.postgresMcp = postgresMcp;
    this.githubMcp = githubMcp;
    this.approvalGate = approvalGate;
    this.sessionStore = sessionStore;
    this.targetRegistry = targetRegistry || defaultTargetRegistry;
    this.verifier = verifier || new PostApplyVerifier(postgresMcp);
    this.broadcaster = broadcaster || SessionEventBroadcaster.getInstance();

    this.schemaAnalyst = schemaAnalyst || new SchemaAnalystSubagent(postgresMcp);
    this.riskAnalyst = riskAnalyst || new RiskAnalystSubagent();
    this.sandboxValidator = sandboxValidator || new SandboxValidatorSubagent();
    this.reviewSynthesizer = reviewSynthesizer || new ReviewSynthesizerSubagent(approvalGate);
  }

  /**
   * Generates a deterministic SHA-256 hash for immutable evidence payloads.
   */
  private computeSha256(content: string | object): string {
    const raw = typeof content === "string" ? content : JSON.stringify(content);
    return crypto.createHash("sha256").update(raw, "utf-8").digest("hex");
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

    // 1. Parse table mutations (ALTER/CREATE/DROP TABLE) with schema-qualified support
    const tableMatches = Array.from(
      rawSql.matchAll(/(?:ALTER|CREATE|DROP)\s+TABLE\s+(?:IF\s+(?:EXISTS|NOT\s+EXISTS)\s+)?([a-zA-Z0-9_".]+)/gi)
    );
    for (const m of tableMatches) {
      const rawName = m[1].replace(/['"`]/g, "").trim();
      const normalized = rawName.includes(".") ? rawName.split(".").pop()! : rawName;
      if (normalized) {
        tableSet.add(normalized.toLowerCase());
      }
    }

    // 2. Parse column additions
    const addedColumns: string[] = [];
    const colMatches = Array.from(rawSql.matchAll(/ALTER\s+TABLE\s+([^\s;]+)\s+ADD\s+COLUMN\s+([^\s;]+)/gi));
    for (const m of colMatches) {
      const rawTableName = m[1].replace(/['"`]/g, "").trim();
      const rawColName = m[2].replace(/['"`]/g, "").trim();
      const tableName = rawTableName.includes(".") ? rawTableName.split(".").pop()! : rawTableName;
      tableSet.add(tableName.toLowerCase());
      addedColumns.push(`${rawColName} to ${tableName}`);
    }

    // 3. Parse index creations (including index ON table)
    const createdIndexes: string[] = [];
    const idxMatches = Array.from(
      rawSql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?([^\s;]+)\s+ON\s+([^\s;(]+)/gi)
    );
    for (const m of idxMatches) {
      const rawIdxName = m[1].replace(/['"`]/g, "").trim();
      const rawTableName = m[2].replace(/['"`]/g, "").trim();
      const tableName = rawTableName.includes(".") ? rawTableName.split(".").pop()! : rawTableName;
      tableSet.add(tableName.toLowerCase());
      createdIndexes.push(`${rawIdxName} on ${tableName}`);
    }

    const affectedTables = Array.from(tableSet);

    let summaryParts: string[] = [];
    if (addedColumns.length > 0) summaryParts.push(`Add column ${addedColumns.join(", ")}`);
    if (createdIndexes.length > 0) summaryParts.push(`Create index ${createdIndexes.join(", ")}`);
    if (summaryParts.length === 0) summaryParts.push(`Schema modification in ${migrationFilePath}`);
    const migrationSummary = summaryParts.join("; ");

    const rollbackStatements: string[] = [];
    for (const idx of idxMatches) {
      const rawIdxName = idx[1].replace(/['"`]/g, "").trim();
      rollbackStatements.unshift(`DROP INDEX IF EXISTS ${rawIdxName};`);
    }
    for (const col of colMatches) {
      const rawTableName = col[1].replace(/['"`]/g, "").trim();
      const rawColName = col[2].replace(/['"`]/g, "").trim();
      rollbackStatements.push(`ALTER TABLE ${rawTableName} DROP COLUMN IF EXISTS ${rawColName};`);
    }
    const rollbackSql = rollbackStatements.length > 0 ? rollbackStatements.join("\n") : "-- No rollback script needed.";

    return { affectedTables, migrationSummary, rollbackSql };
  }

  /**
   * Executes the multi-subagent TrueForge Migration Review pipeline.
   * Emits fine-grained live SSE activity events, records evidence provenance, and halts at the human approval gate.
   */
  public async executeReviewWorkflow(params: {
    sessionId: string;
    targetId: string;
    repo: string;
    migrationFilePath: string;
    userPrompt: string;
  }): Promise<OrchestrationResult> {
    // Prevent overwriting an existing session
    const existingSession = await this.sessionStore.loadSession(params.sessionId);
    if (existingSession) {
      throw new Error(`[Session Error]: Session '${params.sessionId}' already exists. Cannot overwrite an existing session.`);
    }

    const timeline: AgentTimelineEvent[] = [];
    const activityEvents: AgentActivityEvent[] = [];
    const evidenceItems: EvidenceItem[] = [];

    const emitActivity = (
      actor: AgentRole,
      status: AgentActivityEvent["status"],
      phase: string,
      message: string,
      evidence?: Record<string, unknown>,
      durationMs?: number,
      toolName?: string,
      evidenceRef?: string
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
        evidenceRef,
      };
      activityEvents.push(event);
      this.broadcaster.emitActivity(params.sessionId, event);
    };

    const recordEvidence = (
      source: string,
      sourceType: EvidenceSourceType,
      actor: AgentRole,
      summary: string,
      rawPayload: unknown,
      confidence: number = 1.0
    ): EvidenceItem => {
      const rawSnapshot = rawPayload !== undefined && rawPayload !== null
        ? JSON.parse(JSON.stringify(rawPayload))
        : rawPayload;
      const contentHash = this.computeSha256(rawSnapshot as object);
      const evidence: EvidenceItem = {
        evidenceId: `evi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        sessionId: params.sessionId,
        source,
        sourceType,
        actor,
        timestamp: new Date().toISOString(),
        summary,
        contentHash,
        rawReference: rawSnapshot,
        confidence,
      };
      evidenceItems.push(evidence);
      this.broadcaster.emitEvidence(params.sessionId, evidence);
      return evidence;
    };

    const recordTimeline = (step: string, status: AgentTimelineEvent["status"], details: string) => {
      timeline.push({
        timestamp: new Date().toISOString(),
        step,
        status,
        details,
      });
    };

    // State Machine: CREATED -> RUNNING
    let currentSessionStatus = transitionSessionState("CREATED", "RUNNING");
    this.broadcaster.emitStateChange(params.sessionId, currentSessionStatus);

    // 1. ORCHESTRATOR: Initialize
    recordTimeline("REQUEST_RECEIVED", "COMPLETED", `Received migration review request for target '${params.targetId}' and file '${params.migrationFilePath}'.`);
    emitActivity("ORCHESTRATOR", "COMPLETED", "INIT", `Initialized TrueForge review pipeline for target '${params.targetId}'`);

    // 2. MIGRATION READ: Fetch SQL
    recordTimeline("MIGRATION_READ", "STARTED", `Fetching migration file '${params.migrationFilePath}' from '${params.repo}' via GitHub MCP...`);
    emitActivity("ORCHESTRATOR", "RUNNING", "FETCH_MIGRATION", `Reading migration file '${params.migrationFilePath}'`, undefined, undefined, "github.get_file_contents");
    
    const migrationContent = await this.githubMcp.readMigrationFile(params.repo, params.migrationFilePath);
    const sqlEvidence = recordEvidence(
      params.migrationFilePath,
      "MIGRATION_FILE",
      "ORCHESTRATOR",
      `Migration DDL SQL retrieved from GitHub repository (${migrationContent.length} bytes)`,
      { path: params.migrationFilePath, content: migrationContent }
    );

    recordTimeline("MIGRATION_READ", "COMPLETED", `Successfully retrieved migration payload (${migrationContent.length} bytes).`);
    emitActivity("ORCHESTRATOR", "COMPLETED", "FETCH_MIGRATION", `Retrieved ${migrationContent.length} bytes from GitHub MCP`, {
      path: params.migrationFilePath,
      sizeBytes: migrationContent.length,
      evidenceId: sqlEvidence.evidenceId,
      contentHash: sqlEvidence.contentHash,
    }, undefined, "github.get_file_contents", sqlEvidence.evidenceId);

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
      affectedTables: affectedTables.length > 0 ? affectedTables : ["orders"],
      rollbackSql,
      createdAt: new Date().toISOString(),
      contentHash: sqlEvidence.contentHash,
      evidenceId: sqlEvidence.evidenceId,
    };

    // 3. PARALLEL READ-ONLY SPECIALIST ANALYSIS (Schema Analyst & Preliminary Risk Context)
    // Controlled parallel execution: Independent preparatory AST checks and target catalog introspection run concurrently
    recordTimeline("SCHEMA_INSPECTED", "STARTED", `Inspecting target PostgreSQL database '${params.targetId}' via Schema Analyst subagent...`);
    emitActivity("SCHEMA_ANALYST", "RUNNING", "SCHEMA_INSPECTION", `Inspecting catalog for target '${params.targetId}'`, undefined, undefined, "postgres.inspect_schema");
    emitActivity("RISK_ANALYST", "RUNNING", "RISK_ANALYSIS", `Evaluating locking risks, table rewrites, and constraint hazards`, undefined, undefined, "risk_engine.evaluate");

    const parallelStart = Date.now();
    const [schemaResult] = await Promise.all([
      this.schemaAnalyst.analyzeSchema(params.targetId, plan.affectedTables),
      // Concurrently evaluate candidate AST syntax
      this.riskAnalyst.analyzeMigrationRisk(plan.id, plan.rawSql, {
        targetId: params.targetId,
        timestamp: new Date().toISOString(),
        tableCount: 0,
        totalIndexCount: 0,
        affectedTables: plan.affectedTables,
        affectedTableDetails: [],
        foreignKeyDependencies: [],
        volumeEstimates: {},
        summary: "Preliminary AST parsing",
      }),
    ]);
    const { snapshot: schemaSnapshot, analysis: schemaAnalysis } = schemaResult;
    const schemaDuration = Date.now() - parallelStart;

    const schemaEvidence = recordEvidence(
      `postgres://${params.targetId}/catalog`,
      "POSTGRES_SCHEMA",
      "SCHEMA_ANALYST",
      `Target catalog snapshot for '${params.targetId}': ${schemaAnalysis.tableCount} tables, ${schemaAnalysis.totalIndexCount} indexes`,
      schemaSnapshot
    );
    schemaAnalysis.evidenceId = schemaEvidence.evidenceId;
    schemaAnalysis.contentHash = schemaEvidence.contentHash;

    recordTimeline("SCHEMA_INSPECTED", "COMPLETED", `Schema snapshot completed: Discovered ${schemaSnapshot.tables.length} tables (${schemaSnapshot.tables.map(t => t.tableName).join(", ")}).`);
    emitActivity("SCHEMA_ANALYST", "COMPLETED", "SCHEMA_INSPECTION", schemaAnalysis.summary, {
      tableCount: schemaAnalysis.tableCount,
      indexCount: schemaAnalysis.totalIndexCount,
      affectedTables: schemaAnalysis.affectedTables,
      evidenceId: schemaEvidence.evidenceId,
      contentHash: schemaEvidence.contentHash,
    }, schemaDuration, "postgres.inspect_schema", schemaEvidence.evidenceId);

    // 4. SUBAGENT 2: Risk Analyst (Refine risk with full schema snapshot)
    const riskStart = Date.now();
    const { riskReport, riskAnalysis } = await this.riskAnalyst.analyzeMigrationRisk(
      plan.id,
      plan.rawSql,
      schemaAnalysis
    );
    const riskDuration = Date.now() - riskStart;

    plan.riskLevel = riskReport.overallRisk;
    plan.riskFactors = riskReport.findings.map((f) => f.title);

    const riskEvidence = recordEvidence(
      `risk-engine://eval/${plan.id}`,
      "RISK_ANALYSIS",
      "RISK_ANALYST",
      `Risk Analysis: Overall Risk = ${riskReport.overallRisk}, Lock Risk = ${riskReport.lockRisk}, ${riskReport.findings.length} findings`,
      { riskReport, riskAnalysis }
    );
    riskAnalysis.evidenceId = riskEvidence.evidenceId;
    riskAnalysis.contentHash = riskEvidence.contentHash;

    recordTimeline("ANALYSIS_COMPLETED", "COMPLETED", `Risk Analysis Complete: Overall Risk = ${riskReport.overallRisk}, Lock Risk = ${riskReport.lockRisk}, Findings = ${riskReport.findings.length}.`);
    emitActivity("RISK_ANALYST", "COMPLETED", "RISK_ANALYSIS", riskAnalysis.summary, {
      overallRisk: riskAnalysis.overallRisk,
      lockRisk: riskAnalysis.lockRisk,
      tableRewriteExpected: riskAnalysis.tableRewriteExpected,
      findingsCount: riskAnalysis.findings.length,
      evidenceId: riskEvidence.evidenceId,
      contentHash: riskEvidence.contentHash,
    }, riskDuration, "risk_engine.evaluate", riskEvidence.evidenceId);

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

    const sandboxEvidence = recordEvidence(
      `pglite://sandbox/${plan.id}`,
      "SANDBOX_EXECUTION",
      "SANDBOX_VALIDATOR",
      `PGlite isolated validation: ${sandboxResult.success ? "PASSED" : "FAILED"} in ${sandboxResult.executionDurationMs}ms (Rollback: ${sandboxResult.rollbackSuccessful ? "PASS" : "FAIL"})`,
      { sandboxResult, sandboxOutput }
    );
    sandboxResult.evidenceId = sandboxEvidence.evidenceId;
    sandboxResult.contentHash = sandboxEvidence.contentHash;
    sandboxOutput.evidenceId = sandboxEvidence.evidenceId;
    sandboxOutput.contentHash = sandboxEvidence.contentHash;

    recordTimeline("SANDBOX_COMPLETED", "COMPLETED", `Sandbox validation ${sandboxResult.success ? "PASSED" : "FAILED"} in ${sandboxResult.executionDurationMs}ms (Rollback: ${sandboxResult.rollbackSuccessful ? "PASS" : "FAIL"}).`);
    emitActivity("SANDBOX_VALIDATOR", "COMPLETED", "SANDBOX_VALIDATION", `Sandbox validation ${sandboxResult.success ? "PASSED" : "FAILED"}: ${sandboxResult.assertionsPassed.length} assertion(s) passed`, {
      assertionsPassed: sandboxResult.assertionsPassed,
      rollbackSuccessful: sandboxResult.rollbackSuccessful,
      evidenceId: sandboxEvidence.evidenceId,
      contentHash: sandboxEvidence.contentHash,
    }, sandboxDuration, "pglite.dry_run", sandboxEvidence.evidenceId);

    // 6. SUBAGENT 4: Review Synthesizer (derive actual target environment)
    const targetConfig = this.targetRegistry.getTarget(params.targetId);
    const targetEnvironment = targetConfig ? targetConfig.environment : "staging";

    emitActivity("REVIEW_SYNTHESIZER", "RUNNING", "SYNTHESIS", `Synthesizing multi-agent evidence and generating TrueForge approval packet`);
    const { reviewReport, approvalPacket } = await this.reviewSynthesizer.synthesizeReview({
      sessionId: params.sessionId,
      plan,
      targetId: params.targetId,
      targetEnvironment,
      migrationFilePath: params.migrationFilePath,
      migrationSummary,
      schemaAnalysis,
      riskReport,
      riskAnalysis,
      sandboxOutput,
    });
    reviewReport.evidenceProvenance = evidenceItems.map((e) => e.evidenceId);

    emitActivity("REVIEW_SYNTHESIZER", "COMPLETED", "SYNTHESIS", `Review synthesis complete. Generated approval token and staged plan.`);

    // State Machine: RUNNING -> REVIEW_READY -> AWAITING_APPROVAL
    currentSessionStatus = transitionSessionState(currentSessionStatus, "REVIEW_READY");
    currentSessionStatus = transitionSessionState(currentSessionStatus, "AWAITING_APPROVAL");
    this.broadcaster.emitStateChange(params.sessionId, currentSessionStatus);

    // 7. ORCHESTRATOR: Halt at Human Approval Checkpoint
    recordTimeline("APPROVAL_REQUESTED", "PAUSED_FOR_APPROVAL", `HALTING EXECUTION: Production database mutation blocked. Human approval checkpoint required.`);
    emitActivity("ORCHESTRATOR", "WAITING", "APPROVAL_CHECKPOINT", `HALTED: Awaiting human operator approval for plan '${plan.id}' on '${params.targetId}'`, {
      approvalTokenRedacted: `sat_...${approvalPacket.approvalToken.slice(-6)}`,
      fingerprint: approvalPacket.sqlFingerprint,
    });

    const context: AgentContext = {
      sessionId: params.sessionId,
      targetId: params.targetId,
      status: currentSessionStatus,
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
      status: currentSessionStatus,
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
      evidenceItems,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isReadOnly: false,
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
      evidenceItems,
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
      evidence?: Record<string, unknown>,
      durationMs?: number,
      toolName?: string,
      evidenceRef?: string
    ) => {
      if (!session.activityEvents) session.activityEvents = [];
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
        evidenceRef,
      };
      session.activityEvents.push(event);
      this.broadcaster.emitActivity(params.sessionId, event);
    };

    const recordEvidence = (
      source: string,
      sourceType: EvidenceSourceType,
      actor: AgentRole,
      summary: string,
      rawPayload: unknown,
      confidence: number = 1.0
    ): EvidenceItem => {
      if (!session.evidenceItems) session.evidenceItems = [];
      const rawSnapshot = rawPayload !== undefined && rawPayload !== null
        ? JSON.parse(JSON.stringify(rawPayload))
        : rawPayload;
      const contentHash = this.computeSha256(rawSnapshot as object);
      const evidence: EvidenceItem = {
        evidenceId: `evi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        sessionId: params.sessionId,
        source,
        sourceType,
        actor,
        timestamp: new Date().toISOString(),
        summary,
        contentHash,
        rawReference: rawSnapshot,
        confidence,
      };
      session.evidenceItems.push(evidence);
      this.broadcaster.emitEvidence(params.sessionId, evidence);
      return evidence;
    };

    // Rejection Flow
    if (params.humanDecision === "REJECTED") {
      session.status = transitionSessionState(session.status, "REJECTED");
      this.broadcaster.emitStateChange(params.sessionId, session.status);

      recordEvent("APPROVAL_REJECTED", "COMPLETED", `Operator '${params.approvedBy || "operator"}' rejected migration plan '${session.plan?.id}'. Zero mutation applied.`);
      emitActivity("HUMAN", "COMPLETED", "HUMAN_REJECTION", `Human operator rejected migration. Zero mutations applied.`);
      session.currentStep = "APPROVAL_REJECTED";
      session.completedAt = new Date().toISOString();
      session.isReadOnly = true;
      await this.sessionStore.saveSession(session);
      this.broadcaster.closeSessionStream(params.sessionId);
      return { sessionState: session };
    }

    // Approval Flow
    if (!params.approvalToken) {
      throw new Error("[Approval Error]: Missing required approval token for approved migration.");
    }

    session.status = transitionSessionState(session.status, "APPROVED");
    this.broadcaster.emitStateChange(params.sessionId, session.status);

    recordEvent("APPROVED", "COMPLETED", `Human operator '${params.approvedBy || "operator@schemasentinel.dev"}' granted approval.`);
    emitActivity("HUMAN", "COMPLETED", "HUMAN_APPROVAL", `Human operator approved plan '${session.plan?.id}'. Authorizing controlled staging apply.`);
    
    // Concurrency Lock: Transition & persist to APPLYING
    session.status = transitionSessionState(session.status, "APPLYING");
    this.broadcaster.emitStateChange(params.sessionId, session.status);
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
        session.plan,
        async () => {
          session.status = transitionSessionState(session.status, "VERIFYING");
          this.broadcaster.emitStateChange(params.sessionId, session.status);
          recordEvent("VERIFICATION_STARTED", "STARTED", "Running deterministic post-apply verification queries...");
          emitActivity("SYSTEM", "RUNNING", "VERIFICATION", `Running live post-apply invariant checks`);
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      recordEvent("APPLY_BLOCKED", "FAILED", `Apply blocked by safety boundary: ${msg}`);
      emitActivity("ORCHESTRATOR", "BLOCKED", "STAGING_APPLY", `Apply blocked: ${msg}`);
      session.status = transitionSessionState(session.status, "FAILED");
      this.broadcaster.emitStateChange(params.sessionId, session.status);
      session.currentStep = "APPLY_BLOCKED";
      session.errorMessage = msg;
      session.completedAt = new Date().toISOString();
      session.isReadOnly = true;
      await this.sessionStore.saveSession(session);
      this.broadcaster.closeSessionStream(params.sessionId);
      throw err;
    }

    session.applyResult = applyResult;
    recordEvent("STAGING_APPLY_COMPLETED", applyResult.success ? "COMPLETED" : "FAILED", `DDL execution finished with status '${applyResult.status}'.`);
    emitActivity("ORCHESTRATOR", applyResult.success ? "COMPLETED" : "FAILED", "STAGING_APPLY", `DDL execution finished with status '${applyResult.status}'`);

    // Verification Step Result Processing
    if (applyResult.verificationResult) {
      session.verificationResult = applyResult.verificationResult;
      const verificationEvidence = recordEvidence(
        `postgres://${session.targetId}/post-apply-verification`,
        "VERIFICATION_QUERY",
        "SYSTEM",
        `Post-apply verification: ${applyResult.verificationResult.status.toUpperCase()} (${applyResult.verificationResult.checks.length} invariant checks)`,
        applyResult.verificationResult
      );
      applyResult.verificationResult.evidenceId = verificationEvidence.evidenceId;
      applyResult.verificationResult.contentHash = verificationEvidence.contentHash;

      if (applyResult.verificationResult.status === "passed") {
        recordEvent("VERIFICATION_COMPLETED", "COMPLETED", `All ${applyResult.verificationResult.checks.length} post-apply checks PASSED.`);
        recordEvent("SESSION_COMPLETED", "COMPLETED", `Session '${session.sessionId}' successfully completed.`);
        emitActivity("SYSTEM", "COMPLETED", "VERIFICATION", `All post-apply verification checks PASSED`, undefined, undefined, undefined, verificationEvidence.evidenceId);
        emitActivity("ORCHESTRATOR", "COMPLETED", "COMPLETE", `Session '${session.sessionId}' completed successfully with full verification`);
        session.status = transitionSessionState(session.status, "COMPLETED");
        session.currentStep = "SESSION_COMPLETED";
      } else {
        recordEvent("VERIFICATION_FAILED", "FAILED", `Post-apply verification failed: ${applyResult.verificationResult.failures.join("; ")}`);
        emitActivity("SYSTEM", "FAILED", "VERIFICATION", `Post-apply verification failed with ${applyResult.verificationResult.failures.length} errors`, undefined, undefined, undefined, verificationEvidence.evidenceId);
        session.status = transitionSessionState(session.status, "VERIFICATION_FAILED");
        session.currentStep = "VERIFICATION_FAILED";
        session.errorMessage = "Post-apply verification failed.";
      }
    } else {
      session.status = transitionSessionState(session.status, applyResult.success ? "COMPLETED" : "FAILED");
    }

    session.completedAt = new Date().toISOString();
    session.isReadOnly = true;
    this.broadcaster.emitStateChange(params.sessionId, session.status);
    await this.sessionStore.saveSession(session);
    this.broadcaster.closeSessionStream(params.sessionId);

    return {
      sessionState: session,
      applyResult,
      verificationResult: session.verificationResult,
    };
  }
}

export const defaultOrchestrator = new TrueForgeOrchestrator();
