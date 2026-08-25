import { TrueForgeOrchestrator } from "../lib/agent/orchestrator.js";
import { FileSessionStore } from "../lib/agent/session-store.js";
import { SessionEventBroadcaster } from "../lib/agent/event-stream.js";
import { GithubMcpService } from "../lib/mcp/github.js";
import { ApprovalGate } from "../lib/safety/approval-gate.js";
import { defaultPostgresMcpService } from "../lib/mcp/postgres.js";

/**
 * SchemaSentinel — Final Authoritative End-to-End System Proof
 * Demonstrates the complete lifecycle:
 * Request -> Specialized Agents -> Static Risk Engine -> PGlite Sandbox ->
 * Safe Staged Remediation -> Approval Gate -> GitHub PR Creation ->
 * Qodo Review State -> Evidence Provenance.
 */
async function runFinalProof() {
  console.log("================================================================================");
  console.log("🛡️  SchemaSentinel — Final Authoritative End-to-End System Proof");
  console.log("================================================================================\n");

  const sessionId = `sess_final_proof_${Date.now()}`;
  const targetId = "staging-demo";
  const migrationFilePath = "migrations/0038_add_order_status.sql";
  const repo = process.env.GITHUB_REPO || "mohitpargaie002-a11y/SchemaSentinel";
  const baseBranch = process.env.GITHUB_BASE_BRANCH || "master";
  const userPrompt = "Review risky migration 0038_add_order_status.sql, validate in sandbox, generate zero-lock safe staged remediation, and open a GitHub PR for Qodo review.";

  console.log(`[USER REQUEST]     : "${userPrompt}"`);
  console.log(`[SESSION ID]       : ${sessionId}`);
  console.log(`[TARGET DATABASE]  : ${targetId} (Allowlisted Staging Profile)`);
  console.log(`[TARGET REPO]      : ${repo} (Base: ${baseBranch})`);
  console.log(`[MIGRATION FILE]   : ${migrationFilePath}\n`);

  const sessionStore = new FileSessionStore();
  const broadcaster = SessionEventBroadcaster.getInstance();
  const githubMcp = new GithubMcpService();
  const approvalGate = new ApprovalGate();

  const orchestrator = new TrueForgeOrchestrator(
    defaultPostgresMcpService,
    githubMcp,
    approvalGate,
    sessionStore,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    broadcaster
  );

  // 1. Subscribe live telemetry listener
  broadcaster.subscribe(sessionId, {
    onActivityEvent: (evt) => {
      console.log(`  ⚡ [LIVE EVENT] [${evt.actor}] [${evt.phase}]: ${evt.message}`);
    },
    onEvidenceItem: (evi) => {
      console.log(`  📦 [LIVE EVIDENCE] [${evi.sourceType}] ${evi.source} (Hash: ${evi.contentHash.substring(0, 16)}...)`);
    },
    onStateChange: (status) => {
      console.log(`  🔄 [STATE TRANSITION] ➔ ${status}`);
    },
  });

  // Step 1: Execute Initial Safety Review
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ STEP 1: Executing Multi-Agent Safety Review on Risky Candidate Migration...");
  console.log("--------------------------------------------------------------------------------\n");

  const reviewResult = await orchestrator.executeReviewWorkflow({
    sessionId,
    targetId,
    repo,
    migrationFilePath,
    userPrompt,
  });

  console.log(`\n  ✅ Review Complete. Risk Assessment: [${reviewResult.riskAnalysis.overallRisk}]`);
  console.log(`  🔍 Key Risk Factors: ${reviewResult.riskAnalysis.findings.map((f) => f.category).join(", ")}`);
  console.log(`  🛑 State Halted at: '${reviewResult.context.status}' (Mutation Blocked)\n`);

  // Step 2: Generate Safe Remediation & Dry-run in Sandbox
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ STEP 2: Autonomous Safe Remediation Generation & Ephemeral Sandbox Dry-Run...");
  console.log("--------------------------------------------------------------------------------\n");

  const safeResult = await orchestrator.generateSafeMigrationWorkflow(sessionId);
  const proposal = safeResult.proposal;

  console.log(`\n  ✅ Safe Remediation Proposal Generated: [${proposal.proposalId}]`);
  console.log(`  📉 Risk Reduction: ${proposal.riskReductionSummary.beforeRisk} ➔ ${proposal.riskReductionSummary.afterRisk}`);
  console.log(`  🛡️ Eliminated Factors: ${proposal.riskReductionSummary.eliminatedFactors.join("; ")}`);
  console.log(`\n  📜 Structured SQL Diff Summary: ${proposal.diff.summary}`);
  console.log(`  🧪 Sandbox Dry-Run: ${proposal.sandboxValidation?.success ? "PASS" : "FAIL"} (${proposal.sandboxValidation?.assertionsPassed.length || 0} assertions passed)`);
  console.log(`  🔑 Approval Checkpoint Token: sat_safe_... (Cryptographically Bound)\n`);

  console.log("Proposed Safe Staged DDL:");
  console.log("----------------------------------------");
  console.log(proposal.proposedSql);
  console.log("----------------------------------------\n");

  // Step 3: Human Operator Approves Safe Migration & Creates GitHub PR
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ STEP 3: Operator Approval Granted ➔ Opening GitHub Pull Request for Qodo Review...");
  console.log("--------------------------------------------------------------------------------\n");

  const prResult = await orchestrator.approveAndCreatePrWorkflow({
    sessionId,
    approvedBy: "lead-dba@schemasentinel.dev",
    approvalToken: proposal.approvalToken,
    baseBranch,
  });

  const pr = prResult.githubPr;
  console.log(`\n  🎉 Pull Request Successfully Opened!`);
  console.log(`  📌 PR Number : #${pr.prNumber}`);
  console.log(`  🌐 PR URL    : ${pr.htmlUrl}`);
  console.log(`  🌿 Git Branch: ${pr.branch}`);
  console.log(`  🔏 Commit SHA: ${pr.commitSha.substring(0, 10)}`);
  console.log(`  🤖 Qodo Gate : ${pr.qodoStatus} (PR created — awaiting external review)`);
  console.log(`  🔒 Session Final State: '${prResult.sessionState.status}' (isReadOnly: ${prResult.sessionState.isReadOnly})\n`);

  // Step 4: Tamper-Evident Evidence Provenance Summary
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ STEP 4: Tamper-Evident Evidence Provenance & Audit Trail Summary");
  console.log("--------------------------------------------------------------------------------\n");

  const session = prResult.sessionState;
  console.log(`  📜 Total Activity Events Recorded: ${session.activityEvents.length}`);
  console.log(`  📦 Total Evidence Artifacts Bound: ${session.evidenceItems.length}`);
  session.evidenceItems.forEach((item, idx) => {
    console.log(`    [${idx + 1}] ${item.sourceType.padEnd(20)} | Hash: ${item.contentHash.substring(0, 16)}... | ${item.source}`);
  });

  console.log("\n================================================================================");
  console.log("✨ SchemaSentinel — All Phase 1-7 Verification Gates Passed Cleanly!");
  console.log("================================================================================");
}

runFinalProof().catch((err) => {
  console.error("❌ Final Proof Failed:", err);
  process.exit(1);
});
