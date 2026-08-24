---
name: postgres-migration-safety
description: Guidelines for detecting dangerous DDL patterns, lock escalation risks, table rewrites, and unsafe backfills in PostgreSQL.
---

# PostgreSQL Migration Safety Skill

## Purpose
Identify hazardous DDL operations that could cause production outages, lockouts, or replication lag, and formulate non-blocking staged alternatives.

## Hazardous Patterns & Safe Remediations

### 1. Adding `NOT NULL` Column with Default
- **Hazard**: Acquires `ACCESS EXCLUSIVE` lock and can rewrite entire table on older Postgres versions.
- **Safe Staging**:
  1. Add column as nullable without default.
  2. Set default for future writes (`ALTER TABLE ... ALTER COLUMN ... SET DEFAULT ...`).
  3. Backfill existing rows in non-blocking batches.
  4. Add `NOT NULL` constraint with `NOT VALID`, then validate separately.

### 2. Standard `CREATE INDEX`
- **Hazard**: Blocks concurrent writes (`SHARE` lock).
- **Safe Staging**: Use `CREATE INDEX CONCURRENTLY` (or staged background worker index creation).

### 3. Dropping Columns / Renaming Columns
- **Hazard**: Breaks active application queries immediately.
- **Safe Staging**: Multi-phase deployment (Expand → Migrate → Contract).
