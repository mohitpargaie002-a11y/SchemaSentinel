import { createHash } from "crypto";
import { ApprovalCheckpoint, MigrationPlan } from "../domain/contracts.js";

export class ApprovalGateError extends Error {
  constructor(message: string) {
    super(`[ApprovalGate Security Error]: ${message}`);
    this.name = "ApprovalGateError";
  }
}

export class ApprovalGate {
  private approvedTokens: Map<string, ApprovalCheckpoint> = new Map();

  /**
   * Computes the SHA-256 fingerprint for a migration payload.
   */
  public computeFingerprint(
    sessionId: string,
    planId: string,
    targetId: string,
    rawSql: string
  ): string {
    const payload = `${sessionId}:${planId}:${targetId}:${rawSql.trim()}`;
    return createHash("sha256").update(payload).digest("hex");
  }

  /**
   * Generates a signed approval checkpoint for a migration plan.
   */
  public grantApproval(
    sessionId: string,
    plan: MigrationPlan,
    approvedBy: string = "operator@schemasentinel.dev"
  ): ApprovalCheckpoint {
    const fingerprint = this.computeFingerprint(
      sessionId,
      plan.id,
      plan.targetId,
      plan.rawSql
    );

    const token = `sat_${createHash("sha256")
      .update(`${fingerprint}:${Date.now()}:${Math.random()}`)
      .digest("hex")
      .substring(0, 32)}`;

    const checkpoint: ApprovalCheckpoint = {
      sessionId,
      planId: plan.id,
      targetId: plan.targetId,
      sqlFingerprint: fingerprint,
      approved: true,
      approvedBy,
      token,
      timestamp: new Date().toISOString(),
    };

    this.approvedTokens.set(token, checkpoint);
    return checkpoint;
  }

  /**
   * Verifies if an approval token is valid for the exact target, plan, and SQL.
   * Throws ApprovalGateError if invalid, tampered, or missing.
   */
  public verifyApproval(
    token: string,
    sessionId: string,
    planId: string,
    targetId: string,
    rawSql: string
  ): ApprovalCheckpoint {
    const checkpoint = this.approvedTokens.get(token);
    if (!checkpoint) {
      throw new ApprovalGateError(
        `Approval token '${token}' is invalid or has expired.`
      );
    }

    if (!checkpoint.approved) {
      throw new ApprovalGateError("Migration plan has been rejected.");
    }

    if (
      checkpoint.sessionId !== sessionId ||
      checkpoint.planId !== planId ||
      checkpoint.targetId !== targetId
    ) {
      throw new ApprovalGateError(
        "Approval checkpoint metadata mismatch (session, plan, or target changed)."
      );
    }

    const currentFingerprint = this.computeFingerprint(
      sessionId,
      planId,
      targetId,
      rawSql
    );

    if (checkpoint.sqlFingerprint !== currentFingerprint) {
      throw new ApprovalGateError(
        "CRITICAL: SQL content was modified after approval was granted! Approval has been revoked."
      );
    }

    return checkpoint;
  }

  /**
   * Explicitly revokes or consumes an approval token.
   */
  public revokeToken(token: string): void {
    this.approvedTokens.delete(token);
  }
}

export const defaultApprovalGate = new ApprovalGate();
