import { z } from "zod";

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

// Formal Session State Machine States
export const SessionStatusSchema = z.enum([
  "CREATED",
  "RUNNING",
  "REVIEW_READY",
  "AWAITING_APPROVAL",
  "APPROVED",
  "APPLYING",
  "VERIFYING",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "VERIFICATION_FAILED",
  // Legacy Aliases for backwards compatibility
  "IDLE",
  "INSPECTING",
  "PLANNING",
  "SANDBOXING",
  "SYNTHESIZING",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * Valid state transitions table for SchemaSentinel State Machine.
 * Transitions not listed here are strictly forbidden and will throw a StateTransitionError.
 */
export const VALID_SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  CREATED: ["RUNNING", "FAILED"],
  IDLE: ["RUNNING", "INSPECTING", "FAILED"],
  INSPECTING: ["PLANNING", "RUNNING", "FAILED"],
  PLANNING: ["SANDBOXING", "RUNNING", "FAILED"],
  SANDBOXING: ["SYNTHESIZING", "RUNNING", "FAILED"],
  SYNTHESIZING: ["REVIEW_READY", "AWAITING_APPROVAL", "FAILED"],
  RUNNING: ["REVIEW_READY", "AWAITING_APPROVAL", "FAILED"],
  REVIEW_READY: ["AWAITING_APPROVAL", "FAILED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "FAILED"],
  APPROVED: ["APPLYING", "FAILED"],
  APPLYING: ["VERIFYING", "COMPLETED", "FAILED"],
  VERIFYING: ["COMPLETED", "VERIFICATION_FAILED", "FAILED"],
  COMPLETED: [], // Terminal
  REJECTED: [], // Terminal
  FAILED: [], // Terminal
  VERIFICATION_FAILED: [], // Terminal
};

export class SentinelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SentinelError";
  }
}

export class StateTransitionError extends SentinelError {
  constructor(public readonly current: SessionStatus, public readonly next: SessionStatus) {
    super(`Illegal state transition from '${current}' to '${next}'. State machine fails closed.`);
    this.name = "StateTransitionError";
  }
}

export function transitionSessionState(current: SessionStatus, next: SessionStatus): SessionStatus {
  const allowed = VALID_SESSION_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw new StateTransitionError(current, next);
  }
  return next;
}

export const AgentRoleSchema = z.enum([
  "ORCHESTRATOR",
  "SCHEMA_ANALYST",
  "RISK_ANALYST",
  "SANDBOX_VALIDATOR",
  "REVIEW_SYNTHESIZER",
  "SYSTEM",
  "HUMAN",
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const ActivityEventStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "WAITING",
  "FAILED",
  "BLOCKED",
]);
export type ActivityEventStatus = z.infer<typeof ActivityEventStatusSchema>;

// Evidence Provenance Model
export const EvidenceSourceTypeSchema = z.enum([
  "MIGRATION_FILE",
  "POSTGRES_SCHEMA",
  "POSTGRES_QUERY",
  "SANDBOX_EXECUTION",
  "RISK_ANALYSIS",
  "VERIFICATION_QUERY",
  "SYSTEM",
]);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;

export const EvidenceItemSchema = z.object({
  evidenceId: z.string(),
  sessionId: z.string(),
  source: z.string(),
  sourceType: EvidenceSourceTypeSchema,
  actor: AgentRoleSchema,
  timestamp: z.string(),
  summary: z.string(),
  contentHash: z.string(), // SHA-256 fingerprint
  rawReference: z.unknown().optional(),
  confidence: z.number().min(0).max(1).optional().default(1.0),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const AgentActivityEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  sessionId: z.string(),
  phase: z.string(),
  actor: AgentRoleSchema,
  status: ActivityEventStatusSchema,
  message: z.string(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number().optional(),
  toolName: z.string().optional(),
  evidenceRef: z.string().optional(), // Link to EvidenceItem.evidenceId
});
export type AgentActivityEvent = z.infer<typeof AgentActivityEventSchema>;

export const TargetConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  environment: z.enum(["development", "staging", "staging-demo", "sandbox", "production"]),
  connectionString: z.string(),
  isAllowed: z.boolean().default(true),
  mutable: z.boolean().default(false),
  allowedToApply: z.boolean().default(false),
  approvalRequired: z.boolean().default(true),
  provider: z.enum(["postgres", "pglite"]).default("postgres"),
});
export type TargetConfig = z.infer<typeof TargetConfigSchema>;

export const ColumnMetadataSchema = z.object({
  name: z.string(),
  type: z.string(),
  isNullable: z.boolean(),
  defaultValue: z.string().nullable().optional(),
});
export type ColumnMetadata = z.infer<typeof ColumnMetadataSchema>;

export const TableMetadataSchema = z.object({
  tableName: z.string(),
  columns: z.array(ColumnMetadataSchema),
  primaryKeys: z.array(z.string()),
  foreignKeys: z.array(
    z.object({
      column: z.string(),
      foreignTable: z.string(),
      foreignColumn: z.string(),
    })
  ),
  indexes: z.array(
    z.object({
      name: z.string(),
      columns: z.array(z.string()),
      isUnique: z.boolean(),
    })
  ),
  estimatedRows: z.number().default(0),
});
export type TableMetadata = z.infer<typeof TableMetadataSchema>;

export const SchemaSnapshotSchema = z.object({
  targetId: z.string(),
  timestamp: z.string(),
  tables: z.array(TableMetadataSchema),
});
export type SchemaSnapshot = z.infer<typeof SchemaSnapshotSchema>;

export const SchemaAnalysisResultSchema = z.object({
  targetId: z.string(),
  timestamp: z.string(),
  tableCount: z.number(),
  totalIndexCount: z.number(),
  affectedTables: z.array(z.string()),
  affectedTableDetails: z.array(TableMetadataSchema),
  foreignKeyDependencies: z.array(
    z.object({
      sourceTable: z.string(),
      sourceColumn: z.string(),
      targetTable: z.string(),
      targetColumn: z.string(),
    })
  ),
  volumeEstimates: z.record(z.string(), z.number()),
  summary: z.string(),
  evidenceId: z.string().optional(),
  contentHash: z.string().optional(),
});
export type SchemaAnalysisResult = z.infer<typeof SchemaAnalysisResultSchema>;

export const MigrationPlanSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  targetId: z.string(),
  userPrompt: z.string(),
  rawSql: z.string(),
  riskLevel: RiskLevelSchema,
  riskFactors: z.array(z.string()),
  affectedTables: z.array(z.string()),
  rollbackSql: z.string().optional(),
  createdAt: z.string(),
  contentHash: z.string().optional(),
  evidenceId: z.string().optional(),
});
export type MigrationPlan = z.infer<typeof MigrationPlanSchema>;

export const RiskFindingSchema = z.object({
  category: z.string(),
  level: RiskLevelSchema,
  description: z.string(),
  remediation: z.string().optional(),
  evidenceRef: z.string().optional(),
});
export type RiskFinding = z.infer<typeof RiskFindingSchema>;

export const RiskAnalysisResultSchema = z.object({
  planId: z.string(),
  overallRisk: RiskLevelSchema,
  lockRisk: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "EXCLUSIVE_LOCK_CRITICAL"]),
  tableRewriteExpected: z.boolean(),
  dataLossRisk: z.boolean(),
  findings: z.array(RiskFindingSchema),
  remediatedStagedSql: z.string().optional(),
  summary: z.string(),
  evidenceId: z.string().optional(),
  contentHash: z.string().optional(),
});
export type RiskAnalysisResult = z.infer<typeof RiskAnalysisResultSchema>;

export const SmokeQueryResultSchema = z.object({
  query: z.string(),
  rowCount: z.number(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});
export type SmokeQueryResult = z.infer<typeof SmokeQueryResultSchema>;

export const SandboxValidationResultSchema = z.object({
  planId: z.string(),
  success: z.boolean(),
  executionDurationMs: z.number(),
  errorMessage: z.string().optional(),
  schemaDiffSummary: z.string(),
  assertionsPassed: z.array(z.string()),
  assertionsFailed: z.array(z.string()),
  rollbackSuccessful: z.boolean(),
  smokeQueryResults: z.array(SmokeQueryResultSchema).default([]),
  evidenceId: z.string().optional(),
  contentHash: z.string().optional(),
});
export type SandboxValidationResult = z.infer<typeof SandboxValidationResultSchema>;

export const SandboxValidationOutputSchema = z.object({
  planId: z.string(),
  success: z.boolean(),
  executionDurationMs: z.number(),
  schemaDiffSummary: z.string(),
  assertionsPassed: z.array(z.string()),
  assertionsFailed: z.array(z.string()),
  rollbackSuccessful: z.boolean(),
  smokeQueryResults: z.array(SmokeQueryResultSchema),
  errorMessage: z.string().optional(),
  evidenceId: z.string().optional(),
  contentHash: z.string().optional(),
});
export type SandboxValidationOutput = z.infer<typeof SandboxValidationOutputSchema>;

export const MigrationReviewReportSchema = z.object({
  sessionId: z.string(),
  planId: z.string(),
  targetId: z.string(),
  targetEnvironment: z.string(),
  migrationSummary: z.string(),
  affectedObjects: z.array(z.string()),
  overallRisk: RiskLevelSchema,
  lockRisk: z.string(),
  tableRewriteExpected: z.boolean(),
  dataIntegrityStatus: z.enum(["PASS", "FAIL"]),
  sandboxStatus: z.enum(["PASS", "FAIL"]),
  rollbackStatus: z.enum(["PASS", "FAIL"]),
  findings: z.array(RiskFindingSchema),
  recommendedPlan: z.array(z.string()),
  approvalSummary: z.string(),
  remediatedStagedSql: z.string().optional(),
  evidenceProvenance: z.array(z.string()).default([]),
});
export type MigrationReviewReport = z.infer<typeof MigrationReviewReportSchema>;

export const ApprovalCheckpointSchema = z.object({
  sessionId: z.string(),
  planId: z.string(),
  targetId: z.string(),
  sqlFingerprint: z.string(),
  approved: z.boolean(),
  approvedBy: z.string().optional(),
  token: z.string(),
  timestamp: z.string(),
});
export type ApprovalCheckpoint = z.infer<typeof ApprovalCheckpointSchema>;

export const VerificationCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  details: z.string(),
  evidenceRef: z.string().optional(),
});
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

export const VerificationResultSchema = z.object({
  status: z.enum(["passed", "failed"]),
  checks: z.array(VerificationCheckSchema),
  failures: z.array(z.string()),
  executionDurationMs: z.number(),
  timestamp: z.string(),
  evidenceId: z.string().optional(),
  contentHash: z.string().optional(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const ApplyResultSchema = z.object({
  planId: z.string(),
  targetId: z.string(),
  status: z.enum([
    "APPLY_BLOCKED",
    "APPLY_FAILED",
    "APPLY_SUCCEEDED",
    "APPLY_SUCCEEDED_VERIFICATION_FAILED",
    "COMPLETED",
  ]),
  success: z.boolean(),
  appliedAt: z.string(),
  executionDurationMs: z.number(),
  verificationPassed: z.boolean().optional(),
  verificationResult: VerificationResultSchema.optional(),
  auditLog: z.array(z.string()),
  errorMessage: z.string().optional(),
  evidenceId: z.string().optional(),
  contentHash: z.string().optional(),
});
export type ApplyResult = z.infer<typeof ApplyResultSchema>;

export const AgentTimelineEventSchema = z.object({
  timestamp: z.string(),
  step: z.string(),
  status: z.enum(["STARTED", "COMPLETED", "PAUSED_FOR_APPROVAL", "FAILED"]),
  details: z.string(),
});
export type AgentTimelineEvent = z.infer<typeof AgentTimelineEventSchema>;

export const AgentContextSchema = z.object({
  sessionId: z.string(),
  targetId: z.string(),
  status: SessionStatusSchema,
  userPrompt: z.string(),
  schemaSnapshot: SchemaSnapshotSchema.optional(),
  plan: MigrationPlanSchema.optional(),
  sandboxResult: SandboxValidationResultSchema.optional(),
  approvalCheckpoint: ApprovalCheckpointSchema.optional(),
  applyResult: ApplyResultSchema.optional(),
  timeline: z.array(AgentTimelineEventSchema),
});
export type AgentContext = z.infer<typeof AgentContextSchema>;

export const TrueForgeApprovalPacketSchema = z.object({
  sessionId: z.string(),
  planId: z.string(),
  targetId: z.string(),
  targetEnvironment: z.string(),
  migrationFilename: z.string(),
  migrationSummary: z.string(),
  riskLevel: z.string(),
  lockRisk: z.string(),
  tableRewriteExpected: z.boolean(),
  affectedObjects: z.array(z.string()),
  sandboxStatus: z.enum(["PASS", "FAIL"]),
  rollbackStatus: z.enum(["PASS", "FAIL"]),
  dataIntegrityStatus: z.enum(["PASS", "FAIL"]),
  candidateSql: z.string(),
  remediatedStagedSql: z.string().optional(),
  isModifiedFromOriginal: z.boolean(),
  sqlFingerprint: z.string(),
  approvalToken: z.string(),
  status: z.literal("AWAITING_HUMAN_APPROVAL"),
  irreversibleWarning: z.string(),
});
export type TrueForgeApprovalPacket = z.infer<typeof TrueForgeApprovalPacketSchema>;

export const PersistedSessionStateSchema = z.object({
  sessionId: z.string(),
  targetId: z.string(),
  repo: z.string(),
  migrationFilePath: z.string(),
  userPrompt: z.string(),
  status: SessionStatusSchema,
  currentStep: z.string(),
  schemaSnapshot: SchemaSnapshotSchema.optional(),
  schemaAnalysis: SchemaAnalysisResultSchema.optional(),
  plan: MigrationPlanSchema.optional(),
  riskAnalysis: RiskAnalysisResultSchema.optional(),
  riskReport: z.any().optional(),
  sandboxResult: SandboxValidationResultSchema.optional(),
  sandboxOutput: SandboxValidationOutputSchema.optional(),
  reviewReport: MigrationReviewReportSchema.optional(),
  approvalCheckpoint: ApprovalCheckpointSchema.optional(),
  approvalPacket: TrueForgeApprovalPacketSchema.optional(),
  applyResult: ApplyResultSchema.optional(),
  verificationResult: VerificationResultSchema.optional(),
  timeline: z.array(AgentTimelineEventSchema).default([]),
  activityEvents: z.array(AgentActivityEventSchema).default([]),
  evidenceItems: z.array(EvidenceItemSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  isReadOnly: z.boolean().default(false),
  errorMessage: z.string().optional(),
});
export type PersistedSessionState = z.infer<typeof PersistedSessionStateSchema>;

// Session Summary for History Listing
export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  migrationFilePath: z.string(),
  targetId: z.string(),
  targetEnvironment: z.string(),
  overallRisk: RiskLevelSchema.optional(),
  status: SessionStatusSchema,
  createdAt: z.string(),
  completedAt: z.string().optional(),
  approvalState: z.string(),
  isReadOnly: z.boolean().default(false),
  tableCount: z.number().optional(),
  eventCount: z.number().default(0),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

// HTTP API Request Schemas
export const CreateSessionRequestSchema = z.object({
  targetId: z.string().min(1).default("staging-demo"),
  repo: z.string().min(1).default("mohitpargaie002-a11y/SchemaSentinel"),
  migrationFilePath: z.string().min(1).default("migrations/0038_add_order_status.sql"),
  userPrompt: z.string().optional(),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const ApproveSessionRequestSchema = z.object({
  approvalToken: z.string().optional(),
  approvedBy: z.string().min(1).default("lead-dba@schemasentinel.dev"),
});
export type ApproveSessionRequest = z.infer<typeof ApproveSessionRequestSchema>;

export const RejectSessionRequestSchema = z.object({
  approvedBy: z.string().optional().default("lead-dba@schemasentinel.dev"),
});
export type RejectSessionRequest = z.infer<typeof RejectSessionRequestSchema>;
