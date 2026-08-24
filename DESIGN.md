# DESIGN.md — SchemaSentinel Visual & Operational Design System

## 1. Design Philosophy

SchemaSentinel is an **engineering mission-control system** designed for DBAs, platform engineers, and software architects. It prioritizes clarity, rapid risk comprehension, and unmistakable control boundaries over decorative consumer-chat aesthetics.

---

## 2. Color Tokens & Semantic States

- **Background Canvas**: Deep Charcoal / Carbon (`#0B0F17`)
- **Panel Surface**: Subtle Glass Card (`#131B2E`, 1px border `#1E293B`)
- **Verified / Safe**: Cyber Emerald (`#10B981`, Accent Glow `#059669`)
- **Caution / Awaiting Approval**: Amber Gold (`#F59E0B`, Pulse `#D97706`)
- **Critical Risk / Blocked**: Crimson Flare (`#EF4444`, Border `#B91C1C`)
- **Diagnostic / Investigation**: Cool Cyan (`#06B6D4`)
- **Typography**: Inter (UI text) + JetBrains Mono (SQL code & diffs)

---

## 3. Core UI Surfaces

### 3.1 Specialized Subagent Activity Grid
Displays 4 dedicated agent cards:
- **Schema Analyst**: Catalog tables, indexes, volume estimates, status badges.
- **Risk Analyst**: Lock severity, table rewrites, identified hazards.
- **Sandbox Validator**: PGlite execution duration, assertion counts, rollback status.
- **Review Synthesizer**: Evidence collation, SHA-256 fingerprint, approval readiness.

### 3.2 Structured Risk Matrix
Presents quantitative metrics:
- **Lock Risk**: `LOW` / `MEDIUM` / `HIGH` / `EXCLUSIVE LOCK (CRITICAL)`
- **Estimated Rows Affected**: e.g., `50,000 rows`
- **Table Rewrite Detected**: `YES` / `NO`
- **Rollback Compatibility**: `PASS` / `FAIL`

### 3.3 The Human Approval Boundary
An explicit, non-bypassable verification card:
- Displays target database name & environment (`staging-demo`).
- Displays SHA-256 plan fingerprint & redacted single-use token.
- Irreversible execution warning banner.
- Offers explicit **[Reject Migration]** and **[Approve & Apply to Staging]** actions.

### 3.4 Post-Apply Verification Invariant Results
Renders live assertion check results after staging execution:
- Catalog schema introspection verification.
- Column structure & normalized datatype checks.
- Index creation checks.
- Application smoke queries (3 queries).
- Unintended table deletion assertions.

### 3.5 Deep Evidence & Audit Explorer
Tabbed explorer displaying raw telemetry:
- Candidate SQL diff.
- Target catalog snapshot.
- PGlite sandbox execution logs.
- Cryptographic migration audit log.
