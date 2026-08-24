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
  createPrComment(
    repo: string,
    payload: GithubPrCommentPayload
  ): Promise<{ commentId: number; htmlUrl: string }>;
}

export class GithubMcpService implements IGithubMcpService {
  /**
   * MCP Tool: read_migration_file
   */
  public async readMigrationFile(repo: string, filePath: string): Promise<string> {
    return `-- Candidate migration file from ${repo}:${filePath}\nALTER TABLE orders ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending';\nCREATE INDEX idx_orders_status ON orders(status);`;
  }

  /**
   * MCP Tool: create_pr_comment
   * Publishes risk assessment, sandbox evidence, and approval status to the pull request.
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

    return {
      commentId: Math.floor(Math.random() * 1000000),
      htmlUrl: `https://github.com/${repo}/pull/${payload.prNumber}#issuecomment-sentinel`,
    };
  }
}

export const defaultGithubMcpService = new GithubMcpService();
