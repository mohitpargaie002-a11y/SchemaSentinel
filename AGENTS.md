# AGENTS.md — SchemaSentinel Governance & Operating Rules

This file defines non-negotiable operational boundaries, safety rules, and coding standards for all AI agents contributing to or running within the SchemaSentinel repository.

---

## 1. Safety Boundaries & Hard Invariants

1. **Explicit Human Approval Before Mutation**:
   - The agent may explore schemas, generate migrations, execute sandbox dry-runs, calculate risks, and generate test assertions autonomously.
   - **Zero mutation** (DDL/DML like `ALTER TABLE`, `DROP`, `TRUNCATE`, `UPDATE`, `INSERT`, `CREATE INDEX`) is permitted on any designated target database without an explicit, valid TrueForge human approval checkpoint token.

2. **Tamper-Evident Approval Checksums**:
   - The approval token is cryptographically bound: `SHA-256(sessionId + planId + targetId + exact_sql)`.
   - Any modification to the SQL, session, or target invalidates the token immediately.

3. **Strict Target Allowlisting**:
   - Connections to arbitrary or user-supplied external database URLs are strictly prohibited.
   - All operations are bound to pre-registered, known target configurations (e.g. `demo-postgres`, `staging-demo`).

4. **Zero Production Secrets in Repo or Logs**:
   - No API keys, database connection strings, or credentials may be logged, stored in Git, or displayed in the UI.
   - All secret values must be loaded from `.env` and masked in logs/traces.

---

## 2. Coding Standards

- **Language & Runtime**: Strict TypeScript (`strict: true`, `NodeNext` modules).
- **Zero `any`**: Type contracts must be fully specified using TypeScript types and validated with `zod`.
- **Error Handling**: Custom error classes inheriting from `SentinelError` (`SafetyViolationError`, `ApprovalRequiredError`, `TargetNotFoundError`). Never swallow exceptions silently.
- **Modularity**: MCP tools, agent orchestration, safety checks, and sandbox runners must remain decoupled with clean interface contracts.

---

## 3. Development Workflow & Git Rules

- **Branch Naming**: `feat/<feature-name>`, `fix/<fix-name>`, `chore/<chore-name>`.
- **Commit Format**: Conventional Commits (`feat(mcp): ...`, `fix(sandbox): ...`, `chore(repo): ...`).
- **Review Trail**: Every pull request must pass test suites, typechecks, and review by **Qodo** before merge.

---

## 4. Subagent Roles & Separation of Concerns

- **Schema Analyst**: Focuses exclusively on schema introspection, relationships, constraints, and dependency trees.
- **Migration Risk Analyst**: Evaluates table locking, backfill costs, nullability traps, and concurrency risks.
- **Sandbox Validator**: Executes migrations inside ephemeral sandboxes (`PGlite`) and runs integrity assertions.
- **Review Synthesizer**: Collates subagent findings into a clear, unified risk report and approval packet for the operator.
