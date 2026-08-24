// SchemaSentinel — Frontend Client Controller
(function () {
  let currentSessionId = localStorage.getItem("schemasentinel_current_session") || null;
  let currentApprovalToken = null;
  let pollInterval = null;

  // DOM Elements
  const form = document.getElementById("migration-form");
  const targetSelect = document.getElementById("target-select");
  const migrationFileInput = document.getElementById("migration-file");
  const btnStartReview = document.getElementById("btn-start-review");
  const btnApprove = document.getElementById("btn-approve");
  const btnReject = document.getElementById("btn-reject");
  const announcer = document.getElementById("aria-live-announcer");

  function announce(msg) {
    if (announcer) {
      announcer.textContent = msg;
    }
  }

  function setSubagentState(agentId, status, desc, metric1, metric2) {
    const card = document.getElementById(`agent-${agentId}`);
    const badge = document.getElementById(`status-${agentId}`);
    const descEl = document.getElementById(`desc-${agentId}`);
    const metricsEl = document.getElementById(`metrics-${agentId}`);

    if (card) {
      card.className = `card subagent-card ${status.toLowerCase()}`;
    }
    if (badge) {
      badge.className = `agent-status-badge status-${status.toLowerCase()}`;
      badge.textContent = status;
    }
    if (descEl && desc) {
      descEl.textContent = desc;
    }
    if (metricsEl && metric1 && metric2) {
      metricsEl.innerHTML = `<span>${metric1}</span><span>${metric2}</span>`;
    }
  }

  function updateRiskMatrix(report, analysis) {
    const badge = document.getElementById("overall-risk-badge");
    const valLock = document.getElementById("val-lock-risk");
    const valRewrite = document.getElementById("val-table-rewrite");
    const valIntegrity = document.getElementById("val-data-integrity");
    const valSandbox = document.getElementById("val-sandbox-status");
    const valRollback = document.getElementById("val-rollback-status");
    const valTables = document.getElementById("val-affected-tables");

    if (badge) {
      badge.textContent = `${report.overallRisk} RISK`;
      badge.className = report.overallRisk === "HIGH" ? "badge badge-danger" : "badge badge-warning";
    }
    if (valLock) {
      valLock.textContent = report.lockRisk;
      valLock.className = `metric-value ${report.lockRisk === "HIGH" ? "val-high" : "val-warn"}`;
    }
    if (valRewrite) {
      valRewrite.textContent = report.tableRewriteExpected ? "YES (Rewrite)" : "NO";
      valRewrite.className = `metric-value ${report.tableRewriteExpected ? "val-high" : "val-pass"}`;
    }
    if (valIntegrity) {
      valIntegrity.textContent = report.dataIntegrityStatus;
      valIntegrity.className = `metric-value ${report.dataIntegrityStatus === "PASS" ? "val-pass" : "val-high"}`;
    }
    if (valSandbox) {
      valSandbox.textContent = report.sandboxStatus;
      valSandbox.className = `metric-value ${report.sandboxStatus === "PASS" ? "val-pass" : "val-high"}`;
    }
    if (valRollback) {
      valRollback.textContent = report.rollbackStatus;
      valRollback.className = `metric-value ${report.rollbackStatus === "PASS" ? "val-pass" : "val-high"}`;
    }
    if (valTables) {
      valTables.textContent = (report.affectedObjects || []).join(", ") || "orders";
    }

    // Render Findings List
    const findingsArea = document.getElementById("findings-area");
    const findingsList = document.getElementById("findings-list");
    if (findingsArea && findingsList && report.findings && report.findings.length > 0) {
      findingsArea.style.display = "block";
      findingsList.innerHTML = report.findings
        .map(
          (f) => `
        <div class="finding-item">
          <div class="finding-header">
            <span>${f.category} [${f.level}]</span>
          </div>
          <p class="finding-desc">${f.description}</p>
          ${f.remediation ? `<p class="finding-rem">💡 Remediation: ${f.remediation}</p>` : ""}
        </div>
      `
        )
        .join("");
    }

    // Render Staged Plan List
    const stagedPlanList = document.getElementById("staged-plan-list");
    if (stagedPlanList && report.recommendedPlan) {
      stagedPlanList.innerHTML = report.recommendedPlan
        .map(
          (p, i) => `
        <div class="plan-item">
          <span class="plan-num">${i + 1}</span>
          <span>${p}</span>
        </div>
      `
        )
        .join("");
    }
  }

  function updateApprovalCard(packet, status) {
    const card = document.getElementById("approval-card");
    const targetEl = document.getElementById("approval-target");
    const envEl = document.getElementById("approval-env");
    const fpEl = document.getElementById("approval-fingerprint");
    const tokenEl = document.getElementById("approval-token");
    const warningBanner = document.getElementById("approval-warning");
    const warningText = document.getElementById("warning-text");

    if (targetEl) targetEl.textContent = packet.targetId;
    if (envEl) envEl.textContent = packet.targetEnvironment;
    if (fpEl) fpEl.textContent = packet.sqlFingerprint;
    if (tokenEl) tokenEl.textContent = packet.approvalToken ? `sat_...${packet.approvalToken.slice(-6)} (REDACTED)` : "—";
    
    currentApprovalToken = packet.approvalToken;

    if (warningBanner && warningText && packet.irreversibleWarning) {
      warningBanner.style.display = "flex";
      warningText.textContent = packet.irreversibleWarning;
    }

    if (status === "AWAITING_APPROVAL") {
      card.className = "card approval-card awaiting";
      btnApprove.disabled = false;
      btnReject.disabled = false;
      announce("Human approval required. Migration execution paused.");
    } else if (status === "APPROVED" || status === "COMPLETED") {
      card.className = "card approval-card approved";
      btnApprove.disabled = true;
      btnReject.disabled = true;
    } else if (status === "REJECTED") {
      card.className = "card approval-card rejected";
      btnApprove.disabled = true;
      btnReject.disabled = true;
    }
  }

  function updateTimeline(timeline) {
    const feed = document.getElementById("timeline-feed");
    const countBadge = document.getElementById("event-count-badge");
    if (!feed || !timeline) return;

    if (countBadge) {
      countBadge.textContent = `${timeline.length} Events`;
    }

    feed.innerHTML = timeline
      .map(
        (t) => `
      <div class="timeline-item">
        <span class="timeline-time">${t.timestamp.substring(11, 19)}</span>
        <div class="timeline-content">
          <strong>[${t.step}]</strong> <span class="timeline-msg">${t.details}</span>
        </div>
      </div>
    `
      )
      .join("");
    feed.scrollTop = feed.scrollHeight;
  }

  function updateVerification(result) {
    const card = document.getElementById("verification-card");
    const list = document.getElementById("verification-checks-list");
    const badge = document.getElementById("verification-status-badge");

    if (!result || !card || !list) return;

    card.style.display = "block";
    badge.textContent = result.status.toUpperCase();
    badge.className = result.status === "passed" ? "badge badge-success" : "badge badge-danger";

    list.innerHTML = (result.checks || [])
      .map(
        (c) => `
      <div class="check-item ${c.passed ? "passed" : "failed"}">
        <span class="check-icon">${c.passed ? "✓" : "✕"}</span>
        <span>${c.details}</span>
      </div>
    `
      )
      .join("");
  }

  function updateEvidence(session) {
    const sqlEl = document.getElementById("evidence-sql");
    const schemaEl = document.getElementById("evidence-schema");
    const sandboxEl = document.getElementById("evidence-sandbox");
    const auditEl = document.getElementById("evidence-audit");

    if (sqlEl && session.plan) {
      sqlEl.textContent = session.plan.rawSql;
    }
    if (schemaEl && session.schemaSnapshot) {
      schemaEl.textContent = JSON.stringify(session.schemaSnapshot, null, 2);
    }
    if (sandboxEl && session.sandboxOutput) {
      sandboxEl.textContent = JSON.stringify(session.sandboxOutput, null, 2);
    }
    if (auditEl && session.applyResult) {
      auditEl.textContent = JSON.stringify(session.applyResult, null, 2);
    }
  }

  async function loadSession(sessionId) {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      const s = data.session;
      if (!s) return;

      currentSessionId = s.sessionId;
      localStorage.setItem("schemasentinel_current_session", currentSessionId);

      // Subagent States
      if (s.schemaAnalysis) {
        setSubagentState("schema-analyst", "COMPLETED", s.schemaAnalysis.summary, `Tables: <strong>${s.schemaAnalysis.tableCount}</strong>`, `Indexes: <strong>${s.schemaAnalysis.totalIndexCount}</strong>`);
      }
      if (s.riskAnalysis) {
        setSubagentState("risk-analyst", "COMPLETED", s.riskAnalysis.summary, `Lock Risk: <strong>${s.riskAnalysis.lockRisk}</strong>`, `Rewrite: <strong>${s.riskAnalysis.tableRewriteExpected ? "YES" : "NO"}</strong>`);
      }
      if (s.sandboxOutput) {
        setSubagentState("sandbox-validator", s.sandboxOutput.success ? "COMPLETED" : "FAILED", `Validated in ${s.sandboxOutput.executionDurationMs}ms`, `Assertions: <strong>${s.sandboxOutput.assertionsPassed.length}</strong>`, `Rollback: <strong>${s.sandboxOutput.rollbackSuccessful ? "PASS" : "FAIL"}</strong>`);
      }
      if (s.reviewReport) {
        setSubagentState("review-synthesizer", "COMPLETED", s.reviewReport.approvalSummary, `Risk: <strong>${s.reviewReport.overallRisk}</strong>`, `Plan: <strong>Ready</strong>`);
        updateRiskMatrix(s.reviewReport, s.riskAnalysis);
      }

      if (s.approvalPacket) {
        updateApprovalCard(s.approvalPacket, s.status);
      }

      if (s.timeline) {
        updateTimeline(s.timeline);
      }

      if (s.verificationResult) {
        updateVerification(s.verificationResult);
      }

      updateEvidence(s);
    } catch (err) {
      console.error("Error loading session:", err);
    }
  }

  // Handle Review Submission
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const targetId = targetSelect.value;
      const migrationFilePath = migrationFileInput.value.trim();

      btnStartReview.disabled = true;
      btnStartReview.innerHTML = `<span class="pulse-dot"></span> Analyzing Schema & Sandbox...`;
      announce("Starting multi-agent review pipeline...");

      setSubagentState("schema-analyst", "RUNNING", "Introspecting PostgreSQL catalog via MCP...", "Tables: ...", "Indexes: ...");
      setSubagentState("risk-analyst", "RUNNING", "Evaluating lock hierarchy and rewrites...", "Lock Risk: ...", "Rewrite: ...");
      setSubagentState("sandbox-validator", "RUNNING", "Running PGlite sandbox dry-run...", "Assertions: ...", "Rollback: ...");
      setSubagentState("review-synthesizer", "RUNNING", "Preparing TrueForge approval packet...", "Evidence: ...", "Fingerprint: ...");

      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetId,
            migrationFilePath,
            userPrompt: `Review migration ${migrationFilePath} for target ${targetId}`,
          }),
        });

        const data = await res.json();
        if (data.sessionId) {
          currentSessionId = data.sessionId;
          localStorage.setItem("schemasentinel_current_session", currentSessionId);
          await loadSession(currentSessionId);
        }
      } catch (err) {
        console.error("Submission failed:", err);
        alert(`Error initiating review: ${err.message}`);
      } finally {
        btnStartReview.disabled = false;
        btnStartReview.innerHTML = `<span class="btn-icon">⚡</span> Run Multi-Agent Safety Review`;
      }
    });
  }

  // Handle Approve Button
  if (btnApprove) {
    btnApprove.addEventListener("click", async () => {
      if (!currentSessionId || !currentApprovalToken) return;
      if (!confirm("Authorizing migration apply on staging-demo. Proceed?")) return;

      btnApprove.disabled = true;
      btnReject.disabled = true;
      announce("Applying migration to staging target...");

      try {
        const res = await fetch(`/api/sessions/${currentSessionId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvalToken: currentApprovalToken,
            approvedBy: "lead-dba@schemasentinel.dev",
          }),
        });
        const data = await res.json();
        await loadSession(currentSessionId);
        announce("Migration applied and verified successfully!");
      } catch (err) {
        console.error("Apply failed:", err);
        alert(`Apply error: ${err.message}`);
      }
    });
  }

  // Handle Reject Button
  if (btnReject) {
    btnReject.addEventListener("click", async () => {
      if (!currentSessionId) return;

      btnApprove.disabled = true;
      btnReject.disabled = true;

      try {
        await fetch(`/api/sessions/${currentSessionId}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvedBy: "lead-dba@schemasentinel.dev",
          }),
        });
        await loadSession(currentSessionId);
        announce("Migration rejected. Zero mutations applied.");
      } catch (err) {
        console.error("Reject failed:", err);
      }
    });
  }

  // Tab Switcher for Evidence Explorer
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".tab-pane").forEach((p) => (p.style.display = "none"));

      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      const targetTab = document.getElementById(btn.dataset.tab);
      if (targetTab) {
        targetTab.style.display = "block";
      }
    });
  });

  // Session Continuity: Load previous session on refresh if present
  if (currentSessionId) {
    loadSession(currentSessionId);
  }
})();
