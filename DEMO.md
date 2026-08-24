# DEMO.md — 3-Minute Golden Demo Walkthrough

## Scenario
A developer submits a dangerous migration:
```sql
ALTER TABLE orders ADD COLUMN fulfillment_status VARCHAR(32) NOT NULL DEFAULT 'pending';
CREATE INDEX idx_orders_status ON orders(fulfillment_status);
```

On a high-traffic table with historical records, this naive migration triggers a full table rewrite, blocks concurrent writes via `ACCESS EXCLUSIVE` and `SHARE` locks, and creates unindexed backfill penalties.

---

## 3-Minute Golden Demo Script

1. **Submit Migration Request (0:00 - 0:30)**:
   - User inputs: *"Review and apply migration 0038_add_order_status.sql to staging-demo."*
   - TrueForge initializes session `sess_day3_staging_apply_001`.
   - GitHub MCP retrieves migration file payload.

2. **Schema Inspection & Ephemeral Sandbox Execution (0:30 - 1:15)**:
   - Postgres MCP inspects `staging-demo` PostgreSQL schema (`users`, `orders`, `order_items`).
   - TrueForge executes candidate SQL inside an isolated `PGlite` sandbox with full ecommerce fixtures & seed data.
   - Smoke queries and rollback scripts execute with complete isolation.

3. **Risk Remediation & Staged Plan (1:15 - 1:45)**:
   - Risk Analyzer categorizes risk as `HIGH` (Table Rewrite + Exclusive Lock).
   - Agent synthesizes a safer 5-phase staged migration (Expand → Set Default → Batched Backfill → Constraint → Concurrent Index).

4. **Human Approval Checkpoint & Disconnect Resilience (1:45 - 2:15)**:
   - TrueForge **halts execution** at the human approval gate.
   - Session state is persisted to `FileSessionStore`.
   - Client disconnects; when reconnected, the **identical session** is reconstructed without starting over.
   - Irreversible mutation is strictly blocked until human approval is explicitly granted.

5. **Approved Staging Apply & Deterministic Verification (2:15 - 3:00)**:
   - Human operator approves; the **SAME session** is resumed.
   - Migration is applied to allowlisted `staging-demo` target via Postgres MCP.
   - Single-use approval token is consumed and retired.
   - `PostApplyVerifier` performs live catalog assertions (column types, created indexes, application queries, no unintended drops).
   - Agent writes immutable audit record to `_schemasentinel_migrations` and marks session `COMPLETED`.

---

## Runnable CLI Demo
```bash
npm run demo:day3
```
