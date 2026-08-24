import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import path from "path";
import os from "os";
import { createSchemaSentinelServer } from "../../lib/server/app.js";
import { FileSessionStore } from "../../lib/agent/session-store.js";
import { TrueForgeOrchestrator } from "../../lib/agent/orchestrator.js";
import { PersistedSessionState, SessionSummary } from "../../lib/domain/contracts.js";

describe("Session History & Switching API", () => {
  let server: http.Server;
  let port: number;
  let store: FileSessionStore;
  let orchestrator: TrueForgeOrchestrator;

  beforeAll(async () => {
    const tempDir = path.join(os.tmpdir(), `schemasentinel_history_test_${Date.now()}`);
    store = new FileSessionStore(tempDir);
    orchestrator = new TrueForgeOrchestrator(undefined, undefined, undefined, store);

    server = createSchemaSentinelServer({
      sessionStore: store,
      orchestrator,
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          port = address.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /api/sessions returns summarized session records sorted newest first", async () => {
    // Create Session 1
    await orchestrator.executeReviewWorkflow({
      sessionId: "sess_hist_1",
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0037_add_customer_index.sql",
      userPrompt: "Review migration 1",
    });

    // Create Session 2
    await orchestrator.executeReviewWorkflow({
      sessionId: "sess_hist_2",
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration 2",
    });

    const res = await fetch(`http://localhost:${port}/api/sessions`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { sessions: SessionSummary[] };
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(data.sessions.length).toBe(2);

    // Verify summaries contain essential metadata
    const first = data.sessions[0];
    expect(first.sessionId).toBe("sess_hist_2");
    expect(first.migrationFilePath).toBe("migrations/0038_add_order_status.sql");
    expect(first.targetId).toBe("staging-demo");
    expect(first.status).toBe("AWAITING_APPROVAL");
    expect(first.overallRisk).toBe("HIGH");
  });

  it("completing a session marks it isReadOnly=true in history retrieval", async () => {
    const sessionId = "sess_hist_completed_1";

    const rev = await orchestrator.executeReviewWorkflow({
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration",
    });

    await orchestrator.resumeAndApplyWorkflow({
      sessionId,
      humanDecision: "APPROVED",
      approvalToken: rev.approvalPacket.approvalToken,
      approvedBy: "lead-dba@schemasentinel.dev",
    });

    const res = await fetch(`http://localhost:${port}/api/sessions/${sessionId}`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { session: PersistedSessionState };
    expect(data.session.status).toBe("COMPLETED");
    expect(data.session.isReadOnly).toBe(true);
    expect(data.session.completedAt).toBeDefined();
    expect(data.session.evidenceItems.length).toBeGreaterThanOrEqual(4);
  });
});
