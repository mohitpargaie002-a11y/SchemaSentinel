# ARCHITECTURE.md — SchemaSentinel Architecture

## 1. System Topology

```text
                               ┌────────────────────────────────┐
                               │       SchemaSentinel UI        │
                               │  Timeline / Risk / Approval    │
                               └───────────────┬────────────────┘
                                               │
                                       TrueForge Session
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
                                               └───────────────┤ (Approved Token)
                                                               ▼
                                                      Approved Apply & Verify
```

---

## 2. Core Components

### 2.1 TrueForge Agent Harness
- **Execution Engine**: Orchestrates tool invocations, manages subagent contexts, and controls agent lifecycle.
- **Approval Checkpoint**: Hard gate blocking execution until an authenticated human operator signs the migration hash.
- **Session State**: Persists agent timeline and migration artifacts across browser disconnections and reconnections.

### 2.2 MCP Tool Layer
1. **Postgres MCP**:
   - `inspect_schema`: Extracts schema metadata (tables, columns, indexes, foreign keys, row counts).
   - `execute_readonly`: Executes read-only SQL diagnostics with strict parser-level mutation rejection.
   - `apply_migration`: Executes approved SQL against an authorized target, verifying the cryptographic approval token.
2. **GitHub MCP**:
   - `read_migration_context`: Reads SQL migration files, commit diffs, and PR discussions.
   - `create_pr_comment`: Posts detailed risk summaries, execution logs, and rollback instructions to the GitHub PR.

### 2.3 Ephemeral Sandbox Runner (`PGlite`)
- Spins up an isolated, in-memory PostgreSQL instance in milliseconds.
- Applies candidate SQL, executes representative queries/mutations, asserts constraint preservation, and verifies rollback behaviors without touching any live database.

### 2.4 Safety & Cryptographic Approval Gate
- Signs `SHA256(sessionId + planId + targetId + exact_sql)`.
- Rejects any mismatch or tampered payload with `SafetyViolationError`.
