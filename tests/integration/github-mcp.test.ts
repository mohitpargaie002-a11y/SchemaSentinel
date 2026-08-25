import { describe, it, expect } from "vitest";
import { GithubMcpService } from "../../lib/mcp/github.js";
import { GitHubMcpError } from "../../lib/domain/contracts.js";

describe("GitHub MCP Integration Tests", () => {
  const service = new GithubMcpService();
  const repo = "mohitpargaie002-a11y/SchemaSentinel";

  it("sanitizes and validates branch names strictly", () => {
    expect(service.sanitizeBranchName("schemasentinel/migration/sess_123")).toBe("schemasentinel/migration/sess_123");
    expect(service.sanitizeBranchName("feat-safe-col")).toBe("feat-safe-col");

    expect(() => service.sanitizeBranchName("")).toThrow(GitHubMcpError);
    expect(() => service.sanitizeBranchName("/invalid-lead-slash")).toThrow(GitHubMcpError);
    expect(() => service.sanitizeBranchName("invalid..dot")).toThrow(GitHubMcpError);
    expect(() => service.sanitizeBranchName("invalid//slash")).toThrow(GitHubMcpError);
    expect(() => service.sanitizeBranchName("bad name with spaces")).toThrow(GitHubMcpError);
  });

  it("creates a git branch idempotently", async () => {
    const branch = "schemasentinel/migration/test-session-mcp";
    const res = await service.createBranch(repo, branch, "master");

    expect(res.ref).toBe(`refs/heads/${branch}`);
    expect(res.sha).toBeDefined();
  });

  it("writes safe migration file to target branch", async () => {
    const branch = "schemasentinel/migration/test-session-mcp";
    const content = "-- Safe migration test\nALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(32);";
    const res = await service.writeMigrationFile(
      repo,
      branch,
      "migrations/0038_safe_status.sql",
      content,
      "feat(migration): safe remediation test"
    );

    expect(res.commitSha).toBeDefined();
    expect(res.commitSha.length).toBeGreaterThanOrEqual(20);
  });

  it("opens a pull request with structured Markdown body", async () => {
    const branch = "schemasentinel/migration/test-session-mcp";
    const title = "Safe migration proposal: 0038_safe_status.sql";
    const body = "## 🛡️ SchemaSentinel Safe Migration Proposal\n- Zero-lock staged remediation";

    const res = await service.createPullRequest(repo, title, body, branch, "master");

    expect(res.prNumber).toBeGreaterThan(0);
    expect(res.htmlUrl).toContain(`https://github.com/${repo}/pull/`);
    expect(res.prUrl).toContain(`https://api.github.com/repos/${repo}/pulls/`);
  });
});
