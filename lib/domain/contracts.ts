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
  environment: z.enum(["development", "staging-demo", "sandbox"]),
  connectionString: z.string(),
  isAllowed: z.boolean().default(true),
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

export const ApplyResultSchema = z.object({
  planId: z.string(),
  targetId: z.string(),
  success: z.boolean(),
  appliedAt: z.string(),
  executionDurationMs: z.number(),
  verificationPassed: z.boolean(),
  auditLog: z.array(z.string()),
});
export type ApplyResult = z.infer<typeof ApplyResultSchema>;
