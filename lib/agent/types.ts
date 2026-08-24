import {
  MigrationPlan,
  RiskLevel,
  SandboxValidationResult,
  SchemaSnapshot,
  SessionStatus,
  ApprovalCheckpoint,
  ApplyResult,
} from "../domain/contracts.js";

export interface AgentContext {
  sessionId: string;
  targetId: string;
  status: SessionStatus;
  userPrompt: string;
  schemaSnapshot?: SchemaSnapshot;
  plan?: MigrationPlan;
  sandboxResult?: SandboxValidationResult;
  approvalCheckpoint?: ApprovalCheckpoint;
  applyResult?: ApplyResult;
  timeline: AgentTimelineEvent[];
}

export interface AgentTimelineEvent {
  timestamp: string;
  step: string;
  status: "STARTED" | "COMPLETED" | "PAUSED_FOR_APPROVAL" | "FAILED";
  details: string;
}
