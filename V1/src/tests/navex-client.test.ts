import { describe, it, expect } from "vitest";
import { NavexClient } from "../clients/navex-client.js";
import { NavexError } from "../utils/errors.js";
import { createMockNavexFetch } from "./mock-navex.js";

const opts = (fetchFn: typeof fetch, password = "secret") => ({
  baseUrl: "https://test.lockpath.app:4443",
  username: "apiuser",
  password,
  retryMax: 2,
  fetchFn,
});

describe("NavexClient", () => {
  it("logs in and captures the session cookie", async () => {
    const { fetchFn } = createMockNavexFetch();
    const client = new NavexClient(opts(fetchFn));
    await client.login();
    expect(client.isAuthenticated).toBe(true);
    expect(await client.ping()).toBe(true);
  });

  it("falls back to XML login on instances that reject the JSON login body", async () => {
    const { fetchFn, state } = createMockNavexFetch();
    state.xmlOnlyLogin = true;
    const client = new NavexClient(opts(fetchFn));
    await client.login();
    expect(client.isAuthenticated).toBe(true);
    expect(state.loginCalls).toBe(2); // JSON attempt, then XML fallback
  });

  it("rejects bad credentials with AUTH_FAILED", async () => {
    const { fetchFn } = createMockNavexFetch();
    const client = new NavexClient(opts(fetchFn, "wrong"));
    await expect(client.login()).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("auto-logs-in on first request and re-logs-in after session expiry", async () => {
    const { fetchFn, state } = createMockNavexFetch();
    const client = new NavexClient(opts(fetchFn));
    const list = await client.request<unknown[]>("GET", "/ComponentService/GetComponentList");
    expect(list).toHaveLength(2);
    expect(state.loginCalls).toBe(1);

    // Simulate server-side session invalidation.
    state.loggedIn = false;
    const again = await client.request<unknown[]>("GET", "/ComponentService/GetComponentList");
    expect(again).toHaveLength(2);
    expect(state.loginCalls).toBe(2); // one transparent re-login
  });

  it("retries on transient 5xx errors", async () => {
    const { fetchFn, state } = createMockNavexFetch();
    const client = new NavexClient(opts(fetchFn));
    await client.login();
    state.failNextWith = 503;
    const list = await client.request<unknown[]>("GET", "/ComponentService/GetComponentList");
    expect(list).toHaveLength(2);
  });

  it("maps 403 to PERMISSION_DENIED without retry storm", async () => {
    const { fetchFn, state } = createMockNavexFetch();
    const client = new NavexClient(opts(fetchFn));
    await client.login();
    state.failNextWith = 403;
    await expect(client.request("GET", "/ComponentService/GetComponentList")).rejects.toBeInstanceOf(NavexError);
  });

  it("logout clears the cookie", async () => {
    const { fetchFn } = createMockNavexFetch();
    const client = new NavexClient(opts(fetchFn));
    await client.login();
    await client.logout();
    expect(client.isAuthenticated).toBe(false);
  });
});
