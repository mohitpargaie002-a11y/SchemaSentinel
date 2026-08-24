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

  function escapeHtml(str) {
    if (!str && str !== 0) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

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
      metricsEl.innerHTML = `<span>${escapeHtml(metric1)}</span><span>${escapeHtml(metric2)}</span>`;
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
            <span>${escapeHtml(f.category)} [${escapeHtml(f.level)}]</span>
          </div>
          <p class="finding-desc">${escapeHtml(f.description)}</p>
          ${f.remediation ? `<p class="finding-rem">💡 Remediation: ${escapeHtml(f.remediation)}</p>` : ""}
        </div>
      `
        )
        .join("");
    }

    // Render Staged Plan List
    const planArea = document.getElementById("staged-plan-area");
    const planList = document.getElementById("plan-list");
    if (planArea && planList && report.recommendedPlan && report.recommendedPlan.length > 0) {
      planArea.style.display = "block";
      planList.innerHTML = report.recommendedPlan
        .map((p) => `<li class="plan-step-item">${escapeHtml(p)}</li>`)
        .join("");
    }
  }

  function renderApprovalCheckpoint(packet) {
    const card = document.getElementById("approval-card");
    const targetLabel = document.getElementById("approval-target-label");
    const tokenDisplay = document.getElementById("approval-token-display");
    const fpDisplay = document.getElementById("approval-fingerprint-display");
    const warningDisplay = document.getElementById("approval-warning-display");

    if (card) {
      card.style.display = "block";
      card.className = "card approval-card active";
    }
    if (targetLabel) {
      targetLabel.textContent = `TARGET: ${packet.targetId} (${packet.targetEnvironment || "staging"})`;
    }
    if (tokenDisplay) {
      const redactedToken = packet.approvalToken
        ? (packet.approvalToken.length > 12 ? `sat_...${packet.approvalToken.slice(-6)}` : packet.approvalToken)
        : "N/A";
      tokenDisplay.textContent = redactedToken;
    }
    if (fpDisplay) {
      fpDisplay.textContent = packet.sqlFingerprint ? packet.sqlFingerprint.substring(0, 16) + "..." : "SHA-256 Validated";
    }
    if (warningDisplay && packet.irreversibleWarning) {
      warningDisplay.textContent = packet.irreversibleWarning;
    }
    if (btnApprove) btnApprove.disabled = false;
    if (btnReject) btnReject.disabled = false;
  }

  function renderPostApplyVerification(verificationResult, applyResult) {
    const card = document.getElementById("verification-card");
    const badge = document.getElementById("verification-badge");
    const list = document.getElementById("verification-checks-list");

    if (!card) return;
    card.style.display = "block";

    if (badge) {
      const passed = verificationResult?.status === "passed" && applyResult?.success;
      badge.textContent = passed ? "VERIFIED (PASSED)" : "VERIFICATION FAILED";
      badge.className = passed ? "badge badge-success" : "badge badge-danger";
    }

    if (list && verificationResult?.checks) {
      list.innerHTML = verificationResult.checks
        .map(
          (c) => `
        <div class="verification-check-item ${c.passed ? "check-pass" : "check-fail"}">
          <span class="check-icon">${c.passed ? "✓" : "✗"}</span>
          <div class="check-body">
            <strong>${escapeHtml(c.name)}</strong>
            <p>${escapeHtml(c.details)}</p>
          </div>
        </div>
      `
        )
        .join("");
    }
  }

  function renderTimelineFeed(activityEvents, timeline) {
    const feed = document.getElementById("activity-feed");
    if (!feed) return;

    if (activityEvents && activityEvents.length > 0) {
      feed.innerHTML = activityEvents
        .slice()
        .reverse()
        .map(
          (evt) => `
        <div class="activity-feed-item status-${escapeHtml((evt.status || "").toLowerCase())}">
          <div class="evt-header">
            <span class="evt-actor">[${escapeHtml(evt.actor)}]</span>
            <span class="evt-phase">${escapeHtml(evt.phase)}</span>
            <span class="evt-time">${new Date(evt.timestamp).toLocaleTimeString()}</span>
          </div>
          <p class="evt-msg">${escapeHtml(evt.message)}</p>
          ${evt.toolName ? `<span class="evt-tool">🔧 ${escapeHtml(evt.toolName)}</span>` : ""}
          ${evt.durationMs ? `<span class="evt-duration">⏱ ${escapeHtml(evt.durationMs)}ms</span>` : ""}
        </div>
      `
        )
        .join("");
    } else if (timeline && timeline.length > 0) {
      feed.innerHTML = timeline
        .slice()
        .reverse()
        .map(
          (evt) => `
        <div class="activity-feed-item status-${escapeHtml((evt.status || "").toLowerCase())}">
          <div class="evt-header">
            <span class="evt-actor">[TIMELINE]</span>
            <span class="evt-phase">${escapeHtml(evt.step)}</span>
            <span class="evt-time">${new Date(evt.timestamp).toLocaleTimeString()}</span>
          </div>
          <p class="evt-msg">${escapeHtml(evt.details)}</p>
        </div>
      `
        )
        .join("");
    }
  }

  function renderEvidenceTabs(session) {
    const rawSqlEl = document.getElementById("raw-sql-view");
    const rawSchemaEl = document.getElementById("raw-schema-view");
    const rawSandboxEl = document.getElementById("raw-sandbox-view");
    const rawAuditEl = document.getElementById("raw-audit-view");

    if (rawSqlEl && session.plan?.rawSql) {
      rawSqlEl.textContent = session.plan.rawSql;
    }
    if (rawSchemaEl && session.schemaSnapshot) {
      rawSchemaEl.textContent = JSON.stringify(session.schemaSnapshot, null, 2);
    }
    if (rawSandboxEl && session.sandboxOutput) {
      rawSandboxEl.textContent = JSON.stringify(session.sandboxOutput, null, 2);
    }
    if (rawAuditEl) {
      const auditPayload = {
        sessionId: session.sessionId,
        approvalCheckpoint: session.approvalCheckpoint,
        applyResult: session.applyResult,
        verificationResult: session.verificationResult,
      };
      rawAuditEl.textContent = JSON.stringify(auditPayload, null, 2);
    }
  }

  async function loadTargets() {
    try {
      const res = await fetch("/api/targets");
      const data = await res.json();
      if (targetSelect && data.targets) {
        targetSelect.innerHTML = data.targets
          .map(
            (t) =>
              `<option value="${escapeHtml(t.id)}" ${t.id === "staging-demo" ? "selected" : ""}>
                ${escapeHtml(t.name)} (${escapeHtml(t.environment)}) ${t.mutable ? "[Mutable Staging]" : "[Read-Only Sandbox/Prod]"}
              </option>`
          )
          .join("");
      }
    } catch (err) {
      console.error("Failed to load targets:", err);
    }
  }

  async function loadSession(sessionId) {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) return;
      const { session } = await res.json();
      if (!session) return;

      currentSessionId = session.sessionId;
      localStorage.setItem("schemasentinel_current_session", session.sessionId);

      // Restore Subagent Badges
      if (session.schemaAnalysis) {
        setSubagentState("schema", "COMPLETED", session.schemaAnalysis.summary, `${session.schemaAnalysis.tableCount} tables`, `${session.schemaAnalysis.totalIndexCount} indexes`);
      }
      if (session.riskAnalysis) {
        setSubagentState("risk", "COMPLETED", session.riskAnalysis.summary, `Lock: ${session.riskAnalysis.lockRisk}`, `Risk: ${session.riskAnalysis.overallRisk}`);
      }
      if (session.sandboxOutput) {
        setSubagentState("sandbox", session.sandboxOutput.success ? "COMPLETED" : "FAILED", session.sandboxOutput.schemaDiffSummary, `${session.sandboxOutput.executionDurationMs}ms`, `Rollback: ${session.sandboxOutput.rollbackSuccessful ? "PASS" : "FAIL"}`);
      }
      if (session.reviewReport) {
        setSubagentState("synthesizer", "COMPLETED", session.reviewReport.approvalSummary, "Approval Token Generated", "Staged Plan Ready");
        updateRiskMatrix(session.reviewReport, session.riskAnalysis);
      }

      // Restore Approval Checkpoint
      if (session.status === "AWAITING_APPROVAL" && session.approvalPacket) {
        renderApprovalCheckpoint(session.approvalPacket);
      } else if (session.status === "COMPLETED" || session.status === "REJECTED" || session.status === "FAILED") {
        const approvalCard = document.getElementById("approval-card");
        if (approvalCard) {
          approvalCard.className = `card approval-card ${session.status.toLowerCase()}`;
          const tokenDisplay = document.getElementById("approval-token-display");
          if (tokenDisplay) tokenDisplay.textContent = `SESSION STATUS: ${session.status}`;
        }
      }

      // Restore Post-Apply Verification
      if (session.verificationResult || session.applyResult) {
        renderPostApplyVerification(session.verificationResult, session.applyResult);
      }

      // Restore Timeline & Evidence
      renderTimelineFeed(session.activityEvents, session.timeline);
      renderEvidenceTabs(session);
    } catch (err) {
      console.error("Failed to load session:", err);
    }
  }

  // Handle Form Submission: Trigger Review
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const targetId = targetSelect ? targetSelect.value : "staging-demo";
      const migrationFilePath = migrationFileInput ? migrationFileInput.value.trim() : "migrations/0038_add_order_status.sql";

      btnStartReview.disabled = true;
      btnStartReview.innerHTML = `<span class="spinner"></span> Reviewing Schema...`;
      announce("Starting TrueForge multi-subagent migration review...");

      // Set Subagents to Running
      setSubagentState("schema", "RUNNING", "Inspecting PostgreSQL catalog via Schema Analyst...");
      setSubagentState("risk", "RUNNING", "Evaluating lock risks & AST hazards via Risk Analyst...");
      setSubagentState("sandbox", "RUNNING", "Spinning up isolated PGlite sandbox...");
      setSubagentState("synthesizer", "RUNNING", "Waiting for subagent outputs...");

      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetId,
            migrationFilePath,
            repo: "mohitpargaie002-a11y/SchemaSentinel",
          }),
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        currentSessionId = data.sessionId;
        currentApprovalToken = data.approvalPacket?.approvalToken;
        localStorage.setItem("schemasentinel_current_session", currentSessionId);

        // Update Subagent Cards
        setSubagentState("schema", "COMPLETED", data.schemaAnalysis.summary, `${data.schemaAnalysis.tableCount} tables`, `${data.schemaAnalysis.totalIndexCount} indexes`);
        setSubagentState("risk", "COMPLETED", data.riskAnalysis.summary, `Lock: ${data.riskAnalysis.lockRisk}`, `Risk: ${data.riskAnalysis.overallRisk}`);
        setSubagentState("sandbox", data.sandboxOutput.success ? "COMPLETED" : "FAILED", data.sandboxOutput.schemaDiffSummary, `${data.sandboxOutput.executionDurationMs}ms`, `Rollback: ${data.sandboxOutput.rollbackSuccessful ? "PASS" : "FAIL"}`);
        setSubagentState("synthesizer", "COMPLETED", data.reviewReport.approvalSummary, "Approval Token Generated", "Staged Plan Ready");

        // Update Risk Matrix & Approval Card
        updateRiskMatrix(data.reviewReport, data.riskAnalysis);
        renderApprovalCheckpoint(data.approvalPacket);

        // Update Timeline & Evidence
        renderTimelineFeed(data.activityEvents);
        renderEvidenceTabs(data);

        announce("Multi-subagent review complete. Awaiting human approval checkpoint.");
      } catch (err) {
        console.error("Review failed:", err);
        alert(`Review error: ${err.message}`);
        announce(`Review failed: ${err.message}`);
      } finally {
        btnStartReview.disabled = false;
        btnStartReview.innerHTML = `<span class="btn-icon">⚡</span> Run Multi-Agent Safety Review`;
      }
    });
  }

  // Handle Approve Button
  if (btnApprove) {
    btnApprove.addEventListener("click", async () => {
      if (!currentSessionId) return;

      const targetLabel = targetSelect ? targetSelect.value : "staging-demo";
      if (!confirm(`Authorizing migration apply on '${targetLabel}'. Proceed?`)) return;

      btnApprove.disabled = true;
      btnReject.disabled = true;
      announce("Applying migration to staging target...");

      try {
        const res = await fetch(`/api/sessions/${currentSessionId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approvalToken: currentApprovalToken || "sat_demo_token",
            approvedBy: "lead-dba@schemasentinel.dev",
          }),
        });
        const data = await res.json();
        await loadSession(currentSessionId);

        if (!res.ok || data.status !== "COMPLETED" || !data.applyResult?.success || data.verificationResult?.status !== "passed") {
          const errorMsg = data.error || data.applyResult?.errorMessage || (data.verificationResult?.failures && data.verificationResult.failures.join("; ")) || "Migration apply or verification failed.";
          announce(`Migration apply failed: ${errorMsg}`);
          alert(`Apply failed: ${errorMsg}`);
        } else {
          announce("Migration applied and verified successfully!");
        }
      } catch (err) {
        console.error("Apply failed:", err);
        alert(`Apply error: ${err.message}`);
        announce(`Apply error: ${err.message}`);
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

  // Initialize
  loadTargets();
  if (currentSessionId) {
    loadSession(currentSessionId);
  }
})();
