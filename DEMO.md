# DEMO.md — SchemaSentinel Hackathon Demo Walkthrough

## 3-Minute Live Demo Script

```text
0:00 - 0:20  [REQUEST]: Operator inputs target 'staging-demo' and migration '0038_add_order_status.sql'.
0:20 - 0:45  [SUBAGENTS INVESTIGATE]:
             • Schema Analyst introspects PostgreSQL schema via MCP (3 tables, 14 indexes).
             • Risk Analyst detects NOT NULL DEFAULT table rewrite hazard (Lock Risk: HIGH).
0:45 - 1:15  [SANDBOX DRY-RUN]:
             • Sandbox Validator runs PGlite ephemeral instance, passes 8 assertions & rollback.
1:15 - 1:40  [SYNTHESIS & STAGED PLAN]:
             • Review Synthesizer collates findings and outputs 5-phase staged rollout plan.
1:40 - 2:00  [HUMAN APPROVAL CHECKPOINT]:
             • System strictly halts. UI renders Human Approval Card with SHA-256 fingerprint.
2:00 - 2:20  [SAME-SESSION RESUMPTION & APPLY]:
             • Operator clicks "Approve & Apply". Same session resumes and executes DDL on staging-demo.
2:20 - 2:45  [POST-APPLY VERIFICATION]:
             • System runs 8 live invariant queries and smoke tests. All checks pass.
2:45 - 3:00  [AUDIT TRAIL]:
             • Complete cryptographic event timeline displayed. Zero unapproved mutations.
```

---

## Running the Demo

### Option 1: Interactive Mission Control Web UI
```bash
npm run serve
```
Open [http://localhost:3000](http://localhost:3000) in your browser. Click **"Run Multi-Agent Safety Review"** then **"Approve & Apply to Staging"**.

### Option 2: Automated CLI Proof
```bash
npm run demo:day4
```
