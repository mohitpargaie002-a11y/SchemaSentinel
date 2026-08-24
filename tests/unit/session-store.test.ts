import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileSessionStore, SessionPersistenceError } from "../../lib/agent/session-store.js";
import { PersistedSessionState } from "../../lib/domain/contracts.js";
import { promises as fs } from "fs";
import * as path from "path";

describe("FileSessionStore - Path Traversal & Schema Validation", () => {
  const testDir = path.join(process.cwd(), ".schemasentinel", "test_sessions");
  let store: FileSessionStore;

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    store = new FileSessionStore(testDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const validSessionState: PersistedSessionState = {
    sessionId: "sess_test_123",
    targetId: "staging-demo",
    repo: "mohitpargaie002-a11y/SchemaSentinel",
    migrationFilePath: "migrations/0038_add_order_status.sql",
    userPrompt: "Review migration",
    status: "AWAITING_APPROVAL",
    currentStep: "APPROVAL_REQUESTED",
    timeline: [
      {
        timestamp: new Date().toISOString(),
        step: "REQUEST_RECEIVED",
        status: "COMPLETED",
        details: "Test request",
      },
    ],
    activityEvents: [],
    evidenceItems: [],
    isReadOnly: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("saves and loads a valid session state successfully", async () => {
    await store.saveSession(validSessionState);
    const loaded = await store.loadSession("sess_test_123");

    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe("sess_test_123");
    expect(loaded?.status).toBe("AWAITING_APPROVAL");
  });

  it("strictly rejects path traversal in sessionId during save and load", async () => {
    const maliciousState = {
      ...validSessionState,
      sessionId: "../../../malicious_file",
    };

    await expect(store.saveSession(maliciousState)).rejects.toThrow(SessionPersistenceError);
    await expect(store.loadSession("../../../malicious_file")).rejects.toThrow(SessionPersistenceError);
  });

  it("returns null when loading non-existent session", async () => {
    const nonExistent = await store.loadSession("sess_non_existent");
    expect(nonExistent).toBeNull();
  });

  it("lists all persisted sessions", async () => {
    await store.saveSession(validSessionState);
    await store.saveSession({
      ...validSessionState,
      sessionId: "sess_test_456",
    });

    const list = await store.listSessions();
    expect(list).toContain("sess_test_123");
    expect(list).toContain("sess_test_456");
  });
});
