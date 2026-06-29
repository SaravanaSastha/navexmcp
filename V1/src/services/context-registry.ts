import { createHash } from "node:crypto";
import type { Config } from "../config.js";
import type { Credentials, SessionManager } from "./session-manager.js";
import { NavexApi } from "./navex-api.js";
import { MetadataCache } from "./metadata-cache.js";

export interface NavexContext {
  api: NavexApi;
  metadata: MetadataCache;
}

/**
 * One NavexApi + MetadataCache per credential set, layered on the
 * SessionManager so metadata caching survives across requests.
 */
export class ContextRegistry {
  private readonly contexts = new Map<string, NavexContext>();

  constructor(private readonly config: Config, private readonly sessions: SessionManager) {}

  getContext(creds: Credentials): NavexContext {
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
