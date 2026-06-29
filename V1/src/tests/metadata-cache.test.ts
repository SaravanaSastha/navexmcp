import { describe, it, expect } from "vitest";
import { NavexClient } from "../clients/navex-client.js";
import { NavexApi } from "../services/navex-api.js";
import { MetadataCache } from "../services/metadata-cache.js";
import { createMockNavexFetch } from "./mock-navex.js";

function setup() {
  const { fetchFn, state } = createMockNavexFetch();
  const client = new NavexClient({ baseUrl: "https://test.lockpath.app:4443", username: "u", password: "p", fetchFn });
  const api = new NavexApi(client);
  return { cache: new MetadataCache(api, 60_000), fetchFn, state };
}

describe("MetadataCache", () => {
  it("resolves components by alias case-insensitively", async () => {
    const { cache } = setup();
    const comp = await cache.resolveComponent("incidentreports");
    expect(comp.Id).toBe(10021);
  });

  it("resolves components by numeric ID", async () => {
    const { cache } = setup();
    const comp = await cache.resolveComponent(10001);
    expect(comp.ShortName).toBe("Devices");
  });

  it("caches the component list between calls", async () => {
    const { cache, fetchFn } = setup();
    await cache.listComponents();
    await cache.listComponents();
    const listCalls = (fetchFn as ReturnType<typeof import("vitest")["vi"]["fn"]>).mock.calls
      .filter((c: unknown[]) => String(c[0]).includes("GetComponentList"));
    expect(listCalls).toHaveLength(1);
  });

  it("resolves fields by name and by ID", async () => {
    const { cache } = setup();
    const byName = await cache.resolveField(10001, "Cost");
    expect(byName.Id).toBe(9);
    const byId = await cache.resolveField(10001, 11);
    expect(byId.Name).toBe("IP Address");
  });

  it("throws NOT_FOUND for unknown fields with guidance", async () => {
    const { cache } = setup();
    await expect(cache.resolveField(10001, "Nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("invalidate() clears caches", async () => {
    const { cache, fetchFn } = setup();
    await cache.listComponents();
    cache.invalidate();
    await cache.listComponents();
    const listCalls = (fetchFn as ReturnType<typeof import("vitest")["vi"]["fn"]>).mock.calls
      .filter((c: unknown[]) => String(c[0]).includes("GetComponentList"));
    expect(listCalls).toHaveLength(2);
  });
});
