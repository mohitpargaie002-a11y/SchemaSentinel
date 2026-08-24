import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import path from "path";
import os from "os";
import { createSchemaSentinelServer } from "../../lib/server/app.js";
import { FileSessionStore } from "../../lib/agent/session-store.js";
import { SessionEventBroadcaster } from "../../lib/agent/event-stream.js";
import { TrueForgeOrchestrator } from "../../lib/agent/orchestrator.js";

describe("Live Server-Sent Events (SSE) Streaming API", () => {
  let server: http.Server;
  let port: number;
  let store: FileSessionStore;
  let broadcaster: SessionEventBroadcaster;
  let orchestrator: TrueForgeOrchestrator;

  beforeAll(async () => {
    const tempDir = path.join(os.tmpdir(), `schemasentinel_sse_test_${Date.now()}`);
    store = new FileSessionStore(tempDir);
    broadcaster = SessionEventBroadcaster.getInstance();
    orchestrator = new TrueForgeOrchestrator(undefined, undefined, undefined, store, undefined, undefined, undefined, undefined, undefined, undefined, broadcaster);

    server = createSchemaSentinelServer({
      sessionStore: store,
      orchestrator,
      broadcaster,
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

  it("rejects uninitialized sessions with 404 and invalid format with 400", async () => {
    // 404 on non-existent session
    const res404 = await fetch(`http://localhost:${port}/api/sessions/sess_non_existent_123/events/stream`);
    expect(res404.status).toBe(404);

    // 400 on invalid format with illegal characters
    const res400 = await fetch(`http://localhost:${port}/api/sessions/bad$session!id/events/stream`);
    expect(res400.status).toBe(400);
  });

  it("subscribes to /api/sessions/:id/events/stream and receives real-time events as they execute", async () => {
    const sessionId = "sess_sse_test_1";

    // Start review workflow in background
    const reviewPromise = orchestrator.executeReviewWorkflow({
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration",
    });

    // Wait 50ms for session to initialize in broadcaster
    await new Promise((r) => setTimeout(r, 50));

    // Connect SSE listener
    const receivedChunks: string[] = [];
    const sseReq = http.request(
      `http://localhost:${port}/api/sessions/${sessionId}/events/stream`,
      {
        headers: {
          Accept: "text/event-stream",
        },
      },
      (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toContain("text/event-stream");

        res.on("data", (chunk) => {
          receivedChunks.push(chunk.toString());
        });
      }
    );
    sseReq.end();

    await reviewPromise;
    await new Promise((r) => setTimeout(r, 300));
    sseReq.destroy();

    const fullStreamOutput = receivedChunks.join("");
    expect(fullStreamOutput).toContain("event: open");
    expect(fullStreamOutput).toContain("event: activity");
    expect(fullStreamOutput).toContain("event: evidence");
    expect(fullStreamOutput).toContain("SCHEMA_ANALYST");
    expect(fullStreamOutput).toContain("RISK_ANALYST");
    expect(fullStreamOutput).toContain("SANDBOX_VALIDATOR");
    expect(fullStreamOutput).toContain("REVIEW_SYNTHESIZER");
  });

  it("replays buffered activity events and evidence when a client reconnects to an ongoing session", async () => {
    const sessionId = "sess_sse_reconnect_1";

    // Run review first
    await orchestrator.executeReviewWorkflow({
      sessionId,
      targetId: "staging-demo",
      repo: "mohitpargaie002-a11y/SchemaSentinel",
      migrationFilePath: "migrations/0038_add_order_status.sql",
      userPrompt: "Review migration",
    });

    // Client connects after review is complete (simulating reload/reconnect)
    const receivedChunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        `http://localhost:${port}/api/sessions/${sessionId}/events/stream`,
        {
          headers: {
            Accept: "text/event-stream",
          },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          res.on("data", (chunk) => {
            receivedChunks.push(chunk.toString());
            if (receivedChunks.join("").includes("event: evidence")) {
              req.destroy();
              resolve();
            }
          });
          res.on("error", reject);
        }
      );
      req.end();
    });

    const output = receivedChunks.join("");
    expect(output).toContain("SCHEMA_ANALYST");
    expect(output).toContain("SANDBOX_VALIDATOR");
    expect(output).toContain("event: evidence");
  });
});
