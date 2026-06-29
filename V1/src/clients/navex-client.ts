import { logger } from "../utils/logger.js";
import { NavexError, fromHttpStatus, isRetryable } from "../utils/errors.js";

export interface NavexClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  /** Required for LDAP/SSO-backed NAVEX accounts; plain logins return false for those. */
  ldapSettingsId?: number;
  maxConcurrent?: number;
  retryMax?: number;
  /** injectable for tests */
  fetchFn?: typeof fetch;
}

/** Simple semaphore to cap concurrent calls against the NAVEX instance. */
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    return () => this.release();
  }
  private release() {
    this.active--;
    this.queue.shift()?.();
  }
}

/**
 * Low-level NAVEX IRM HTTP client.
 * Owns the session cookie lifecycle: Login -> cookie -> re-login on 401.
 * Cookies never leave this class.
 */
export class NavexClient {
  private cookie: string | null = null;
  private loginPromise: Promise<void> | null = null;
  private readonly sem: Semaphore;
  private readonly retryMax: number;
  private readonly fetchFn: typeof fetch;
  public lastUsedAt = Date.now();

  constructor(private readonly opts: NavexClientOptions) {
    this.sem = new Semaphore(opts.maxConcurrent ?? 4);
    this.retryMax = opts.retryMax ?? 3;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  get isAuthenticated(): boolean {
    return this.cookie !== null;
  }

  private extractCookie(res: Response): string | null {
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const single = setCookie.length > 0 ? setCookie : [res.headers.get("set-cookie") ?? ""];
    const jar = single
      .filter(Boolean)
      .map((c) => c.split(";")[0]!)
      .join("; ");
    return jar || null;
  }

  /** Login succeeded if the body is `true` (JSON) or `<boolean...>true</boolean>` (XML). */
  private static loginAccepted(body: string): boolean {
    const stripped = body.trim().replace(/<[^>]+>/g, "").trim().toLowerCase();
    return stripped === "true";
  }

  /** Human-readable diagnosis of a refused login, safe to surface to clients. */
  private static classifyLoginRefusal(body: string, baseUrl: string): string {
    const t = body.trim();
    const stripped = t.replace(/<[^>]+>/g, "").trim().toLowerCase();
    if (stripped === "false") {
      return "NAVEX answered 'false': the platform itself refused this account. Causes in order of likelihood: (1) 'API Access' is not enabled for this user in NAVEX Security settings, (2) the account is locked after repeated failed attempts, (3) wrong password for THIS instance (sandbox vs prod credentials differ).";
    }
    if (/<html|<!doctype/i.test(t)) {
      return `The response was an HTML page, not an API reply — a proxy/WAF/SSO gateway intercepted the request before it reached NAVEX (check VPN and that ${baseUrl} is the correct API host).`;
    }
    if (t === "") return "NAVEX returned an empty body.";
    return `Unexpected login response starting with: "${t.slice(0, 80)}"`;
  }

  private lastAuthFailureAt = 0;
  private lastAuthFailureMsg = "";

  private async attemptLogin(format: "json" | "xml"): Promise<{ accepted: boolean; cookie: string | null; status: number; body: string }> {
    const xmlEscape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    const res = await this.fetchFn(`${this.opts.baseUrl}/SecurityService/Login`, {
      method: "POST",
      headers:
        format === "json"
          ? { "content-type": "application/json", accept: "application/json" }
          : { "content-type": "application/xml;charset=utf-8" },
      body:
        format === "json"
          ? JSON.stringify({
              username: this.opts.username,
              password: this.opts.password,
              ...(this.opts.ldapSettingsId !== undefined ? { ldapSettingsId: String(this.opts.ldapSettingsId) } : {}),
            })
          : `<Login><username>${xmlEscape(this.opts.username)}</username><password>${xmlEscape(this.opts.password)}</password>${
              this.opts.ldapSettingsId !== undefined ? `<ldapSettingsId>${this.opts.ldapSettingsId}</ldapSettingsId>` : ""
            }</Login>`,
    });
    const body = await res.text();
    const accepted = res.ok && NavexClient.loginAccepted(body);
    if (!accepted) {
      // Diagnostic: the login body is a boolean or an error/WAF page — never credentials.
      logger.warn(
        {
          format,
          status: res.status,
          contentType: res.headers.get("content-type"),
          hasSetCookie: this.extractCookie(res) !== null,
          bodyPreview: body.slice(0, 300),
        },
        "NAVEX login attempt not accepted",
      );
    }
    return { accepted, cookie: this.extractCookie(res), status: res.status, body };
  }

  /**
   * SecurityService/Login — stores the encrypted session cookie.
   * Tries the JSON login format first; falls back to XML automatically
   * (some Keylight-era instances only accept the XML login body).
   */
  async login(): Promise<void> {
    // Collapse concurrent login attempts into one.
    if (this.loginPromise) return this.loginPromise;
    // Lockout protection: don't hammer NAVEX with login attempts while it is
    // refusing this account (agents retry aggressively and can lock accounts).
    if (Date.now() - this.lastAuthFailureAt < 60_000) {
      throw new NavexError(
        `${this.lastAuthFailureMsg} (Login attempts paused for 60s to protect the account from lockout.)`,
        "AUTH_FAILED",
      );
    }
    this.loginPromise = (async () => {
      let result = await this.attemptLogin("json");
      if (!result.accepted) {
        logger.debug({ status: result.status }, "JSON login not accepted; retrying with XML login format");
        result = await this.attemptLogin("xml");
      }
      if (!result.accepted) {
        const diagnosis = NavexClient.classifyLoginRefusal(result.body, this.opts.baseUrl);
        this.lastAuthFailureAt = Date.now();
        this.lastAuthFailureMsg = `NAVEX login refused (HTTP ${result.status}). ${diagnosis}`;
        throw new NavexError(this.lastAuthFailureMsg, "AUTH_FAILED", result.status);
      }
      if (!result.cookie) throw new NavexError("NAVEX login returned no session cookie.", "AUTH_FAILED");
      this.cookie = result.cookie;
      this.lastAuthFailureAt = 0;
      logger.info("NAVEX session established");
    })().finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  /** SecurityService/Ping — refreshes the session; returns false if invalid. */
  async ping(): Promise<boolean> {
    if (!this.cookie) return false;
    try {
      const res = await this.fetchFn(`${this.opts.baseUrl}/SecurityService/Ping`, {
        headers: { accept: "application/json", cookie: this.cookie },
      });
      return res.ok && (await res.text()).trim() === "true";
    } catch {
      return false;
    }
  }

  /** SecurityService/Logout — best-effort session termination. */
  async logout(): Promise<void> {
    if (!this.cookie) return;
    try {
      await this.fetchFn(`${this.opts.baseUrl}/SecurityService/Logout`, {
        headers: { accept: "application/json", cookie: this.cookie },
      });
    } catch {
      /* best effort */
    } finally {
      this.cookie = null;
    }
  }

  /**
   * Authenticated JSON request with retry/backoff and automatic
   * one-shot re-login on session expiry.
   */
  async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    this.lastUsedAt = Date.now();
    if (!this.cookie) await this.login();

    const release = await this.sem.acquire();
    try {
      let attempt = 0;
      let reloggedIn = false;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const res = await this.fetchFn(`${this.opts.baseUrl}${path}`, {
            method,
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              cookie: this.cookie!,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          if (res.status === 401 && !reloggedIn) {
            reloggedIn = true;
            this.cookie = null;
            await this.login();
            continue;
          }
          if (!res.ok) throw fromHttpStatus(res.status, path);
          const text = await res.text();
          if (text.trim().length === 0) return undefined as T;
          try {
            return JSON.parse(text) as T;
          } catch {
            // Some endpoints return bare scalars ("true") or raw export bytes.
            return text as unknown as T;
          }
        } catch (err) {
          if (attempt < this.retryMax && isRetryable(err)) {
            attempt++;
            const delay = Math.min(2 ** attempt * 250, 4_000) + Math.random() * 100;
            logger.warn({ path, attempt, delay }, "retrying NAVEX call");
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw err;
        }
      }
    } finally {
      release();
    }
  }

  /** Binary GET (report export) returned as base64. */
  async requestBinary(path: string): Promise<{ base64: string; contentType: string }> {
    this.lastUsedAt = Date.now();
    if (!this.cookie) await this.login();
    const res = await this.fetchFn(`${this.opts.baseUrl}${path}`, {
      headers: { cookie: this.cookie! },
    });
    if (!res.ok) throw fromHttpStatus(res.status, path);
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString("base64"), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }
}
