# SchemaSentinel 🛡️

> **Let the agent test the migration before you trust the migration.**

SchemaSentinel is an approval-gated AI agent harness built on **TrueForge** that investigates database schemas, simulates candidate DDL changes inside an isolated sandbox, detects destructive locking and regression risks, pauses for explicit human authorization, transforms risky migrations into zero-downtime staged SQL, and opens verified GitHub Pull Requests for automated review by **Qodo**.

Built for **The Agent Harness Hackathon 2026** (WeMakeDevs × TrueFoundry).

---

## 🎯 What, Why, and How

### What is SchemaSentinel?
SchemaSentinel is an autonomous database migration safety harness that acts as a deterministic firewall between AI-generated or developer-submitted schema changes and target databases.

### Why do we need it?
- **Destructive Locks**: A single unbatched `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT` or unindexed foreign key can acquire an `AccessExclusiveLock`, blocking all reads and writes and bringing down production.
- **Silent Regressions**: Table rewrites and schema drift lead to catastrophic rollback failures.
- **Uncontrolled Agents**: LLM agents must **never** possess unsupervised mutation access to production databases.

### How does SchemaSentinel solve it?
1. **Introspects**: Reads schema catalogs without taking locks via PostgreSQL MCP.
2. **Analyzes**: Static risk engine and specialized subagents evaluate locking hazards, backfill costs, and constraint traps.
3. **Simulates**: Executes candidate DDL in an isolated ephemeral PGlite WASM sandbox with rollback verification.
4. **Remediates**: Autonomously restructures risky DDL into staged, non-blocking zero-downtime SQL steps.
5. **Gates**: Cryptographically halts execution at non-bypassable human approval checkpoints (`SHA-256(sessionId + planId + targetId + sql)`).
6. **Applies & Verifies**: Executes allowlisted staging migrations and performs deterministic post-apply invariant checks.
7. **Collaborates**: Creates GitHub branches, commits safe migrations, and opens Pull Requests for automated **Qodo** code reviews.

---

## 🌟 Key Architecture & Capabilities

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 TrueForge Orchestrator                  │
                  └────────┬───────────┬─────────────┬────────────┬─────────┘
                           │           │             │            │
            ┌──────────────▼───┐ ┌─────▼───────┐ ┌───▼────────┐ ┌─▼───────────────┐
            │  Schema Analyst  │ │Risk Analyst │ │Sandbox Val.│ │Review Synthesizer│
            └──────────────┬───┘ └─────┬───────┘ └───┬────────┘ └─┬───────────────┘
                           │           │             │            │
    PostgreSQL MCP ◄───────┘           │             │            │
    Static Risk Engine ◄───────────────┘             │            │
    PGlite Ephemeral Sandbox ◄───────────────────────┘            │
    Cryptographic Approval Gate (sat_safe_...) ◄──────────────────┘
                           │
            ┌──────────────▼────────────────────────────────┐
            │        Safe Migration Generator               │
            │  • Zero-lock staged DDL transformation       │
            │  • Line-by-line structured diff viewer        │
            │  • Operational backfill safety caveats        │
            └──────────────┬────────────────────────────────┘
                           │
    GitHub MCP ◄───────────┴───────────────────────────────┐
    • Branch: schemasentinel/migration/<session-id>        │
    • Commit safe migration file                           │
    • Open Pull Request ➔ Automated Qodo PR Review Gate    │
```

---

## 🔒 Production Safety & Sandbox Semantics

### Hard Security Boundaries
1. **Target Allowlisting**: Only designated staging targets (`staging-demo`) permit controlled mutation. Production targets (`prod-postgres`) are **strictly blocked** in code.
2. **Cryptographic Approval Binding**: Approval tokens are bound to the exact SQL fingerprint. Tampering with SQL or swapping target database IDs invalidates the token immediately.
3. **Single-Use Tokens**: Every approval token is consumed upon durable application to prevent replay attacks.
4. **Zero Production Secrets in Git/Logs**: Connection strings and credentials are sanitized and masked.

### Honest Sandbox Limitations
- **What PGlite Sandbox Proves**: SQL syntax correctness, schema end-state, table constraint invariants, representative query execution, and rollback cleanliness.
- **What Sandbox Does NOT Prove**: High-volume production lock contention, multi-gigabyte table rewrite duration, or live replication lag.
- **Operational Rule**: High-volume tables (>100k rows) require staged DDL restructuring **plus** static risk evaluation and human operator approval.

---

## 🚀 Quick Start & Deterministic Demo

### Prerequisites
- Node.js >= 20.x
- npm >= 10.x

### 1. Installation
```bash
git clone https://github.com/mohitpargaie002-a11y/SchemaSentinel.git
cd SchemaSentinel
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

### 3. Run Quality Gates & Tests
```bash
npm test         # 100% passing across 27 test files / 97 tests
npm run typecheck # 0 errors (strict TypeScript)
npm run lint      # 0 errors
npm run build     # Clean compile
```

### 4. Interactive Web UI
```bash
npm run serve
```
Open `http://localhost:3000` to interact with the "Ink & Paper" operations console.

### 5. Deterministic Golden Demo
```bash
# Run authoritative end-to-end proof (Review -> Safe Remediation -> Staging Apply -> GitHub PR -> Qodo Gate)
npm run demo:final

# Safe demo environment reset
npm run demo:reset
```

---

## 📚 Repository Map & Documentation
- [AGENTS.md](./AGENTS.md) — Agent governance and safety rules
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Multi-agent system topology & state machine
- [DESIGN.md](./DESIGN.md) — Ink & Paper UI system specification
- [SECURITY.md](./SECURITY.md) — Threat model, security controls, & target allowlisting
- [DEMO.md](./DEMO.md) — 2-minute golden demo guide
- [HANDOFF.md](./HANDOFF.md) — Final Phase 7 handoff & production readiness notes
