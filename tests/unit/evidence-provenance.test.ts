import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import path from "path";
import os from "os";
import {
  EvidenceItem,
  EvidenceItemSchema,
  EvidenceSourceTypeSchema,
} from "../../lib/domain/contracts.js";
import { TrueForgeOrchestrator } from "../../lib/agent/orchestrator.js";
import { FileSessionStore } from "../../lib/agent/session-store.js";

describe("Evidence Provenance & Integrity Model", () => {
  it("validates EvidenceItem schema structure and SHA-256 fingerprinting", () => {
    const rawSql = "ALTER TABLE orders ADD COLUMN status VARCHAR(32);";
    const hash = crypto.createHash("sha256").update(rawSql, "utf-8").digest("hex");

    const item: EvidenceItem = {
      evidenceId: "evi_12345_abcde",
      sessionId: "sess_test_100",
      source: "migrations/0038_add_order_status.sql",
      sourceType: "MIGRATION_FILE",
      actor: "ORCHESTRATOR",
      timestamp: new Date().toISOString(),
      summary: "Raw migration SQL payload",
      contentHash: hash,
      rawReference: { sql: rawSql },
      confidence: 1.0,
    };

    const parsed = EvidenceItemSchema.parse(item);
    expect(parsed.evidenceId).toBe("evi_12345_abcde");
    expect(parsed.contentHash).toBe(hash);
    expect(parsed.sourceType).toBe("MIGRATION_FILE");
  });

  it("ensures all evidence source types are supported", () => {
    const validTypes = [
      "MIGRATION_FILE",
      "POSTGRES_SCHEMA",
      "POSTGRES_QUERY",
      "SANDBOX_EXECUTION",
      "RISK_ANALYSIS",
      "VERIFICATION_QUERY",
      "SYSTEM",
    ];

    for (const t of validTypes) {
      expect(EvidenceSourceTypeSchema.parse(t)).toBe(t);
    }
  });

  it("orchestrator attaches deterministic evidence items and provenance list to review results", async () => {
    const tempDir = path.join(os.tmpdir(), `schemasentinel_prov_test_${Date.now()}`);
    const store = new FileSessionStore(tempDir);
    const orchestrator = new TrueForgeOrchestrator(undefined, undefined, undefined, store);

    const res = await orchestrator.executeReviewWorkflow({
      sessionId: "sess_provenance_test_1",
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration",
    });

    expect(res.evidenceItems.length).toBeGreaterThanOrEqual(4);
    
    // Check for MIGRATION_FILE evidence
    const sqlEvi = res.evidenceItems.find((e) => e.sourceType === "MIGRATION_FILE");
    expect(sqlEvi).toBeDefined();
    expect(sqlEvi?.contentHash).toHaveLength(64); // SHA-256 hex string length

    // Check for POSTGRES_SCHEMA evidence
    const schemaEvi = res.evidenceItems.find((e) => e.sourceType === "POSTGRES_SCHEMA");
    expect(schemaEvi).toBeDefined();
    expect(schemaEvi?.actor).toBe("SCHEMA_ANALYST");

    // Check for RISK_ANALYSIS evidence
    const riskEvi = res.evidenceItems.find((e) => e.sourceType === "RISK_ANALYSIS");
    expect(riskEvi).toBeDefined();
    expect(riskEvi?.actor).toBe("RISK_ANALYST");

    // Check for SANDBOX_EXECUTION evidence
    const sandboxEvi = res.evidenceItems.find((e) => e.sourceType === "SANDBOX_EXECUTION");
    expect(sandboxEvi).toBeDefined();
    expect(sandboxEvi?.actor).toBe("SANDBOX_VALIDATOR");

    // Verify ReviewReport provenance contains all evidence IDs
    expect(res.reviewReport.evidenceProvenance).toContain(sqlEvi?.evidenceId);
    expect(res.reviewReport.evidenceProvenance).toContain(schemaEvi?.evidenceId);
  });
});
