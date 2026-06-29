import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "../config.js";
import { SessionManager } from "../services/session-manager.js";
import { ContextRegistry } from "../services/context-registry.js";
import { createAuthMiddleware, type AuthedRequest } from "../middleware/auth.js";
import { createApiRouter } from "./api-routes.js";
import { buildMcpServer } from "./build-mcp.js";
import { logger } from "../utils/logger.js";

export interface AppBundle {
  app: express.Express;
  sessions: SessionManager;
}

export function createApp(config: Config, fetchFn?: typeof fetch): AppBundle {
  const sessions = new SessionManager(config, fetchFn);
  const registry = new ContextRegistry(config, sessions);
  const requireAuth = createAuthMiddleware(config, sessions);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "25mb" })); // attachments/imports are base64 payloads

  // Demo web console (static page; all data calls still require Basic auth).
  app.use(express.static("public"));

  // Liveness/readiness — unauthenticated, no NAVEX call.
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", activeNavexSessions: sessions.sessionCount });
  });

  /**
   * MCP endpoint — stateless Streamable HTTP.
   * A fresh McpServer + transport is created per request, bound to the
   * caller's NAVEX context. This is the pattern Copilot Studio expects.
   */
  app.post("/mcp", requireAuth, async (req: AuthedRequest, res) => {
    // Visibility for Copilot Studio onboarding: log every arrival.
    logger.info(
      { identity: req.callerIdentity, method: (req.body as { method?: string })?.method, ua: req.headers["user-agent"] },
      "MCP request received",
    );
    try {
      const { api, metadata } = registry.getContext(req.navexCredentials!);
      const server = buildMcpServer({ api, metadata, identity: req.callerIdentity ?? "unknown" });
      // enableJsonResponse: plain application/json replies (instead of SSE frames)
      // — fewer moving parts through Power Platform's connector gateway.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, "MCP request failed");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless server: no SSE stream resumption, no server-side MCP sessions.
  const methodNotAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. This MCP server is stateless; use POST /mcp." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  // REST facade for the Power Platform custom connector (cloud flows).
  app.use("/api", requireAuth, createApiRouter(registry));

  return { app, sessions };
}
