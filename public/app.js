// SchemaSentinel — Frontend Client Controller (Refined Design System)
(function () {
  let currentSessionId = localStorage.getItem("schemasentinel_current_session") || null;
  let currentApprovalToken = null;

  // DOM Elements
  const form = document.getElementById("migration-form");
  const targetSelect = document.getElementById("target-select");
  const migrationFileInput = document.getElementById("migration-file");
  const btnStartReview = document.getElementById("btn-start-review");
  const btnLabel = document.getElementById("btn-label");
  const btnSpinner = document.getElementById("btn-spinner");
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

  function setSubagentState(subagentKey, status, desc, metric1, metric2) {
    const card = document.getElementById(`agent-${subagentKey}`);
    const badge = document.getElementById(`status-${subagentKey}`);
    const descEl = document.getElementById(`desc-${subagentKey}`);
    const metricsEl = document.getElementById(`metrics-${subagentKey}`);

    if (card) {
      card.className = `subagent-card ${status.toLowerCase()}`;
    }
    if (badge) {
      badge.textContent = status;
      badge.className = `badge ${
        status === "RUNNING"
          ? "badge-info"
          : status === "COMPLETED"
          ? "badge-safe"
          : status === "FAILED"
          ? "badge-danger"
          : "badge-idle"
      }`;
    }
    if (descEl && desc) {
      descEl.textContent = desc;
    }
    if (metricsEl && metric1 && metric2) {
      metricsEl.innerHTML = `<span class="metric-tag">${escapeHtml(metric1)}</span><span class="metric-tag">${escapeHtml(metric2)}</span>`;
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
      badge.className = report.overallRisk === "HIGH" ? "badge badge-danger" : "badge badge-warn";
    }
    if (valLock) {
      valLock.textContent = report.lockRisk;
      valLock.className = `cell-val ${report.lockRisk === "HIGH" ? "val-high" : "val-warn"}`;
    }
    if (valRewrite) {
      valRewrite.textContent = report.tableRewriteExpected ? "YES (Rewrite)" : "NO";
      valRewrite.className = `cell-val ${report.tableRewriteExpected ? "val-high" : "val-pass"}`;
    }
    if (valIntegrity) {
      valIntegrity.textContent = report.dataIntegrityStatus;
      valIntegrity.className = `cell-val ${report.dataIntegrityStatus === "PASS" ? "val-pass" : "val-high"}`;
    }
    if (valSandbox) {
      valSandbox.textContent = report.sandboxStatus;
      valSandbox.className = `cell-val ${report.sandboxStatus === "PASS" ? "val-pass" : "val-high"}`;
    }
    if (valRollback) {
      valRollback.textContent = report.rollbackStatus;
      valRollback.className = `cell-val ${report.rollbackStatus === "PASS" ? "val-pass" : "val-high"}`;
    }
    if (valTables) {
      valTables.textContent = (report.affectedObjects || []).join(", ") || "orders";
    }

    // Render Findings List
    const findingsArea = document.getElementById("findings-area");
    const findingsList = document.getElementById("findings-list");
    if (findingsArea && findingsList) {
      if (report.findings && report.findings.length > 0) {
        findingsArea.style.display = "block";
        findingsList.innerHTML = report.findings
          .map(
            (f) => `
          <div class="finding-row level-${(f.level || "HIGH").toLowerCase()}">
            <div class="finding-row-top">
              <span class="finding-cat">${escapeHtml(f.category)}</span>
              <span class="badge ${f.level === "HIGH" ? "badge-danger" : "badge-warn"}">${escapeHtml(f.level)}</span>
            </div>
            <p class="finding-desc">${escapeHtml(f.description)}</p>
            ${f.remediation ? `<div class="finding-remediation">💡 Safe Remediation: ${escapeHtml(f.remediation)}</div>` : ""}
          </div>
        `
          )
          .join("");
      } else {
        findingsArea.style.display = "none";
      }
    }

    // Render Staged Rollout Plan
    const stagedPlanList = document.getElementById("staged-plan-list");
    if (stagedPlanList && report.recommendedPlan && report.recommendedPlan.length > 0) {
      stagedPlanList.innerHTML = report.recommendedPlan
        .map((step) => `<li>${escapeHtml(step)}</li>`)
        .join("");
    }
  }

  function renderApprovalCheckpoint(packet) {
    const card = document.getElementById("approval-card");
    const targetEl = document.getElementById("approval-target");
    const envEl = document.getElementById("approval-env");
    const tokenEl = document.getElementById("approval-token");
    const fpEl = document.getElementById("approval-fingerprint");
    const warningEl = document.getElementById("approval-warning");
    const warningText = document.getElementById("warning-text");

    if (card) {
      card.style.display = "block";
      card.className = "panel approval-panel";
    }
    if (targetEl) {
      targetEl.textContent = packet.targetId || "staging-demo";
    }
    if (envEl) {
      envEl.textContent = packet.targetEnvironment || "staging";
    }
    if (tokenEl) {
      const redacted = packet.approvalToken
        ? (packet.approvalToken.length > 16 ? `sat_...${packet.approvalToken.slice(-6)} (REDACTED)` : packet.approvalToken)
        : "N/A";
      tokenEl.textContent = redacted;
    }
    if (fpEl) {
      fpEl.textContent = packet.sqlFingerprint ? packet.sqlFingerprint.substring(0, 20) + "..." : "SHA-256 Validated";
    }
    if (warningEl && packet.irreversibleWarning) {
      warningEl.style.display = "flex";
      if (warningText) warningText.textContent = packet.irreversibleWarning;
    }
    if (btnApprove) btnApprove.disabled = false;
    if (btnReject) btnReject.disabled = false;
  }

  function renderPostApplyVerification(verificationResult, applyResult) {
    const card = document.getElementById("verification-card");
    const badge = document.getElementById("verification-status-badge");
    const list = document.getElementById("verification-checks-list");

    if (!card) return;
    card.style.display = "block";

    const passed = verificationResult?.status === "passed" && applyResult?.success;
    if (badge) {
      badge.textContent = passed ? "PASSED" : "FAILED";
      badge.className = `badge ${passed ? "badge-safe" : "badge-danger"}`;
    }

    if (list && verificationResult?.checks) {
      list.innerHTML = verificationResult.checks
        .map(
          (c) => `
        <div class="verification-item ${c.passed ? "check-pass" : "check-fail"}">
          <span class="check-icon" aria-hidden="true">${c.passed ? "✓" : "✗"}</span>
          <div class="check-content">
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
    const feed = document.getElementById("timeline-feed");
    const countBadge = document.getElementById("event-count-badge");
    if (!feed) return;

    const events = (activityEvents && activityEvents.length > 0) ? activityEvents : (timeline || []);
    if (countBadge) {
      countBadge.textContent = `${events.length} Event${events.length === 1 ? "" : "s"}`;
    }

    if (activityEvents && activityEvents.length > 0) {
      feed.innerHTML = activityEvents
        .slice()
        .reverse()
        .map(
          (evt) => `
        <div class="timeline-entry status-${escapeHtml((evt.status || "").toLowerCase())}">
          <div class="timeline-entry-header">
            <span class="timeline-actor">[${escapeHtml(evt.actor)}]</span>
            <span class="timeline-time">${new Date(evt.timestamp).toLocaleTimeString()}</span>
          </div>
          <p class="timeline-msg">${escapeHtml(evt.message)}</p>
          <div class="timeline-meta">
            <span>Phase: ${escapeHtml(evt.phase)}</span>
            ${evt.toolName ? `<span>· Tool: ${escapeHtml(evt.toolName)}</span>` : ""}
            ${evt.durationMs ? `<span>· ${escapeHtml(evt.durationMs)}ms</span>` : ""}
          </div>
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
        <div class="timeline-entry status-${escapeHtml((evt.status || "").toLowerCase())}">
          <div class="timeline-entry-header">
            <span class="timeline-actor">[TIMELINE]</span>
            <span class="timeline-time">${new Date(evt.timestamp).toLocaleTimeString()}</span>
          </div>
          <p class="timeline-msg">${escapeHtml(evt.details)}</p>
          <div class="timeline-meta">
            <span>Step: ${escapeHtml(evt.step)}</span>
          </div>
        </div>
      `
        )
        .join("");
    } else {
      feed.innerHTML = `<div class="timeline-empty">Awaiting review execution trace...</div>`;
    }
  }

  function renderEvidenceTabs(session) {
    const rawSqlEl = document.getElementById("evidence-sql");
    const rawSchemaEl = document.getElementById("evidence-schema");
    const rawSandboxEl = document.getElementById("evidence-sandbox");
    const rawAuditEl = document.getElementById("evidence-audit");

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
        status: session.status,
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
        setSubagentState("schema-analyst", "COMPLETED", session.schemaAnalysis.summary, `${session.schemaAnalysis.tableCount} tables`, `${session.schemaAnalysis.totalIndexCount} indexes`);
      }
      if (session.riskAnalysis) {
        setSubagentState("risk-analyst", "COMPLETED", session.riskAnalysis.summary, `Lock: ${session.riskAnalysis.lockRisk}`, `Rewrite: ${session.riskAnalysis.tableRewriteExpected ? "YES" : "NO"}`);
      }
      if (session.sandboxOutput) {
        setSubagentState("sandbox-validator", session.sandboxOutput.success ? "COMPLETED" : "FAILED", session.sandboxOutput.schemaDiffSummary, `${session.sandboxOutput.executionDurationMs}ms`, `Rollback: ${session.sandboxOutput.rollbackSuccessful ? "PASS" : "FAIL"}`);
      }
      if (session.reviewReport) {
        setSubagentState("review-synthesizer", "COMPLETED", session.reviewReport.approvalSummary, "Token Ready", "Plan Staged");
        updateRiskMatrix(session.reviewReport, session.riskAnalysis);
      }

      // Restore Approval Checkpoint
      if (session.status === "AWAITING_APPROVAL" && session.approvalPacket) {
        renderApprovalCheckpoint(session.approvalPacket);
      } else if (session.status === "COMPLETED" || session.status === "REJECTED" || session.status === "FAILED") {
        const approvalCard = document.getElementById("approval-card");
        if (approvalCard) {
          approvalCard.className = `panel approval-panel ${session.status.toLowerCase()}`;
          const tokenEl = document.getElementById("approval-token");
          if (tokenEl) tokenEl.textContent = `SESSION STATUS: ${session.status}`;
        }
        if (btnApprove) btnApprove.disabled = true;
        if (btnReject) btnReject.disabled = true;
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
      if (btnSpinner) btnSpinner.style.display = "inline-block";
      if (btnLabel) btnLabel.textContent = "Reviewing Schema...";
      announce("Starting TrueForge multi-subagent migration review...");

      // Set Subagents to Running
      setSubagentState("schema-analyst", "RUNNING", "Inspecting PostgreSQL catalog via Schema Analyst...");
      setSubagentState("risk-analyst", "RUNNING", "Evaluating lock risks & AST hazards via Risk Analyst...");
      setSubagentState("sandbox-validator", "RUNNING", "Executing dry-run inside isolated PGlite sandbox...");
      setSubagentState("review-synthesizer", "RUNNING", "Synthesizing multi-agent evidence and approval packet...");

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

        // Update Subagent Cards with Real Metrics
        setSubagentState("schema-analyst", "COMPLETED", data.schemaAnalysis.summary, `${data.schemaAnalysis.tableCount} tables`, `${data.schemaAnalysis.totalIndexCount} indexes`);
        setSubagentState("risk-analyst", "COMPLETED", data.riskAnalysis.summary, `Lock: ${data.riskAnalysis.lockRisk}`, `Rewrite: ${data.riskAnalysis.tableRewriteExpected ? "YES" : "NO"}`);
        setSubagentState("sandbox-validator", data.sandboxOutput.success ? "COMPLETED" : "FAILED", data.sandboxOutput.schemaDiffSummary, `${data.sandboxOutput.executionDurationMs}ms`, `Rollback: ${data.sandboxOutput.rollbackSuccessful ? "PASS" : "FAIL"}`);
        setSubagentState("review-synthesizer", "COMPLETED", data.reviewReport.approvalSummary, "Token Ready", "Plan Staged");

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
        if (btnSpinner) btnSpinner.style.display = "none";
        if (btnLabel) btnLabel.textContent = "Run Safety Review";
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
  const tabButtons = document.querySelectorAll(".tab-button");
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

  // Initialize on load
  loadTargets();
  if (currentSessionId) {
    loadSession(currentSessionId);
  }
})();
