---
name: qodo-pr-resolver
description: Fetch open review findings and comments from Qodo PR Agent, evaluate constructive feedback, and resolve items interactively.
---

# Qodo PR Resolver Skill

## Purpose
Systematically inspect review findings posted by Qodo on Pull Requests, determine necessary remediation actions, execute code fixes, and update the review log.

## Review Resolution Workflow
1. **Fetch Findings**: Inspect PR comments for Qodo suggestions, score cards, and security flags.
2. **Evaluate Impact**: Group findings into (a) Critical Bugs & Security, (b) Type & Style consistency, and (c) Optional suggestions.
3. **Remediate**: Apply fixes with corresponding regression test coverage.
4. **Document**: Record developer resolution in `HANDOFF.md` or PR reply comments.
