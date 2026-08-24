# SECURITY.md — SchemaSentinel Threat Model & Security Controls

## 1. Threat Vectors & Mitigations

| Threat | Risk Level | Mitigation Strategy |
| :--- | :--- | :--- |
| **Unauthorized DDL Execution** | CRITICAL | Cryptographic TrueForge approval gate; blocked at MCP tool layer without valid signature. |
| **SQL Injection in Readonly Tools** | HIGH | Strict AST/keyword parser rejecting non-`SELECT`/`EXPLAIN` commands in `execute_readonly`. |
| **Connection to Hostile DBs** | HIGH | Target allowlist registry; external/user-provided connection strings are rejected. |
| **Approval Token Tampering** | HIGH | Signed payload `SHA-256(sessionId + planId + targetId + sql)`; fails on any byte change. |
| **Credential Exfiltration** | MEDIUM | Automatic redaction of secrets and URIs from agent logs, traces, and UI payloads. |
| **Double-Apply On Reconnect** | HIGH | Idempotency locks and applied-state verification on session resumption. |
