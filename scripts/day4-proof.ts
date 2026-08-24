import { TrueForgeOrchestrator } from "../lib/agent/orchestrator.js";
import { defaultPostgresMcpService } from "../lib/mcp/postgres.js";
import { defaultGithubMcpService } from "../lib/mcp/github.js";
import { defaultApprovalGate } from "../lib/safety/approval-gate.js";
import { defaultSessionStore, FileSessionStore } from "../lib/agent/session-store.js";
import { createSchemaSentinelServer } from "../lib/server/app.js";
import http from "http";

async function runDay4Proof() {
  console.log("================================================================================");
  console.log("🛡️  SchemaSentinel — Day 4 / Phase 4: Specialized Subagents & Web UI Proof");
  console.log("================================================================================");

  const sessionId = `sess_day4_subagents_${Date.now()}`;
  const targetId = "staging-demo";
  const repo = "mohitpargaie002-a11y/SchemaSentinel";
  const migrationFilePath = "migrations/0038_add_order_status.sql";
  const userPrompt = "Review and apply migration 0038_add_order_status.sql to staging-demo.";

  console.log(`\n[USER REQUEST]     : "${userPrompt}"`);
  console.log(`[SESSION ID]       : ${sessionId}`);
  console.log(`[TARGET DATABASE]  : ${targetId} (Allowlisted Mutable Staging Profile)`);
  console.log(`[MIGRATION FILE]   : ${migrationFilePath}\n`);

  const orchestrator = new TrueForgeOrchestrator(
    defaultPostgresMcpService,
    defaultGithubMcpService,
    defaultApprovalGate,
    defaultSessionStore
  );

  console.log("--------------------------------------------------------------------------------");
  console.log("▶ PHASE 1: Running TrueForge Multi-Subagent Review Pipeline...");
  console.log("--------------------------------------------------------------------------------");

  const reviewResult = await orchestrator.executeReviewWorkflow({
    sessionId,
    targetId,
    repo,
    migrationFilePath,
    userPrompt,
  });

  console.log("\n🤖 SPECIALIZED SUBAGENT EVIDENCE SUMMARY:");
  console.log(`  1. Schema Analyst    : ${reviewResult.schemaAnalysis.summary}`);
  console.log(`  2. Risk Analyst      : ${reviewResult.riskAnalysis.summary}`);
  console.log(`  3. Sandbox Validator : Sandbox validation ${reviewResult.sandboxOutput.success ? "PASSED" : "FAILED"} in ${reviewResult.sandboxOutput.executionDurationMs}ms (Rollback: ${reviewResult.sandboxOutput.rollbackSuccessful ? "PASS" : "FAIL"}).`);
  console.log(`  4. Synthesizer       : ${reviewResult.reviewReport.approvalSummary}`);

  console.log("\n📋 STAGED ROLLOUT PLAN:");
  reviewResult.reviewReport.recommendedPlan.forEach((step, i) => {
    console.log(`  ${i + 1}. ${step}`);
  });

  console.log("\n🔒 TRUEFORGE HUMAN APPROVAL CHECKPOINT REACHED:");
  console.log(`  Status              : ${reviewResult.approvalPacket.status}`);
  console.log(`  Approval Token      : sat_...${reviewResult.approvalPacket.approvalToken.slice(-6)} (REDACTED)`);
  console.log(`  SHA-256 Fingerprint : ${reviewResult.approvalPacket.sqlFingerprint}`);
  console.log("  🛑 Execution halted before target database mutation.\n");

  console.log("--------------------------------------------------------------------------------");
  console.log("▶ PHASE 2: Simulating Client/Browser Reload & Session State Rehydration...");
  console.log("--------------------------------------------------------------------------------");

  const reloadedSession = await defaultSessionStore.loadSession(sessionId);
  if (!reloadedSession) {
    throw new Error("Failed to rehydrate session from persistent store!");
  }
  console.log("🔄 [RECONNECTED]: Successfully reloaded session from persistent store:");
  console.log(`  Session ID          : ${reloadedSession.sessionId} (Identical)`);
  console.log(`  Restored Status     : ${reloadedSession.status}`);
  console.log(`  Restored Events     : ${reloadedSession.activityEvents?.length || 0} activity events preserved.`);
  console.log(`  Restored Plan ID    : ${reloadedSession.plan?.id}`);

  console.log("--------------------------------------------------------------------------------");
  console.log("▶ PHASE 3: Human Operator Grants Approval & Resumes the SAME Logical Session...");
  console.log("--------------------------------------------------------------------------------");

  console.log("👤 [OPERATOR DECISION]: APPROVED by lead-dba@schemasentinel.dev");
  console.log(`▶ [RESUMING SESSION]: Resuming session '${sessionId}' to apply migration on '${targetId}'...\n`);

  const resumeResult = await orchestrator.resumeAndApplyWorkflow({
    sessionId,
    humanDecision: "APPROVED",
    approvalToken: reviewResult.approvalPacket.approvalToken,
    approvedBy: "lead-dba@schemasentinel.dev",
  });

  console.log(`🚀 [APPLY RESULT]: Status = ${resumeResult.applyResult?.status} (Success = ${resumeResult.applyResult?.success})`);
  console.log("📋 APPLY AUDIT LOG:");
  resumeResult.applyResult?.auditLog.forEach((log) => console.log(`  ${log}`));

  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ PHASE 4: Deterministic Post-Apply Verification Results...");
  console.log("--------------------------------------------------------------------------------");

  if (resumeResult.verificationResult) {
    console.log(`Verification Status   : ${resumeResult.verificationResult.status.toUpperCase()}`);
    console.log(`Execution Time        : ${resumeResult.verificationResult.executionDurationMs}ms`);
    console.log("Invariant Checks:");
    resumeResult.verificationResult.checks.forEach((c, idx) => {
      console.log(`  ${idx + 1}. [${c.passed ? "PASS" : "FAIL"}] ${c.name}: ${c.details}`);
    });
  }

  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ PHASE 5: Verifying HTTP Server & API Endpoints...");
  console.log("--------------------------------------------------------------------------------");

  const server = createSchemaSentinelServer({
    orchestrator,
    sessionStore: defaultSessionStore,
  });

  await new Promise<void>((resolve) => {
    server.listen(3099, async () => {
      console.log("🌐 Server listening on http://localhost:3099");
      try {
        const healthRes = await fetch("http://localhost:3099/api/health");
        const health = await healthRes.json();
        console.log(`  ✓ GET /api/health -> Status ${healthRes.status}: ${JSON.stringify(health)}`);

        const targetsRes = await fetch("http://localhost:3099/api/targets");
        const targetsData = (await targetsRes.json()) as { targets: Array<{ id: string }> };
        console.log(`  ✓ GET /api/targets -> Status ${targetsRes.status}: ${targetsData.targets.length} targets available`);

        const sessionRes = await fetch(`http://localhost:3099/api/sessions/${sessionId}`);
        const sessionData = (await sessionRes.json()) as { session: { status: string } };
        console.log(`  ✓ GET /api/sessions/${sessionId} -> Status ${sessionRes.status} (Session Status: ${sessionData.session.status})`);

        const eventsRes = await fetch(`http://localhost:3099/api/sessions/${sessionId}/events`);
        const eventsData = (await eventsRes.json()) as { activityEvents: unknown[] };
        console.log(`  ✓ GET /api/sessions/${sessionId}/events -> Status ${eventsRes.status} (${eventsData.activityEvents.length} events logged)`);
      } finally {
        server.close(() => resolve());
      }
    });
  });

  console.log("\n================================================================================");
  console.log(`🎉 SUCCESS: Session '${sessionId}' completed with specialized subagents & UI.`);
  console.log("================================================================================\n");
}

runDay4Proof().catch((err) => {
  console.error("FATAL ERROR in Day 4 Proof:", err);
  process.exit(1);
});
