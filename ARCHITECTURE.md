# ARCHITECTURE.md — SchemaSentinel Architecture

## 1. System Topology & Subagent Roles

```text
                               ┌────────────────────────────────┐
                               │   SchemaSentinel Mission UI    │
                               │  Timeline / Risk / Approval    │
                               └───────────────┬────────────────┘
                                               │ HTTP API / SSE Live Stream
                                               ▼
                                   TrueForge Orchestrator
                                (Persistent & Reconnectable)
                                               │
                ┌───────────────────────────────┼───────────────────────────────┐
                ↓ (Parallelized)                ↓ (Parallelized)                ↓
        SCHEMA ANALYST                     RISK ANALYST                 SANDBOX VALIDATOR
      (Postgres MCP Tool)              (Static AST & Rules)            (PGlite Ephemeral)
      • Read-only Introspection        • Table Rewrite Hazards         • Isolated Execution
      • Index & Key Dependencies       • Lock Severity & Nullability   • Assertion Probes
      • Row Volume Estimates           • Staged Rollout Remediation    • Rollback Verification
                \                               |                               /
                 \                              |                              /
                  └──────────────────► REVIEW SYNTHESIZER ◄────────────────────┘
                                       • Evidence Provenance Ledger
                                       • Cryptographic Checkpoint Token
                                                │
                                     ┌──────────▼──────────┐
                                     │    HUMAN APPROVAL   │
                                     │      CHECKPOINT     │
                                     └──────────┬──────────┘
                                                │
                                      [Resume Same Session]
                                                │ (Single-Use Token)
                                                ▼
                                    Allowlisted Staging Apply
                                                │
                                                ▼
                                     Deterministic Post-Apply
                                      Invariant Verification
```

---

## 2. Core Components & Subagents

### 2.1 Specialized Subagent Architecture
1. **Schema Analyst Subagent (`SchemaAnalystSubagent`)**:
   - **Privilege**: READ-ONLY.
   - **Responsibility**: Introspects target database catalog via PostgreSQL MCP. Identifies affected tables, foreign key trees, index topology, and row counts.
2. **Risk Analyst Subagent (`RiskAnalystSubagent`)**:
   - **Privilege**: READ-ONLY / Analysis.
   - **Responsibility**: Evaluates candidate SQL against locking rules, table rewrites, nullability traps, and concurrency hazards. Generates structured risk findings and 5-phase staged remediations.
3. **Sandbox Validator Subagent (`SandboxValidatorSubagent`)**:
   - **Privilege**: SANDBOX-ONLY (`PGlite`).
   - **Responsibility**: Runs candidate DDL inside an ephemeral in-memory PostgreSQL instance, tests rollback feasibility, asserts constraints, and runs application smoke queries.
4. **Review Synthesizer Subagent (`ReviewSynthesizerSubagent`)**:
   - **Privilege**: NO MUTATION.
   - **Responsibility**: Collates evidence from all subagents into a unified `MigrationReviewReport` with an immutable `evidenceProvenance` list and cryptographically signs the `TrueForgeApprovalPacket`.
5. **TrueForge Orchestrator (`TrueForgeOrchestrator`)**:
   - **Responsibility**: Manages workflow sequencing, orchestrates parallel read-only stages where safe, broadcasts live Server-Sent Events, enforces checkpoint boundaries, restores sessions across client disconnects, coordinates controlled staging apply, and runs deterministic post-apply verifications.

---

## 3. Real-Time Observability & Live Event Stream (SSE)

SchemaSentinel implements real-time Server-Sent Events (SSE) via `SessionEventBroadcaster`:
- **Endpoint**: `GET /api/sessions/:id/events/stream`
- **Stream Events**:
  - `event: open`: Initial connection handshake with session ID and timestamp.
  - `event: activity`: Emitted in real-time as subagents transition between `QUEUED`, `RUNNING`, `COMPLETED`, `WAITING`, `FAILED`, and `BLOCKED`.
  - `event: evidence`: Emitted whenever an immutable `EvidenceItem` is generated with provenance metadata and SHA-256 hash.
  - `event: state`: Session state machine transitions (`RUNNING`, `AWAITING_APPROVAL`, `APPROVED`, `APPLYING`, `VERIFYING`, `COMPLETED`).
  - `event: close`: Stream completion on session finalization.
- **Reconnect & Replay**: When a client reconnects (e.g. browser reload or network interruption), `SessionEventBroadcaster` replays all buffered historical activity and evidence items before streaming live updates.

---

## 4. Evidence Provenance & Integrity Model

Every finding shown to the operator originates from verifiable evidence rather than model hallucination:
- **Typed Model (`EvidenceItem`)**:
  - `evidenceId`: Unique identifier (`evi_<timestamp>_<random>`).
  - `sessionId`: Associated review session.
  - `source`: File path or catalog URI (e.g. `migrations/0038_add_order_status.sql`, `postgres://staging-demo/catalog`, `pglite://sandbox/plan_123`).
  - `sourceType`: `MIGRATION_FILE`, `POSTGRES_SCHEMA`, `POSTGRES_QUERY`, `SANDBOX_EXECUTION`, `RISK_ANALYSIS`, `VERIFICATION_QUERY`, `SYSTEM`.
  - `actor`: Agent role that produced the evidence (`SCHEMA_ANALYST`, `RISK_ANALYST`, `SANDBOX_VALIDATOR`, `ORCHESTRATOR`, `SYSTEM`).
  - `timestamp`: UTC ISO timestamp of capture.
  - `summary`: Human-readable summary of the artifact.
  - `contentHash`: Deterministic SHA-256 hash computed over raw payload.
  - `rawReference`: Sanitized underlying data structure.
  - `confidence`: Numerical score (default `1.0`).

---

## 5. Formal Session State Machine

The session lifecycle is governed by an explicit state machine that strictly fails closed on invalid transitions:

```text
       ┌──────────┐
       │ CREATED  │
       └────┬─────┘
            │
            ▼
       ┌──────────┐
       │ RUNNING  │
       └────┬─────┘
            │
            ▼
     ┌──────────────┐
     │ REVIEW_READY │
     └──────┬───────┘
            │
            ▼
 ┌──────────────────────┐
 │  AWAITING_APPROVAL   │
 └──────────┬───────────┘
            │
      ┌─────┴──────────────┐
      │ (Operator Reject)  │ (Operator Approve)
      ▼                    ▼
┌───────────┐        ┌──────────┐
│ REJECTED  │        │ APPROVED │
└───────────┘        └────┬─────┘
 (Terminal)               │
                          ▼
                     ┌──────────┐
                     │ APPLYING │
                     └────┬─────┘
                          │
                          ▼
                    ┌───────────┐
                    │ VERIFYING │
                    └─────┬─────┘
                          │
          ┌───────────────┴───────────────┐
          │ (All Checks Pass)             │ (Check Failed)
          ▼                               ▼
    ┌───────────┐             ┌──────────────────────┐
    │ COMPLETED │             │ VERIFICATION_FAILED  │
    └───────────┘             └──────────────────────┘
     (Terminal)                      (Terminal)
```

- Invalid jumps (e.g. `AWAITING_APPROVAL → APPLYING`, `REJECTED → APPLYING`, `COMPLETED → APPLYING`) throw `StateTransitionError` and fail closed.
- Completed and rejected historical sessions are marked `isReadOnly: true`.

---

## 6. HTTP Server API Contract

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status and metadata. |
| `GET` | `/api/targets` | Allowlisted database target profiles. |
| `GET` | `/api/sessions` | Persistent session history summaries sorted newest first. |
| `GET` | `/api/sessions/:id` | Full sanitized session state, reports, evidence, and read-only flags. |
| `GET` | `/api/sessions/:id/events` | Historical timeline and activity events. |
| `GET` | `/api/sessions/:id/events/stream` | Server-Sent Events (SSE) live event and evidence stream. |
| `POST` | `/api/sessions` | Create and execute new multi-subagent review session. |
| `POST` | `/api/sessions/:id/approve` | Resume session, authorize staging apply, and verify invariants. |
| `POST` | `/api/sessions/:id/reject` | Resume session with operator rejection (zero mutations). |
