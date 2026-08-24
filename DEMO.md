# DEMO.md — 3-Minute Golden Demo Walkthrough

## Scenario
A developer submits a dangerous migration:
```sql
ALTER TABLE orders ADD COLUMN fulfillment_status VARCHAR(32) NOT NULL DEFAULT 'pending';
CREATE INDEX idx_orders_status ON orders(fulfillment_status);
```

On a high-traffic table with millions of rows, this naive migration acquires an `ACCESS EXCLUSIVE` lock and rewrites the table.

---

## 3-Minute Script

1. **Submit Request (0:00 - 0:30)**:
   - User inputs natural language request or candidate SQL.
   - TrueForge initializes session and tasks the Schema Analyst subagent.

2. **Schema Inspection & Sandbox Validation (0:30 - 1:15)**:
   - Postgres MCP inspects `orders` table structure, row counts, and existing indexes.
   - TrueForge executes candidate SQL in an isolated `PGlite` sandbox.
   - Sandbox checks uncover high table-lock latency and unindexed backfill penalties.

3. **Risk Remediation & Staged Plan (1:15 - 1:45)**:
   - Risk Analyst categorizes risk as `HIGH` (Table Rewrite + Exclusive Lock).
   - Agent synthesizes a safer staged migration (`ADD COLUMN` without default → backfill in batches → `CREATE INDEX CONCURRENTLY` → add `NOT NULL` constraint).

4. **Human Approval Checkpoint (1:45 - 2:15)**:
   - TrueForge **halts execution** at the human approval gate.
   - Shows risk card, diff, and cryptographic SHA-256 fingerprint.
   - Irreversible apply is strictly blocked until the operator clicks **[Approve & Apply]**.

5. **Approved Apply & Verification (2:15 - 3:00)**:
   - Approved SQL is applied to the authorized target.
   - Post-apply smoke tests verify schema invariants and application queries.
   - Agent outputs audit certificate and updates GitHub PR.
