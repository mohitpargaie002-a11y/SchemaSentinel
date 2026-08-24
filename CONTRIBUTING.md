# CONTRIBUTING.md — Contributor Guidelines

## Development Workflow

1. **Branch Pattern**:
   - `feat/<feature-name>` for new capabilities
   - `fix/<fix-name>` for bug fixes
   - `chore/<chore-name>` for infrastructure and docs

2. **Commit Policy**:
   Follow Conventional Commits:
   ```text
   feat(mcp): add postgres schema inspection tool
   feat(sandbox): add pglite execution runner
   fix(safety): invalidate approval on SQL payload modification
   ```

3. **Code Quality Gates**:
   - Run typecheck: `npm run typecheck`
   - Run test suite: `npm test`
   - Run Qodo review before merge: All PRs must have Qodo review feedback evaluated and addressed.

4. **Pull Request Protocol**:
   - Keep PRs focused and self-contained.
   - Include test evidence and a link to the corresponding issue/phase.
