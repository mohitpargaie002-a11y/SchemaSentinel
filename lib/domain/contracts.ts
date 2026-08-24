import { z } from "zod";

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const SessionStatusSchema = z.enum([
  "IDLE",
  "INSPECTING",
  "PLANNING",
  "SANDBOXING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "APPLYING",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

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
});
export type MigrationPlan = z.infer<typeof MigrationPlanSchema>;

export const SandboxValidationResultSchema = z.object({
  planId: z.string(),
  success: z.boolean(),
  executionDurationMs: z.number(),
  errorMessage: z.string().optional(),
  schemaDiffSummary: z.string(),
  assertionsPassed: z.array(z.string()),
  assertionsFailed: z.array(z.string()),
  rollbackSuccessful: z.boolean(),
});
export type SandboxValidationResult = z.infer<typeof SandboxValidationResultSchema>;

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
});
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

export const VerificationResultSchema = z.object({
  status: z.enum(["passed", "failed"]),
  checks: z.array(VerificationCheckSchema),
  failures: z.array(z.string()),
  executionDurationMs: z.number(),
  timestamp: z.string(),
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
  plan: MigrationPlanSchema.optional(),
  riskReport: z.any().optional(),
  sandboxResult: SandboxValidationResultSchema.optional(),
  approvalCheckpoint: ApprovalCheckpointSchema.optional(),
  approvalPacket: TrueForgeApprovalPacketSchema.optional(),
  applyResult: ApplyResultSchema.optional(),
  verificationResult: VerificationResultSchema.optional(),
  timeline: z.array(AgentTimelineEventSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  errorMessage: z.string().optional(),
});
export type PersistedSessionState = z.infer<typeof PersistedSessionStateSchema>;

