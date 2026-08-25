import { TrueForgeOrchestrator } from "../lib/agent/orchestrator.js";
import { FileSessionStore } from "../lib/agent/session-store.js";
import { SessionEventBroadcaster } from "../lib/agent/event-stream.js";
import { GithubMcpService } from "../lib/mcp/github.js";
import { ApprovalGate } from "../lib/safety/approval-gate.js";
import { defaultPostgresMcpService } from "../lib/mcp/postgres.js";

async function runDay6Proof() {
  console.log("================================================================================");
  console.log("🛡️  SchemaSentinel — Day 6 / Phase 6: Safe Migration Generation + GitHub PR Proof");
  console.log("================================================================================\n");

  const sessionId = `sess_day6_safe_${Date.now()}`;
  const targetId = "staging-demo";
  const migrationFilePath = "migrations/0038_add_order_status.sql";
  const repo = "mohitpargaie002-a11y/SchemaSentinel";

  console.log(`[USER REQUEST]     : "Review risky migration ${migrationFilePath}, generate a zero-lock safe staged remediation, and open a GitHub PR."`);
  console.log(`[SESSION ID]       : ${sessionId}`);
  console.log(`[TARGET DATABASE]  : ${targetId} (Allowlisted Staging Profile)`);
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
    userPrompt: "Review migration 0038_add_order_status.sql",
  });

  console.log(`\n  ✅ Review Complete. Risk Assessment: [${reviewResult.riskAnalysis.overallRisk}]`);
  console.log(`  🔍 Key Risk Factors: ${reviewResult.riskAnalysis.findings.map((f) => f.category).join(", ")}`);
  console.log(`  🛑 State Halted at: '${reviewResult.context.status}' (Mutation Blocked)\n`);

  // Step 2: Generate Safe Remediation & Dry-run in Sandbox
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ STEP 2: Autonomous Safe Remediation Generation & Sandbox Validation...");
  console.log("--------------------------------------------------------------------------------\n");

  const safeResult = await orchestrator.generateSafeMigrationWorkflow(sessionId);
  const proposal = safeResult.proposal;

  console.log(`\n  ✅ Safe Remediation Proposal Generated: [${proposal.proposalId}]`);
  console.log(`  📉 Risk Reduction: ${proposal.riskReductionSummary.beforeRisk} ➔ ${proposal.riskReductionSummary.afterRisk}`);
  console.log(`  🛡️ Eliminated Factors: ${proposal.riskReductionSummary.eliminatedFactors.join("; ")}`);
  console.log(`\n  📜 Structured SQL Diff Summary: ${proposal.diff.summary}`);
  console.log(`  🧪 Sandbox Dry-Run: ${proposal.sandboxValidation?.success ? "PASS" : "FAIL"} (${proposal.sandboxValidation?.assertionsPassed.length || 0} assertions passed)`);
  console.log(`  🔑 Approval Checkpoint Token: sat_safe_... (Redacted)\n`);

  console.log("Proposed Staged DDL:");
  console.log("----------------------------------------");
  console.log(proposal.proposedSql);
  console.log("----------------------------------------\n");

  // Step 3: Human Operator Approves Safe Migration & Creates GitHub PR
  console.log("--------------------------------------------------------------------------------");
  console.log("▶ STEP 3: Operator Approval Granted ➔ Opening GitHub Pull Request...");
  console.log("--------------------------------------------------------------------------------\n");

  const prResult = await orchestrator.approveAndCreatePrWorkflow({
    sessionId,
    approvedBy: "operator@schemasentinel.dev",
    approvalToken: proposal.approvalToken,
    baseBranch: "master",
  });

  const pr = prResult.githubPr;
  console.log(`\n  🎉 Pull Request Successfully Opened!`);
  console.log(`  📌 PR Number : #${pr.prNumber}`);
  console.log(`  🌐 PR URL    : ${pr.htmlUrl}`);
  console.log(`  🌿 Git Branch: ${pr.branch}`);
  console.log(`  🔏 Commit SHA: ${pr.commitSha.substring(0, 10)}`);
  console.log(`  🤖 Qodo Gate : ${pr.qodoStatus}`);
  console.log(`  🔒 Session Final State: '${prResult.sessionState.status}' (isReadOnly: ${prResult.sessionState.isReadOnly})\n`);

  console.log("================================================================================");
  console.log("✨ Day 6 / Phase 6 Safe Migration & GitHub PR Workflow Validated Successfully!");
  console.log("================================================================================\n");
}

runDay6Proof().catch((err) => {
  console.error("❌ Day 6 Proof Failed:", err);
  process.exit(1);
});
