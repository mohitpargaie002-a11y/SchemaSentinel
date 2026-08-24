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

  it("strictly rejects invalid sessionId characters", async () => {
    const invalidCharsState = {
      ...validSessionState,
      sessionId: "session!@#$%",
    };

    await expect(store.saveSession(invalidCharsState)).rejects.toThrow(SessionPersistenceError);
    await expect(store.loadSession("session!@#$%")).rejects.toThrow(SessionPersistenceError);
  });

  it("throws SessionPersistenceError when persisted file is corrupted JSON", async () => {
    const corruptedPath = path.join(testDir, "corrupted_session.json");
    await fs.writeFile(corruptedPath, "{ invalid json content ...", "utf-8");

    await expect(store.loadSession("corrupted_session")).rejects.toThrow(SessionPersistenceError);
  });
});
