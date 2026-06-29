import { createHash } from "node:crypto";
import { NavexApi } from "./navex-api.js";
import { MetadataCache } from "./metadata-cache.js";
/**
 * One NavexApi + MetadataCache per credential set, layered on the
 * SessionManager so metadata caching survives across requests.
 */
export class ContextRegistry {
    config;
    sessions;
    contexts = new Map();
    constructor(config, sessions) {
        this.config = config;
        this.sessions = sessions;
    }
    getContext(creds) {
        const key = createHash("sha256").update(`${creds.username} ${creds.password}`).digest("hex");
        let ctx = this.contexts.get(key);
        if (!ctx) {
            const api = new NavexApi(this.sessions.getClient(creds));
            ctx = { api, metadata: new MetadataCache(api, this.config.metadataCacheTtlMs) };
            this.contexts.set(key, ctx);
        }
        return ctx;
    }
}
//# sourceMappingURL=context-registry.js.map