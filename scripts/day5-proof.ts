import { createSchemaSentinelServer } from "../lib/server/app.js";
import { TrueForgeOrchestrator } from "../lib/agent/orchestrator.js";
import { FileSessionStore } from "../lib/agent/session-store.js";
import { SessionEventBroadcaster } from "../lib/agent/event-stream.js";
import http from "http";

async function runDay5Proof() {
  console.log("================================================================================");
  console.log("🛡️  SchemaSentinel — Day 5 / Phase 5: Live Agent Orchestration & Provenance Proof");
  console.log("================================================================================\n");

  const sessionId = `sess_day5_live_${Date.now()}`;
  const targetId = "staging-demo";
  const migrationFilePath = "migrations/0038_add_order_status.sql";
  const repo = "mohitpargaie002-a11y/SchemaSentinel";

  console.log(`[USER REQUEST]     : "Review and apply migration ${migrationFilePath} to ${targetId} with live telemetry."`);
  console.log(`[SESSION ID]       : ${sessionId}`);
  console.log(`[TARGET DATABASE]  : ${targetId} (Allowlisted Mutable Staging Profile)`);
  console.log(`[MIGRATION FILE]   : ${migrationFilePath}\n`);

  const sessionStore = new FileSessionStore();
  const broadcaster = SessionEventBroadcaster.getInstance();
  const orchestrator = new TrueForgeOrchestrator(
    undefined,
    undefined,
    undefined,
    sessionStore,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    broadcaster
  );

  // 1. Setup Live SSE Telemetry Listener
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ PHASE 1: Subscribing Live SSE Stream Listener & Orchestrating Subagents...");
  console.log("--------------------------------------------------------------------------------\n");

  const liveEventsReceived: string[] = [];
  const liveEvidenceReceived: string[] = [];

  const unsubscribe = broadcaster.subscribe(sessionId, {
    onActivityEvent: (evt) => {
      liveEventsReceived.push(evt.id);
      console.log(`  ⚡ [SSE ACTIVITY] [${evt.actor}] [${evt.phase}]: ${evt.message}`);
    },
    onEvidenceItem: (evi) => {
      liveEvidenceReceived.push(evi.evidenceId);
      console.log(`  📦 [SSE EVIDENCE] [${evi.sourceType}] ${evi.source} -> Hash: ${evi.contentHash.substring(0, 16)}...`);
    },
    onStateChange: (status) => {
      console.log(`  🔄 [SSE STATE] Transitioned to '${status}'`);
    },
  });

  // 2. Run Review Workflow with Controlled Parallelism
  const reviewResult = await orchestrator.executeReviewWorkflow({
    sessionId,
    targetId,
    repo,
    migrationFilePath,
    userPrompt: `Review and analyze migration ${migrationFilePath}`,
  });

  console.log(`\n📋 EVIDENCE PROVENANCE LEDGER (${reviewResult.evidenceItems.length} immutable items):`);
  reviewResult.evidenceItems.forEach((evi, idx) => {
    console.log(`  ${idx + 1}. [${evi.sourceType}] ${evi.source} (${evi.actor})`);
    console.log(`     SHA-256: ${evi.contentHash}`);
    console.log(`     Summary: ${evi.summary}`);
  });

  console.log(`\n🔒 TRUEFORGE HUMAN APPROVAL CHECKPOINT REACHED:`);
  console.log(`  Status              : ${reviewResult.context.status}`);
  console.log(`  Approval Token      : sat_...${reviewResult.approvalPacket.approvalToken.slice(-6)} (REDACTED)`);
  console.log(`  SHA-256 Fingerprint : ${reviewResult.approvalPacket.sqlFingerprint}`);
  console.log(`  🛑 Execution safely halted before target database mutation.\n`);

  // 3. Reconnect / Rehydrate Session
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ PHASE 2: Testing Session History & Historical State Rehydration...");
  console.log("--------------------------------------------------------------------------------\n");

  const historyList = await sessionStore.listSessions();
  console.log(`📂 Persisted Session History Count: ${historyList.length} session(s) in catalog.`);
  const reloaded = await sessionStore.loadSession(sessionId);
  console.log(`🔄 Rehydrated Session '${sessionId}': Status = ${reloaded?.status}, Evidence Count = ${reloaded?.evidenceItems?.length}`);

  // 4. Operator Grants Approval & Resumes Same Session
  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ PHASE 3: Human Operator Grants Approval & Resumes Logical Session...");
  console.log("--------------------------------------------------------------------------------\n");

  console.log(`👤 [OPERATOR DECISION]: APPROVED by lead-dba@schemasentinel.dev`);
  const resumeResult = await orchestrator.resumeAndApplyWorkflow({
    sessionId,
    humanDecision: "APPROVED",
    approvalToken: reviewResult.approvalPacket.approvalToken,
    approvedBy: "lead-dba@schemasentinel.dev",
  });

  console.log(`\n🚀 [APPLY RESULT]: Status = ${resumeResult.sessionState.status} (Success = ${resumeResult.applyResult?.success})`);
  console.log(`📋 APPLY AUDIT LOG:`);
  resumeResult.applyResult?.auditLog.forEach((log) => console.log(`  ${log}`));

  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ PHASE 4: Post-Apply Verification Invariant Results...");
  console.log("--------------------------------------------------------------------------------\n");

  const vResult = resumeResult.verificationResult;
  console.log(`Verification Status   : ${vResult?.status.toUpperCase()}`);
  console.log(`Execution Time        : ${vResult?.executionDurationMs}ms`);
  console.log(`Evidence Fingerprint  : ${vResult?.contentHash?.substring(0, 16)}...`);
  console.log(`Invariant Checks:`);
  vResult?.checks.forEach((chk, i) => {
    console.log(`  ${i + 1}. [${chk.passed ? "PASS" : "FAIL"}] ${chk.name}: ${chk.details}`);
  });

  unsubscribe();

  // 5. Verify HTTP Server API Endpoints
  console.log("\n--------------------------------------------------------------------------------");
  console.log("▶ PHASE 5: Verifying Server-Sent Events (SSE) & Session History Endpoints...");
  console.log("--------------------------------------------------------------------------------\n");

  const server = createSchemaSentinelServer({
    sessionStore,
    orchestrator,
    broadcaster,
  });

  const testPort = 3098;
  await new Promise<void>((resolve) => server.listen(testPort, resolve));
  console.log(`🌐 Server listening on http://localhost:${testPort}`);

  const healthRes = await fetch(`http://localhost:${testPort}/api/health`);
  console.log(`  ✓ GET /api/health -> Status ${healthRes.status}: ${await healthRes.text()}`);

  const sessionsRes = await fetch(`http://localhost:${testPort}/api/sessions`);
  const sessionsData = (await sessionsRes.json()) as { sessions: unknown[] };
  console.log(`  ✓ GET /api/sessions -> Status ${sessionsRes.status}: ${sessionsData.sessions.length} session summaries returned`);

  const singleSessionRes = await fetch(`http://localhost:${testPort}/api/sessions/${sessionId}`);
  const singleData = (await singleSessionRes.json()) as { session: { isReadOnly: boolean } };
  console.log(`  ✓ GET /api/sessions/${sessionId} -> Status ${singleSessionRes.status} (Read-Only: ${singleData.session.isReadOnly})`);

  // Test SSE Stream Handshake
  await new Promise<void>((resolve) => {
    const sseReq = http.request(
      `http://localhost:${testPort}/api/sessions/${sessionId}/events/stream`,
      { headers: { Accept: "text/event-stream" } },
      (res) => {
        console.log(`  ✓ GET /api/sessions/${sessionId}/events/stream -> Status ${res.statusCode} (Content-Type: ${res.headers["content-type"]})`);
        res.on("data", (chunk) => {
          if (chunk.toString().includes("event: open")) {
            console.log(`  ✓ SSE Handshake verified: Received initial 'event: open' connection frame.`);
            sseReq.destroy();
            resolve();
          }
        });
      }
    );
    sseReq.end();
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));

  console.log("\n================================================================================");
  console.log(`🎉 SUCCESS: Session '${sessionId}' completed with live SSE streaming & provenance.`);
  console.log("================================================================================\n");
}

runDay5Proof().catch((err) => {
  console.error("Day 5 Proof Failed:", err);
  process.exit(1);
});
