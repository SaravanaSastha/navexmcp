import { auditLogger, logger } from "../utils/logger.js";
import { sanitizeError } from "../utils/errors.js";
export function ok(data) {
    return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}
/**
 * Wraps a tool handler with audit logging and error sanitization so that
 * no cookie, password, or stack trace can leak into a tool response.
 */
export function wrap(ctx, tool, fn) {
    return async (args) => {
        const start = Date.now();
        try {
            const result = await fn(args);
            auditLogger.info({ tool, identity: ctx.identity, durationMs: Date.now() - start, success: true });
            return result;
        }
        catch (err) {
            logger.error({ tool, err }, "tool failed");
            auditLogger.info({ tool, identity: ctx.identity, durationMs: Date.now() - start, success: false });
            const safe = sanitizeError(err);
            return { content: [{ type: "text", text: JSON.stringify({ error: safe }) }], isError: true };
        }
    };
}
//# sourceMappingURL=context.js.map