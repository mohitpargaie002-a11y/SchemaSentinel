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

### 3.1 Agent Execution Timeline
Displays step-by-step progress with explicit statuses:
`Queued` → `Inspecting Schema` → `Sandbox Dry-Run` → `Risk Analysis` → **`Awaiting Approval`** → `Applying Migration` → `Verified`.

### 3.2 Structured Risk Matrix
Presents quantitative metrics:
- **Lock Risk**: `LOW` / `MEDIUM` / `HIGH` / `EXCLUSIVE LOCK (CRITICAL)`
- **Estimated Rows Affected**: e.g., `2.4M rows`
- **Table Rewrite Detected**: `YES` / `NO`
- **Rollback Compatibility**: `PASS` / `FAIL`

### 3.3 The Human Approval Boundary
An explicit, non-bypassable verification card:
- Displays target database name & environment
- Shows exact SQL diff with syntax highlighting
- Displays SHA-256 plan fingerprint
- Offers explicit **[Reject]** and **[Approve & Apply (Irreversible)]** actions
