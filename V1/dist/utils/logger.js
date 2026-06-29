import { pino } from "pino";
export const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    // Defense-in-depth: never log credentials, cookies, or auth headers.
    redact: {
        paths: [
            "password",
            "*.password",
            "username",
            "*.username",
            "cookie",
            "*.cookie",
            "headers.authorization",
            "headers.cookie",
            "*.headers.authorization",
            "*.headers.cookie",
            "apiKey",
            "*.apiKey",
        ],
        censor: "[REDACTED]",
    },
    base: { service: "navex-irm-mcp" },
});
/** Audit logger: who did what, when, outcome. No payloads. */
export const auditLogger = logger.child({ channel: "audit" });
//# sourceMappingURL=logger.js.map