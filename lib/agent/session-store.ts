import { promises as fs } from "fs";
import * as path from "path";
import {
  PersistedSessionState,
  PersistedSessionStateSchema,
  SentinelError,
} from "../domain/contracts.js";

export type { PersistedSessionState };
export { PersistedSessionStateSchema };

export class SessionPersistenceError extends SentinelError {
  constructor(message: string) {
    super(`[SessionPersistence Error]: ${message}`);
    this.name = "SessionPersistenceError";
  }
}

export interface ISessionStore {
  saveSession(state: PersistedSessionState): Promise<void>;
  loadSession(sessionId: string): Promise<PersistedSessionState | null>;
  listSessions(): Promise<string[]>;
  deleteSession(sessionId: string): Promise<void>;
}

export class FileSessionStore implements ISessionStore {
  private baseDir: string;
  private memoryFallback: Map<string, PersistedSessionState> = new Map();

  constructor(baseDir?: string) {
    this.baseDir = path.resolve(baseDir || path.join(process.cwd(), ".schemasentinel", "sessions"));
  }

  /**
   * Sanitizes and verifies that a sessionId cannot escape the base directory.
   */
  private getSafeFilePath(sessionId: string): string {
    if (!sessionId || typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) {
      throw new SessionPersistenceError(
        `Invalid sessionId '${sessionId}'. Session IDs must contain only alphanumeric characters, underscores, or dashes (max 64 chars).`
      );
    }

    const resolvedBase = path.resolve(this.baseDir);
    const resolvedPath = path.resolve(this.baseDir, `${sessionId}.json`);

    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
      throw new SessionPersistenceError(`Path traversal attempt detected with sessionId '${sessionId}'.`);
    }

    return resolvedPath;
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SessionPersistenceError(`Failed to create session directory '${this.baseDir}': ${msg}`);
    }
  }

  public async saveSession(state: PersistedSessionState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    // Validate schema before persisting
    const validatedState = PersistedSessionStateSchema.parse(state);
    const filePath = this.getSafeFilePath(validatedState.sessionId);

    this.memoryFallback.set(validatedState.sessionId, JSON.parse(JSON.stringify(validatedState)));

    try {
      await this.ensureDir();
      await fs.writeFile(filePath, JSON.stringify(validatedState, null, 2), "utf-8");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SessionPersistenceError(`Failed to persist session '${validatedState.sessionId}' to '${filePath}': ${msg}`);
    }
  }

  public async loadSession(sessionId: string): Promise<PersistedSessionState | null> {
    const filePath = this.getSafeFilePath(sessionId);

    try {
      const data = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(data);
      const validated = PersistedSessionStateSchema.parse(parsed);
      this.memoryFallback.set(sessionId, validated);
      return validated;
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "ENOENT") {
        return this.memoryFallback.get(sessionId) || null;
      }
      if (err instanceof Error && err.name === "ZodError") {
        throw new SessionPersistenceError(`Persisted session data for '${sessionId}' failed schema validation: ${err.message}`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new SessionPersistenceError(`Failed to load session '${sessionId}' from '${filePath}': ${msg}`);
    }
  }

  public async listSessions(): Promise<string[]> {
    try {
      await this.ensureDir();
      const files = await fs.readdir(this.baseDir);
      const diskSessions = files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
      const allSessions = new Set([...diskSessions, ...this.memoryFallback.keys()]);
      return Array.from(allSessions);
    } catch {
      return Array.from(this.memoryFallback.keys());
    }
  }

  public async deleteSession(sessionId: string): Promise<void> {
    const filePath = this.getSafeFilePath(sessionId);
    this.memoryFallback.delete(sessionId);

    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "ENOENT") {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new SessionPersistenceError(`Failed to delete session '${sessionId}': ${msg}`);
    }
  }
}

export const defaultSessionStore = new FileSessionStore();
