# SchemaSentinel 🛡️

> **Let the agent test the migration before you trust the migration.**

SchemaSentinel is an approval-gated AI agent harness built on **TrueForge** that investigates database schemas, simulates candidate DDL changes inside an isolated sandbox, detects destructive locking and regression risks, pauses for explicit human authorization, and verifies database integrity after application.

Built for **The Agent Harness Hackathon 2026** (WeMakeDevs × TrueFoundry).

---

## 🌟 Key Capabilities

- **Safe Migration Generation & GitHub PR Workflow**:
  - Autonomous zero-downtime SQL transformation engine with AST hazard analysis.
  - Interactive structured visual diff viewer with line additions/removals and lock elimination metrics.
  - Ephemeral sandbox dry-run verification before PR creation.
  - Cryptographically approved GitHub branch creation, migration file committing, and Pull Request opening for automated Qodo review.
- **Live Agent Orchestration & Observability**:
  - Real-time Server-Sent Events (SSE) stream (`/api/sessions/:id/events/stream`) with subagent telemetry and client reconnect replay.
- **Evidence Provenance & Integrity**:
  - Deterministic SHA-256 content hashing across all artifacts (`MIGRATION_FILE`, `POSTGRES_SCHEMA`, `RISK_ANALYSIS`, `SANDBOX_EXECUTION`, `SAFE_MIGRATION_SQL`, `MIGRATION_DIFF`, `SAFE_SANDBOX_EVAL`, `GITHUB_PR`, `VERIFICATION_QUERY`, `SYSTEM`).
- **Session History & Switching**:
  - Full persistence across reboots with read-only historical inspection and session resumption.
- **Specialized Multi-Subagent Architecture**:
  - `SchemaAnalystSubagent`: Read-only schema introspection via PostgreSQL MCP.
  - `RiskAnalystSubagent`: Static locking and table rewrite hazard detection.
  - `SandboxValidatorSubagent`: Ephemeral in-memory PGlite sandbox execution and rollback validation.
  - `ReviewSynthesizerSubagent`: Evidence provenance collation, structured reporting, and cryptographic checkpoint signing.
  - `SafeMigrationGenerator`: Deterministic non-blocking SQL transformation and visual diff engine.
  - `TrueForgeOrchestrator`: Parallel read-only stage execution, typed event stream, session continuity, safe remediation generation, controlled apply, and post-apply invariant verification.
- **Formal Session State Machine**:
  - Strict lifecycle transitions (`CREATED` → `RUNNING` → `REVIEW_READY` → `AWAITING_APPROVAL` → `SAFE_MIGRATION_GENERATING` → `SAFE_MIGRATION_VALIDATING` → `SAFE_MIGRATION_READY` → `AWAITING_SAFE_MIGRATION_APPROVAL` → `PR_CREATING` → `PR_CREATED`) with fail-closed security.
- **Interactive "Ink & Paper" Web UI**: Real-time engineering dashboard with live subagent telemetry, quantitative risk matrix, staged plan, visual diff viewer, evidence provenance explorer, and human approval boundary.
- **Cryptographic Approval Boundary**: Non-bypassable authorization gate binding `SHA256(sessionId + planId + targetId + sql)`.
- **Quality & Governance via Qodo**: Continuous code review, test enforcement, and rule compliance with Qodo Agent Skills.

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20.x
- npm >= 10.x

### 1. Clone & Install
```bash
git clone https://github.com/mohitpargaie002-a11y/SchemaSentinel.git
cd SchemaSentinel
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

### 3. Run Tests
```bash
npm test
```

### 4. Launch Interactive Web UI
```bash
npm run serve
```
Open `http://localhost:3000` in your browser.

### 5. Run Automated Proof CLI
```bash
# Day 6 Safe Migration & GitHub PR Proof
npm run demo:day6

# Day 5 Live Telemetry & Provenance Proof
npm run demo:day5
```

---

## 📚 Documentation
- [AGENTS.md](file:///e:/F/Codex/Hackathon2/AGENTS.md) — Agent governance and safety rules
- [ARCHITECTURE.md](file:///e:/F/Codex/Hackathon2/ARCHITECTURE.md) — System design & TrueForge topology
- [DESIGN.md](file:///e:/F/Codex/Hackathon2/DESIGN.md) — Operations console design specification
- [SECURITY.md](file:///e:/F/Codex/Hackathon2/SECURITY.md) — Threat model & security controls
- [DEMO.md](file:///e:/F/Codex/Hackathon2/DEMO.md) — 3-minute golden demo walkthrough
- [HANDOFF.md](file:///e:/F/Codex/Hackathon2/HANDOFF.md) — Phase status and handoff notes
