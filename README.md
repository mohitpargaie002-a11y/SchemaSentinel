# SchemaSentinel 🛡️

> **Let the agent test the migration before you trust the migration.**

SchemaSentinel is an approval-gated AI agent harness built on **TrueForge** that investigates database schemas, simulates candidate DDL changes inside an isolated sandbox, detects destructive locking and regression risks, pauses for explicit human authorization, and verifies database integrity after application.

Built for **The Agent Harness Hackathon 2026** (WeMakeDevs × TrueFoundry).

---

## 🌟 Key Capabilities

- **Specialized Multi-Subagent Architecture**:
  - `SchemaAnalystSubagent`: Read-only schema introspection via PostgreSQL MCP.
  - `RiskAnalystSubagent`: Static locking and table rewrite hazard detection.
  - `SandboxValidatorSubagent`: Ephemeral in-memory PGlite sandbox execution and rollback validation.
  - `ReviewSynthesizerSubagent`: Evidence collation, structured reporting, and cryptographic checkpoint signing.
  - `TrueForgeOrchestrator`: Multi-agent sequencing, typed event stream, session continuity, controlled apply, and post-apply invariant verification.
- **Interactive Mission Control UI**: Real-time engineering dashboard with live subagent telemetry, quantitative risk matrix, staged plan, and human approval boundary.
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
npm run demo:day4
```

---

## 📚 Documentation
- [AGENTS.md](file:///e:/F/Codex/Hackathon2/AGENTS.md) — Agent governance and safety rules
- [ARCHITECTURE.md](file:///e:/F/Codex/Hackathon2/ARCHITECTURE.md) — System design & TrueForge topology
- [DESIGN.md](file:///e:/F/Codex/Hackathon2/DESIGN.md) — Operations console design specification
- [SECURITY.md](file:///e:/F/Codex/Hackathon2/SECURITY.md) — Threat model & security controls
- [DEMO.md](file:///e:/F/Codex/Hackathon2/DEMO.md) — 3-minute golden demo walkthrough
- [HANDOFF.md](file:///e:/F/Codex/Hackathon2/HANDOFF.md) — Phase status and handoff notes
