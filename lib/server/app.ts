import http from "http";
import fs from "fs/promises";
import path from "path";
import { defaultOrchestrator, TrueForgeOrchestrator } from "../agent/orchestrator.js";
import { defaultSessionStore, ISessionStore } from "../agent/session-store.js";
import { defaultTargetRegistry, TargetRegistry } from "../safety/target-allowlist.js";

export interface CreateServerOptions {
  orchestrator?: TrueForgeOrchestrator;
  sessionStore?: ISessionStore;
  targetRegistry?: TargetRegistry;
  staticDir?: string;
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

  const server = http.createServer(async (req, res) => {
    // CORS headers for safety & local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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

    const sendError = (statusCode: number, message: string) => {
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message, statusCode }));
    };

    const parseJsonBody = async (): Promise<Record<string, unknown>> => {
      return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
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
            reject(new Error("Invalid JSON body"));
          }
        });
        req.on("error", reject);
      });
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

      // 3. List Sessions API
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

      // 4. Create Session API (Triggers Migration Review)
      if (req.method === "POST" && pathname === "/api/sessions") {
        const body = await parseJsonBody();
        const targetId = typeof body.targetId === "string" ? body.targetId : "staging-demo";
        const repo = typeof body.repo === "string" ? body.repo : "mohitpargaie002-a11y/SchemaSentinel";
        const migrationFilePath = typeof body.migrationFilePath === "string" ? body.migrationFilePath : "migrations/0038_add_order_status.sql";
        const userPrompt = typeof body.userPrompt === "string" ? body.userPrompt : `Review migration ${migrationFilePath}`;
        const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : `sess_${Date.now()}`;

        const result = await orchestrator.executeReviewWorkflow({
          sessionId,
          targetId,
          repo,
          migrationFilePath,
          userPrompt,
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

      // 5. Get Single Session API
      const singleSessionMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)$/);
      if (req.method === "GET" && singleSessionMatch) {
        const sessionId = singleSessionMatch[1];
        const session = await sessionStore.loadSession(sessionId);
        if (!session) {
          return sendError(404, `Session '${sessionId}' not found`);
        }
        return sendJson(200, { session });
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

      // 7. Approve Session API
      const approveMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/approve$/);
      if (req.method === "POST" && approveMatch) {
        const sessionId = approveMatch[1];
        const body = await parseJsonBody();
        const approvalToken = typeof body.approvalToken === "string" ? body.approvalToken : undefined;
        const approvedBy = typeof body.approvedBy === "string" ? body.approvedBy : "lead-dba@schemasentinel.dev";

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

      // 8. Reject Session API
      const rejectMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/reject$/);
      if (req.method === "POST" && rejectMatch) {
        const sessionId = rejectMatch[1];
        const body = await parseJsonBody();
        const approvedBy = typeof body.approvedBy === "string" ? body.approvedBy : "operator@schemasentinel.dev";

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
      const msg = err instanceof Error ? err.message : String(err);
      return sendError(500, `Internal Server Error: ${msg}`);
    }
  });

  return server;
}
