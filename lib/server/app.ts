import http from "http";
import fs from "fs/promises";
import path from "path";
import { defaultOrchestrator, TrueForgeOrchestrator } from "../agent/orchestrator.js";
import { defaultSessionStore, ISessionStore, PersistedSessionState } from "../agent/session-store.js";
import { defaultTargetRegistry, TargetRegistry } from "../safety/target-allowlist.js";
import {
  ApproveSessionRequestSchema,
  CreateSessionRequestSchema,
  RejectSessionRequestSchema,
} from "../domain/contracts.js";

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB defensive limit

export interface CreateServerOptions {
  orchestrator?: TrueForgeOrchestrator;
  sessionStore?: ISessionStore;
  targetRegistry?: TargetRegistry;
  staticDir?: string;
  allowedOrigins?: string[];
}

export function createSchemaSentinelServer(options: CreateServerOptions = {}) {
  const sessionStore = options.sessionStore || defaultSessionStore;
  const orchestrator =
    options.orchestrator ||
    (options.sessionStore
      ? new TrueForgeOrchestrator(undefined, undefined, undefined, sessionStore)
      : defaultOrchestrator);
  const targetRegistry = options.targetRegistry || defaultTargetRegistry;
  const staticDir = options.staticDir || path.resolve(process.cwd(), "public");
  const allowedOrigins = options.allowedOrigins || ["http://localhost:3000", "http://127.0.0.1:3000"];

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes(origin) || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
      res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    const sendJson = (statusCode: number, data: unknown) => {
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    const sendError = (statusCode: number, message: string, details?: unknown) => {
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message, statusCode, details }));
    };

    const parseJsonBody = async (): Promise<Record<string, unknown>> => {
      return new Promise((resolve, reject) => {
        const contentLength = req.headers["content-length"];
        if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
          const err = new Error("Payload Too Large");
          (err as unknown as { statusCode: number }).statusCode = 413;
          req.destroy();
          return reject(err);
        }

        let body = "";
        let receivedBytes = 0;

        req.on("data", (chunk: Buffer | string) => {
          receivedBytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
          if (receivedBytes > MAX_BODY_SIZE) {
            const err = new Error("Payload Too Large");
            (err as unknown as { statusCode: number }).statusCode = 413;
            req.destroy();
            return reject(err);
          }
          body += chunk;
        });

        req.on("end", () => {
          if (!body.trim()) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            const err = new Error("Invalid JSON body");
            (err as unknown as { statusCode: number }).statusCode = 400;
            reject(err);
          }
        });

        req.on("error", reject);
      });
    };

    /**
     * Sanitizes sensitive secrets before returning session data to API callers.
     */
    const sanitizeSessionState = (s: PersistedSessionState): Record<string, unknown> => {
      const sanitized = { ...s };
      if (sanitized.approvalPacket) {
        sanitized.approvalPacket = {
          ...sanitized.approvalPacket,
          approvalToken: sanitized.approvalPacket.approvalToken
            ? `sat_...${sanitized.approvalPacket.approvalToken.slice(-6)} (REDACTED)`
            : "",
        };
      }
      if (sanitized.approvalCheckpoint) {
        sanitized.approvalCheckpoint = {
          ...sanitized.approvalCheckpoint,
          token: sanitized.approvalCheckpoint.token
            ? `sat_...${sanitized.approvalCheckpoint.token.slice(-6)} (REDACTED)`
            : "",
        };
      }
      return sanitized;
    };

    try {
      // 1. Health API
      if (req.method === "GET" && pathname === "/api/health") {
        return sendJson(200, {
          status: "ok",
          service: "SchemaSentinel",
          version: "0.1.0",
          timestamp: new Date().toISOString(),
        });
      }

      // 2. Targets API
      if (req.method === "GET" && pathname === "/api/targets") {
        const targets = targetRegistry.listAllowedTargets().map((t) => ({
          id: t.id,
          name: t.name,
          environment: t.environment,
          mutable: t.mutable,
          allowedToApply: t.allowedToApply,
          approvalRequired: t.approvalRequired,
        }));
        return sendJson(200, { targets });
      }

      // 3. List Sessions API (Sanitizes tokens)
      if (req.method === "GET" && pathname === "/api/sessions") {
        const sessionIds = await sessionStore.listSessions();
        const summaries = [];
        for (const id of sessionIds) {
          const s = await sessionStore.loadSession(id);
          if (s) {
            summaries.push({
              sessionId: s.sessionId,
              targetId: s.targetId,
              status: s.status,
              currentStep: s.currentStep,
              migrationFilePath: s.migrationFilePath,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
            });
          }
        }
        return sendJson(200, { sessions: summaries });
      }

      // 4. Create Session API (Zod Boundary Validation & Conflict Check)
      if (req.method === "POST" && pathname === "/api/sessions") {
        const rawBody = await parseJsonBody();
        const parseResult = CreateSessionRequestSchema.safeParse(rawBody);
        if (!parseResult.success) {
          return sendError(400, "Invalid session request payload", parseResult.error.format());
        }

        const { targetId, repo, migrationFilePath, userPrompt, sessionId: requestedSessionId } = parseResult.data;
        const sessionId = requestedSessionId || `sess_${Date.now()}`;

        // Check for session collision (Prevent overwriting existing session)
        const existing = await sessionStore.loadSession(sessionId);
        if (existing) {
          return sendError(409, `Session '${sessionId}' already exists. Overwrite rejected.`);
        }

        const result = await orchestrator.executeReviewWorkflow({
          sessionId,
          targetId,
          repo,
          migrationFilePath,
          userPrompt: userPrompt || `Review migration ${migrationFilePath}`,
        });

        return sendJson(201, {
          sessionId: result.context.sessionId,
          status: result.context.status,
          reviewReport: result.reviewReport,
          approvalPacket: result.approvalPacket,
          schemaAnalysis: result.schemaAnalysis,
          riskAnalysis: result.riskAnalysis,
          sandboxOutput: result.sandboxOutput,
          activityEvents: result.activityEvents,
        });
      }

      // 5. Get Single Session API (Sanitizes tokens)
      const singleSessionMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)$/);
      if (req.method === "GET" && singleSessionMatch) {
        const sessionId = singleSessionMatch[1];
        const session = await sessionStore.loadSession(sessionId);
        if (!session) {
          return sendError(404, `Session '${sessionId}' not found`);
        }
        return sendJson(200, { session: sanitizeSessionState(session) });
      }

      // 6. Get Session Events API
      const eventsMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/events$/);
      if (req.method === "GET" && eventsMatch) {
        const sessionId = eventsMatch[1];
        const session = await sessionStore.loadSession(sessionId);
        if (!session) {
          return sendError(404, `Session '${sessionId}' not found`);
        }
        return sendJson(200, {
          sessionId,
          status: session.status,
          timeline: session.timeline || [],
          activityEvents: session.activityEvents || [],
        });
      }

      // 7. Approve Session API (Zod Boundary Validation & Authorization)
      const approveMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/approve$/);
      if (req.method === "POST" && approveMatch) {
        const sessionId = approveMatch[1];
        const rawBody = await parseJsonBody();
        const parseResult = ApproveSessionRequestSchema.safeParse(rawBody);
        if (!parseResult.success) {
          return sendError(400, "Invalid approval request payload", parseResult.error.format());
        }

        const { approvalToken, approvedBy } = parseResult.data;

        const resumeResult = await orchestrator.resumeAndApplyWorkflow({
          sessionId,
          humanDecision: "APPROVED",
          approvalToken,
          approvedBy,
        });

        return sendJson(200, {
          sessionId,
          status: resumeResult.sessionState.status,
          applyResult: resumeResult.applyResult,
          verificationResult: resumeResult.verificationResult,
          timeline: resumeResult.sessionState.timeline,
          activityEvents: resumeResult.sessionState.activityEvents,
        });
      }

      // 8. Reject Session API (Zod Boundary Validation)
      const rejectMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/reject$/);
      if (req.method === "POST" && rejectMatch) {
        const sessionId = rejectMatch[1];
        const rawBody = await parseJsonBody();
        const parseResult = RejectSessionRequestSchema.safeParse(rawBody);
        if (!parseResult.success) {
          return sendError(400, "Invalid rejection request payload", parseResult.error.format());
        }

        const { approvedBy } = parseResult.data;

        const rejectResult = await orchestrator.resumeAndApplyWorkflow({
          sessionId,
          humanDecision: "REJECTED",
          approvedBy,
        });

        return sendJson(200, {
          sessionId,
          status: rejectResult.sessionState.status,
          timeline: rejectResult.sessionState.timeline,
          activityEvents: rejectResult.sessionState.activityEvents,
        });
      }

      // 9. Static File Serving (Web UI)
      let filePath = pathname === "/" ? "/index.html" : pathname;
      const safePath = path.normalize(path.join(staticDir, filePath));

      if (!safePath.startsWith(path.normalize(staticDir))) {
        return sendError(403, "Access denied");
      }

      try {
        const fileContent = await fs.readFile(safePath);
        const ext = path.extname(safePath).toLowerCase();
        const contentTypes: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".js": "application/javascript; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        };
        res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
        res.end(fileContent);
        return;
      } catch {
        return sendError(404, `File '${pathname}' not found`);
      }
    } catch (err: unknown) {
      const statusCode = typeof (err as { statusCode?: number })?.statusCode === "number" ? (err as { statusCode: number }).statusCode : 500;
      const msg = err instanceof Error ? err.message : String(err);
      return sendError(statusCode, msg);
    }
  });

  return server;
}
