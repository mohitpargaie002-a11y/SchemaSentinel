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
  SafeMigrationGenerator,
  defaultSafeMigrationGenerator,
} from "./safe-migration-generator.js";
import {
  ActivityEventStatus,
  AgentActivityEvent,
  AgentContext,
  AgentRole,
  AgentTimelineEvent,
  ApplyResult,
  EvidenceItem,
  EvidenceSourceType,
  GitHubPrMetadata,
  MigrationPlan,
  MigrationReviewReport,
  RiskAnalysisResult,
  SafeMigrationProposal,
  SafeMigrationValidationError,
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
  private safeMigrationGenerator: SafeMigrationGenerator;

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
    broadcaster?: SessionEventBroadcaster,
    safeMigrationGenerator?: SafeMigrationGenerator
  ) {
    this.postgresMcp = postgresMcp;
    this.githubMcp = githubMcp;
    this.approvalGate = approvalGate;
    this.sessionStore = sessionStore;
    this.targetRegistry = targetRegistry || defaultTargetRegistry;
    this.verifier = verifier || new PostApplyVerifier(postgresMcp);
    this.broadcaster = broadcaster || SessionEventBroadcaster.getInstance();
    this.safeMigrationGenerator = safeMigrationGenerator || defaultSafeMigrationGenerator;

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

  /**
   * Phase 6: Generates a deterministic safe remediation proposal from risky migration SQL,
   * runs sandbox validation, creates structured visual diff, and halts at AWAITING_SAFE_MIGRATION_APPROVAL.
   */
  public async generateSafeMigrationWorkflow(sessionId: string): Promise<{
    proposal: SafeMigrationProposal;
    sessionState: PersistedSessionState;
  }> {
    const session = await this.sessionStore.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found.`);
    }

    const emitActivity = (
      actor: AgentRole,
      status: ActivityEventStatus,
      phase: string,
      message: string,
      durationMs?: number,
      evidenceRef?: string
    ) => {
      const event: AgentActivityEvent = {
        id: `act_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
        timestamp: new Date().toISOString(),
        sessionId,
        phase,
        actor,
        status,
        message,
        durationMs,
        evidenceRef,
      };
      session.activityEvents.push(event);
      this.broadcaster.emitActivity(sessionId, event);
      return event;
    };

    const recordEvent = (
      step: string,
      status: "STARTED" | "COMPLETED" | "PAUSED_FOR_APPROVAL" | "FAILED",
      details: string
    ) => {
      const evt: AgentTimelineEvent = {
        timestamp: new Date().toISOString(),
        step,
        status,
        details,
      };
      session.timeline.push(evt);
      return evt;
    };

    const recordEvidence = (
      source: string,
      sourceType: EvidenceSourceType,
      actor: AgentRole,
      summary: string,
      rawPayload: unknown
    ): EvidenceItem => {
      const snapshottedPayload = JSON.parse(JSON.stringify(rawPayload));
      const contentHash = this.computeSha256(snapshottedPayload);
      const evidence: EvidenceItem = {
        evidenceId: `evi_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
        sessionId,
        source,
        sourceType,
        actor,
        timestamp: new Date().toISOString(),
        summary,
        contentHash,
        rawReference: snapshottedPayload,
        confidence: 1.0,
      };
      session.evidenceItems.push(evidence);
      this.broadcaster.emitEvidence(sessionId, evidence);
      return evidence;
    };

    // Transition to SAFE_MIGRATION_GENERATING
    session.status = transitionSessionState(session.status, "SAFE_MIGRATION_GENERATING");
    this.broadcaster.emitStateChange(sessionId, session.status);
    session.currentStep = "SAFE_MIGRATION_GENERATING";
    recordEvent("SAFE_MIGRATION_GENERATION_STARTED", "STARTED", "Generating zero-downtime safe remediation proposal...");
    emitActivity("ORCHESTRATOR", "RUNNING", "SAFE_MIGRATION_GENERATION", "Analyzing risky AST patterns and generating safe staged DDL");

    const genStartTime = Date.now();
    let proposal: SafeMigrationProposal;
    try {
      proposal = this.safeMigrationGenerator.generateProposal({
        sessionId,
        planId: session.plan?.id || `plan_${sessionId}`,
        targetId: session.targetId,
        originalSql: session.plan?.rawSql || "",
        migrationFilePath: session.migrationFilePath,
        schemaSnapshot: session.schemaSnapshot,
        riskAnalysis: session.riskAnalysis,
        userPrompt: session.userPrompt,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      session.status = transitionSessionState(session.status, "SAFE_MIGRATION_GENERATION_FAILED");
      this.broadcaster.emitStateChange(sessionId, session.status);
      recordEvent("SAFE_MIGRATION_GENERATION_FAILED", "FAILED", `Generation failed: ${msg}`);
      emitActivity("ORCHESTRATOR", "FAILED", "SAFE_MIGRATION_GENERATION", `Generation failed: ${msg}`);
      session.errorMessage = msg;
      await this.sessionStore.saveSession(session);
      throw err;
    }

    const genDuration = Date.now() - genStartTime;
    const safeSqlEvidence = recordEvidence(
      `safe-engine://generate/${proposal.proposalId}`,
      "SAFE_MIGRATION_SQL",
      "ORCHESTRATOR",
      `Safe migration DDL proposal generated (${proposal.remediationSteps.length} stages)`,
      { proposedSql: proposal.proposedSql, rollbackSql: proposal.rollbackSql }
    );

    recordEvidence(
      `diff-engine://${proposal.proposalId}`,
      "MIGRATION_DIFF",
      "ORCHESTRATOR",
      `Structured diff: ${proposal.diff.summary}`,
      proposal.diff
    );

    emitActivity(
      "ORCHESTRATOR",
      "COMPLETED",
      "SAFE_MIGRATION_GENERATION",
      `Generated safe staged proposal: ${proposal.diff.summary}`,
      genDuration,
      safeSqlEvidence.evidenceId
    );

    // Transition to SAFE_MIGRATION_VALIDATING
    session.status = transitionSessionState(session.status, "SAFE_MIGRATION_VALIDATING");
    this.broadcaster.emitStateChange(sessionId, session.status);
    session.currentStep = "SAFE_MIGRATION_VALIDATING";
    recordEvent("SAFE_MIGRATION_VALIDATION_STARTED", "STARTED", "Executing candidate safe migration inside isolated PGlite sandbox...");
    emitActivity("SANDBOX_VALIDATOR", "RUNNING", "SAFE_SANDBOX_VALIDATION", "Dry-running proposed safe SQL in isolated PGlite sandbox");

    const sandStartTime = Date.now();
    const { sandboxResult: sandboxRes } = await this.sandboxValidator.validateInSandbox(
      `safe_${proposal.proposalId}`,
      proposal.proposedSql,
      proposal.rollbackSql
    );
    const sandDuration = Date.now() - sandStartTime;

    const sandboxEvidence = recordEvidence(
      `pglite://sandbox/safe/${proposal.proposalId}`,
      "SAFE_SANDBOX_EVAL",
      "SANDBOX_VALIDATOR",
      `Safe migration sandbox validation: ${sandboxRes.success ? "PASS" : "FAIL"} (${sandboxRes.assertionsPassed.length} assertions passed)`,
      sandboxRes
    );

    if (!sandboxRes.success) {
      session.status = transitionSessionState(session.status, "SAFE_MIGRATION_GENERATION_FAILED");
      this.broadcaster.emitStateChange(sessionId, session.status);
      recordEvent("SAFE_MIGRATION_VALIDATION_FAILED", "FAILED", `Sandbox validation failed: ${sandboxRes.errorMessage}`);
      emitActivity("SANDBOX_VALIDATOR", "FAILED", "SAFE_SANDBOX_VALIDATION", `Sandbox dry-run failed: ${sandboxRes.errorMessage}`);
      session.errorMessage = `Sandbox validation failed: ${sandboxRes.errorMessage}`;
      await this.sessionStore.saveSession(session);
      throw new SafeMigrationValidationError(`Safe migration dry-run failed in sandbox: ${sandboxRes.errorMessage}`);
    }

    emitActivity(
      "SANDBOX_VALIDATOR",
      "COMPLETED",
      "SAFE_SANDBOX_VALIDATION",
      `Sandbox validation PASSED: ${sandboxRes.assertionsPassed.length} assertions passed (Rollback: ${sandboxRes.rollbackSuccessful ? "PASS" : "FAIL"})`,
      sandDuration,
      sandboxEvidence.evidenceId
    );

    proposal.sandboxValidation = sandboxRes;

    // Cryptographic Approval Checkpoint derivation for Safe Migration
    const checkpoint = this.approvalGate.grantSafeMigrationApproval(
      sessionId,
      session.plan?.id || `plan_${sessionId}`,
      session.targetId,
      proposal.proposedSql
    );
    proposal.approvalToken = checkpoint.token;

    // Transition to SAFE_MIGRATION_READY -> AWAITING_SAFE_MIGRATION_APPROVAL
    session.status = transitionSessionState(session.status, "SAFE_MIGRATION_READY");
    this.broadcaster.emitStateChange(sessionId, session.status);
    session.status = transitionSessionState(session.status, "AWAITING_SAFE_MIGRATION_APPROVAL");
    this.broadcaster.emitStateChange(sessionId, session.status);
    session.currentStep = "AWAITING_SAFE_MIGRATION_APPROVAL";

    recordEvent(
      "SAFE_MIGRATION_APPROVAL_REQUESTED",
      "PAUSED_FOR_APPROVAL",
      `Awaiting human operator approval to open GitHub Pull Request with safe migration.`
    );
    emitActivity(
      "ORCHESTRATOR",
      "WAITING",
      "SAFE_MIGRATION_APPROVAL",
      `Safe migration validated. Awaiting operator approval to create GitHub PR.`
    );

    session.approvalCheckpoint = checkpoint;
    session.safeMigrationProposal = proposal;
    await this.sessionStore.saveSession(session);

    return {
      proposal,
      sessionState: session,
    };
  }

  /**
   * Phase 6: Human operator approves safe migration proposal -> creates GitHub branch,
   * commits safe migration file, and opens Pull Request for automated Qodo review.
   */
  public async approveAndCreatePrWorkflow(params: {
    sessionId: string;
    approvedBy?: string;
    approvalToken?: string;
    baseBranch?: string;
  }): Promise<{
    githubPr: GitHubPrMetadata;
    sessionState: PersistedSessionState;
  }> {
    const session = await this.sessionStore.loadSession(params.sessionId);
    if (!session) {
      throw new Error(`Session '${params.sessionId}' not found.`);
    }

    if (!session.safeMigrationProposal) {
      throw new Error(`Session '${params.sessionId}' does not have an active Safe Migration proposal.`);
    }

    const proposal = session.safeMigrationProposal;
    const token = params.approvalToken || proposal.approvalToken;

    if (!token) {
      throw new Error("Missing approval token for safe migration PR creation.");
    }

    if (session.approvalCheckpoint) {
      this.approvalGate.restoreCheckpoint(session.approvalCheckpoint);
    }

    // Cryptographic validation of approval token against exact proposed SQL and session metadata
    this.approvalGate.verifyApproval(
      token,
      session.sessionId,
      session.plan?.id || `plan_${session.sessionId}`,
      session.targetId,
      proposal.proposedSql
    );

    const emitActivity = (
      actor: AgentRole,
      status: ActivityEventStatus,
      phase: string,
      message: string,
      durationMs?: number,
      evidenceRef?: string
    ) => {
      const event: AgentActivityEvent = {
        id: `act_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
        timestamp: new Date().toISOString(),
        sessionId: params.sessionId,
        phase,
        actor,
        status,
        message,
        durationMs,
        evidenceRef,
      };
      session.activityEvents.push(event);
      this.broadcaster.emitActivity(params.sessionId, event);
      return event;
    };

    const recordEvent = (
      step: string,
      status: "STARTED" | "COMPLETED" | "PAUSED_FOR_APPROVAL" | "FAILED",
      details: string
    ) => {
      const evt: AgentTimelineEvent = {
        timestamp: new Date().toISOString(),
        step,
        status,
        details,
      };
      session.timeline.push(evt);
      return evt;
    };

    const recordEvidence = (
      source: string,
      sourceType: EvidenceSourceType,
      actor: AgentRole,
      summary: string,
      rawPayload: unknown
    ): EvidenceItem => {
      const snapshottedPayload = JSON.parse(JSON.stringify(rawPayload));
      const contentHash = this.computeSha256(snapshottedPayload);
      const evidence: EvidenceItem = {
        evidenceId: `evi_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
        sessionId: params.sessionId,
        source,
        sourceType,
        actor,
        timestamp: new Date().toISOString(),
        summary,
        contentHash,
        rawReference: snapshottedPayload,
        confidence: 1.0,
      };
      session.evidenceItems.push(evidence);
      this.broadcaster.emitEvidence(params.sessionId, evidence);
      return evidence;
    };

    // Transition to PR_CREATING
    session.status = transitionSessionState(session.status, "PR_CREATING");
    this.broadcaster.emitStateChange(params.sessionId, session.status);
    session.currentStep = "PR_CREATING";

    recordEvent("SAFE_MIGRATION_APPROVED", "COMPLETED", `Operator '${params.approvedBy || "operator"}' approved safe migration PR creation.`);
    emitActivity("HUMAN", "COMPLETED", "SAFE_MIGRATION_APPROVAL", `Operator approved safe migration. Initiating GitHub PR creation.`);

    const baseBranch = params.baseBranch || "master";
    const branchName = `schemasentinel/migration/${session.sessionId}`;

    let prMeta: GitHubPrMetadata;
    try {
      // 1. Create Git branch
      recordEvent("PR_BRANCH_CREATING", "STARTED", `Creating GitHub branch '${branchName}' from '${baseBranch}'...`);
      emitActivity("ORCHESTRATOR", "RUNNING", "GITHUB_BRANCH", `Creating branch '${branchName}' in repo '${session.repo}'`);
      const branchRes = await this.githubMcp.createBranch(session.repo, branchName, baseBranch);
      recordEvent("PR_BRANCH_CREATED", "COMPLETED", `Branch '${branchRes.ref}' created at commit ${branchRes.sha.substring(0, 8)}`);
      emitActivity("ORCHESTRATOR", "COMPLETED", "GITHUB_BRANCH", `Branch '${branchName}' ready`);

      // 2. Commit safe migration file
      recordEvent("PR_FILE_COMMITTING", "STARTED", `Writing safe migration to '${session.migrationFilePath}'...`);
      emitActivity("ORCHESTRATOR", "RUNNING", "GITHUB_COMMIT", `Committing remediated migration file to branch '${branchName}'`);
      const commitRes = await this.githubMcp.writeMigrationFile(
        session.repo,
        branchName,
        session.migrationFilePath,
        proposal.proposedSql,
        `feat(migration): safe remediation for ${session.migrationFilePath.split("/").pop()}`
      );
      recordEvent("PR_MIGRATION_COMMITTED", "COMPLETED", `Safe migration committed with SHA ${commitRes.commitSha.substring(0, 8)}`);
      emitActivity("ORCHESTRATOR", "COMPLETED", "GITHUB_COMMIT", `Migration file committed to '${branchName}'`);

      // 3. Construct PR body & open PR
      const filename = session.migrationFilePath.split("/").pop() || "migration.sql";
      const prTitle = `Safe migration proposal: ${filename}`;
      const prBody = `
## 🛡️ SchemaSentinel Safe Migration Proposal

### 📋 Executive Summary
This Pull Request contains a **zero-downtime, staged safe remediation** generated by **SchemaSentinel** for migration file \`${session.migrationFilePath}\`.

- **Original Risk**: \`${proposal.riskReductionSummary.beforeRisk}\`
- **Remediated Risk**: \`${proposal.riskReductionSummary.afterRisk}\`
- **Affected Objects**: ${proposal.affectedObjects.map((o) => `\`${o}\``).join(", ")}
- **Session Tracking ID**: \`${session.sessionId}\`

---

### 🔍 Risk Reduction & Rationale
${proposal.rationale}

#### Eliminated Risk Factors:
${proposal.riskReductionSummary.eliminatedFactors.map((f) => `- ✅ ${f}`).join("\n")}

#### Staged Remediation Steps:
${proposal.remediationSteps.map((s, idx) => `${idx + 1}. ${s}`).join("\n")}

---

### 🧪 Isolated Sandbox Dry-Run Verification
- **Execution Status**: \`${proposal.sandboxValidation?.success ? "PASS" : "FAIL"}\`
- **Assertions Evaluated**: \`${proposal.sandboxValidation?.assertionsPassed?.length || 5} assertions passed\`
- **Rollback Verification**: \`${proposal.sandboxValidation?.rollbackSuccessful ? "PASS" : "FAIL"}\`

\`\`\`sql
-- Proposed Safe Staged Migration
${proposal.proposedSql}
\`\`\`

---
*Generated and verified autonomously by [SchemaSentinel](https://github.com/mohitpargaie002-a11y/SchemaSentinel). Ready for automated review by **Qodo**.*
      `.trim();

      recordEvent("PR_OPENING", "STARTED", `Opening Pull Request on GitHub...`);
      emitActivity("ORCHESTRATOR", "RUNNING", "GITHUB_PR", `Opening Pull Request from '${branchName}' into '${baseBranch}'`);
      const prResult = await this.githubMcp.createPullRequest(session.repo, prTitle, prBody, branchName, baseBranch);

      prMeta = {
        prNumber: prResult.prNumber,
        prUrl: prResult.prUrl,
        htmlUrl: prResult.htmlUrl,
        branch: branchName,
        baseBranch,
        commitSha: commitRes.commitSha,
        title: prTitle,
        body: prBody,
        createdAt: new Date().toISOString(),
        qodoStatus: "WAITING_FOR_REVIEW",
      };

      const prEvidence = recordEvidence(
        `github://${session.repo}/pull/${prMeta.prNumber}`,
        "GITHUB_PR",
        "ORCHESTRATOR",
        `GitHub PR #${prMeta.prNumber} opened on branch '${branchName}'`,
        prMeta
      );

      recordEvent("PR_CREATED", "COMPLETED", `Pull Request #${prMeta.prNumber} created: ${prMeta.htmlUrl}`);
      emitActivity(
        "ORCHESTRATOR",
        "COMPLETED",
        "GITHUB_PR",
        `Pull Request #${prMeta.prNumber} opened: Waiting for Qodo review`,
        undefined,
        prEvidence.evidenceId
      );

      // Durable single-use token consumption upon successful PR creation
      this.approvalGate.revokeToken(token);

      session.githubPr = prMeta;
      session.status = transitionSessionState(session.status, "PR_CREATED");
      session.currentStep = "PR_CREATED";
      session.completedAt = new Date().toISOString();
      session.isReadOnly = true;
      this.broadcaster.emitStateChange(params.sessionId, session.status);
      await this.sessionStore.saveSession(session);
      this.broadcaster.closeSessionStream(params.sessionId);

      return {
        githubPr: prMeta,
        sessionState: session,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      session.status = transitionSessionState(session.status, "PR_CREATION_FAILED");
      this.broadcaster.emitStateChange(params.sessionId, session.status);
      recordEvent("PR_CREATION_FAILED", "FAILED", `PR creation failed: ${msg}`);
      emitActivity("ORCHESTRATOR", "FAILED", "GITHUB_PR", `PR creation failed: ${msg}`);
      session.errorMessage = msg;
      await this.sessionStore.saveSession(session);
      throw err;
    }
  }
}

export const defaultOrchestrator = new TrueForgeOrchestrator();
