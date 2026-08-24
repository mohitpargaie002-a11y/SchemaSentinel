import { promises as fs } from "fs";
import * as path from "path";
import {
  AgentTimelineEvent,
} from "./types.js";
import {
  MigrationPlan,
  SandboxValidationResult,
  ApprovalCheckpoint,
  ApplyResult,
  VerificationResult,
  SchemaSnapshot,
  SessionStatus,
} from "../domain/contracts.js";
import { ComprehensiveRiskReport } from "./risk-analyzer.js";
import { TrueForgeApprovalPacket } from "./session.js";

export interface PersistedSessionState {
  sessionId: string;
  targetId: string;
  repo: string;
  migrationFilePath: string;
  userPrompt: string;
  status: SessionStatus;
  currentStep: string;
  schemaSnapshot?: SchemaSnapshot;
  plan?: MigrationPlan;
  riskReport?: ComprehensiveRiskReport;
  sandboxResult?: SandboxValidationResult;
  approvalCheckpoint?: ApprovalCheckpoint;
  approvalPacket?: TrueForgeApprovalPacket;
  applyResult?: ApplyResult;
  verificationResult?: VerificationResult;
  timeline: AgentTimelineEvent[];
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
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
    this.baseDir = baseDir || path.resolve(process.cwd(), ".schemasentinel", "sessions");
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch {
      // Memory fallback if filesystem unavailable
    }
  }

  public async saveSession(state: PersistedSessionState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    this.memoryFallback.set(state.sessionId, JSON.parse(JSON.stringify(state)));

    try {
      await this.ensureDir();
      const filePath = path.join(this.baseDir, `${state.sessionId}.json`);
      await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      // Retain in memory
    }
  }

  public async loadSession(sessionId: string): Promise<PersistedSessionState | null> {
    try {
      const filePath = path.join(this.baseDir, `${sessionId}.json`);
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data) as PersistedSessionState;
    } catch {
      return this.memoryFallback.get(sessionId) || null;
    }
  }

  public async listSessions(): Promise<string[]> {
    try {
      await this.ensureDir();
      const files = await fs.readdir(this.baseDir);
      return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    } catch {
      return Array.from(this.memoryFallback.keys());
    }
  }

  public async deleteSession(sessionId: string): Promise<void> {
    this.memoryFallback.delete(sessionId);
    try {
      const filePath = path.join(this.baseDir, `${sessionId}.json`);
      await fs.unlink(filePath);
    } catch {
      // Ignore
    }
  }
}

export const defaultSessionStore = new FileSessionStore();
