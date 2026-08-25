import { createHash } from "crypto";
import { ApprovalCheckpoint, MigrationPlan, SentinelError } from "../domain/contracts.js";

export class ApprovalGateError extends SentinelError {
  constructor(message: string) {
    super(`[ApprovalGate Security Error]: ${message}`);
    this.name = "ApprovalGateError";
  }
}

export interface IApprovalGate {
  computeFingerprint(
    sessionId: string,
    planId: string,
    targetId: string,
    rawSql: string
  ): string;
  grantApproval(
    sessionId: string,
    plan: MigrationPlan,
    approvedBy?: string
  ): ApprovalCheckpoint;
  grantSafeMigrationApproval(
    sessionId: string,
    planId: string,
    targetId: string,
    proposedSql: string,
    approvedBy?: string
  ): ApprovalCheckpoint;
  verifyApproval(
    token: string,
    sessionId: string,
    planId: string,
    targetId: string,
    rawSql: string
  ): ApprovalCheckpoint;
  restoreCheckpoint(checkpoint: ApprovalCheckpoint): void;
  revokeToken(token: string): void;
}

export class ApprovalGate implements IApprovalGate {
  private approvedTokens: Map<string, ApprovalCheckpoint> = new Map();

  /**
   * Computes the deterministic SHA-256 fingerprint for the exact migration payload.
   * Bound to: SHA-256(sessionId + planId + targetId + exact_sql)
   */
  public computeFingerprint(
    sessionId: string,
    planId: string,
    targetId: string,
    rawSql: string
  ): string {
    const payload = `${sessionId}:${planId}:${targetId}:${rawSql}`;
    return createHash("sha256").update(payload).digest("hex");
  }

  /**
   * Generates a signed approval checkpoint for a migration plan.
   * Derives token deterministically from the cryptographic fingerprint.
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

    const token = `sat_${fingerprint.substring(0, 32)}`;

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
   * Generates a signed approval checkpoint for a proposed safe migration.
   * Cryptographically binds: SHA-256(sessionId + planId + targetId + exact_proposed_sql).
   */
  public grantSafeMigrationApproval(
    sessionId: string,
    planId: string,
    targetId: string,
    proposedSql: string,
    approvedBy: string = "operator@schemasentinel.dev"
  ): ApprovalCheckpoint {
    const fingerprint = this.computeFingerprint(
      sessionId,
      planId,
      targetId,
      proposedSql
    );

    const token = `sat_safe_${fingerprint.substring(0, 27)}`;

    const checkpoint: ApprovalCheckpoint = {
      sessionId,
      planId,
      targetId,
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
   * Restores a persisted approval checkpoint (e.g. across process restarts).
   */
  public restoreCheckpoint(checkpoint: ApprovalCheckpoint): void {
    if (checkpoint && checkpoint.token) {
      this.approvedTokens.set(checkpoint.token, checkpoint);
    }
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
