# NAVEX IRM MCP Server for Power Platform — Feasibility Report

*Generated: 2026-06-12 | Sources: 10+ | Confidence: High*

## Executive Summary

**Verdict: Yes, this is achievable — and well-supported as of mid-2026.** Model Context Protocol (MCP) is generally available in Microsoft Copilot Studio, consumed via Power Platform custom connectors over the Streamable HTTP transport. The NAVEX IRM API (v6.1, the former Lockpath/Keylight platform) is a conventional REST API and can be wrapped cleanly by an MCP server. One important nuance: **MCP serves the agent layer (Copilot Studio agents, agent flows), not classic deterministic cloud flows.** Your 30+ existing Power Automate cloud flows with HTTP actions are best served by a **custom connector** built on the same backend facade — so the recommended architecture is one NAVEX facade service that exposes both an `/mcp` endpoint (for agents) and a REST surface (for the custom connector used by flows).

## 1. What the NAVEX IRM API Gives Us (from the attached PDF)

- REST API at `https://[instance]:[port]/[service]/[call]`, JSON or XML, methods GET/POST/DELETE, **case-sensitive** call names.
- Four service groups: **SecurityService** (Login/Logout/Ping, user/group CRUD), **ComponentService** (metadata discovery + record CRUD, workflow transition/vote, attachments, import), **ReportService** (ExportReport — CSV/PDF/XLSX), **AssessmentService** (IssueAssessment).
- **Auth is session-cookie based**: `SecurityService/Login` returns an encrypted cookie; it must accompany every subsequent call. `Ping` refreshes the session. Permissions follow the login account's Security Role.
- **Dynamic Content Framework (DCF)**: components = tables, fields = schema, records = rows. Structures are tenant-specific and must be discovered at runtime via `GetComponentList`/`GetFieldList` — never hardcoded.

## 2. How Power Platform Consumes MCP (June 2026)

- **Copilot Studio: MCP is GA.** Agents connect to MCP servers via an onboarding wizard or a manually built custom connector ([Microsoft announcement](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/model-context-protocol-mcp-is-now-generally-available-in-microsoft-copilot-studio/)).
- **Transport: Streamable HTTP only.** SSE is deprecated and unsupported in Copilot Studio since August 2025 ([Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)). stdio transport is irrelevant for this scenario.
- **Connector mechanics:** the wizard creates a Power Platform custom connector behind the scenes; a manual connector needs an OpenAPI (Swagger 2.0) spec with `x-ms-agentic-protocol: mcp-streamable-1.0` on the `/mcp` POST operation ([Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent)).
- **Auth options for the MCP connection:** None, API key (header/query), or OAuth 2.0 (dynamic discovery via DCR, dynamic, or manual). Entra ID can secure the MCP server ([example walkthrough](https://ashiqf.com/2026/03/19/secure-your-mcp-server-with-entra-id-authentication-for-copilot-studio/), [OAuth lab](https://microsoft.github.io/copilot-camp/pages/make/copilot-studio/10-mcp-oauth/)).
- **Governance:** because MCP access flows through Power Platform connectors, existing DLP policies automatically govern it ([Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent#mcp-servers-and-data-policies)).
- **Agent flows** in Copilot Studio can use tools including MCP servers, flows, and connectors ([flows overview](https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview)).
- **Classic Power Automate cloud flows do not call MCP tools directly.** Flows remain deterministic; they consume connectors. This shapes the architecture below.

## 3. NAVEX Integration Landscape

- No certified Power Platform connector for NAVEX IRM exists today — confirming the gap your team feels.
- NAVEX offers the Integration Cloud and the "Lockpath API Connector" for custom integrations ([NAVEX press release](https://www.navex.com/en-us/company/press-room/navex-launches-navex-integration-cloud-for-seamless-data-integration/)), but the REST API remains the path for custom Power Platform work.
- NAVEX IRM supports Entra ID SAML SSO for the UI ([Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/saas-apps/navex-irm-keylight-lockpath-tutorial)) — but the API itself is username/password → cookie, so the facade must bridge auth models.

## 4. Recommended Architecture

```
                          ┌──────────────────────────────────────────────┐
 Copilot Studio agents ──►│  POST /mcp  (Streamable HTTP, MCP SDK)       │
 (via MCP custom          │                                              │
  connector, OAuth/key)   │   NAVEX Facade Service (TypeScript/Node)     │
                          │   ├── Tools: login-less; facade owns session │
 Power Automate cloud ───►│  REST /api/* (OpenAPI → custom connector)    │──► NAVEX IRM API
 flows (30+ HTTP actions  │                                              │    (session cookie,
  migrate to connector)   │   Shared core:                               │     Ping renewal)
                          │   ├── NavexClient (cookie jar, Ping renewal, │
                          │   │    retry, rate limit)                    │
                          │   ├── DCF metadata cache (components/fields) │
                          │   ├── Zod validation, audit log, OTel        │
                          └──────────────────────────────────────────────┘
                              Hosted on Azure (Container Apps / App
                              Service), secrets in Key Vault, fronted
                              by Entra ID (OAuth) or API key
```

Key points:

1. **One backend, two front doors.** The MCP endpoint powers Copilot Studio agents; the REST surface (same service) becomes a custom connector that replaces raw HTTP actions in your 30+ flows. Both reuse one `NavexClient` with server-side session management — flows stop re-implementing Login/cookie handling in every flow.
2. **Session bridging.** NAVEX's cookie auth never reaches Power Platform. The facade holds a service-account session (Login → cookie jar → Ping keep-alive → re-login on 401) and exposes Entra ID OAuth or API-key auth outward. Credentials live in Azure Key Vault / env vars.
3. **Metadata-driven tools.** Tools like `search_records` take `componentAlias` + field filters and resolve IDs at runtime via cached `GetComponentList`/`GetFieldList` — no hardcoded component/field IDs, per DCF design.
4. **Tool surface** mirrors the project spec: auth (ping), users/groups CRUD, metadata (list_components, get_component, get_fields), records (get/search/create/update/delete), workflow (get_workflow, transition_record, vote_record), reports (export_report), assessments (issue_assessment), attachments (upload/get/delete).
5. **Governance & safety.** DLP policies govern the connector automatically; destructive tools (delete_record, delete_user) should be flagged for human-in-the-loop confirmation in agent configs; error sanitization keeps cookies/passwords/stack traces out of responses.

## 5. Risks & Caveats

- **Cloud-flow expectation mismatch (main risk):** if the team expects flows to "call MCP," that's not how flows work — the custom connector half of this design is what modernizes the 30+ flows. MCP adds the agent capability on top.
- **Single service account = coarse permissions.** All facade traffic runs with one NAVEX account's Security Role. Mitigation: dedicated least-privilege API account(s); optionally per-team accounts mapped to connection-level API keys.
- **Session limits/concurrency:** the PDF doesn't document NAVEX session concurrency or rate limits — validate against your instance; build conservative rate limiting + retry into NavexClient.
- **Network reachability:** Power Platform must reach the facade; the facade must reach your NAVEX instance (cloud-hosted `*.lockpath.app` is straightforward; on-prem needs VNet/gateway planning).
- **Drift:** Copilot Studio MCP capabilities are evolving quickly (2026 Release Wave 1 expands MCP support) — re-verify specifics at build time.
- Unverified (single source): NAVEX "1,000 pre-built integrations" claim is vendor marketing; doesn't change this design.

## 6. Recommendation & Next Steps

Proceed. Suggested phases:

1. **Scaffold the facade service** (TypeScript, MCP SDK, Streamable HTTP, Zod, OTel) with NavexClient session manager — per project architecture spec.
2. **Implement metadata + record tools first** (highest value for operations), then workflow/reports/assessments/attachments.
3. **Generate the OpenAPI spec** and create the custom connector; migrate 2–3 pilot flows off raw HTTP actions.
4. **Onboard to Copilot Studio** via the MCP wizard; pilot one agent use case (e.g., "summarize open incidents and transition approved ones").
5. **Security review + load test** against NAVEX session behavior before broad rollout.

Decisions captured as ADRs in `docs/adr/` (transport, auth bridging, dual exposure, stack).

## Sources

1. [MCP GA in Copilot Studio — Microsoft Copilot Blog](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/model-context-protocol-mcp-is-now-generally-available-in-microsoft-copilot-studio/)
2. [Connect agent to existing MCP server — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent) (transport, wizard, auth, schema, DLP)
3. [Extend agent with MCP — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp)
4. [Create a new MCP server — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-create-new-server)
5. [Streamable HTTP in Copilot Studio — Developer's Cantina](https://www.developerscantina.com/p/mcp-copilot-studio-streamable-http/)
6. [Entra ID auth for MCP + Copilot Studio — ashiqf.com](https://ashiqf.com/2026/03/19/secure-your-mcp-server-with-entra-id-authentication-for-copilot-studio/)
7. [Consuming MCP with OAuth 2.0 — Copilot Developer Camp](https://microsoft.github.io/copilot-camp/pages/make/copilot-studio/10-mcp-oauth/)
8. [Agent flows overview — Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview)
9. [NAVEX Integration Cloud — NAVEX press room](https://www.navex.com/en-us/company/press-room/navex-launches-navex-integration-cloud-for-seamless-data-integration/)
10. [NAVEX IRM Entra ID SSO tutorial — Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity/saas-apps/navex-irm-keylight-lockpath-tutorial)
11. NAVEX IRM Platform API Reference Guide 6.1 (attached PDF, 189 pp.)

## Methodology

Analyzed the 189-page NAVEX IRM API Reference Guide 6.1 (services, auth flow, DCF model). Ran 5 web research queries across Microsoft Learn, Microsoft blogs, and practitioner sources; deep-read the authoritative Microsoft Learn MCP onboarding page (updated 2026-05-28). Sub-questions: Copilot Studio MCP support status; transport/auth requirements; Power Automate consumption paths; NAVEX integration landscape; architecture implications of cookie-based auth.
