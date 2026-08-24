import { TrueForgeMigrationSession } from "../lib/agent/session.js";

async function main() {
  console.log("================================================================================");
  console.log("🛡️  SchemaSentinel — Day 2 / Phase 2: Agent Core Vertical Slice Proof-of-Life");
  console.log("================================================================================\n");

  const session = new TrueForgeMigrationSession();

  const userRequest = {
    sessionId: "sess_day2_slice_001",
    targetId: "demo-postgres",
    repo: "mohitpargaie002-a11y/SchemaSentinel",
    migrationFilePath: "migrations/0038_add_order_status.sql",
    userPrompt: "Review migration 0038_add_order_status.sql before production.",
  };

  console.log(`[USER REQUEST]: "${userRequest.userPrompt}"`);
  console.log(`[TARGET DATABASE]: ${userRequest.targetId}`);
  console.log(`[MIGRATION FILE]: ${userRequest.migrationFilePath}\n`);

  console.log("--------------------------------------------------------------------------------");
  console.log("▶ TrueForge Agent Initializing Session & Executing Autonomous Review Pipeline...");
  console.log("--------------------------------------------------------------------------------\n");

  const result = await session.executeReviewWorkflow(userRequest);

  console.log("📜 AGENT EXECUTION TIMELINE (TrueForge Harness):");
  result.context.timeline.forEach((t: { status: string; step: string; details: string }) => {
    const icon = t.status === "COMPLETED" ? "✓" : t.status === "STARTED" ? "●" : "🔒";
    console.log(`  ${icon} [${t.step}] (${t.status}): ${t.details}`);
  });

  console.log("\n================================================================================");
  console.log("📊 SCHEMASENTINEL RISK ASSESSMENT & SANDBOX VALIDATION REPORT");
  console.log("================================================================================");
  console.log(`Overall Risk Level : ${result.riskReport.overallRisk}`);
  console.log(`Locking Risk Level : ${result.riskReport.lockRisk}`);
  console.log(`Table Rewrite      : ${result.riskReport.tableRewriteExpected ? "YES (Hazardous)" : "NO"}`);
  console.log(`Rollback Feasibility: ${result.riskReport.rollbackFeasibility}`);
  console.log(`Sandbox Status     : ${result.approvalPacket.sandboxStatus}`);
  console.log(`Rollback Validation: ${result.approvalPacket.rollbackStatus}`);
  console.log(`Data Integrity     : ${result.approvalPacket.dataIntegrityStatus}\n`);

  console.log("🔍 DETAILED SAFETY FINDINGS:");
  result.riskReport.findings.forEach((f, idx) => {
    console.log(`  ${idx + 1}. [${f.severity}] ${f.title}`);
    console.log(`     Description: ${f.description}`);
    console.log(`     Remediation: ${f.remediation}\n`);
  });

  if (result.riskReport.remediatedStagedSql) {
    console.log("💡 RECOMMENDED SAFER STAGED MIGRATION ALTERNATIVE:");
    console.log("--------------------------------------------------------------------------------");
    console.log(result.riskReport.remediatedStagedSql);
    console.log("--------------------------------------------------------------------------------\n");
  }

  console.log("================================================================================");
  console.log("🔒 TRUEFORGE HUMAN APPROVAL CHECKPOINT (EXECUTION HALTED)");
  console.log("================================================================================");
  console.log(`Checkpoint Status  : ${result.approvalPacket.status}`);
  console.log(`Target Database    : ${result.approvalPacket.targetId} (${result.approvalPacket.targetEnvironment})`);
  console.log(`Migration File     : ${result.approvalPacket.migrationFilename}`);
  console.log(`Approval Token     : ${result.approvalPacket.approvalToken}`);
  console.log(`SHA-256 Fingerprint: ${result.approvalPacket.sqlFingerprint}`);
  console.log(`Safety Boundary    : ${result.approvalPacket.irreversibleWarning}`);
  console.log("\n🛑 Execution successfully stopped at TrueForge Approval Gate.");
  console.log("   Zero production database mutations performed.");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Day 2 Proof Execution Error:", err);
  process.exit(1);
});
