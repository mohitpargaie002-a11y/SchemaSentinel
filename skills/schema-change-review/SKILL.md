---
name: schema-change-review
description: Protocol for synthesizing risk findings, formatting human-readable approval packets, and generating GitHub PR audit comments.
---

# Schema Change Review Skill

## Purpose
Synthesize findings from schema inspection, risk analysis, and sandbox validation into a structured, crystal-clear approval packet for human operators.

## Human Approval Packet Structure
1. **Executive Risk Rating**: `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`.
2. **Impact Summary**: Affected tables, column modifications, estimated row counts, lock levels.
3. **Sandbox Results**: Execution timing, constraint checks, rollback status (`PASS` / `FAIL`).
4. **Exact SQL DDL**: Formatted SQL that will be executed upon approval.
5. **Cryptographic Checkpoint Hash**: `SHA256(sessionId + planId + targetId + sql)`.
6. **Explicit Warning**: Statement confirming that clicking approve will permanently modify the target database.
