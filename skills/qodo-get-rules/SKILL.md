---
name: qodo-get-rules
description: Fetch repository and team coding rules from Qodo to ensure compliance before generating or refactoring code.
---

# Qodo Get Rules Skill

## Purpose
Enforces repository architecture rules, typing discipline, error-handling conventions, and security boundaries before any code is written or modified.

## Directives
1. Verify strict TypeScript compliance (`noImplicitAny`, explicit return types).
2. Validate domain invariants using `zod` schemas.
3. Ensure zero mutation commands occur without human approval checkpoints.
4. Verify all tests pass before proposing pull request changes.
