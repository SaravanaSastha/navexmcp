import { vi } from "vitest";

/** Minimal in-memory NAVEX IRM API double matching the v6.1 wire formats. */
export function createMockNavexFetch() {
  const state = {
    loggedIn: false,
    cookie: "Keylight=abc123",
    loginCalls: 0,
    failNextWith: null as number | null,
    /** Simulate older Keylight instances that only accept the XML login body. */
    xmlOnlyLogin: false,
  };

  const components = [
    { Id: 10001, Name: "Devices", SystemName: "Devices", ShortName: "Devices" },
    { Id: 10021, Name: "Incident Reports", SystemName: "IncidentReports", ShortName: "IncidentReports" },
  ];
  const fields = [
    { Id: 3, Name: "DNS Name", SystemName: "DNSName", ShortName: "DNSName", ReadOnly: false, Required: true, FieldType: 1, OneToMany: false },
    { Id: 9, Name: "Acquisition Cost", SystemName: "Cost", ShortName: "Cost", ReadOnly: false, Required: false, FieldType: 2, OneToMany: false },
    { Id: 11, Name: "IP Address", SystemName: "IPAddress", ShortName: "IPAddress", ReadOnly: false, Required: false, FieldType: 4, OneToMany: false },
  ];

  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const path = new URL(url).pathname;
    const headers = new Headers(init?.headers);

    const json = (data: unknown, opts: ResponseInit = {}) =>
      new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" }, ...opts });

    if (path === "/SecurityService/Login") {
      state.loginCalls++;
      const raw = String(init?.body ?? "");
      const isXml = raw.startsWith("<Login>");
      if (state.xmlOnlyLogin && !isXml) {
        // Older instances answer 200 with a non-"true" body for JSON logins.
        return new Response('<boolean xmlns="http://schemas.microsoft.com/2003/10/Serialization/">false</boolean>', { status: 200 });
      }
      const password = isXml ? /<password>(.*?)<\/password>/.exec(raw)?.[1] : JSON.parse(raw || "{}").password;
      if (password === "wrong") return new Response("false", { status: 401 });
      state.loggedIn = true;
      const body = isXml ? '<boolean xmlns="http://schemas.microsoft.com/2003/10/Serialization/">true</boolean>' : "true";
      return new Response(body, { status: 200, headers: { "set-cookie": `${state.cookie}; Path=/; HttpOnly` } });
    }

    // All other calls require the session cookie.
    if (headers.get("cookie") !== state.cookie || !state.loggedIn) {
      return new Response("", { status: 401 });
    }
    if (state.failNextWith !== null) {
      const status = state.failNextWith;
      state.failNextWith = null;
      return new Response("", { status });
    }

    switch (true) {
      case path === "/SecurityService/Ping":
        return new Response("true");
      case path === "/SecurityService/Logout":
        state.loggedIn = false;
        return new Response("true");
      case path === "/ComponentService/GetComponentList":
        return json(components);
      case path === "/ComponentService/GetComponentByAlias":
        return json(components[0]);
      case path === "/ComponentService/GetFieldList":
        return json(fields);
      case path === "/ComponentService/GetRecords": {
        const body = JSON.parse(String(init?.body));
        if (typeof body.componentId !== "number") return new Response("", { status: 400 });
        return json([
          { Id: 1, DisplayName: "192.168.1.84", FieldValues: [] },
          { Id: 2, DisplayName: "192.168.1.69", FieldValues: [] },
        ]);
      }
      case path === "/ComponentService/GetRecord":
        return json({ Id: 1, DisplayName: "1", FieldValues: [{ Key: 3, Value: "host-a" }, { Key: 9, Value: 250.0 }] });
      case path === "/ComponentService/GetRecordCount":
        return json(42);
      case path === "/ComponentService/CreateRecord": {
        const body = JSON.parse(String(init?.body));
        return json({ Id: 322, DisplayName: "322", FieldValues: body.dynamicRecord.FieldValues.map((fv: { key: number; value: unknown }) => ({ Key: fv.key, Value: fv.value })) });
      }
      case path === "/ComponentService/DeleteRecord":
        return json(true);
      case path === "/ComponentService/TransitionRecord":
        return json(true);
      case path === "/SecurityService/GetUsers":
        return json([{ Id: 9, FullName: "User, Test", Username: "testuser", Active: true, Deleted: false, AccountType: 1 }]);
      default:
        return new Response("", { status: 404 });
    }
  });

  return { fetchFn: fetchFn as unknown as typeof fetch, state };
}
