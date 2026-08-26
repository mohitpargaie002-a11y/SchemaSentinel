import { describe, it, expect } from "vitest";
import fs from "fs/promises";
import path from "path";

describe("UI Data Binding & Visual Contract Tests", () => {
  it("verifies all DOM element IDs in public/app.js exist in public/index.html", async () => {
    const htmlPath = path.resolve(process.cwd(), "public/index.html");
    const jsPath = path.resolve(process.cwd(), "public/app.js");

    const htmlContent = await fs.readFile(htmlPath, "utf-8");
    const jsContent = await fs.readFile(jsPath, "utf-8");

    // Required core UI Element IDs
    const requiredElementIds = [
      // Header & Status
      "aria-live-announcer",
      "live-stream-badge",
      "btn-history-toggle",
      "history-drawer",
      "history-list",
      "history-count-badge",
      "btn-close-history",
      "readonly-banner",
      "readonly-text",
      "btn-exit-readonly",

      // Request bar
      "migration-form",
      "target-select",
      "migration-file",
      "btn-start-review",
      "btn-label",
      "btn-spinner",
      
      // Subagents
      "agent-schema-analyst",
      "status-schema-analyst",
      "desc-schema-analyst",
      "metrics-schema-analyst",

      "agent-risk-analyst",
      "status-risk-analyst",
      "desc-risk-analyst",
      "metrics-risk-analyst",

      "agent-sandbox-validator",
      "status-sandbox-validator",
      "desc-sandbox-validator",
      "metrics-sandbox-validator",

      "agent-review-synthesizer",
      "status-review-synthesizer",
      "desc-review-synthesizer",
      "metrics-review-synthesizer",

      // Risk Matrix
      "overall-risk-badge",
      "val-lock-risk",
      "val-table-rewrite",
      "val-data-integrity",
      "val-sandbox-status",
      "val-rollback-status",
      "val-affected-tables",
      "findings-area",
      "findings-list",

      // Staged Rollout Plan
      "staged-plan-list",

      // Approval Card
      "approval-card",
      "approval-target",
      "approval-env",
      "approval-fingerprint",
      "approval-token",
      "approval-warning",
      "warning-text",
      "btn-reject",
      "btn-approve",

      // Post-Apply Verification
      "verification-card",
      "verification-status-badge",
      "verification-checks-list",

      // Timeline Feed
      "timeline-feed",
      "event-count-badge",

      // Deep Evidence Tabs & Provenance
      "provenance-strip",
      "prov-source",
      "prov-actor",
      "prov-time",
      "prov-hash",
      "evidence-sql",
      "evidence-schema",
      "evidence-risk",
      "evidence-sandbox",
      "evidence-verification",
      "evidence-audit",
    ];

    for (const id of requiredElementIds) {
      const existsInHtml = htmlContent.includes(`id="${id}"`);
      expect(existsInHtml, `Expected element ID '${id}' to exist in public/index.html`).toBe(true);
    }
  });

  it("verifies public/style.css contains the Ink & Paper neutral tokens and typography scale", async () => {
    const cssPath = path.resolve(process.cwd(), "public/style.css");
    const cssContent = await fs.readFile(cssPath, "utf-8");

    // Ink & Paper Palette tokens
    expect(cssContent).toContain("--bg-page: #09090a");
    expect(cssContent).toContain("--bg-surface: #101011");
    expect(cssContent).toContain("--bg-elevated: #171718");
    expect(cssContent).toContain("--border-subtle: #27272a");
    expect(cssContent).toContain("--border-strong: #3f3f46");
    expect(cssContent).toContain("--text-primary: #f5f5f5");
    expect(cssContent).toContain("--text-secondary: #a1a1aa");
    expect(cssContent).toContain("--text-muted: #71717a");
    expect(cssContent).toContain("--action-primary-bg: #f5f5f5");

    // Semantic tokens
    expect(cssContent).toContain("--success: #63b58a");
    expect(cssContent).toContain("--warning: #d6a84f");
    expect(cssContent).toContain("--danger: #e06b6b");
    expect(cssContent).toContain("--info: #a1a1aa");

    // Typography and Focus
    expect(cssContent).toContain("--font-sans");
    expect(cssContent).toContain("--font-mono");
    expect(cssContent).toContain(":focus-visible");
  });

  it("verifies grid alignment, subagent card stretch, and trace height structure in public/style.css", async () => {
    const cssPath = path.resolve(process.cwd(), "public/style.css");
    const cssContent = await fs.readFile(cssPath, "utf-8");

    // Main 2-column grid structure
    expect(cssContent).toContain("grid-template-columns: minmax(0, 1.35fr) minmax(360px, 1fr);");
    expect(cssContent).toContain("align-items: stretch;");

    // Subagent cards equal stretching & bottom-anchored metrics
    expect(cssContent).toContain("grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(cssContent).toContain("margin-top: auto;");

    // Quantitative metrics grid
    expect(cssContent).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");

    // Execution trace filling vertical space
    expect(cssContent).toContain(".timeline-panel {");
    expect(cssContent).toContain("flex: 1;");

    // Responsive breakpoints
    expect(cssContent).toContain("@media (max-width: 1180px)");
    expect(cssContent).toContain("@media (max-width: 768px)");
    expect(cssContent).toContain("@media (max-width: 480px)");
  });
});

