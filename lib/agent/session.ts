import {
  AgentContext,
  AgentTimelineEvent,
} from "./types.js";
import { IPostgresMcpService, defaultPostgresMcpService } from "../mcp/postgres.js";
import { IGithubMcpService, defaultGithubMcpService } from "../mcp/github.js";
import { ISandboxRunner, defaultSandboxRunner } from "../sandbox/pglite-runner.js";
import { IApprovalGate, defaultApprovalGate } from "../safety/approval-gate.js";
import { IRiskAnalyzer, defaultRiskAnalyzer, ComprehensiveRiskReport } from "./risk-analyzer.js";
import { ISessionStore, defaultSessionStore, PersistedSessionState } from "./session-store.js";
import {
  MigrationPlan,
  SandboxValidationResult,
  SchemaSnapshot,
  ApplyResult,
  VerificationResult,
  TrueForgeApprovalPacket,
  TrueForgeApprovalPacketSchema,
} from "../domain/contracts.js";
import { TrueForgeOrchestrator } from "./orchestrator.js";
import { SandboxValidatorSubagent } from "./subagents/sandbox-validator.js";
import { RiskAnalystSubagent } from "./subagents/risk-analyst.js";
import { SchemaAnalystSubagent } from "./subagents/schema-analyst.js";
import { ReviewSynthesizerSubagent } from "./subagents/review-synthesizer.js";

export type { TrueForgeApprovalPacket };
export { TrueForgeApprovalPacketSchema };

export class TrueForgeMigrationSession {
  private orchestrator: TrueForgeOrchestrator;
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
    this.approvalGate = approvalGate;
    this.sessionStore = sessionStore;

    const schemaAnalyst = new SchemaAnalystSubagent(postgresMcp);
    const riskAnalyst = new RiskAnalystSubagent(riskAnalyzer);
    const sandboxValidator = new SandboxValidatorSubagent(sandboxRunner);
    const reviewSynthesizer = new ReviewSynthesizerSubagent(approvalGate);

    this.orchestrator = new TrueForgeOrchestrator(
      postgresMcp,
      githubMcp,
      approvalGate,
      sessionStore,
      schemaAnalyst,
      riskAnalyst,
      sandboxValidator,
      reviewSynthesizer
    );
  }

  /**
   * Executes the full migration review lifecycle using TrueForge specialized subagents.
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
    const result = await this.orchestrator.executeReviewWorkflow(params);
    return {
      context: result.context,
      riskReport: result.riskReport,
      approvalPacket: result.approvalPacket,
    };
  }

  /**
   * Resumes the SAME logical session from the persistent store and executes the staging apply.
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
    return this.orchestrator.resumeAndApplyWorkflow(params);
  }
}

export const defaultSession = new TrueForgeMigrationSession();
