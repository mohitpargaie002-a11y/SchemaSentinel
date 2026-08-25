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

2:00 - 2:20  [SAFE MIGRATION GENERATION & VISUAL DIFF]:
             • Operator clicks "Generate Safe Remediation".
             • Autonomous engine generates zero-lock staged DDL and validates it in PGlite sandbox.
             • Renders structured visual diff with line additions/removals and lock elimination metrics.

2:20 - 2:40  [OPERATOR APPROVAL & GITHUB PR OPENED]:
             • Operator approves safe proposal.
             • System creates deterministic Git branch (`schemasentinel/migration/<id>`), commits remediated migration file, and opens GitHub Pull Request.
             • PR contains full audit report and awaits automated review by Qodo.

2:40 - 3:00  [SAME-SESSION RESUMPTION OR AUDIT RETRIEVAL]:
             • Operator can also apply to staging or browse session history in read-only mode for auditable compliance.
```

---

## Running the Demo

### Option 1: Interactive Mission Control Web UI
```bash
npm run serve
```
Open [http://localhost:3000](http://localhost:3000) in your browser.
1. Click **"Run Safety Review"** to see live subagent telemetry streaming in real time.
2. Click **"Generate Safe Remediation"** to produce non-blocking staged DDL with visual diff and sandbox validation.
3. Click **"Approve & Open GitHub PR"** to create a Git branch and open a Pull Request for automated Qodo review.
4. Click **"History"** in the top navigation to switch between past sessions in read-only mode.

### Option 2: Automated End-to-End CLI Proofs
```bash
# Day 6 Safe Migration & GitHub PR Proof
npm run demo:day6

# Day 5 Live Observability & Provenance Proof
npm run demo:day5
```

