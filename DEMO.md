# DEMO.md — SchemaSentinel Hackathon Demo Walkthrough

## 3-Minute Live Demo Script

```text
0:00 - 0:20  [REQUEST & STREAM]: 
             • Operator selects target 'staging-demo' and migration '0038_add_order_status.sql'.
             • Web UI connects to live Server-Sent Events (SSE) stream (/api/sessions/:id/events/stream).

0:20 - 0:45  [PARALLEL SUBAGENTS INVESTIGATE]:
             • Schema Analyst & Risk Analyst run parallel AST & catalog introspection.
             • Detects NOT NULL DEFAULT table rewrite hazard (Lock Risk: HIGH).

0:45 - 1:15  [SANDBOX DRY-RUN & PROVENANCE]:
             • Sandbox Validator executes PGlite ephemeral dry-run (assertions pass, rollback pass).
             • Deep Evidence Explorer displays immutable evidence items with SHA-256 hashes.

1:15 - 1:40  [SYNTHESIS & STAGED REMEDIATION]:
             • Review Synthesizer collates multi-subagent findings into a 5-phase zero-downtime plan.

1:40 - 2:00  [HUMAN APPROVAL CHECKPOINT]:
             • System strictly halts before any database mutation.
             • Renders Human Approval Card with plan fingerprint and single-use token.

2:00 - 2:20  [SAME-SESSION RESUMPTION & STAGING APPLY]:
             • Operator clicks "Approve & Apply". Same logical session resumes and applies DDL to allowlisted staging.

2:20 - 2:45  [POST-APPLY VERIFICATION]:
             • System runs 8 live invariant queries and smoke tests. All pass deterministically.

2:45 - 3:00  [SESSION HISTORY & SWITCHING]:
             • Session History drawer displays previous runs in read-only mode for auditable compliance.
```

---

## Running the Demo

### Option 1: Interactive Mission Control Web UI
```bash
npm run serve
```
Open [http://localhost:3000](http://localhost:3000) in your browser.
1. Click **"Run Safety Review"** to see live subagent telemetry streaming in real time.
2. Inspect **"Deep Evidence & Audit Explorer"** tabs for SHA-256 evidence provenance.
3. Click **"Approve & Apply to Staging"** to resume the session and apply to staging.
4. Click **"History"** in the top navigation to switch between past sessions in read-only mode.

### Option 2: Automated End-to-End CLI Proof
```bash
npm run demo:day5
```
