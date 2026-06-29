# NAVEX IRM MCP Server

Production-grade **Model Context Protocol (MCP) server + REST facade** for the NAVEX IRM Platform (formerly Lockpath), built for Microsoft Power Platform:

- **`POST /mcp`** — Streamable HTTP MCP endpoint for **Copilot Studio agents** (and any MCP client: Claude, VS Code, etc.)
- **`/api/*`** — REST facade published as a **Power Platform custom connector** for Power Automate cloud flows (replaces raw HTTP actions + per-flow cookie handling)
- **`GET /healthz`** — liveness probe

Both surfaces share one core: server-side NAVEX session management (Login → cookie → Ping keep-alive → re-login), DCF metadata cache, Zod validation, audit logging, retries, and error sanitization.

## Why

NAVEX IRM auth is session-cookie based, which Power Platform can't manage natively. Every flow re-implements Login/cookie handling today. This facade owns the session lifecycle.

**Auth (strict default):** HTTP Basic with NAVEX username/password — every caller uses their own NAVEX account; permissions and audit attribution follow that account. No anonymous access. API keys (mapped to a service account) are a hard opt-in via `API_KEYS` + `NAVEX_SERVICE_USERNAME/PASSWORD`; setting one without the other fails at startup.

## Tools (MCP)

| Group | Tools |
|---|---|
| Session | `ping`, `logout`, `refresh_metadata` |
| Metadata | `list_components`, `get_component`, `get_fields`, `get_field`, `get_lookup_options` |
| Records | `get_record`, `search_records`, `count_records`, `create_record`, `update_record`, `delete_record`, `import_file` |
| Workflow | `get_workflows`, `get_workflow`, `transition_record`, `vote_record` |
| Reports | `export_report` (CSV/PDF/XLSX) |
| Assessments | `issue_assessment` |
| Attachments | `list_attachments`, `get_attachment`, `upload_attachment`, `delete_attachments` |
| Users/Groups | `get_user`, `list_users`, `get_user_count`, `create_user`, `update_user`, `delete_user`, `get_group`, `list_groups`, `create_group`, `update_group`, `delete_group` |

Resources: `navex://components`, `navex://components/{id}`, `navex://components/{id}/fields`, `navex://components/{alias}/workflows`, `navex://users`, `navex://groups`.

All tools are **metadata-driven**: pass component aliases and field names; IDs are resolved at runtime via the DCF metadata cache — nothing is hardcoded. Destructive tools require `confirm: true` and are flagged for human-in-the-loop confirmation.

## Quick start

```bash
npm install
cp .env.example .env   # set NAVEX_BASE_URL (+ service account / API keys)
npm run dev
npm test
```

See `docs/DEPLOYMENT.md` for Azure Container Apps, Copilot Studio, and Power Automate setup; `docs/connector/` for connector specs; `docs/adr/` for architecture decisions; `FEASIBILITY_REPORT.md` for the research behind the design.

## Layout

```
src/
├── clients/navex-client.ts      # HTTP + cookie session, retry, throttle
├── services/                    # session manager, typed NAVEX API, metadata cache, context registry
├── tools/                       # MCP tool groups
├── resources/                   # navex:// resources
├── middleware/auth.ts           # Basic (pass-through) + x-api-key
├── server/                      # MCP wiring, REST routes, express app
├── schemas.ts, config.ts, utils/
└── tests/                       # vitest + mock NAVEX API
```

## Security model

- NAVEX cookies and passwords never leave the server process; logs redact credentials.
- Errors crossing the boundary are sanitized (no stack traces, no internal URLs).
- Audit log records caller identity, tool/operation, duration, outcome — no payloads.
- Soft-deletes only (NAVEX behavior), but treat `delete_*` as destructive anyway.
