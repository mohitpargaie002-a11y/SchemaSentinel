import https from "https";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { z } from "zod";
import { GitHubMcpError } from "../domain/contracts.js";

export interface GithubPrCommentPayload {
  prNumber: number;
  planId: string;
  riskLevel: string;
  riskSummary: string;
  sandboxResults: string;
  approvalStatus: string;
}

export interface IGithubMcpService {
  readMigrationFile(repo: string, filePath: string): Promise<string>;
  createBranch(repo: string, branchName: string, baseBranch?: string): Promise<{ ref: string; sha: string }>;
  writeMigrationFile(repo: string, branch: string, filePath: string, content: string, commitMessage: string): Promise<{ commitSha: string }>;
  createPullRequest(repo: string, title: string, body: string, headBranch: string, baseBranch?: string): Promise<{ prNumber: number; prUrl: string; htmlUrl: string }>;
  createPrComment(repo: string, payload: GithubPrCommentPayload): Promise<{ commentId: number; htmlUrl: string }>;
}

const TokenSchema = z.string().trim().min(1);

export class GithubMcpService implements IGithubMcpService {
  private token: string;
  private memoryBranches: Map<string, string> = new Map(); // branchName -> commitSha
  private memoryFiles: Map<string, string> = new Map(); // branch:filePath -> content
  private memoryPrs: Map<number, { title: string; body: string; head: string; base: string; htmlUrl: string }> =
    new Map();
  private prCounter = 100;

  constructor(customToken?: string) {
    this.token = customToken || this.loadGitHubToken();
  }

  public isLiveMode(): boolean {
    return Boolean(this.token);
  }

  private loadGitHubToken(): string {
    if (process.env.GITHUB_TOKEN) {
      const parsed = TokenSchema.safeParse(process.env.GITHUB_TOKEN);
      if (parsed.success) return parsed.data;
    }

    // Check .env file with strict Zod parsing
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      try {
        const envContent = fs.readFileSync(envPath, "utf-8");
        const m = envContent.match(/GITHUB_TOKEN=(.*)/);
        if (m && m[1]) {
          const parsed = TokenSchema.safeParse(m[1].trim());
          if (parsed.success) return parsed.data;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[GitHubMCP] Notice: Could not read .env file for token: ${msg}\n`);
      }
    }

    // Try git credential helper
    try {
      const credOutput = execSync("git credential fill", {
        input: "protocol=https\nhost=github.com\n\n",
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      for (const line of credOutput.split("\n")) {
        if (line.startsWith("password=")) {
          const parsed = TokenSchema.safeParse(line.substring(9).trim());
          if (parsed.success) return parsed.data;
        }
      }
    } catch (err: unknown) {
      // Git credential helper not configured or unavailable in non-interactive environment
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[GitHubMCP] Notice: git credential helper returned: ${msg}\n`);
    }

    return "";
  }

  /**
   * Sanitizes and validates a Git branch name according to git-check-ref-format and security invariants.
   */
  public sanitizeBranchName(branchName: string): string {
    const trimmed = branchName.trim();
    if (!trimmed) {
      throw new GitHubMcpError("Branch name cannot be empty");
    }

    // Validate characters: only alphanumeric, dashes, underscores, slashes, and periods
    if (!/^[a-zA-Z0-9_\-\.\/]+$/.test(trimmed)) {
      throw new GitHubMcpError(`Invalid characters in branch name '${branchName}'. Only alphanumeric, dashes, underscores, and slashes are permitted.`);
    }

    if (trimmed.length > 100) {
      throw new GitHubMcpError(`Branch name exceeds maximum length of 100 characters: '${branchName}'`);
    }

    if (trimmed.startsWith("/") || trimmed.endsWith("/") || trimmed.includes("//") || trimmed.includes("..")) {
      throw new GitHubMcpError(`Illegal slash or dot structure in branch name '${branchName}'`);
    }

    return trimmed;
  }

  private async makeGithubRequest<T>(
    method: string,
    apiPath: string,
    body?: Record<string, unknown>
  ): Promise<{ status: number; data: T }> {
    if (!this.token) {
      throw new GitHubMcpError("GitHub token not configured for live API calls");
    }

    return new Promise((resolve, reject) => {
      const postData = body ? JSON.stringify(body) : undefined;
      const options: https.RequestOptions = {
        hostname: "api.github.com",
        path: apiPath,
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "SchemaSentinel-GitHubMCP",
          ...(postData
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData),
              }
            : {}),
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode || 500, data: parsed as T });
          } catch (e) {
            reject(new GitHubMcpError(`Failed to parse GitHub API response: ${data}`));
          }
        });
      });

      req.on("error", (e) => reject(new GitHubMcpError(`GitHub API request failed: ${e.message}`)));
      if (postData) req.write(postData);
      req.end();
    });
  }

  /**
   * MCP Tool: read_migration_file
   */
  public async readMigrationFile(repo: string, filePath: string): Promise<string> {
    if (this.token) {
      try {
        const res = await this.makeGithubRequest<{ content: string; encoding: string }>(
          "GET",
          `/repos/${repo}/contents/${filePath}`
        );
        if (res.status === 200 && res.data.content) {
          return Buffer.from(res.data.content, "base64").toString("utf-8");
        }
      } catch (err: unknown) {
        // Fall through to local workspace file check
      }
    }

    // Check local repository disk path
    const localPath = path.resolve(process.cwd(), filePath);
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath, "utf-8");
    }

    // Check in-memory files (written by writeMigrationFile)
    for (const [key, content] of this.memoryFiles.entries()) {
      if (key.endsWith(`:${filePath}`)) {
        return content;
      }
    }

    if (this.token) {
      throw new GitHubMcpError(`Migration file '${filePath}' not found in repository '${repo}' or local workspace.`);
    }

    // Explicit mock / local sandbox test fixture
    return `-- Candidate migration file from ${repo}:${filePath}\nALTER TABLE orders ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending';\nCREATE INDEX idx_orders_status ON orders(status);`;
  }

  /**
   * MCP Tool: create_branch
   */
  public async createBranch(
    repo: string,
    branchName: string,
    baseBranch: string = "master"
  ): Promise<{ ref: string; sha: string }> {
    const validBranch = this.sanitizeBranchName(branchName);

    if (this.token) {
      // 1. Get base branch commit SHA
      const baseRefRes = await this.makeGithubRequest<{ object: { sha: string } }>(
        "GET",
        `/repos/${repo}/git/ref/heads/${baseBranch}`
      );

      let baseSha = baseRefRes.status === 200 ? baseRefRes.data.object.sha : "";
      if (!baseSha) {
        // Try main branch if baseBranch was default
        const mainRefRes = await this.makeGithubRequest<{ object: { sha: string } }>(
          "GET",
          `/repos/${repo}/git/ref/heads/main`
        );
        if (mainRefRes.status === 200) baseSha = mainRefRes.data.object.sha;
      }

      if (!baseSha) {
        throw new GitHubMcpError(`Could not find base branch '${baseBranch}' or 'main' in repository '${repo}'.`);
      }

      const createRefRes = await this.makeGithubRequest<{ ref: string; object: { sha: string } }>(
        "POST",
        `/repos/${repo}/git/refs`,
        {
          ref: `refs/heads/${validBranch}`,
          sha: baseSha,
        }
      );

      if (createRefRes.status === 201) {
        return {
          ref: createRefRes.data.ref,
          sha: createRefRes.data.object.sha,
        };
      }
      if (createRefRes.status === 422) {
        // Branch already exists idempotently
        return {
          ref: `refs/heads/${validBranch}`,
          sha: baseSha,
        };
      }

      throw new GitHubMcpError(`GitHub API failed to create branch '${validBranch}' in '${repo}' with status ${createRefRes.status}.`);
    }

    // Deterministic memory fallback for testing / simulated execution
    const mockSha = `sha_${crypto.createHash("sha1").update(validBranch).digest("hex").substring(0, 40)}`;
    this.memoryBranches.set(validBranch, mockSha);
    return {
      ref: `refs/heads/${validBranch}`,
      sha: mockSha,
    };
  }

  /**
   * MCP Tool: write_migration_file
   */
  public async writeMigrationFile(
    repo: string,
    branch: string,
    filePath: string,
    content: string,
    commitMessage: string
  ): Promise<{ commitSha: string }> {
    const validBranch = this.sanitizeBranchName(branch);

    if (this.token) {
      // Check if file already exists to get SHA
      let fileSha: string | undefined;
      const existingRes = await this.makeGithubRequest<{ sha: string }>(
        "GET",
        `/repos/${repo}/contents/${filePath}?ref=${validBranch}`
      ).catch(() => ({ status: 404, data: { sha: "" } }));

      if (existingRes.status === 200 && existingRes.data.sha) {
        fileSha = existingRes.data.sha;
      }

      const putRes = await this.makeGithubRequest<{ commit: { sha: string } }>(
        "PUT",
        `/repos/${repo}/contents/${filePath}`,
        {
          message: commitMessage,
          content: Buffer.from(content, "utf-8").toString("base64"),
          branch: validBranch,
          ...(fileSha ? { sha: fileSha } : {}),
        }
      );

      if (putRes.status === 200 || putRes.status === 201) {
        return { commitSha: putRes.data.commit.sha };
      }

      throw new GitHubMcpError(`GitHub API failed to commit file '${filePath}' to branch '${validBranch}' in '${repo}' with status ${putRes.status}.`);
    }

    const commitSha = crypto.createHash("sha1").update(content + Date.now()).digest("hex");
    this.memoryFiles.set(`${validBranch}:${filePath}`, content);
    this.memoryBranches.set(validBranch, commitSha);
    return { commitSha };
  }

  /**
   * MCP Tool: create_pull_request
   */
  public async createPullRequest(
    repo: string,
    title: string,
    body: string,
    headBranch: string,
    baseBranch: string = "master"
  ): Promise<{ prNumber: number; prUrl: string; htmlUrl: string }> {
    const validHead = this.sanitizeBranchName(headBranch);

    if (this.token) {
      const prRes = await this.makeGithubRequest<{ number: number; url: string; html_url: string }>(
        "POST",
        `/repos/${repo}/pulls`,
        {
          title,
          body,
          head: validHead,
          base: baseBranch,
        }
      );

      if (prRes.status === 201) {
        return {
          prNumber: prRes.data.number,
          prUrl: prRes.data.url,
          htmlUrl: prRes.data.html_url,
        };
      }

      if (prRes.status === 422) {
        // Query existing pull request for this head branch
        const owner = repo.split("/")[0];
        const existingPrsRes = await this.makeGithubRequest<Array<{ number: number; url: string; html_url: string }>>(
          "GET",
          `/repos/${repo}/pulls?head=${owner}:${validHead}&state=all`
        ).catch(() => ({ status: 500, data: [] }));

        if (existingPrsRes.status === 200 && existingPrsRes.data.length > 0) {
          const existingPr = existingPrsRes.data[0];
          return {
            prNumber: existingPr.number,
            prUrl: existingPr.url,
            htmlUrl: existingPr.html_url,
          };
        }
      }

      throw new GitHubMcpError(`GitHub API failed to open Pull Request from '${validHead}' into '${baseBranch}' with status ${prRes.status}.`);
    }

    const prNumber = ++this.prCounter;
    const htmlUrl = `https://github.com/${repo}/pull/${prNumber}`;
    this.memoryPrs.set(prNumber, {
      title,
      body,
      head: validHead,
      base: baseBranch,
      htmlUrl,
    });

    return {
      prNumber,
      prUrl: `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
      htmlUrl,
    };
  }

  /**
   * MCP Tool: create_pr_comment
   */
  public async createPrComment(
    repo: string,
    payload: GithubPrCommentPayload
  ): Promise<{ commentId: number; htmlUrl: string }> {
    const commentMarkdown = `
## 🛡️ SchemaSentinel Migration Risk Audit

| Metric | Assessment |
| :--- | :--- |
| **Plan ID** | \`${payload.planId}\` |
| **Risk Level** | **${payload.riskLevel}** |
| **Approval Status** | \`${payload.approvalStatus}\` |

### 🔍 Risk Summary
${payload.riskSummary}

### 🧪 Isolated Sandbox Validation Results
${payload.sandboxResults}

---
*Generated autonomously by SchemaSentinel Agent Harness.*
    `.trim();

    if (this.token) {
      const res = await this.makeGithubRequest<{ id: number; html_url: string }>(
        "POST",
        `/repos/${repo}/issues/${payload.prNumber}/comments`,
        { body: commentMarkdown }
      );
      if (res.status === 201) {
        return { commentId: res.data.id, htmlUrl: res.data.html_url };
      }
      throw new GitHubMcpError(`GitHub API failed to post comment on PR #${payload.prNumber} with status ${res.status}.`);
    }

    return {
      commentId: Math.floor(Math.random() * 1000000),
      htmlUrl: `https://github.com/${repo}/pull/${payload.prNumber}#issuecomment-sentinel`,
    };
  }
}

export const defaultGithubMcpService = new GithubMcpService();
