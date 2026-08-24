import { IRiskAnalyzer, defaultRiskAnalyzer, ComprehensiveRiskReport } from "../risk-analyzer.js";
import { RiskAnalysisResult, SchemaAnalysisResult, RiskFinding } from "../../domain/contracts.js";

export interface IRiskAnalystSubagent {
  analyzeMigrationRisk(
    planId: string,
    rawSql: string,
    schemaAnalysis?: SchemaAnalysisResult
  ): Promise<{
    riskReport: ComprehensiveRiskReport;
    riskAnalysis: RiskAnalysisResult;
  }>;
}

export class RiskAnalystSubagent implements IRiskAnalystSubagent {
  private riskAnalyzer: IRiskAnalyzer;

  constructor(riskAnalyzer: IRiskAnalyzer = defaultRiskAnalyzer) {
    this.riskAnalyzer = riskAnalyzer;
  }

  /**
   * Evaluates table locking risks, full table rewrites, nullability traps, and backfill costs.
   * Produces structured evidence and safer staged remediations.
   */
  public async analyzeMigrationRisk(
    planId: string,
    rawSql: string,
    schemaAnalysis?: SchemaAnalysisResult
  ): Promise<{
    riskReport: ComprehensiveRiskReport;
    riskAnalysis: RiskAnalysisResult;
  }> {
    const riskReport = this.riskAnalyzer.analyzeRisk(rawSql);

    const findings: RiskFinding[] = riskReport.findings.map((f) => ({
      category: f.category,
      level: f.severity,
      description: f.description,
      remediation: f.remediation,
    }));

    const dataLossRisk = riskReport.findings.some(
      (f) => f.category === "DATA_INTEGRITY" || f.code.includes("DESTRUCTIVE")
    );

    const summary = `Risk Analyst: Calculated Overall Risk = ${riskReport.overallRisk} (Lock Risk: ${riskReport.lockRisk}). Identified ${findings.length} risk factor(s). Table Rewrite Expected = ${riskReport.tableRewriteExpected ? "YES" : "NO"}.`;

    const riskAnalysis: RiskAnalysisResult = {
      planId,
      overallRisk: riskReport.overallRisk,
      lockRisk: riskReport.lockRisk,
      tableRewriteExpected: riskReport.tableRewriteExpected,
      dataLossRisk,
      findings,
      remediatedStagedSql: riskReport.remediatedStagedSql,
      summary,
    };

    return { riskReport, riskAnalysis };
  }
}
