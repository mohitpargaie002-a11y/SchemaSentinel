# ARCHITECTURE.md — SchemaSentinel Architecture

## 1. System Topology

```text
                               ┌────────────────────────────────┐
                               │       SchemaSentinel UI        │
                               │  Timeline / Risk / Approval    │
                               └───────────────┬────────────────┘
                                               │
                                       TrueForge Session
                                 (Persistent & Reconnectable)
                                               │
                       ┌───────────────────────▼────────────────────────┐
                       │          TrueForge Agent Harness               │
                       │    (Runtime, Subagents, Context & Memory)      │
                       └───────┬───────────────┬───────────────┬────────┘
                               │               │               │
                        GitHub MCP       Postgres MCP       Sandbox
                               │               │               │
                               ▼               ▼               ▼
                        Repository Context   Readonly DDL     PGlite Ephemeral
                        & PR Drafts          Diagnostics      Execution & Probes
                                               │               │
                                               │        Structured Risk Report
                                               │               │
                                               │     ┌─────────▼──────────┐
                                               │     │   HUMAN APPROVAL   │
                                               │     │     CHECKPOINT     │
                                               │     └─────────┬──────────┘
                                               │               │
                                               │     [Resume Same Session]
                                               │               │
                                               └───────────────┤ (Single-Use Token)
                                                               ▼
                                                      Allowlisted Staging Apply
                                                               │
                                                               ▼
                                                    Deterministic Post-Apply
                                                    Invariant Verification
```

---

## 2. Core Components

### 2.1 TrueForge Agent Harness & Same-Session Resumption
- **Execution Engine**: Orchestrates tool invocations, manages agent contexts, and governs the review lifecycle.
- **Approval Checkpoint**: Hard gate blocking execution until an authenticated human operator signs the migration hash.
- **Same-Session Resume**: When approval is granted, the original TrueForge session (`sessionId`) is resumed directly, transitioning from `AWAITING_HUMAN_APPROVAL` → `APPROVED` → `STAGING_APPLY` → `VERIFICATION` → `COMPLETED`.
- **Session Persistence & Disconnect Recovery**: `FileSessionStore` persists full session state, timelines, risk findings, and approval tokens, surviving client/process disconnects.

### 2.2 MCP Tool Layer
1. **Postgres MCP**:
   - `inspect_schema`: Extracts schema metadata (tables, columns, indexes, foreign keys, row counts).
   - `execute_readonly`: Executes read-only SQL diagnostics with strict parser-level mutation rejection.
   - `apply_migration`: Executes approved SQL against an authorized mutable staging target, verifying and consuming single-use cryptographic tokens.
2. **GitHub MCP**:
   - `read_migration_file`: Reads SQL migration files, commit diffs, and PR metadata.
   - `create_pr_comment`: Posts detailed risk summaries, execution logs, and rollback instructions to the GitHub PR.

### 2.3 Ephemeral Sandbox Runner (`PGlite`)
- Spins up an isolated, in-memory PostgreSQL instance in milliseconds.
- Applies candidate SQL, executes representative queries/mutations, asserts constraint preservation, and verifies rollback behaviors without touching any live database.

### 2.4 Safety, Cryptographic Approval Gate & Target Allowlist
- **Deterministic Checksum**: Signs `SHA256(sessionId + ":" + planId + ":" + targetId + ":" + exact_sql)`.
- **Single-Use Tokens**: Tokens are consumed and retired upon execution, preventing replay attacks.
- **Target Profiles**: Explicit allowlisting distinguishing mutable staging targets (`staging-demo`) from immutable production targets (`prod-postgres`), which strictly fail closed.

### 2.5 Deterministic Post-Apply Verifier
- Executes live catalog introspection after DDL application.
- Verifies added columns, datatypes, constraints, and created indexes.
- Executes representative application smoke queries and confirms no unintended table deletions occurred.
- Logs immutable migration records into `_schemasentinel_migrations`.
