/** Error model. All errors crossing the MCP/REST boundary are sanitized. */
export class NavexError extends Error {
    code;
    httpStatus;
    constructor(message, code, httpStatus) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.name = "NavexError";
    }
}
export function fromHttpStatus(status, context) {
    if (status === 401)
        return new NavexError(`Authentication failed or session expired (${context}).`, "SESSION_EXPIRED", status);
    if (status === 403)
        return new NavexError(`Permission denied (${context}). Check the account's Security Role.`, "PERMISSION_DENIED", status);
    if (status === 404)
        return new NavexError(`Not found (${context}). API call names are case-sensitive.`, "NOT_FOUND", status);
    if (status === 429)
        return new NavexError(`NAVEX rate limit hit (${context}).`, "RATE_LIMITED", status);
    if (status >= 500)
        return new NavexError(`NAVEX server error ${status} (${context}).`, "UPSTREAM", status);
    return new NavexError(`Unexpected NAVEX response ${status} (${context}).`, "UPSTREAM", status);
}
/**
 * Returns a message safe to show to clients: no stack traces, no cookies,
 * no credentials, no internal URLs.
 */
export function sanitizeError(err) {
    if (err instanceof NavexError)
        return { code: err.code, message: err.message };
    if (err instanceof Error && err.name === "ZodError") {
        return { code: "VALIDATION", message: "Input validation failed. Check tool arguments." };
    }
    return { code: "INTERNAL", message: "An internal error occurred. Check server logs for details." };
}
export function isRetryable(err) {
    if (err instanceof NavexError)
        return err.code === "RATE_LIMITED" || err.code === "UPSTREAM";
    // Network-level failures (fetch TypeError, ECONNRESET, etc.)
    return err instanceof TypeError || (err instanceof Error && /ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(err.message));
}
//# sourceMappingURL=errors.js.map