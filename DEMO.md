# DEMO.md — SchemaSentinel Golden Demo Walkthrough

## 3-Minute Live Walkthrough Script

```text
0:00 - 0:20  [REQUEST & SSE STREAM]: 
             • Operator selects target 'staging-demo' and migration '0038_add_order_status.sql'.
             • Web UI connects to live Server-Sent Events (SSE) stream (/api/sessions/:id/events/stream).

0:20 - 0:45  [PARALLEL SUBAGENTS INVESTIGATE]:
             • Schema Analyst & Risk Analyst run parallel catalog introspection & AST analysis.
             • Detects NOT NULL DEFAULT table rewrite hazard (Lock Risk: HIGH, AccessExclusiveLock).

0:45 - 1:15  [PGlite SANDBOX DRY-RUN & PROVENANCE]:
             • Sandbox Validator executes PGlite ephemeral dry-run (assertions pass, rollback pass).
             • Deep Evidence Explorer displays immutable evidence items with SHA-256 hashes.

1:15 - 1:40  [SAFE MIGRATION GENERATION & VISUAL DIFF]:
             • Operator triggers "Generate Safe Remediation".
             • Autonomous engine restructures risky DDL into staged, non-blocking zero-downtime SQL.
             • Renders structured visual diff with line additions/removals and lock elimination metrics.
             • Re-validates staged SQL inside PGlite sandbox.

1:40 - 2:05  [HUMAN APPROVAL CHECKPOINT]:
             • System strictly halts before any mutation on designated targets.
             • Renders Human Approval Card with plan fingerprint and single-use cryptographic token.

2:05 - 2:30  [CONTROLLED STAGING APPLY & VERIFICATION]:
             • Operator approves staging execution (`sat_...`).
             • Applies to allowlisted 'staging-demo' target with post-apply invariant checks.

2:30 - 3:00  [GITHUB PR OPENED FOR QODO REVIEW]:
             • System creates deterministic Git branch (`schemasentinel/migration/<id>`).
             • Commits safe migration file and opens GitHub Pull Request.
             • Sets Qodo status to WAITING_FOR_REVIEW for automated compliance verification.
```

---

## 🛠️ Running the Demo

### Option 1: Authoritative Deterministic CLI Demo
```bash
# 1. Reset demo environment safely (cleans local sessions; never touches production)
npm run demo:reset

# 2. Run authoritative end-to-end demo proof
npm run demo:final
```

### Option 2: Interactive Web UI Console
```bash
npm run serve
```
1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. Click **"Run Safety Review"** to see live subagent telemetry streaming in real time.
3. Click **"Generate Safe Remediation"** to produce non-blocking staged DDL with visual diff and sandbox validation.
4. Click **"Approve & Apply to Staging"** to apply to allowlisted staging with post-apply invariant verification.
5. Click **"Approve & Open GitHub PR"** to create a Git branch and open a Pull Request for automated Qodo review.
6. Click **"History"** in the top navigation to switch between past sessions in read-only mode.
