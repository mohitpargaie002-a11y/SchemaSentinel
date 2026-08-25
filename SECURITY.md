# SECURITY.md — SchemaSentinel Threat Model & Security Controls

## 1. Threat Vectors & Mitigation Matrix

| Threat | Risk Level | Mitigation Strategy |
| :--- | :--- | :--- |
| **Unauthorized DDL Execution** | CRITICAL | Cryptographic TrueForge approval gate; execution strictly blocked at orchestrator and MCP tool layers without valid signature. |
| **Production Database Mutation** | CRITICAL | Target allowlist profile lock; production targets (`prod-postgres`) are marked immutable and strictly fail-closed (`TargetImmutableError`). |
| **Token Replay / Double Apply** | HIGH | Single-use approval tokens retired immediately upon durable application (`revokeToken`). |
| **SQL Injection in Readonly Tools** | HIGH | Strict AST and keyword parser rejecting non-`SELECT`/`EXPLAIN` commands in `execute_readonly`. |
| **Connection to Hostile DBs** | HIGH | Strict Target Registry allowlist; external or user-provided connection strings are rejected (`TargetNotAllowedError`). |
| **Approval Token Tampering** | HIGH | Signed payload `SHA-256(sessionId:planId:targetId:exact_sql)`; invalidates token on any byte mismatch. |
| **Credential Exfiltration** | MEDIUM | Redaction of passwords, tokens, and connection strings from agent timelines, logs, and UI states. |
| **Post-Apply Silent Schema Corruption** | HIGH | Deterministic `PostApplyVerifier` asserting column datatypes, constraints, indexes, and smoke query execution. |
| **Large-Table Unbatched Backfill Lockout** | HIGH | Safe Migration Generator decomposes NOT NULL column additions into staged non-blocking steps with explicit batching caveats. |

---

## 2. Security Boundaries & Hard Invariants

1. **Target Allowlisting**: Only explicitly registered targets with `mutable: true` and `allowedToApply: true` permit approved DDL execution.
2. **Deterministic Checksums**: Cryptographic binding `SHA-256(sessionId + planId + targetId + exact_sql)`. Swapping SQL, targets, or session IDs causes immediate verification failure.
3. **Single-Use Tokens**: Every approval token is consumed once upon successful durable execution. Transient errors preserve the token for retry.
4. **State Persistence**: Checkpoints are durably stored in session state (`approvalCheckpoint`) so server restarts maintain security invariants without raw secret exposure.
5. **Fail-Closed Stance**: Any failure during verification, dry-run, or application triggers an immediate halt without blind automated retries.

---

## 3. PGlite Sandbox Semantics & Limitations

- **Capabilities**:
  - Ephemeral WASM PostgreSQL execution in complete process isolation.
  - Verifies SQL syntax, DDL execution order, foreign keys, constraints, and deterministic rollback behavior.
- **Explicit Limitations**:
  - Does **not** simulate production table volume (>1M rows).
  - Does **not** simulate real-world lock contention under high concurrent transactional load.
  - Does **not** measure replication lag.
- **Operational Standard**:
  - All high-risk operations rely on **Sandbox Validation + Static Risk Analysis + Staged Zero-Downtime Restructuring + Human Operator Signoff**.
