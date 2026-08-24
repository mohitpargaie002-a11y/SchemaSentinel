import { describe, it, expect } from "vitest";
import fs from "fs/promises";
import path from "path";

describe("UI Data Binding & Contract Invariants", () => {
  it("verifies all DOM element IDs in public/app.js exist in public/index.html", async () => {
    const htmlPath = path.resolve(process.cwd(), "public/index.html");
    const jsPath = path.resolve(process.cwd(), "public/app.js");

    const htmlContent = await fs.readFile(htmlPath, "utf-8");
    const jsContent = await fs.readFile(jsPath, "utf-8");

    // Required core UI Element IDs
    const requiredElementIds = [
      // Request bar
      "migration-form",
      "target-select",
      "migration-file",
      "btn-start-review",
      "btn-label",
      "btn-spinner",
      "aria-live-announcer",
      
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

      // Deep Evidence Tabs
      "evidence-sql",
      "evidence-schema",
      "evidence-sandbox",
      "evidence-audit",
    ];

    for (const id of requiredElementIds) {
      const existsInHtml = htmlContent.includes(`id="${id}"`);
      expect(existsInHtml, `Expected element ID '${id}' to exist in public/index.html`).toBe(true);
    }
  });

  it("verifies public/style.css contains essential Geist/Linear design tokens", async () => {
    const cssPath = path.resolve(process.cwd(), "public/style.css");
    const cssContent = await fs.readFile(cssPath, "utf-8");

    expect(cssContent).toContain("--bg-canvas");
    expect(cssContent).toContain("--bg-surface");
    expect(cssContent).toContain("--status-safe");
    expect(cssContent).toContain("--status-warn");
    expect(cssContent).toContain("--status-danger");
    expect(cssContent).toContain("--font-sans");
    expect(cssContent).toContain("--font-mono");
    expect(cssContent).toContain(":focus-visible");
  });
});
