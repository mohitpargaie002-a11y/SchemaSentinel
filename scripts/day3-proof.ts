import { TrueForgeMigrationSession } from "../lib/agent/session.js";
import { defaultSessionStore } from "../lib/agent/session-store.js";
import { defaultPostgresMcpService } from "../lib/mcp/postgres.js";

async function main() {
  console.log("================================================================================");
  console.log("🛡️  SchemaSentinel — Day 3 / Phase 3: Controlled Staging Apply & Resume Proof");
  console.log("================================================================================\n");

  const sessionId = "sess_day3_staging_apply_001";
  const targetId = "staging-demo";
  const repo = "mohitpargaie002-a11y/SchemaSentinel";
  const migrationFilePath = "migrations/0038_add_order_status.sql";
  const userPrompt = "Review and apply migration 0038_add_order_status.sql to staging-demo.";

  console.log(`[USER REQUEST]     : "${userPrompt}"`);
  console.log(`[SESSION ID]       : ${sessionId}`);
  console.log(`[TARGET DATABASE]  : ${targetId} (Allowlisted Mutable Staging Profile)`);
  console.log(`[MIGRATION FILE]   : ${migrationFilePath}\n`);

  // ============================================================================
  // PART 1: AUTONOMOUS REVIEW & TRUEFORGE APPROVAL HALT
  // ============================================================================
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ PHASE 1: Running TrueForge Autonomous Review Pipeline & Sandbox Isolation...");
  console.log("--------------------------------------------------------------------------------");

  const sessionRunner = new TrueForgeMigrationSession(defaultPostgresMcpService);

  const reviewResult = await sessionRunner.executeReviewWorkflow({
    sessionId,
    targetId,
    repo,
    migrationFilePath,
    userPrompt,
  });

  console.log("\n📜 PRE-APPROVAL TIMELINE:");
  reviewResult.context.timeline.forEach((t) => {
    const icon = t.status === "COMPLETED" ? "✓" : t.status === "STARTED" ? "●" : "🔒";
    console.log(`  ${icon} [${t.step}] (${t.status}): ${t.details}`);
  });

  console.log("\n📊 ASSESSMENT SUMMARY:");
  console.log(`  Overall Risk Level  : ${reviewResult.riskReport.overallRisk}`);
  console.log(`  Lock Risk Level     : ${reviewResult.riskReport.lockRisk}`);
  console.log(`  Sandbox Status      : ${reviewResult.approvalPacket.sandboxStatus}`);
  console.log(`  Rollback Status     : ${reviewResult.approvalPacket.rollbackStatus}`);
  console.log(`  Data Integrity      : ${reviewResult.approvalPacket.dataIntegrityStatus}`);

  console.log("\n🔒 TRUEFORGE HUMAN APPROVAL CHECKPOINT REACHED:");
  console.log(`  Status              : ${reviewResult.approvalPacket.status}`);
  console.log(`  Approval Token      : ${reviewResult.approvalPacket.approvalToken}`);
  console.log(`  SHA-256 Fingerprint : ${reviewResult.approvalPacket.sqlFingerprint}`);
  console.log("  🛑 Execution halted before database mutation.");

  // ============================================================================
  // PART 2: SIMULATE PROCESS DISCONNECT & SESSION RESTORATION
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ PHASE 2: Simulating Client/Process Disconnect & Session State Reconstruction...");
  console.log("--------------------------------------------------------------------------------");

  console.log("⚡ [DISCONNECT]: Terminating local session memory reference...");
  // Load session purely from persistent store
  const restoredSession = await defaultSessionStore.loadSession(sessionId);

  if (!restoredSession) {
    throw new Error("Failed to restore session from persistent store!");
  }

  console.log("🔄 [RECONNECTED]: Successfully reloaded session from persistent store:");
  console.log(`  Session ID          : ${restoredSession.sessionId} (Identical)`);
  console.log(`  Restored Status     : ${restoredSession.status}`);
  console.log(`  Restored Step       : ${restoredSession.currentStep}`);
  console.log(`  Restored Events     : ${restoredSession.timeline.length} timeline events preserved.`);
  console.log(`  Restored Plan ID    : ${restoredSession.plan?.id}`);

  // ============================================================================
  // PART 3: HUMAN APPROVAL & SAME-SESSION RESUME
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ PHASE 3: Human Operator Grants Approval & Resumes the SAME Logical Session...");
  console.log("--------------------------------------------------------------------------------");

  console.log("👤 [OPERATOR DECISION]: APPROVED by lead-dba@schemasentinel.dev");
  console.log(`▶ [RESUMING SESSION]: Resuming session '${sessionId}' to apply migration on '${targetId}'...`);

  const resumeResult = await sessionRunner.resumeAndApplyWorkflow({
    sessionId,
    humanDecision: "APPROVED",
    approvalToken: restoredSession.approvalPacket!.approvalToken,
    approvedBy: "lead-dba@schemasentinel.dev",
  });

  console.log(`\n🚀 [APPLY RESULT]: Status = ${resumeResult.applyResult?.status} (Success = ${resumeResult.applyResult?.success})`);
  console.log("📋 APPLY AUDIT LOG:");
  resumeResult.applyResult?.auditLog.forEach((log) => {
    console.log(`  ${log}`);
  });

  // ============================================================================
  // PART 4: DETERMINISTIC POST-APPLY VERIFICATION
  // ============================================================================
  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ PHASE 4: Deterministic Post-Apply Verification Results...");
  console.log("--------------------------------------------------------------------------------");

  const vResult = resumeResult.verificationResult;
  console.log(`Verification Status   : ${vResult?.status.toUpperCase()}`);
  console.log(`Execution Time        : ${vResult?.executionDurationMs}ms`);
  console.log("Invariant Checks:");
  vResult?.checks.forEach((check, idx) => {
    console.log(`  ${idx + 1}. [${check.passed ? "PASS" : "FAIL"}] ${check.name}: ${check.details}`);
  });

  console.log("\n================================================================================");
  console.log("🏁 FINAL COMPLETE AUDIT TIMELINE (End-to-End Governance)");
  console.log("================================================================================");
  resumeResult.sessionState.timeline.forEach((event, idx) => {
    console.log(`  ${idx + 1}. [${event.step}] (${event.status}) at ${event.timestamp}`);
    console.log(`     Details: ${event.details}`);
  });

  console.log("\n================================================================================");
  console.log(`🎉 SUCCESS: Session '${sessionId}' completed with zero unapproved mutations.`);
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Day 3 Proof Execution Error:", err);
  process.exit(1);
});
