import { describe, it, expect } from "vitest";
import { SchemaAnalystSubagent } from "../../lib/agent/subagents/schema-analyst.js";
import { RiskAnalystSubagent } from "../../lib/agent/subagents/risk-analyst.js";
import { SandboxValidatorSubagent } from "../../lib/agent/subagents/sandbox-validator.js";
import { ReviewSynthesizerSubagent } from "../../lib/agent/subagents/review-synthesizer.js";
import { defaultPostgresMcpService } from "../../lib/mcp/postgres.js";
import { defaultApprovalGate } from "../../lib/safety/approval-gate.js";
import { MigrationPlan } from "../../lib/domain/contracts.js";

describe("Subagents - Unit Tests", () => {
  it("SchemaAnalystSubagent performs read-only introspection without mutating target", async () => {
    const analyst = new SchemaAnalystSubagent(defaultPostgresMcpService);
    const { snapshot, analysis } = await analyst.analyzeSchema("demo-postgres", ["orders"]);

    expect(snapshot.tables.length).toBeGreaterThan(0);
    expect(analysis.targetId).toBe("demo-postgres");
    expect(analysis.affectedTables).toContain("orders");
    expect(analysis.totalIndexCount).toBeGreaterThan(0);
    expect(analysis.summary).toContain("Schema Analyst:");
  });

  it("RiskAnalystSubagent detects NOT NULL column with DEFAULT hazard and locking risks", async () => {
    const riskAnalyst = new RiskAnalystSubagent();
    const rawSql = `ALTER TABLE orders ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending';\nCREATE INDEX idx_orders_status ON orders(status);`;

    const { riskReport, riskAnalysis } = await riskAnalyst.analyzeMigrationRisk("plan_test_01", rawSql);

    expect(riskReport.overallRisk).toBe("HIGH");
    expect(riskReport.lockRisk).toBe("HIGH");
    expect(riskReport.tableRewriteExpected).toBe(true);
    expect(riskAnalysis.findings.length).toBeGreaterThanOrEqual(2);
    expect(riskAnalysis.findings.some((f) => f.category === "LOCKING")).toBe(true);
  });

  it("SandboxValidatorSubagent executes isolated PGlite validation and tests rollback", async () => {
    const sandboxValidator = new SandboxValidatorSubagent();
    const rawSql = `ALTER TABLE orders ADD COLUMN test_col VARCHAR(50);`;
    const rollbackSql = `ALTER TABLE orders DROP COLUMN IF EXISTS test_col;`;

    const { sandboxResult, sandboxOutput } = await sandboxValidator.validateInSandbox(
      "plan_test_sandbox",
      rawSql,
      rollbackSql
    );

    expect(sandboxResult.success).toBe(true);
    expect(sandboxResult.rollbackSuccessful).toBe(true);
    expect(sandboxOutput.assertionsPassed.length).toBeGreaterThan(0);
    expect(sandboxOutput.assertionsFailed.length).toBe(0);
    expect(sandboxOutput.smokeQueryResults.length).toBeGreaterThan(0);
  });

  it("ReviewSynthesizerSubagent synthesizes multi-agent evidence into a cryptographic approval packet", async () => {
    const synthesizer = new ReviewSynthesizerSubagent(defaultApprovalGate);
    const plan: MigrationPlan = {
      id: "plan_test_synth",
      sessionId: "sess_test_synth",
      targetId: "staging-demo",
      userPrompt: "Add order status",
      rawSql: "ALTER TABLE orders ADD COLUMN status VARCHAR(32);",
      riskLevel: "HIGH",
      riskFactors: ["Table Rewrite"],
      affectedTables: ["orders"],
      createdAt: new Date().toISOString(),
    };

    const { reviewReport, approvalPacket } = await synthesizer.synthesizeReview({
      sessionId: plan.sessionId,
      plan,
      targetId: plan.targetId,
      targetEnvironment: "staging-demo",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      migrationSummary: "Add column status to orders",
      schemaAnalysis: {
        targetId: plan.targetId,
        timestamp: new Date().toISOString(),
        tableCount: 3,
        totalIndexCount: 14,
        affectedTables: ["orders"],
        affectedTableDetails: [],
        foreignKeyDependencies: [],
        volumeEstimates: { orders: 50000 },
        summary: "Schema Analyst Introspection",
      },
      riskReport: {
        overallRisk: "HIGH",
        requiresStagedRollout: true,
        lockRisk: "HIGH",
        tableRewriteExpected: true,
        rollbackFeasibility: "FULLY_REVERSIBLE",
        findings: [
          {
            code: "HAZARD_LOCK",
            category: "LOCKING",
            severity: "HIGH",
            title: "Access Exclusive Lock",
            description: "Table rewrite lock",
            remediation: "Staged rollout",
          },
        ],
      },
      riskAnalysis: {
        planId: plan.id,
        overallRisk: "HIGH",
        lockRisk: "HIGH",
        tableRewriteExpected: true,
        dataLossRisk: false,
        findings: [
          {
            category: "LOCKING",
            level: "HIGH",
            description: "Table rewrite lock",
            remediation: "Staged rollout",
          },
        ],
        summary: "Risk Analysis Summary",
      },
      sandboxOutput: {
        planId: plan.id,
        success: true,
        executionDurationMs: 150,
        schemaDiffSummary: "Column added",
        assertionsPassed: ["Column exists"],
        assertionsFailed: [],
        rollbackSuccessful: true,
        smokeQueryResults: [],
      },
    });

    expect(reviewReport.overallRisk).toBe("HIGH");
    expect(reviewReport.recommendedPlan.length).toBeGreaterThan(0);
    expect(approvalPacket.status).toBe("AWAITING_HUMAN_APPROVAL");
    expect(approvalPacket.approvalToken.startsWith("sat_")).toBe(true);
    expect(approvalPacket.sqlFingerprint.length).toBe(64);
  });
});
