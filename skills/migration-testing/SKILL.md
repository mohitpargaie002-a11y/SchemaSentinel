---
name: migration-testing
description: Instructions for running candidate schema migrations in isolated disposable PostgreSQL sandboxes and executing integrity assertions.
---

# Migration Testing Skill

## Purpose
Safely execute candidate migrations in a disposable environment (`PGlite` or ephemeral container), run schema integrity assertions, verify seed queries, and validate rollback scripts.

## Lifecycle in Sandbox
1. **Initialize Snapshot**: Load baseline schema and representative seed dataset into the sandbox.
2. **Execute Candidate Migration**: Apply proposed DDL inside a transaction, recording execution duration and errors.
3. **Assert Schema Invariants**:
   - Verify new columns exist with correct types and nullability constraints.
   - Verify indexes exist and are recognized by the query planner.
4. **Assert Application Reads/Writes**:
   - Execute sample `INSERT`, `UPDATE`, and `SELECT` queries reflecting application traffic.
5. **Rollback Verification**:
   - Apply rollback/down migration and verify that the schema returns cleanly to baseline without orphaned artifacts.
