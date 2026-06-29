import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NavexApi } from "../services/navex-api.js";
import type { MetadataCache } from "../services/metadata-cache.js";
import { auditLogger, logger } from "../utils/logger.js";
import { sanitizeError } from "../utils/errors.js";

export interface ToolContext {
  api: NavexApi;
  metadata: MetadataCache;
  /** caller identity for audit: NAVEX username or "api-key:<suffix>" */
  identity: string;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

export function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

/**
 * Wraps a tool handler with audit logging and error sanitization so that
 * no cookie, password, or stack trace can leak into a tool response.
 */
export function wrap<A>(ctx: ToolContext, tool: string, fn: (args: A) => Promise<ToolResult>) {
  return async (args: A): Promise<ToolResult> => {
    const start = Date.now();
    try {
      const result = await fn(args);
      auditLogger.info({ tool, identity: ctx.identity, durationMs: Date.now() - start, success: true });
      return result;
    } catch (err) {
      logger.error({ tool, err }, "tool failed");
      auditLogger.info({ tool, identity: ctx.identity, durationMs: Date.now() - start, success: false });
      const safe = sanitizeError(err);
      return { content: [{ type: "text", text: JSON.stringify({ error: safe }) }], isError: true };
    }
  };
}

export type RegisterFn = (server: McpServer, ctx: ToolContext) => void;
