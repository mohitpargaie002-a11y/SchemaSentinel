# DESIGN.md — SchemaSentinel Visual & Operational Design System

## 1. Visual Philosophy & Design Direction

SchemaSentinel is a **premium database reliability & safety product** designed for Staff DBAs, Lead Platform Engineers, and Software Architects.

It is inspired by the design principles of **Vercel Geist**, **Linear**, and **Apple Human Interface Guidelines**:
- **Hierarchy Over Decoration**: Risk, candidate SQL, and safety assertions dominate; decorative chrome and glowing cards are eliminated.
- **Calm, Restrained Palette**: Deep obsidian surfaces, subtle borders, and intentional semantic colors (emerald for verified/safe, amber for human approval checkpoints, crimson for high-risk table rewrites, and sky-cyan for diagnostics).
- **Crisp Typography**: High-legibility modern sans-serif (`Inter`) paired with clean monospace (`JetBrains Mono`) for SQL statements, row counts, and cryptographic hashes.
- **Information-Dense but Uncluttered**: Compact spacing on a 4px scale, subtle elevation, and structured tabular data layouts.
- **Subtle Motion**: 120–180ms ease-out transitions for state changes without bouncy or theatrical animations.

---

## 2. Design Tokens

### 2.1 Color Tokens
```css
:root {
  /* Canvas & Neutral Surfaces */
  --bg-canvas: #090d14;
  --bg-surface: #101726;
  --bg-surface-elevated: #162033;
  --bg-surface-hover: #1c2840;
  --bg-input: #0c1220;

  /* Borders & Dividers */
  --border-subtle: #1e293b;
  --border-muted: #2d3b55;
  --border-focus: #3b82f6;

  /* Text & Content */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-inverse: #090d14;

  /* Semantic State Colors */
  --status-safe: #10b981;
  --status-safe-bg: rgba(16, 185, 129, 0.12);
  --status-safe-border: rgba(16, 185, 129, 0.28);

  --status-warn: #f59e0b;
  --status-warn-bg: rgba(245, 158, 11, 0.12);
  --status-warn-border: rgba(245, 158, 11, 0.28);

  --status-danger: #ef4444;
  --status-danger-bg: rgba(239, 68, 68, 0.12);
  --status-danger-border: rgba(239, 68, 68, 0.28);

  --status-info: #0ea5e9;
  --status-info-bg: rgba(14, 165, 233, 0.12);
  --status-info-border: rgba(14, 165, 233, 0.28);

  /* Elevation & Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.35);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.6);

  /* Radii */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace;

  /* Transitions */
  --transition-fast: 120ms cubic-bezier(0.16, 1, 0.3, 1);
  --transition-normal: 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## 3. Core UI Surfaces

### 3.1 Global Header & Target Bar
- Sticky, compact 56px header.
- Product moniker: **`SchemaSentinel`** with subtle version tag and status pill.
- Allowlisted target selector dropdown with inline environment indicator (`[Mutable Staging]` vs `[Read-Only Prod]`).

### 3.2 Subagent Execution Strip
Compact horizontal subagent status grid displaying real-time execution telemetry:
- **Schema Analyst**: Catalog tables, indexes, volume estimates, status badges (`IDLE`, `RUNNING`, `COMPLETED`).
- **Risk Analyst**: Lock risk severity, table rewrite hazards, AST analysis duration.
- **Sandbox Validator**: Ephemeral PGlite dry-run execution duration, assertion count, rollback status.
- **Review Synthesizer**: Evidence collation, SHA-256 fingerprint, approval token readiness.

### 3.3 Quantitative Risk Matrix & Staged Rollout Plan
- **Risk Matrix**: Metric grid showing Lock Severity, Table Rewrite, Data Integrity, Sandbox, Rollback, and Affected Objects.
- **Staged Rollout Plan**: Progressive 5-phase zero-downtime execution checklist dynamically derived from backend analysis.

### 3.4 The Human Approval Boundary (Primary Focal Point)
The centerpiece of the review interface:
- **What will change?**: Migration summary & affected tables.
- **Where?**: Allowlisted target database & environment.
- **Is it safe?**: Overall risk rating, lock hazard rating, and sandbox status.
- **What am I approving?**: Cryptographic SHA-256 fingerprint & redacted token (`sat_...XXXXXX (REDACTED)`).
- **Actions**: Explicit **[Reject Migration]** and **[Approve & Apply to Staging]** buttons with confirmation gates.

### 3.5 Post-Apply Invariant Verification Matrix
Post-apply assertion dashboard rendering individual check results:
- Catalog schema introspection verification.
- Column structure & normalized datatype checks.
- Index creation checks.
- Application smoke query assertions (rows returned, timing).
- Unintended table deletion assertions.

### 3.6 Execution Trace Timeline (Feed)
A real-time, chronological execution trace showing:
- Subagent / actor attribution badge (`[SCHEMA_ANALYST]`, `[RISK_ANALYST]`, `[SANDBOX_VALIDATOR]`, `[REVIEW_SYNTHESIZER]`, `[ORCHESTRATOR]`, `[HUMAN]`).
- Phase, timestamp, duration, tool name, and formatted message.

### 3.7 Deep Evidence & Audit Explorer (Tabbed)
Tabbed interface for low-level inspection:
- **Migration SQL**: Formatted candidate DDL.
- **Target Schema**: Introspected database catalog JSON.
- **Sandbox Logs**: Ephemeral PGlite dry-run execution results & assertions.
- **Audit Trail**: Cryptographic session event ledger with timestamps and SHA-256 checksums.

---

## 4. State Management & DOM Binding Contract

| Component | HTML Element ID | JavaScript Selector | Data Binding Source |
|---|---|---|---|
| Target Selector | `target-select` | `document.getElementById("target-select")` | `GET /api/targets` |
| Migration File Input | `migration-file` | `document.getElementById("migration-file")` | User input / Default fixture |
| Review Trigger Button | `btn-start-review` | `document.getElementById("btn-start-review")` | Form submission |
| Schema Analyst Card | `agent-schema-analyst` | `document.getElementById("agent-schema-analyst")` | `session.schemaAnalysis` |
| Risk Analyst Card | `agent-risk-analyst` | `document.getElementById("agent-risk-analyst")` | `session.riskAnalysis` |
| Sandbox Validator Card | `agent-sandbox-validator` | `document.getElementById("agent-sandbox-validator")` | `session.sandboxOutput` |
| Review Synthesizer Card | `agent-review-synthesizer` | `document.getElementById("agent-review-synthesizer")` | `session.reviewReport` |
| Risk Matrix Badges | `val-lock-risk`, `val-table-rewrite`, etc. | `document.getElementById("val-...")` | `session.reviewReport` |
| Staged Plan List | `staged-plan-list` | `document.getElementById("staged-plan-list")` | `session.reviewReport.recommendedPlan` |
| Approval Card | `approval-card` | `document.getElementById("approval-card")` | `session.approvalPacket` |
| Approval Target | `approval-target` | `document.getElementById("approval-target")` | `session.approvalPacket.targetId` |
| Approval Token | `approval-token` | `document.getElementById("approval-token")` | `session.approvalPacket.approvalToken` |
| Approval Checksum | `approval-fingerprint` | `document.getElementById("approval-fingerprint")` | `session.approvalPacket.sqlFingerprint` |
| Approve Button | `btn-approve` | `document.getElementById("btn-approve")` | `POST /api/sessions/:id/approve` |
| Reject Button | `btn-reject` | `document.getElementById("btn-reject")` | `POST /api/sessions/:id/reject` |
| Verification Card | `verification-card` | `document.getElementById("verification-card")` | `session.verificationResult` |
| Verification Status Badge | `verification-status-badge`| `document.getElementById("verification-status-badge")`| `session.verificationResult.status` |
| Verification Checks List | `verification-checks-list`| `document.getElementById("verification-checks-list")` | `session.verificationResult.checks` |
| Timeline Feed | `timeline-feed` | `document.getElementById("timeline-feed")` | `session.activityEvents` / `session.timeline` |
| Evidence SQL View | `evidence-sql` | `document.getElementById("evidence-sql")` | `session.plan.rawSql` |
| Evidence Schema View | `evidence-schema` | `document.getElementById("evidence-schema")` | `session.schemaSnapshot` |
| Evidence Sandbox View | `evidence-sandbox` | `document.getElementById("evidence-sandbox")` | `session.sandboxOutput` |
| Evidence Audit View | `evidence-audit` | `document.getElementById("evidence-audit")` | Session audit record |

---

## 5. Responsive & Accessibility Invariants

1. **Accessibility (`a11y`)**:
   - `aria-live="polite"` element `#aria-live-announcer` broadcasts major state transitions.
   - All interactive controls have distinct `:focus-visible` outlines.
   - Contrast ratio exceeds WCAG 2.1 AA standards (minimum 4.5:1 for body, 3:1 for large text).
   - Semantic HTML5 elements (`<header>`, `<main>`, `<section>`, `<article>`, `<nav>`, `<footer>`) with explicit `aria-labelledby` linkages.
2. **Responsive Breakpoints**:
   - Desktop: `1200px+` (Two-column layout: Risk & Staged Plan left, Approval & Timeline right).
   - Tablet: `768px - 1199px` (Stacked single-column layout with preserved component hierarchy).
   - Mobile: `< 768px` (Fluid cards, wrapped form controls, full-width buttons).
