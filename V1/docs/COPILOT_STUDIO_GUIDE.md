# NAVEX IRM Agent — Copilot Studio End-to-End Guide

Verified working: 2026-06-12 (sandbox `hp-inc-sandbox.keylightgrc.com`, 36 MCP tools).

---

## Part 1 — Running the stack (dev setup)

Three things must be running/configured. Order matters.

### 1. MCP server (Terminal 1, keep open)

```bash
cd "~/Documents/Claude/Projects/Navex MCP Server"
npm run dev
```

Wait for `NAVEX IRM MCP server listening` (port 3000). `.env` needs only `NAVEX_BASE_URL` pointing at your NAVEX instance.

### 2. Dev tunnel (Terminal 2, keep open)

```bash
devtunnel host -p 3000 --allow-anonymous
```

Note the `https://....devtunnels.ms` URL. **It changes every time you restart the tunnel** — when it does, update the custom connector host (Power Apps → Custom connectors → edit → General → Host) and re-test.

Sanity check: `https://<tunnel-url>/healthz` should return `{"status":"ok"}`.

### 3. Copilot Studio wiring (one-time, already done)

1. Custom connector imported from `docs/connector/mcp-connector.swagger.yaml` (Basic auth; host = tunnel hostname; operation `/mcp` with `x-ms-agentic-protocol: mcp-streamable-1.0`).
2. Agent → Tools → Add tool → the NAVEX connector → connection with the active NAVEX API account (`ambassador.user`).
3. Settings → Generative AI → **Generative orchestration: ON**.
4. Tools section shows 36 tools; "Allow all" enabled.

### Credentials requirements (for IT admin reference)

The NAVEX account used in the connection must be: **Status Active**, **API Access enabled**, **Authentication Type "NAVEX IRM"** (local — SAML/SSO accounts cannot do API logins), with a least-privilege Security Role for the components the agent should reach.

### Moving to production later

Replace the tunnel with Azure Container Apps (see `docs/DEPLOYMENT.md`), update the connector host once — everything else stays identical.

---

## Part 2 — Recommended agent configuration

### Agent description

> Assistant for the NAVEX IRM (Lockpath) GRC platform. Discovers components, searches and manages records, drives workflows, exports reports, and issues assessments through the NAVEX IRM MCP Server.

### Agent instructions (paste into Copilot Studio → Overview → Instructions)

```
You are the NAVEX IRM operations assistant. You work with the NAVEX IRM GRC
platform through MCP tools.

Working rules:
1. DISCOVER FIRST. Component and field structures are tenant-specific. When a
   user mentions a table or field you haven't seen this conversation, call
   list_components and get_fields before searching or writing. Never guess
   field names or IDs.
2. SEARCHING. Build filters from get_fields results. Default pageSize 25;
   tell the user when more pages exist. Use count_records for "how many"
   questions instead of fetching records.
3. PRESENTING. Summarize record sets as tables with the most relevant fields.
   Show record IDs so users can refer to them.
4. WRITING. Before create_record or update_record, restate the exact fields
   and values you will write and ask the user to confirm. The API does not
   enforce required fields, so check get_fields for Required=true fields and
   warn if they are missing.
5. DESTRUCTIVE ACTIONS. delete_record, delete_user, delete_group, and
   delete_attachments require explicit human approval. Always show what will
   be deleted, ask "Are you sure?", and only then call the tool with
   confirm=true. Never set confirm=true without the user saying yes.
6. WORKFLOWS. To move a record between stages: get_workflows for the
   component, get_workflow for stage/transition IDs, then transition_record.
   Show the available transitions if the user's request is ambiguous.
7. REPORTS. export_report needs the numeric report ID from the user's
   "My Reports" tab in NAVEX. For CSV you receive a text preview - summarize
   it rather than dumping raw CSV.
8. ERRORS. If a tool returns AUTH_FAILED, tell the user the NAVEX connection
   needs attention (credentials/API access) and to contact their admin -
   do not retry more than once. For NOT_FOUND on components or fields,
   list the available options instead.
9. Be precise with GRC data: never fabricate record values; if a field is
   null, say so.
```

### Tool settings

Keep "Allow all" ON for read tools. For governance, consider setting "Ask the end user before running" to **Yes** on: `create_record`, `update_record`, `delete_record`, `transition_record`, `vote_record`, `issue_assessment`, `import_file`, and all user/group write tools.

---

## Part 3 — Suggested prompts

### Starter prompts (add in Copilot Studio → Overview → Starter prompts)

| Title | Prompt |
|---|---|
| Explore data | What components (tables) are available in NAVEX? |
| Table schema | Show me the fields of the Incident Reports component |
| Open items | List the 10 most recent records in Incident Reports |
| Count by status | How many incident reports are currently open? |
| Workflow stages | What workflow stages and transitions exist for Incident Reports? |
| Export | Export report 3962 as CSV and summarize the key findings |

### Discovery & metadata

- "What tables can I work with?"
- "Describe the structure of the Vendors component — which fields are required?"
- "Which fields in Third Party Risk are lookup fields, and what can they point to?"

### Searching & analysis

- "Find all Devices where IP Address is not empty, show the first 10"
- "Search Incident Reports where Status equals Open and Severity is greater than 3"
- "How many vendor records were created this year?"
- "Get record 155 from Devices with full lookup details"
- "Compare the count of open vs closed incidents"

### Creating & updating (agent will confirm before writing)

- "Create a new Device record: DNS name web-prod-01, cost 1200, IP 10.2.3.4"
- "Update record 155 in Devices — set the acquisition cost to 1500"
- "Attach this file to record 16 in Vendors on the Documents field"

### Workflow operations

- "What transitions are available for record 22 in Incident Reports?"
- "Move record 22 in Incident Reports to the Review stage"
- "Vote to approve record 4 in Exceptions with comment 'Approved per policy 7.2'"

### Reports & assessments

- "Export report 6926 as XLSX"
- "Issue the vendor security assessment (template 12) for vendor 5, reviewer user 8090"

### Admin (use with care)

- "List all active users"
- "Which groups is user 8090 in?"
- "Create a group called 'Risk Reviewers' with users 8090 and 8101"

---

## Part 4 — Troubleshooting quick reference

| Symptom | Cause | Fix |
|---|---|---|
| "Connector request failed / Couldn't retrieve items" | Tunnel or server down, wrong connector host, or DLP | Check both terminals; verify `/healthz` via tunnel URL; check connector Host |
| `Connection refused localhost:3000` in devtunnel | MCP server not running | Start `npm run dev` |
| `AUTH_FAILED ... NAVEX answered 'false'` | Account inactive / API Access off / SAML account / wrong password | Use an Active, local (NAVEX IRM auth), API-enabled account |
| Login attempts paused for 60s | Lockout protection after a failed login | Fix credentials, wait 60s |
| Tools list empty after working before | Tunnel URL rotated | Update connector Host to new tunnel URL |
| Agent doesn't use tools in chat | Generative orchestration off | Settings → Generative AI → enable |
| Stale component/field names | Admin changed DCF schema | Ask agent to "refresh the metadata cache" |

Server-side visibility: every request and login attempt is logged in Terminal 1 (`MCP request received`, `NAVEX login attempt not accepted`, audit lines with per-tool success/duration).
