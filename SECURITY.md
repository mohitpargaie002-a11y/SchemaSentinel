# SECURITY.md — SchemaSentinel Threat Model & Security Controls

## 1. Threat Vectors & Mitigations

| Threat | Risk Level | Mitigation Strategy |
| :--- | :--- | :--- |
| **Unauthorized DDL Execution** | CRITICAL | Cryptographic TrueForge approval gate; execution strictly blocked at MCP tool layer without valid signature. |
| **Production Database Mutation** | CRITICAL | Target allowlist profile lock; production targets (`prod-postgres`) are marked immutable and strictly fail-closed. |
| **Token Replay / Double Apply** | HIGH | Single-use approval tokens retired immediately upon successful application (`revokeToken`). |
| **SQL Injection in Readonly Tools** | HIGH | Strict AST/keyword parser rejecting non-`SELECT`/`EXPLAIN` commands in `execute_readonly`. |
| **Connection to Hostile DBs** | HIGH | Target allowlist registry; external/user-provided connection strings are rejected. |
| **Approval Token Tampering** | HIGH | Signed payload `SHA-256(sessionId:planId:targetId:exact_sql)`; invalidates token on any character mismatch. |
| **Credential Exfiltration** | MEDIUM | Redaction of secrets, credentials, and connection strings from agent timelines, logs, and UI states. |
| **Post-Apply Silent Schema Corruption** | HIGH | Deterministic `PostApplyVerifier` asserting column datatypes, constraints, indexes, and smoke queries. |

## 2. Security Boundaries & Invariants
1. **Target Allowlisting**: Only explicitly registered targets with `mutable: true` and `allowedToApply: true` permit approved DDL execution.
2. **Deterministic Checksum**: SHA-256 cryptographic binding across session, plan, target, and exact SQL payload.
3. **Single-Use Tokens**: Every approval token can only be consumed once.
4. **Fail-Closed Stance**: Any failure during verification or apply results in immediate halt without automatic blind retry.
