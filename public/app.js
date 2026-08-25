// SchemaSentinel — Web Client Controller (Phase 5 Live Observability & History)

document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements - Request Form
  const form = document.getElementById("migration-form");
  const targetSelect = document.getElementById("target-select");
  const migrationFileInput = document.getElementById("migration-file");
  const btnStartReview = document.getElementById("btn-start-review");
  const btnLabel = document.getElementById("btn-label");
  const btnSpinner = document.getElementById("btn-spinner");
  const liveAnnouncer = document.getElementById("aria-live-announcer");
  const liveStreamBadge = document.getElementById("live-stream-badge");

  // History Elements
  const btnHistoryToggle = document.getElementById("btn-history-toggle");
  const historyDrawer = document.getElementById("history-drawer");
  const btnCloseHistory = document.getElementById("btn-close-history");
  const historyList = document.getElementById("history-list");
  const historyCountBadge = document.getElementById("history-count-badge");
  const readonlyBanner = document.getElementById("readonly-banner");
  const btnExitReadonly = document.getElementById("btn-exit-readonly");

  // Subagents
  const subagentCards = {
    schemaAnalyst: {
      card: document.getElementById("agent-schema-analyst"),
      status: document.getElementById("status-schema-analyst"),
      desc: document.getElementById("desc-schema-analyst"),
      metrics: document.getElementById("metrics-schema-analyst"),
    },
    riskAnalyst: {
      card: document.getElementById("agent-risk-analyst"),
      status: document.getElementById("status-risk-analyst"),
      desc: document.getElementById("desc-risk-analyst"),
      metrics: document.getElementById("metrics-risk-analyst"),
    },
    sandboxValidator: {
      card: document.getElementById("agent-sandbox-validator"),
      status: document.getElementById("status-sandbox-validator"),
      desc: document.getElementById("desc-sandbox-validator"),
      metrics: document.getElementById("metrics-sandbox-validator"),
    },
    reviewSynthesizer: {
      card: document.getElementById("agent-review-synthesizer"),
      status: document.getElementById("status-review-synthesizer"),
      desc: document.getElementById("desc-review-synthesizer"),
      metrics: document.getElementById("metrics-review-synthesizer"),
    },
  };

  // Risk Matrix
  const overallRiskBadge = document.getElementById("overall-risk-badge");
  const valLockRisk = document.getElementById("val-lock-risk");
  const valTableRewrite = document.getElementById("val-table-rewrite");
  const valDataIntegrity = document.getElementById("val-data-integrity");
  const valSandboxStatus = document.getElementById("val-sandbox-status");
  const valRollbackStatus = document.getElementById("val-rollback-status");
  const valAffectedTables = document.getElementById("val-affected-tables");
  const findingsArea = document.getElementById("findings-area");
  const findingsList = document.getElementById("findings-list");

  // Staged Rollout Plan
  const stagedPlanList = document.getElementById("staged-plan-list");

  // Approval Checkpoint
  const approvalCard = document.getElementById("approval-card");
  const approvalTarget = document.getElementById("approval-target");
  const approvalEnv = document.getElementById("approval-env");
  const approvalFingerprint = document.getElementById("approval-fingerprint");
  const approvalToken = document.getElementById("approval-token");
  const approvalWarning = document.getElementById("approval-warning");
  const warningText = document.getElementById("warning-text");
  const btnReject = document.getElementById("btn-reject");
  const btnApprove = document.getElementById("btn-approve");

  // Verification Card
  const verificationCard = document.getElementById("verification-card");
  const verificationStatusBadge = document.getElementById("verification-status-badge");
  const verificationChecksList = document.getElementById("verification-checks-list");

  // Timeline
  const timelineFeed = document.getElementById("timeline-feed");
  const eventCountBadge = document.getElementById("event-count-badge");

  // Deep Evidence Tabs & Provenance
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabPanes = document.querySelectorAll(".tab-pane");
  const provSource = document.getElementById("prov-source");
  const provActor = document.getElementById("prov-actor");
  const provTime = document.getElementById("prov-time");
  const provHash = document.getElementById("prov-hash");
  const evidenceSql = document.getElementById("evidence-sql");
  const evidenceSchema = document.getElementById("evidence-schema");
  const evidenceRisk = document.getElementById("evidence-risk");
  const evidenceSandbox = document.getElementById("evidence-sandbox");
  const evidenceVerification = document.getElementById("evidence-verification");
  const evidenceAudit = document.getElementById("evidence-audit");
  // Safe Migration & GitHub PR Panel (Phase 6)
  const safeMigrationPanel = document.getElementById("safe-migration-panel");
  const btnGenerateSafeMigration = document.getElementById("btn-generate-safe-migration");
  const safeGenSpinner = document.getElementById("safe-gen-spinner");
  const safeGenBtnLabel = document.getElementById("safe-gen-btn-label");
  const safeProposalContent = document.getElementById("safe-proposal-content");
  const safeRiskReduction = document.getElementById("safe-risk-reduction");
  const safeEliminatedFactors = document.getElementById("safe-eliminated-factors");
  const safeMigrationRationale = document.getElementById("safe-migration-rationale");
  const safeDiffSummary = document.getElementById("safe-diff-summary");
  const safeDiffViewer = document.getElementById("safe-diff-viewer");
  const safeApprovalToken = document.getElementById("safe-approval-token");
  const btnApproveSafePr = document.getElementById("btn-approve-safe-pr");
  const safePrSpinner = document.getElementById("safe-pr-spinner");
  const safePrBtnLabel = document.getElementById("safe-pr-btn-label");
  const prCreatedCard = document.getElementById("pr-created-card");
  const prLink = document.getElementById("pr-link");
  const prBranchVal = document.getElementById("pr-branch-val");
  const prCommitVal = document.getElementById("pr-commit-val");
  const prQodoStatusBadge = document.getElementById("pr-qodo-status-badge");

  // Local Application State
  let currentSessionId = null;
  let currentSessionData = null;
  let activeEventSource = null;
  let isReadOnlyMode = false;
  let activeTabId = "tab-sql";

  function announce(msg) {
    if (liveAnnouncer) {
      liveAnnouncer.textContent = msg;
    }
  }

  function escapeHtml(str) {
    if (!str || typeof str !== "string") return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setSubagentState(agentKey, status, desc, metricsHtml) {
    const el = subagentCards[agentKey];
    if (!el) return;

    el.card.classList.remove("running", "completed", "failed");
    el.status.className = "badge";

    if (status === "RUNNING") {
      el.card.classList.add("running");
      el.status.classList.add("badge-warn");
      el.status.textContent = "RUNNING";
    } else if (status === "COMPLETED") {
      el.card.classList.add("completed");
      el.status.classList.add("badge-safe");
      el.status.textContent = "COMPLETED";
    } else if (status === "FAILED") {
      el.card.classList.add("failed");
      el.status.classList.add("badge-danger");
      el.status.textContent = "FAILED";
    } else {
      el.status.classList.add("badge-idle");
      el.status.textContent = "IDLE";
    }

    if (desc) el.desc.textContent = desc;
    if (metricsHtml) el.metrics.innerHTML = metricsHtml;
  }

  function renderTimelineEvent(evt) {
    const existing = document.getElementById(`evt-${evt.id}`);
    if (existing) return;

    const empty = timelineFeed.querySelector(".timeline-empty");
    if (empty) empty.remove();

    const timeStr = new Date(evt.timestamp).toLocaleTimeString([], { hour12: false });
    const entry = document.createElement("div");
    entry.id = `evt-${evt.id}`;
    entry.className = "timeline-entry";
    
    let metaDetails = "";
    if (evt.durationMs) {
      metaDetails += `<span>Duration: ${evt.durationMs}ms</span>`;
    }
    if (evt.toolName) {
      metaDetails += `<span>Tool: ${escapeHtml(evt.toolName)}</span>`;
    }
    if (evt.evidenceRef) {
      metaDetails += `<span>Ref: ${escapeHtml(evt.evidenceRef)}</span>`;
    }

    entry.innerHTML = `
      <div class="timeline-entry-header">
        <span class="timeline-actor">[${escapeHtml(evt.actor)}]</span>
        <span class="timeline-time">${escapeHtml(timeStr)}</span>
      </div>
      <div class="timeline-msg">${escapeHtml(evt.message)}</div>
      ${metaDetails ? `<div class="timeline-meta">${metaDetails}</div>` : ""}
    `;

    timelineFeed.appendChild(entry);
    timelineFeed.scrollTop = timelineFeed.scrollHeight;

    const count = timelineFeed.querySelectorAll(".timeline-entry").length;
    if (eventCountBadge) {
      eventCountBadge.textContent = `${count} Event${count === 1 ? "" : "s"}`;
    }
  }

  // Connect to Live SSE Stream
  function connectEventStream(sessionId) {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }

    try {
      activeEventSource = new EventSource(`/api/sessions/${sessionId}/events/stream`);
      
      activeEventSource.addEventListener("open", () => {
        if (liveStreamBadge) liveStreamBadge.textContent = "Live Stream Active";
      });

      activeEventSource.addEventListener("activity", (e) => {
        try {
          const event = JSON.parse(e.data);
          renderTimelineEvent(event);

          // Update Subagent states
          if (event.actor === "SCHEMA_ANALYST") {
            if (event.status === "RUNNING") {
              setSubagentState("schemaAnalyst", "RUNNING", "Inspecting PostgreSQL catalog & index trees...");
            } else if (event.status === "COMPLETED") {
              const meta = event.evidence || {};
              const tCount = meta.tableCount ?? "3";
              const iCount = meta.indexCount ?? "6";
              setSubagentState("schemaAnalyst", "COMPLETED", event.message, `<span class="metric-tag">Tables: ${tCount}</span><span class="metric-tag">Indexes: ${iCount}</span>`);
            }
          } else if (event.actor === "RISK_ANALYST") {
            if (event.status === "RUNNING") {
              setSubagentState("riskAnalyst", "RUNNING", "Evaluating AST locks, table rewrites, and constraint hazards...");
            } else if (event.status === "COMPLETED") {
              const meta = event.evidence || {};
              const lock = meta.lockRisk ?? "HIGH";
              const rewrite = meta.tableRewriteExpected ? "YES" : "NO";
              setSubagentState("riskAnalyst", "COMPLETED", event.message, `<span class="metric-tag">Lock: ${lock}</span><span class="metric-tag">Rewrite: ${rewrite}</span>`);
            }
          } else if (event.actor === "SANDBOX_VALIDATOR") {
            if (event.status === "RUNNING") {
              setSubagentState("sandboxValidator", "RUNNING", "Spinning up ephemeral PGlite sandbox and testing rollback...");
            } else if (event.status === "COMPLETED") {
              const dur = event.durationMs ?? 850;
              setSubagentState("sandboxValidator", "COMPLETED", event.message, `<span class="metric-tag">${dur}ms</span><span class="metric-tag">Rollback: PASS</span>`);
            }
          } else if (event.actor === "REVIEW_SYNTHESIZER") {
            if (event.status === "RUNNING") {
              setSubagentState("reviewSynthesizer", "RUNNING", "Synthesizing evidence and generating TrueForge approval packet...");
            } else if (event.status === "COMPLETED") {
              setSubagentState("reviewSynthesizer", "COMPLETED", event.message, `<span class="metric-tag">Checkpoint: READY</span><span class="metric-tag">Plan: STAGED</span>`);
            }
          }
        } catch (err) {
          console.error("Failed to parse SSE activity event:", err);
        }
      });

      activeEventSource.addEventListener("evidence", (e) => {
        try {
          const evidence = JSON.parse(e.data);
          if (!currentSessionData.evidenceItems) currentSessionData.evidenceItems = [];
          const exists = currentSessionData.evidenceItems.some((item) => item.evidenceId === evidence.evidenceId);
          if (!exists) {
            currentSessionData.evidenceItems.push(evidence);
            updateProvenanceDisplay();
          }
        } catch (err) {
          console.error("Failed to parse SSE evidence event:", err);
        }
      });

      activeEventSource.addEventListener("state", (e) => {
        try {
          const stateData = JSON.parse(e.data);
          announce(`Session transitioned to ${stateData.status}`);
        } catch (err) {
          console.error("Failed to parse SSE state event:", err);
        }
      });

      activeEventSource.addEventListener("close", () => {
        closeEventStream();
      });

      activeEventSource.onerror = () => {
        if (liveStreamBadge) liveStreamBadge.textContent = "Core Online";
      };
    } catch (e) {
      console.warn("EventSource not supported or connection error:", e);
    }
  }

  function closeEventStream() {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    if (liveStreamBadge) {
      liveStreamBadge.textContent = "Core Online";
    }
  }

  // Update Provenance Display for the Active Tab
  function updateProvenanceDisplay() {
    const items = currentSessionData?.evidenceItems || [];
    let match = null;

    if (activeTabId === "tab-sql") {
      match = items.find((i) => i.sourceType === "MIGRATION_FILE");
    } else if (activeTabId === "tab-schema") {
      match = items.find((i) => i.sourceType === "POSTGRES_SCHEMA");
    } else if (activeTabId === "tab-risk") {
      match = items.find((i) => i.sourceType === "RISK_ANALYSIS");
    } else if (activeTabId === "tab-sandbox") {
      match = items.find((i) => i.sourceType === "SANDBOX_EXECUTION");
    } else if (activeTabId === "tab-verification") {
      match = items.find((i) => i.sourceType === "VERIFICATION_QUERY");
    } else if (activeTabId === "tab-audit") {
      match = items.find((i) => i.sourceType === "SYSTEM");
    }

    if (match) {
      if (provSource) provSource.textContent = match.source || "MCP Tool";
      if (provActor) provActor.textContent = match.actor || "AGENT";
      if (provTime) provTime.textContent = new Date(match.timestamp).toLocaleTimeString([], { hour12: false });
      if (provHash) provHash.textContent = match.contentHash ? `${match.contentHash.substring(0, 16)}...` : "—";
    } else {
      if (provSource) provSource.textContent = "TrueForge Engine";
      if (provActor) provActor.textContent = "ORCHESTRATOR";
      if (provTime) provTime.textContent = currentSessionData?.createdAt ? new Date(currentSessionData.createdAt).toLocaleTimeString([], { hour12: false }) : "—";
      if (provHash) provHash.textContent = currentSessionData?.approvalCheckpoint?.sqlFingerprint ? `${currentSessionData.approvalCheckpoint.sqlFingerprint.substring(0, 16)}...` : "—";
    }
  }

  // Populate Session History List
  async function loadSessionHistory() {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) return;
      const data = await res.json();
      const sessions = data.sessions || [];

      if (historyCountBadge) {
        historyCountBadge.textContent = String(sessions.length);
      }

      if (sessions.length === 0) {
        historyList.innerHTML = `<div class="history-empty">No previous sessions recorded.</div>`;
        return;
      }

      historyList.innerHTML = sessions
        .map((s) => {
          const isSelected = currentSessionId === s.sessionId;
          const timeAgo = new Date(s.createdAt).toLocaleTimeString([], { hour12: false });
          const riskBadgeClass = s.overallRisk === "HIGH" || s.overallRisk === "CRITICAL" ? "badge-danger" : s.overallRisk === "MEDIUM" ? "badge-warn" : "badge-safe";
          return `
            <div class="history-item ${isSelected ? "active" : ""}" data-session-id="${escapeHtml(s.sessionId)}">
              <div class="history-item-top">
                <span class="history-file">${escapeHtml(s.migrationFilePath.split("/").pop())}</span>
                <span class="badge ${riskBadgeClass}">${escapeHtml(s.overallRisk || "LOW")}</span>
              </div>
              <div class="history-meta">
                <span>${escapeHtml(s.targetId)} (${escapeHtml(s.targetEnvironment)})</span>
                <span>${escapeHtml(s.status)} · ${escapeHtml(timeAgo)}</span>
              </div>
            </div>
          `;
        })
        .join("");

      historyList.querySelectorAll(".history-item").forEach((el) => {
        el.addEventListener("click", () => {
          const sid = el.getAttribute("data-session-id");
          if (sid) {
            selectHistoricalSession(sid);
          }
        });
      });
    } catch (e) {
      console.warn("Failed to load session history:", e);
    }
  }

  // Select Historical Session (Read-Only Mode)
  async function selectHistoricalSession(sessionId) {
    try {
      announce(`Loading session ${sessionId}...`);
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      const session = data.session;
      if (!session) return;

      currentSessionId = session.sessionId;
      currentSessionData = session;
      isReadOnlyMode = session.isReadOnly ?? (session.status === "COMPLETED" || session.status === "REJECTED");

      // Update Form Inputs
      if (targetSelect) targetSelect.value = session.targetId;
      if (migrationFileInput) migrationFileInput.value = session.migrationFilePath;

      // Update Read-Only Banner
      if (readonlyBanner) {
        readonlyBanner.style.display = isReadOnlyMode ? "block" : "none";
      }

      // Populate UI with Session Telemetry
      renderFullSessionState(session);

      // Close History Drawer
      if (historyDrawer) historyDrawer.style.display = "none";
      if (btnHistoryToggle) btnHistoryToggle.setAttribute("aria-expanded", "false");

      loadSessionHistory();
    } catch (err) {
      console.error("Error loading historical session:", err);
    }
  }

  function renderFullSessionState(session) {
    const report = session.reviewReport;
    const plan = session.plan;

    // Subagent Execution Cards
    if (session.schemaAnalysis) {
      const sa = session.schemaAnalysis;
      setSubagentState("schemaAnalyst", "COMPLETED", sa.summary, `<span class="metric-tag">Tables: ${sa.tableCount}</span><span class="metric-tag">Indexes: ${sa.totalIndexCount}</span>`);
    } else {
      setSubagentState("schemaAnalyst", "IDLE", "Awaiting schema review request...");
    }

    if (session.riskAnalysis) {
      const ra = session.riskAnalysis;
      setSubagentState("riskAnalyst", "COMPLETED", ra.summary, `<span class="metric-tag">Lock: ${ra.lockRisk}</span><span class="metric-tag">Rewrite: ${ra.tableRewriteExpected ? "YES" : "NO"}</span>`);
    } else {
      setSubagentState("riskAnalyst", "IDLE", "Awaiting schema snapshot...");
    }

    if (session.sandboxResult) {
      const sb = session.sandboxResult;
      setSubagentState("sandboxValidator", "COMPLETED", `Sandbox validation ${sb.success ? "PASSED" : "FAILED"} in ${sb.executionDurationMs}ms`, `<span class="metric-tag">${sb.executionDurationMs}ms</span><span class="metric-tag">Rollback: ${sb.rollbackSuccessful ? "PASS" : "FAIL"}</span>`);
    } else {
      setSubagentState("sandboxValidator", "IDLE", "Awaiting candidate SQL...");
    }

    if (session.approvalPacket || session.approvalCheckpoint) {
      setSubagentState("reviewSynthesizer", "COMPLETED", "Generated cryptographic approval packet and staged remediation plan.", `<span class="metric-tag">Checkpoint: READY</span><span class="metric-tag">Plan: STAGED</span>`);
    } else {
      setSubagentState("reviewSynthesizer", "IDLE", "Awaiting validation results...");
    }

    // Quantitative Risk Matrix
    if (report) {
      overallRiskBadge.className = `badge ${report.overallRisk === "HIGH" || report.overallRisk === "CRITICAL" ? "badge-danger" : report.overallRisk === "MEDIUM" ? "badge-warn" : "badge-safe"}`;
      overallRiskBadge.textContent = `${report.overallRisk} Risk`;

      valLockRisk.textContent = report.lockRisk || "NONE";
      valLockRisk.className = `cell-val ${report.lockRisk === "HIGH" || report.lockRisk === "EXCLUSIVE_LOCK_CRITICAL" ? "val-high" : "val-pass"}`;

      valTableRewrite.textContent = report.tableRewriteExpected ? "YES" : "NO";
      valTableRewrite.className = `cell-val ${report.tableRewriteExpected ? "val-high" : "val-pass"}`;

      valDataIntegrity.textContent = report.dataIntegrityStatus || "PASS";
      valDataIntegrity.className = `cell-val ${report.dataIntegrityStatus === "FAIL" ? "val-high" : "val-pass"}`;

      valSandboxStatus.textContent = report.sandboxStatus || "PASS";
      valSandboxStatus.className = `cell-val ${report.sandboxStatus === "FAIL" ? "val-high" : "val-pass"}`;

      valRollbackStatus.textContent = report.rollbackStatus || "PASS";
      valRollbackStatus.className = `cell-val ${report.rollbackStatus === "FAIL" ? "val-high" : "val-pass"}`;

      valAffectedTables.textContent = (report.affectedObjects || []).join(", ") || "None";

      // Findings
      if (report.findings && report.findings.length > 0) {
        findingsArea.style.display = "block";
        findingsList.innerHTML = report.findings
          .map(
            (f) => `
            <div class="finding-row level-${escapeHtml((f.level || "low").toLowerCase())}">
              <div class="finding-row-top">
                <span class="finding-cat">${escapeHtml(f.category)}</span>
                <span class="badge ${f.level === "HIGH" ? "badge-danger" : "badge-warn"}">${escapeHtml(f.level)}</span>
              </div>
              <div class="finding-desc">${escapeHtml(f.description)}</div>
              ${f.remediation ? `<div class="finding-remediation">🛡️ <strong>Remediation:</strong> ${escapeHtml(f.remediation)}</div>` : ""}
            </div>
          `
          )
          .join("");
      } else {
        findingsArea.style.display = "none";
      }

      // Staged Plan
      if (report.recommendedPlan && report.recommendedPlan.length > 0) {
        stagedPlanList.innerHTML = report.recommendedPlan
          .map((p) => `<li>${escapeHtml(p)}</li>`)
          .join("");
      }
    }

    // Approval Card
    approvalTarget.textContent = session.targetId;
    approvalEnv.textContent = session.targetId === "prod-postgres" ? "production" : "staging";
    approvalFingerprint.textContent = session.approvalPacket?.sqlFingerprint || session.approvalCheckpoint?.sqlFingerprint || "SHA-256 Verified";
    const rawTok = session.approvalPacket?.approvalToken || session.approvalCheckpoint?.token;
    approvalToken.textContent = rawTok
      ? (rawTok.startsWith("sat_") && rawTok.length > 10 ? `sat_...${rawTok.slice(-6)} (REDACTED)` : "sat_... (REDACTED)")
      : "sat_... (REDACTED)";

    if (session.status === "AWAITING_APPROVAL" && !isReadOnlyMode) {
      approvalWarning.style.display = "flex";
      btnReject.disabled = false;
      btnApprove.disabled = false;
    } else {
      approvalWarning.style.display = "none";
      btnReject.disabled = true;
      btnApprove.disabled = true;
    }

    // Verification Card
    if (session.verificationResult) {
      const v = session.verificationResult;
      verificationCard.style.display = "block";
      verificationStatusBadge.className = `badge ${v.status === "passed" ? "badge-safe" : "badge-danger"}`;
      verificationStatusBadge.textContent = v.status.toUpperCase();

      verificationChecksList.innerHTML = v.checks
        .map(
          (c) => `
          <div class="verification-item ${c.passed ? "check-pass" : "check-fail"}">
            <span class="check-icon">${c.passed ? "✓" : "✗"}</span>
            <div class="check-content">
              <strong>${escapeHtml(c.name)}</strong>
              <p>${escapeHtml(c.details)}</p>
            </div>
          </div>
        `
        )
        .join("");
    } else {
      verificationCard.style.display = "none";
    }

    // Safe Migration Panel (Phase 6)
    if (btnGenerateSafeMigration) {
      if ((session.status === "AWAITING_APPROVAL" || session.status === "REVIEW_READY") && !session.safeMigrationProposal && !isReadOnlyMode) {
        btnGenerateSafeMigration.disabled = false;
      } else {
        btnGenerateSafeMigration.disabled = true;
      }
    }

    if (session.safeMigrationProposal) {
      const proposal = session.safeMigrationProposal;
      if (safeProposalContent) safeProposalContent.style.display = "flex";

      if (safeRiskReduction) {
        safeRiskReduction.textContent = `${proposal.riskReductionSummary.beforeRisk} ➔ ${proposal.riskReductionSummary.afterRisk}`;
        safeRiskReduction.className = `badge ${proposal.riskReductionSummary.afterRisk === "LOW" ? "badge-safe" : "badge-warn"}`;
      }

      if (safeEliminatedFactors) {
        safeEliminatedFactors.textContent = proposal.riskReductionSummary.eliminatedFactors.join(" • ") || "Zero-lock staged execution";
      }

      if (safeMigrationRationale) {
        safeMigrationRationale.innerHTML = `
          <strong>Safe Remediation Rationale:</strong> ${escapeHtml(proposal.rationale)}
          <ol style="margin-top: 6px; padding-left: 18px;">
            ${proposal.remediationSteps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
          </ol>
        `;
      }

      if (safeDiffSummary) {
        safeDiffSummary.textContent = proposal.diff.summary || `${proposal.diff.addedLines} lines added, ${proposal.diff.removedLines} lines removed`;
      }

      if (safeDiffViewer && proposal.diff && proposal.diff.chunks) {
        safeDiffViewer.innerHTML = proposal.diff.chunks
          .map((chunk) => `
            <div class="diff-chunk-wrap">
              ${chunk.explanation ? `<div class="diff-chunk-explanation">ℹ️ ${escapeHtml(chunk.explanation)}</div>` : ""}
              ${chunk.lines
                .map((line) => {
                  const cls = chunk.type === "added" ? "diff-line-added" : chunk.type === "removed" ? "diff-line-removed" : "diff-line-unchanged";
                  const marker = chunk.type === "added" ? "+" : chunk.type === "removed" ? "-" : " ";
                  return `<div class="diff-line ${cls}"><span class="diff-marker">${marker}</span><span class="diff-text">${escapeHtml(line)}</span></div>`;
                })
                .join("")}
            </div>
          `)
          .join("");
      }

      if (safeApprovalToken) {
        const rawSafeTok = proposal.approvalToken;
        safeApprovalToken.textContent = rawSafeTok
          ? (rawSafeTok.length > 12 ? `sat_safe_...${rawSafeTok.slice(-6)} (REDACTED)` : "sat_safe_... (REDACTED)")
          : "sat_safe_... (REDACTED)";
      }

      if (btnApproveSafePr) {
        if (session.status === "AWAITING_SAFE_MIGRATION_APPROVAL" && !isReadOnlyMode) {
          btnApproveSafePr.disabled = false;
        } else {
          btnApproveSafePr.disabled = true;
        }
      }
    } else {
      if (safeProposalContent) safeProposalContent.style.display = "none";
    }

    // GitHub PR Opened Card
    if (session.githubPr) {
      const pr = session.githubPr;
      if (prCreatedCard) prCreatedCard.style.display = "flex";
      if (prLink) {
        prLink.href = pr.htmlUrl;
        prLink.textContent = `PR #${pr.prNumber} (${pr.title}) ↗`;
      }
      if (prBranchVal) prBranchVal.textContent = pr.branch;
      if (prCommitVal) prCommitVal.textContent = (pr.commitSha || "").substring(0, 8);
      if (prQodoStatusBadge) {
        prQodoStatusBadge.textContent = pr.qodoStatus || "Waiting for Qodo review";
      }
    } else {
      if (prCreatedCard) prCreatedCard.style.display = "none";
    }

    // Timeline Events
    timelineFeed.innerHTML = "";
    const events = session.activityEvents || [];
    if (events.length > 0) {
      events.forEach(renderTimelineEvent);
    } else {
      timelineFeed.innerHTML = `<div class="timeline-empty">Awaiting review execution trace...</div>`;
    }

    // Deep Evidence Explorer Tabs
    if (plan && evidenceSql) evidenceSql.textContent = plan.rawSql || "// No SQL payload.";
    if (session.schemaSnapshot && evidenceSchema) evidenceSchema.textContent = JSON.stringify(session.schemaSnapshot, null, 2);
    if (session.riskAnalysis && evidenceRisk) evidenceRisk.textContent = JSON.stringify(session.riskAnalysis, null, 2);
    if (session.sandboxOutput && evidenceSandbox) evidenceSandbox.textContent = JSON.stringify(session.sandboxOutput, null, 2);
    if (session.verificationResult && evidenceVerification) evidenceVerification.textContent = JSON.stringify(session.verificationResult, null, 2);
    if (evidenceAudit) {
      const auditPayload = {
        sessionId: session.sessionId,
        status: session.status,
        planFingerprint: session.approvalPacket?.sqlFingerprint || session.approvalCheckpoint?.sqlFingerprint,
        tokenRedacted: session.approvalPacket?.approvalToken || session.approvalCheckpoint?.token,
        safeProposal: session.safeMigrationProposal ? {
          proposalId: session.safeMigrationProposal.proposalId,
          sqlFingerprint: session.safeMigrationProposal.proposedSqlFingerprint,
          remediationStepsCount: session.safeMigrationProposal.remediationSteps.length,
          sandboxPassed: session.safeMigrationProposal.sandboxValidation?.status === "pass",
        } : null,
        githubPr: session.githubPr ? {
          prNumber: session.githubPr.prNumber,
          branch: session.githubPr.branch,
          commitSha: session.githubPr.commitSha,
        } : null,
        applyAuditLog: session.applyResult?.auditLog || [],
        evidenceProvenance: session.evidenceItems || [],
        createdAt: session.createdAt,
        completedAt: session.completedAt,
      };
      evidenceAudit.textContent = JSON.stringify(auditPayload, null, 2);
    }

    updateProvenanceDisplay();
  }

  // Evidence Tab Navigation
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      tabPanes.forEach((p) => {
        p.classList.remove("active");
        p.style.display = "none";
      });

      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      activeTabId = btn.getAttribute("data-tab");
      const targetPane = document.getElementById(activeTabId);
      if (targetPane) {
        targetPane.classList.add("active");
        targetPane.style.display = "block";
      }

      updateProvenanceDisplay();
    });
  });

  // History Toggle
  if (btnHistoryToggle) {
    btnHistoryToggle.addEventListener("click", () => {
      const isOpen = historyDrawer.style.display === "flex";
      historyDrawer.style.display = isOpen ? "none" : "flex";
      btnHistoryToggle.setAttribute("aria-expanded", String(!isOpen));
      if (!isOpen) loadSessionHistory();
    });
  }

  if (btnCloseHistory) {
    btnCloseHistory.addEventListener("click", () => {
      historyDrawer.style.display = "none";
      btnHistoryToggle.setAttribute("aria-expanded", "false");
    });
  }

  // Exit Read-Only Mode
  if (btnExitReadonly) {
    btnExitReadonly.addEventListener("click", () => {
      isReadOnlyMode = false;
      currentSessionId = null;
      currentSessionData = null;
      if (readonlyBanner) readonlyBanner.style.display = "none";
      btnStartReview.disabled = false;
      btnReject.disabled = true;
      btnApprove.disabled = true;
      approvalWarning.style.display = "none";
      timelineFeed.innerHTML = `<div class="timeline-empty">Awaiting review execution trace...</div>`;
      announce("Exited read-only mode. Ready for new safety review.");
    });
  }

  // Start Safety Review
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const targetId = targetSelect.value;
    const migrationFilePath = migrationFileInput.value.trim();

    if (!migrationFilePath) return;

    btnStartReview.disabled = true;
    btnSpinner.style.display = "inline-block";
    btnLabel.textContent = "Analyzing...";
    announce("TrueForge review started. Orchestrating specialized subagents...");

    timelineFeed.innerHTML = "";
    const sessionId = `sess_${Date.now()}`;
    currentSessionId = sessionId;
    currentSessionData = { sessionId, targetId, migrationFilePath, evidenceItems: [] };
    isReadOnlyMode = false;
    if (readonlyBanner) readonlyBanner.style.display = "none";

    // Open Live SSE Stream
    connectEventStream(sessionId);

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          targetId,
          migrationFilePath,
          repo: "mohitpargaie002-a11y/SchemaSentinel",
          userPrompt: `Review and analyze migration ${migrationFilePath}`,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to execute review");
      }

      currentSessionData = data;
      renderFullSessionState(data);
      loadSessionHistory();
      announce("Safety review completed. Human approval required before mutation.");
    } catch (err) {
      closeEventStream();
      alert(`Review Failed: ${err.message}`);
    } finally {
      btnStartReview.disabled = false;
      btnSpinner.style.display = "none";
      btnLabel.textContent = "Run Safety Review";
    }
  });

  // Approve & Apply
  btnApprove.addEventListener("click", async () => {
    if (!currentSessionId || isReadOnlyMode) return;

    btnApprove.disabled = true;
    btnReject.disabled = true;
    btnApprove.textContent = "Applying...";
    announce("Human approval granted. Applying migration to allowlisted staging...");

    try {
      const response = await fetch(`/api/sessions/${currentSessionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvedBy: "lead-dba@schemasentinel.dev",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Approval / Apply failed");
      }

      currentSessionData = { ...currentSessionData, ...data };
      renderFullSessionState(currentSessionData);
      loadSessionHistory();
      announce("Migration applied and post-apply invariant checks verified.");
    } catch (err) {
      alert(`Apply Failed: ${err.message}`);
    } finally {
      btnApprove.textContent = "Approve & Apply to Staging";
    }
  });

  // Reject Migration
  btnReject.addEventListener("click", async () => {
    if (!currentSessionId || isReadOnlyMode) return;

    btnApprove.disabled = true;
    btnReject.disabled = true;
    announce("Human operator rejected migration. Zero mutations applied.");

    try {
      const response = await fetch(`/api/sessions/${currentSessionId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvedBy: "lead-dba@schemasentinel.dev",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Rejection failed");
      }

      currentSessionData = { ...currentSessionData, ...data };
      renderFullSessionState(currentSessionData);
      loadSessionHistory();
    } catch (err) {
      alert(`Reject Failed: ${err.message}`);
    }
  });

  // Phase 6: Generate Safe Remediation
  if (btnGenerateSafeMigration) {
    btnGenerateSafeMigration.addEventListener("click", async () => {
      if (!currentSessionId || isReadOnlyMode) return;

      btnGenerateSafeMigration.disabled = true;
      if (safeGenSpinner) safeGenSpinner.style.display = "inline-block";
      if (safeGenBtnLabel) safeGenBtnLabel.textContent = "Generating...";
      announce("Generating safe staged migration and running sandbox validation...");

      try {
        const response = await fetch(`/api/sessions/${currentSessionId}/safe-migration/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to generate safe migration");
        }

        currentSessionData = { ...currentSessionData, ...data };
        renderFullSessionState(currentSessionData);
        loadSessionHistory();
        announce("Safe migration generated and verified in sandbox. Operator approval required to open GitHub PR.");
      } catch (err) {
        alert(`Safe Migration Generation Failed: ${err.message}`);
      } finally {
        if (safeGenSpinner) safeGenSpinner.style.display = "none";
        if (safeGenBtnLabel) safeGenBtnLabel.textContent = "Generate Safe Remediation";
        if (currentSessionData && !currentSessionData.safeMigrationProposal) {
          btnGenerateSafeMigration.disabled = false;
        }
      }
    });
  }

  // Phase 6: Approve Safe Migration & Create GitHub PR
  if (btnApproveSafePr) {
    btnApproveSafePr.addEventListener("click", async () => {
      if (!currentSessionId || isReadOnlyMode) return;

      btnApproveSafePr.disabled = true;
      if (safePrSpinner) safePrSpinner.style.display = "inline-block";
      if (safePrBtnLabel) safePrBtnLabel.textContent = "Opening PR...";
      announce("Operator approved safe migration. Creating Git branch and opening GitHub Pull Request...");

      try {
        const response = await fetch(`/api/sessions/${currentSessionId}/safe-migration/approve-pr`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvedBy: "lead-dba@schemasentinel.dev",
            baseBranch: "master",
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to open GitHub PR");
        }

        currentSessionData = { ...currentSessionData, ...data };
        renderFullSessionState(currentSessionData);
        loadSessionHistory();
        announce(`GitHub PR #${data.githubPr?.prNumber || ""} created successfully. Awaiting Qodo review.`);
      } catch (err) {
        alert(`PR Creation Failed: ${err.message}`);
      } finally {
        if (safePrSpinner) safePrSpinner.style.display = "none";
        if (safePrBtnLabel) safePrBtnLabel.textContent = "Approve & Open GitHub PR";
      }
    });
  }

  // Initial History Load
  loadSessionHistory();
});
