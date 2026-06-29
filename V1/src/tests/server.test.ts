import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../server/http.js";
import { loadConfig } from "../config.js";
import { createMockNavexFetch } from "./mock-navex.js";
import type { SessionManager } from "../services/session-manager.js";

// Strict default: Basic auth only — no API keys, no service account.
const TEST_ENV = {
  NAVEX_BASE_URL: "https://test.lockpath.app:4443",
} as NodeJS.ProcessEnv;

const basic = "Basic " + Buffer.from("apiuser:secret").toString("base64");

describe("HTTP server (MCP + REST facade)", () => {
  let baseUrl: string;
  let httpServer: Server;
  let sessions: SessionManager;

  beforeAll(async () => {
    const { fetchFn } = createMockNavexFetch();
    const bundle = createApp(loadConfig(TEST_ENV), fetchFn);
    sessions = bundle.sessions;
    httpServer = bundle.app.listen(0);
    await new Promise((r) => httpServer.once("listening", r));
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    httpServer.close();
    await sessions.shutdown();
  });

  it("healthz responds without auth", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("rejects unauthenticated MCP and API requests", async () => {
    const mcp = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(mcp.status).toBe(401);
    const api = await fetch(`${baseUrl}/api/components`);
    expect(api.status).toBe(401);
  });

  it("rejects API keys entirely in strict (default) mode", async () => {
    const res = await fetch(`${baseUrl}/api/components`, { headers: { "x-api-key": "any-key-at-all-1234567890" } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.message).toContain("API-key auth is disabled");
  });

  it("rejects malformed Basic credentials", async () => {
    const res = await fetch(`${baseUrl}/api/components`, {
      headers: { authorization: "Basic " + Buffer.from("useronly").toString("base64") },
    });
    expect(res.status).toBe(401);
  });

  it("REST facade lists components with Basic auth (NAVEX pass-through)", async () => {
    const res = await fetch(`${baseUrl}/api/components`, { headers: { authorization: basic } });
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.map((c: { ShortName: string }) => c.ShortName)).toContain("Devices");
  });

  it("REST facade searches records by alias with friendly filters", async () => {
    const res = await fetch(`${baseUrl}/api/components/Devices/records/search`, {
      method: "POST",
      headers: { authorization: basic, "content-type": "application/json" },
      body: JSON.stringify({ filters: [{ field: "IPAddress", filterType: "IsNotNull" }], pageSize: 10 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(2);
  });

  it("config rejects API_KEYS without a service account (strict invariant)", () => {
    expect(() =>
      loadConfig({ ...TEST_ENV, API_KEYS: "some-key-0123456789abcdef" } as NodeJS.ProcessEnv),
    ).toThrow(/service/i);
  });

  it("MCP initialize handshake succeeds over Streamable HTTP", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: basic, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"name":"navex-irm"');
  });

  it("MCP tools/list exposes the NAVEX tool surface", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: basic, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const text = await res.text();
    for (const tool of ["search_records", "create_record", "transition_record", "export_report", "issue_assessment", "list_components"]) {
      expect(text).toContain(`"${tool}"`);
    }
  });

  it("MCP tools/call search_records returns NAVEX data", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: basic, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "search_records", arguments: { component: "Devices", pageIndex: 0, pageSize: 10 } },
      }),
    });
    const text = await res.text();
    expect(text).toContain("192.168.1.84");
  });

  it("GET /mcp returns 405 (stateless mode)", async () => {
    const res = await fetch(`${baseUrl}/mcp`);
    expect(res.status).toBe(405);
  });
});
