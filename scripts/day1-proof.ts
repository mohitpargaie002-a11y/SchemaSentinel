import { SchemaSentinelAgentHarness } from "../lib/agent/runner.js";
import { ApprovalGate } from "../lib/safety/approval-gate.js";
import { PostgresMcpService } from "../lib/mcp/postgres.js";

async function main() {
  console.log("================================================================");
  console.log("🛡️  SchemaSentinel — Day 1 TrueForge Harness Proof-of-Life Demo");
  console.log("================================================================\n");

  const approvalGate = new ApprovalGate();
  const postgresMcp = new PostgresMcpService(undefined, approvalGate);
  const harness = new SchemaSentinelAgentHarness(postgresMcp, undefined, approvalGate);

  const sessionId = "sess_day1_demo";
  const targetId = "demo-postgres";
  const userPrompt = "Add fulfillment_status to orders and index it for search queries.";

  console.log(`[Step 1] Initializing Session '${sessionId}' for target '${targetId}'...`);
  let context = harness.createSession(sessionId, targetId, userPrompt);
  console.log(`✓ Session Status: ${context.status}\n`);

  console.log("[Step 2] Running Autonomous Pre-Approval Pipeline (Inspect + Sandbox + Risk)...");
  context = await harness.runPreApprovalPipeline(context);

  console.log(`✓ Schema Tables Discovered: ${context.schemaSnapshot?.tables.map((t: { tableName: string }) => t.tableName).join(", ")}`);
  console.log(`✓ Risk Classification: ${context.plan?.riskLevel}`);
  console.log(`✓ Risk Factors:`);
  context.plan?.riskFactors.forEach((f: string) => console.log(`   - ${f}`));
  console.log(`✓ Sandbox Validation Status: ${context.sandboxResult?.success ? "PASSED" : "FAILED"}`);
  console.log(`✓ Current Session Status: ${context.status} (HALTED AT APPROVAL CHECKPOINT)\n`);

  console.log("----------------------------------------------------------------");
  console.log("[Step 3] Proving Safety Gate Boundary: Attempt Apply WITHOUT Approval...");
  try {
    await postgresMcp.applyMigration(
      targetId,
      sessionId,
      context.plan!.id,
      context.plan!.rawSql,
      "unauthorized_fake_token"
    );
    console.error("❌ FAILURE: Safety gate failed to block unauthorized apply!");
    process.exit(1);
  } catch (err: any) {
    console.log(`🔒 SAFETY BOUNDARY ENFORCED: ${err.message}`);
  }
  console.log("----------------------------------------------------------------\n");

  console.log("[Step 4] Granting Explicit Human Approval Checkpoint...");
  const checkpoint = approvalGate.grantApproval(
    sessionId,
    context.plan!,
    "lead_architect@schemasentinel.dev"
  );
  console.log(`✓ Approval Granted by: ${checkpoint.approvedBy}`);
  console.log(`✓ SHA-256 Plan Fingerprint: ${checkpoint.sqlFingerprint}`);
  console.log(`✓ Approval Token: ${checkpoint.token}\n`);

  console.log("----------------------------------------------------------------");
  console.log("[Step 5] Proving Tamper Detection: Modify SQL after Approval...");
  try {
    const tamperedSql = context.plan!.rawSql + "\n-- Tampered DDL Injection";
    approvalGate.verifyApproval(
      checkpoint.token,
      sessionId,
      context.plan!.id,
      targetId,
      tamperedSql
    );
    console.error("❌ FAILURE: Tamper detection failed!");
    process.exit(1);
  } catch (err: any) {
    console.log(`🔒 TAMPER DETECTION VERIFIED: ${err.message}`);
  }
  console.log("----------------------------------------------------------------\n");

  console.log("[Step 6] Executing Approved Apply & Post-Apply Verification...");
  context = await harness.runApprovedApply(context, checkpoint.token);

  console.log(`✓ Final Session Status: ${context.status}`);
  console.log(`✓ Apply Execution Duration: ${context.applyResult?.executionDurationMs}ms`);
  console.log(`✓ Verification Passed: ${context.applyResult?.verificationPassed}`);
  console.log(`✓ Audit Trail:`);
  context.applyResult?.auditLog.forEach((log: string) => console.log(`   ${log}`));

  console.log("\n================================================================");
  console.log("🎉 Day 1 Proof-of-Life Successful: All Invariants & Gates Verified!");
  console.log("================================================================");
}

main().catch(err => {
  console.error("Error executing Day 1 demo:", err);
  process.exit(1);
});
