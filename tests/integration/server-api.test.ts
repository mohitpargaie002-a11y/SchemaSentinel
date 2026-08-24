import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createSchemaSentinelServer } from "../../lib/server/app.js";
import { FileSessionStore } from "../../lib/agent/session-store.js";
import http from "http";
import path from "path";
import os from "os";

describe("Server API - HTTP Endpoints & Session Management", () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;
  let sessionStore: FileSessionStore;

  beforeAll(async () => {
    const tempDir = path.join(os.tmpdir(), `schemasentinel_server_test_${Date.now()}`);
    sessionStore = new FileSessionStore(tempDir);
    server = createSchemaSentinelServer({ sessionStore });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          port = address.port;
          baseUrl = `http://localhost:${port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("GET /api/health returns 200 and service metadata", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const data = (await res.json()) as { status: string; service: string };
    expect(res.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.service).toBe("SchemaSentinel");
  });

  it("GET /api/targets returns allowlisted database targets", async () => {
    const res = await fetch(`${baseUrl}/api/targets`);
    const data = (await res.json()) as { targets: Array<{ id: string }> };
    expect(res.status).toBe(200);
    expect(Array.isArray(data.targets)).toBe(true);
    expect(data.targets.some((t) => t.id === "staging-demo")).toBe(true);
  });

  it("POST /api/sessions executes review and GET /api/sessions/:id returns persisted session", async () => {
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetId: "staging-demo",
        migrationFilePath: "migrations/0038_add_order_status.sql",
        userPrompt: "Review migration test",
      }),
    });

    const createData = (await createRes.json()) as {
      sessionId: string;
      status: string;
      approvalPacket: { approvalToken: string };
    };
    expect(createRes.status).toBe(201);
    expect(createData.sessionId).toBeDefined();
    expect(createData.status).toBe("AWAITING_APPROVAL");
    expect(createData.approvalPacket.approvalToken).toBeDefined();

    // Verify GET /api/sessions/:id
    const getRes = await fetch(`${baseUrl}/api/sessions/${createData.sessionId}`);
    const getData = (await getRes.json()) as { session: { sessionId: string; status: string } };
    expect(getRes.status).toBe(200);
    expect(getData.session.sessionId).toBe(createData.sessionId);
    expect(getData.session.status).toBe("AWAITING_APPROVAL");

    // Verify GET /api/sessions/:id/events
    const eventsRes = await fetch(`${baseUrl}/api/sessions/${createData.sessionId}/events`);
    const eventsData = (await eventsRes.json()) as { activityEvents: unknown[] };
    expect(eventsRes.status).toBe(200);
    expect(eventsData.activityEvents.length).toBeGreaterThan(0);
  });
});
