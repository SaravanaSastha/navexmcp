import { timingSafeEqual } from "node:crypto";
function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
}
/**
 * STRICT inbound auth — NAVEX username/password (HTTP Basic) is the default
 * and only out-of-the-box mechanism. Every caller authenticates with their
 * own NAVEX account; all NAVEX permissions and audit attribution follow that
 * account. No anonymous access, no implicit service account.
 *
 * API-key auth is an explicit opt-in: it activates only when BOTH `API_KEYS`
 * and the NAVEX service-account credentials are configured. Otherwise any
 * `x-api-key` is rejected.
 */
export function createAuthMiddleware(config, sessions) {
    const apiKeysEnabled = config.apiKeys.length > 0 && !!config.navexServiceUsername && !!config.navexServicePassword;
    return (req, res, next) => {
        const header = req.headers.authorization;
        if (header?.startsWith("Basic ")) {
            const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
            const sep = decoded.indexOf(":");
            const username = decoded.slice(0, sep);
            const password = decoded.slice(sep + 1);
            if (sep > 0 && username.length > 0 && password.length > 0) {
                req.navexCredentials = { username, password };
                req.callerIdentity = username;
                next();
                return;
            }
            res.status(401).json({
                error: { code: "AUTH_FAILED", message: "Malformed Basic credentials. Expected NAVEX username and password." },
            });
            return;
        }
        const apiKey = req.headers["x-api-key"];
        if (typeof apiKey === "string") {
            if (apiKeysEnabled && config.apiKeys.some((k) => safeEqual(k, apiKey))) {
                req.navexCredentials = sessions.serviceCredentials();
                req.callerIdentity = `api-key:${apiKey.slice(-4)}`;
                next();
                return;
            }
            res.status(401).json({
                error: {
                    code: "AUTH_FAILED",
                    message: apiKeysEnabled
                        ? "Invalid API key."
                        : "API-key auth is disabled on this server. Authenticate with your NAVEX username and password (Basic auth).",
                },
            });
            return;
        }
        res
            .status(401)
            .set("WWW-Authenticate", 'Basic realm="navex-irm-mcp"')
            .json({
            error: {
                code: "AUTH_FAILED",
                message: "Authentication required: provide your NAVEX username and password via HTTP Basic auth.",
            },
        });
    };
}
//# sourceMappingURL=auth.js.map