# ARCHITECTURE.md — SchemaSentinel Architecture

## 1. System Topology & Subagent Roles

```text
                               ┌────────────────────────────────┐
                               │   SchemaSentinel Mission UI    │
                               │  Timeline / Risk / Approval    │
                               └───────────────┬────────────────┘
                                               │ HTTP API / Events
                                               ▼
                                   TrueForge Orchestrator
                               (Persistent & Reconnectable)
                                               │
               ┌───────────────────────────────┼───────────────────────────────┐
               ↓                               ↓                               ↓
       SCHEMA ANALYST                     RISK ANALYST                 SANDBOX VALIDATOR
     (Postgres MCP Tool)              (Static AST & Rules)            (PGlite Ephemeral)
     • Read-only Introspection        • Table Rewrite Hazards         • Isolated Execution
     • Index & Key Dependencies       • Lock Severity & Nullability   • Assertion Probes
     • Row Volume Estimates           • Staged Rollout Remediation    • Rollback Verification
               \                               |                               /
                \                              |                              /
                 └──────────────────► REVIEW SYNTHESIZER ◄────────────────────┘
                                      • Evidence Collation
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

## 2. Core Components

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
   - **Responsibility**: Collates evidence from all subagents into a unified `MigrationReviewReport` and cryptographically signs the `TrueForgeApprovalPacket`.
5. **TrueForge Orchestrator (`TrueForgeOrchestrator`)**:
   - **Responsibility**: Manages workflow sequencing, emits typed `AgentActivityEvent`s, enforces checkpoint boundaries, restores sessions across client disconnects, coordinates controlled staging apply, and runs deterministic post-apply verifications.

### 2.2 Event & Observability Model
- Every step produces a typed `AgentActivityEvent` (`actor`, `status`, `phase`, `message`, `evidence`, `durationMs`).
- Supported actors: `ORCHESTRATOR`, `SCHEMA_ANALYST`, `RISK_ANALYST`, `SANDBOX_VALIDATOR`, `REVIEW_SYNTHESIZER`, `SYSTEM`, `HUMAN`.
- Events are persisted atomically with the session state in `FileSessionStore`.

### 2.3 HTTP Server & Web API Boundary
- **`GET /api/health`**: Healthcheck and system status.
- **`GET /api/targets`**: Allowlisted database targets (`staging-demo`, `demo-postgres`, `prod-postgres`).
- **`GET /api/sessions`**: Session history and summaries.
- **`GET /api/sessions/:id`**: Full persisted session state, subagent outputs, and reports.
- **`GET /api/sessions/:id/events`**: Live timeline and activity event stream.
- **`POST /api/sessions`**: Trigger multi-subagent autonomous migration review.
- **`POST /api/sessions/:id/approve`**: Resume same session with cryptographic token and apply to staging.
- **`POST /api/sessions/:id/reject`**: Resume same session with rejection, recording zero mutations.

### 2.4 Safety & Cryptographic Boundary
- **Fingerprinting**: `SHA-256(sessionId + ":" + planId + ":" + targetId + ":" + exact_sql)`.
- **Single-Use Consumption**: Tokens are revoked immediately upon verification before DDL execution to prevent replay attacks.
- **Target Allowlisting**: Immutable production databases (`prod-postgres`) strictly fail closed.
