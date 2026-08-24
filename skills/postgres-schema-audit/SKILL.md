---
name: postgres-schema-audit
description: Rules and inspection patterns for auditing PostgreSQL schemas, foreign keys, table volumes, and index definitions before changes.
---

# PostgreSQL Schema Audit Skill

## Purpose
Guide the agent to safely discover database schema state without acquiring heavy table locks or exposing sensitive table rows.

## When to Use
Use during the **INSPECT** phase when analyzing an existing database target before designing or validating a migration.

## Strict Rules
1. **Zero Data Dumps**: Never run `SELECT * FROM table` on large user tables. Use `pg_class.reltuples` or `EXPLAIN` for row counts.
2. **Metadata Queries Only**: Query `information_schema` and `pg_catalog` (e.g. `pg_tables`, `pg_indexes`, `pg_constraint`).
3. **Inspect Dependencies**: Always check foreign key constraints, dependent views, and active triggers on affected tables.

## Output Contract
- List of tables, column types, and nullability
- List of existing primary keys, foreign keys, and indexes
- Estimated row counts and disk sizes
- Dependent database objects (views, triggers)
