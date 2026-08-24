import { IApprovalGate, defaultApprovalGate } from "../../safety/approval-gate.js";
import {
  MigrationPlan,
  MigrationReviewReport,
  RiskAnalysisResult,
  SandboxValidationOutput,
  SchemaAnalysisResult,
  TrueForgeApprovalPacket,
} from "../../domain/contracts.js";
import { ComprehensiveRiskReport } from "../risk-analyzer.js";

export interface IReviewSynthesizerSubagent {
  synthesizeReview(params: {
    sessionId: string;
    plan: MigrationPlan;
    targetId: string;
    targetEnvironment: string;
    migrationFilePath: string;
    migrationSummary: string;
    schemaAnalysis: SchemaAnalysisResult;
    riskReport: ComprehensiveRiskReport;
    riskAnalysis: RiskAnalysisResult;
    sandboxOutput: SandboxValidationOutput;
  }): Promise<{
    reviewReport: MigrationReviewReport;
    approvalPacket: TrueForgeApprovalPacket;
  }>;
}

export class ReviewSynthesizerSubagent implements IReviewSynthesizerSubagent {
  private approvalGate: IApprovalGate;

  constructor(approvalGate: IApprovalGate = defaultApprovalGate) {
    this.approvalGate = approvalGate;
  }

  /**
   * Synthesizes findings from Schema Analyst, Risk Analyst, and Sandbox Validator.
   * Produces an evidence-backed MigrationReviewReport and cryptographic TrueForgeApprovalPacket.
   */
  public async synthesizeReview(params: {
    sessionId: string;
    plan: MigrationPlan;
    targetId: string;
    targetEnvironment: string;
    migrationFilePath: string;
    migrationSummary: string;
    schemaAnalysis: SchemaAnalysisResult;
    riskReport: ComprehensiveRiskReport;
    riskAnalysis: RiskAnalysisResult;
    sandboxOutput: SandboxValidationOutput;
  }): Promise<{
    reviewReport: MigrationReviewReport;
    approvalPacket: TrueForgeApprovalPacket;
  }> {
    const {
      sessionId,
      plan,
      targetId,
      targetEnvironment,
      migrationFilePath,
      migrationSummary,
      schemaAnalysis,
      riskReport,
      riskAnalysis,
      sandboxOutput,
    } = params;

    const dataIntegrityPassed =
      sandboxOutput.success &&
      sandboxOutput.assertionsFailed.length === 0 &&
      sandboxOutput.assertionsPassed.length > 0;

    const recommendedPlan: string[] = [];
    if (riskReport.overallRisk === "HIGH" || riskReport.tableRewriteExpected) {
      recommendedPlan.push("Phase 1 (Expand): Add column as nullable without blocking default");
      recommendedPlan.push("Phase 2 (Default): Set default value for subsequent new writes");
      recommendedPlan.push("Phase 3 (Backfill): Backfill existing historical rows in non-blocking batches");
      recommendedPlan.push("Phase 4 (Enforce): Apply NOT NULL / validation constraints");
      recommendedPlan.push("Phase 5 (Index): Create supporting indexes with CONCURRENTLY");
    } else {
      recommendedPlan.push("Standard Rollout: Direct transaction-wrapped DDL application");
      recommendedPlan.push("Post-Apply Verification: Automatic catalog assertions");
    }

    const approvalSummary =
      `Migration '${migrationFilePath}' on target '${targetId}' (${targetEnvironment}) assessed with ` +
      `Overall Risk = ${riskReport.overallRisk}, Lock Risk = ${riskReport.lockRisk}, Sandbox Status = ${sandboxOutput.success ? "PASS" : "FAIL"}. ` +
      `Explicit human approval checkpoint required prior to any target database mutation.`;

    const reviewReport: MigrationReviewReport = {
      sessionId,
      planId: plan.id,
      targetId,
      targetEnvironment,
      migrationSummary,
      affectedObjects: plan.affectedTables,
      overallRisk: riskReport.overallRisk,
      lockRisk: riskReport.lockRisk,
      tableRewriteExpected: riskReport.tableRewriteExpected,
      dataIntegrityStatus: dataIntegrityPassed ? "PASS" : "FAIL",
      sandboxStatus: sandboxOutput.success ? "PASS" : "FAIL",
      rollbackStatus: sandboxOutput.rollbackSuccessful ? "PASS" : "FAIL",
      findings: riskAnalysis.findings,
      recommendedPlan,
      approvalSummary,
      remediatedStagedSql: riskReport.remediatedStagedSql,
    };

    // Generate cryptographic checkpoint binding
    const checkpoint = this.approvalGate.grantApproval(sessionId, plan);

    const approvalPacket: TrueForgeApprovalPacket = {
      sessionId,
      planId: plan.id,
      targetId,
      targetEnvironment,
      migrationFilename: migrationFilePath,
      migrationSummary,
      riskLevel: riskReport.overallRisk,
      lockRisk: riskReport.lockRisk,
      tableRewriteExpected: riskReport.tableRewriteExpected,
      affectedObjects: plan.affectedTables,
      sandboxStatus: sandboxOutput.success ? "PASS" : "FAIL",
      rollbackStatus: sandboxOutput.rollbackSuccessful ? "PASS" : "FAIL",
      dataIntegrityStatus: dataIntegrityPassed ? "PASS" : "FAIL",
      candidateSql: plan.rawSql,
      remediatedStagedSql: riskReport.remediatedStagedSql,
      isModifiedFromOriginal: !!riskReport.remediatedStagedSql,
      sqlFingerprint: checkpoint.sqlFingerprint,
      approvalToken: checkpoint.token,
      status: "AWAITING_HUMAN_APPROVAL",
      irreversibleWarning: "CAUTION: Approving this checkpoint authorizes irreversible DDL execution on the target database.",
    };

    return { reviewReport, approvalPacket };
  }
}
