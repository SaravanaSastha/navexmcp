# Email → Report Export → Reply — Build Runbook (start to finish)

A linear, click-by-click build. Follow it top to bottom. Where you need *why* a choice was
made, see the design guide: `EMAIL_EXPORT_FLOW.md`. This runbook assumes the design from
that doc: **Power Automate trigger flow → Copilot Studio agent → `ExportAndReply` action
flow**, with the file bytes kept out of the agent.

> **Golden rule, repeated up front:** the agent only ever passes `messageId`, `reportId`,
> `format` (three short strings). The exported file (base64) is handled entirely inside the
> action flow and must never travel through the agent. Everything below is built to enforce
> that.

---

## Part 0 — What you're building (the map)

```
[Email arrives]
   → FLOW 1 (trigger): grabs body + messageId, calls the agent
       → AGENT: reads body, extracts reportId + format
           → calls FLOW 2 (action): ExportAndReply(messageId, reportId, format)
               → HTTP GET Azure facade → base64
               → decode base64 → Reply to email with attachment
               → return "sent" (NOT the file)
       → AGENT: confirms to sender
```

You build them in this order: **Flow 2 first** (the agent can't reference an action that
doesn't exist yet), **then the agent**, **then Flow 1**.

---

## Part 1 — Prerequisites (gather these before building)

1. **Azure facade URL** — your deployed Azure Container Apps base URL, e.g.
   `https://navex-mcp.<region>.azurecontainerapps.io`. You'll use the path
   `/api/reports/{id}/export?format={fmt}`.
2. **A NAVEX service account for Basic auth** — a **local "NAVEX IRM" auth account**
   (NOT SAML/SSO), with **API Access enabled** and **status Active**. SSO accounts cannot
   do password API logins. Note its username + password.
3. **A shared mailbox**, e.g. `navex-reports@yourorg.com`, that you (and the flow's
   connection) can access. Don't build this on a personal inbox.
4. **Power Platform environment** with permission to create flows + a Copilot Studio agent,
   and the **premium HTTP connector** available (needed in Flow 2).
5. **A known good report ID** to test with — you have **7942**.

> Tip: confirm the facade is up first. In a browser or `curl`, hit
> `https://<your-azure-url>/healthz` — it should return OK. (Auth isn't required for health.)

---

## Part 2 — Verify the export endpoint works (2-minute sanity check)

Before touching Power Automate, prove the endpoint returns what we expect. From any
terminal:

```bash
curl -u "NAVEX_USER:NAVEX_PASS" \
  "https://<your-azure-url>/api/reports/7942/export?format=csv"
```

Expected: a JSON body like `{"base64":"aWQ...","contentType":"text/csv"}`.
If you get that, the rest is just wiring. If you get 401, the account/Basic auth is wrong;
404 means wrong report ID or path; 5xx means check the facade logs.

---

## Part 3 — Build FLOW 2: `ExportAndReply` (the action the agent calls)

This flow does the real work. Build it first.

### 3.1 Create the flow
- Power Automate → **Create** → **Instant cloud flow** → name it `ExportAndReply`.
- Trigger: choose **"Run a flow from Copilot"** (a.k.a. "When an agent calls the flow" /
  the Copilot Studio skill trigger).

### 3.2 Define the inputs
On the trigger, **Add an input** three times, all type **Text**:
| Name | Type | Notes |
|------|------|-------|
| `messageId` | Text | Outlook message id to reply to |
| `reportId` | Text | numeric report id, e.g. 7942 |
| `format` | Text | csv / pdf / xlsx |

(All Text on purpose — see the schema note in `EMAIL_EXPORT_FLOW.md` §9.)

### 3.3 HTTP action — call the facade
- Add action **HTTP** (premium).
- **Method:** `GET`
- **URI** (Expression):
  ```
  concat('https://<your-azure-url>/api/reports/', triggerBody()['reportId'], '/export?format=', triggerBody()['format'])
  ```
- **Authentication:** `Basic`
  - **Username:** your NAVEX service-account username
  - **Password:** your NAVEX service-account password
- Leave headers/body empty.

### 3.4 Parse JSON
- Add action **Parse JSON**.
- **Content:** `body('HTTP')`
- **Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "base64": { "type": "string" },
      "contentType": { "type": "string" }
    }
  }
  ```

### 3.5 Reply to the email with the attachment
- Add action **Office 365 Outlook → Reply to email (V3)**.
- **Message Id:** `triggerBody()['messageId']`
- **Body:** `Attached is report @{triggerBody()['reportId']} (@{triggerBody()['format']}). Generated automatically by the NAVEX export agent.`
- Expand **Advanced options → Attachments → Add new item:**
  - **Attachment Name:** Expression
    ```
    concat('report-', triggerBody()['reportId'], '.', triggerBody()['format'])
    ```
  - **Attachment Content:** Expression
    ```
    base64ToBinary(body('Parse_JSON')?['base64'])
    ```
  *(If your action name has a space, it becomes `body('Parse_JSON')` with an underscore —
  match whatever the action is actually named.)*

### 3.6 Error branch (friendly failures)
- On the **HTTP** action: **⋯ → Configure run after** → also run on **has failed** /
  **has timed out**, OR add a parallel branch.
- Add a second **Reply to email (V3)** that runs only on failure:
  - **Message Id:** `triggerBody()['messageId']`
  - **Body:** `Sorry — I couldn't export report @{triggerBody()['reportId']}. Please double-check the report ID and format, or contact the GRC admin.`
- **Never** put the raw HTTP error body in the reply.

### 3.7 Respond to the agent
- Add action **"Respond to Copilot" / "Return value(s) to Copilot"**.
- Add one **Text** output: `status`.
  - On success path value: `sent`
  - (Optional) on failure path: `failed`
- **Do not** return the base64 or the file. Only `status`.

**Save Flow 2.** You now have an action the agent can call.

---

## Part 4 — Build the AGENT (Copilot Studio)

### 4.1 Create/open the agent
- Copilot Studio → your existing NAVEX agent (or **Create → New agent**).

### 4.2 Add the action
- Agent → **Actions** (or **Tools**) → **Add an action** → **Flow** → pick
  **`ExportAndReply`**.
- Confirm the three inputs (`messageId`, `reportId`, `format`) and the `status` output show
  up. Edit each input's **description** so the model knows how to fill it (copy from
  `EMAIL_EXPORT_FLOW.md` §9).

### 4.3 Agent instructions
Paste into the agent's instructions:
```
You handle email requests to export NAVEX IRM reports.

You will be given: the email body, subject, the sender, and a messageId.

1. Read the email and determine:
   - reportId: the numeric NAVEX report ID requested (e.g. "report 7942" → 7942). Digits only.
   - format: csv, pdf, or xlsx. Map words like "Excel" → xlsx, "spreadsheet" → xlsx,
     "PDF" → pdf. If no format is stated, default to csv.
2. If you cannot find a clear numeric reportId, reply to the sender asking them to specify
   the report ID. Do NOT guess and do NOT call any action.
3. Once you have reportId and format, call the ExportAndReply action with:
   messageId (exactly as given), reportId, and format.
4. Do not fetch, open, or handle the file contents yourself — the action sends the email.
5. After the action returns, confirm to the sender that report <reportId> was sent as <format>.

Handle one report per email. If multiple reports are requested, ask the sender to send
separate emails.
```

### 4.4 Quick test in the Test pane
- Open the **Test** panel, type a body as if it were the email, e.g.
  `please export report 7942 as csv`.
- Expected: agent extracts `7942` + `csv`, calls `ExportAndReply`, gets `status: sent`.
- Try `send me the incidents report` → agent should ask for the ID and NOT call the action.

**Publish the agent** when the test pane behaves.

---

## Part 5 — Build FLOW 1: the email trigger

This flow's only job: catch the email and hand it to the agent.

### 5.1 Create the flow
- Power Automate → **Create** → **Automated cloud flow** → name `NAVEX Email Export Trigger`.
- Trigger: **Office 365 Outlook → When a new email arrives (V3)**.
  - **Folder:** Inbox of the shared mailbox.
  - (Optional) **Subject Filter:** leave blank, or set a keyword if you want to narrow it.

### 5.2 (RECOMMENDED) Sender allowlist gate
> You chose "any sender." This one step closes most of the exfiltration risk. Skip only if
> you truly want it open.
- Add a **Condition**:
  - Left (Expression): `contains('alice@yourorg.com;bob@yourorg.com', toLower(triggerOutputs()?['body/from']))`
  - Operator: **is equal to**
  - Right: `true`
- **If no** branch → **Reply to email (V3)** with "This mailbox only accepts requests from
  authorized users." → then **Terminate** (status: Cancelled).
- Put the rest of the steps in the **If yes** branch.

### 5.3 Call the agent
- Add the **Copilot Studio** connector action that invokes your agent (e.g.
  **"Converse with an agent" / "Run agent"**, depending on your tenant's action name).
- Map inputs to the agent:
  - email body → `triggerOutputs()?['body/body']` (or `body/bodyPreview` for plain text)
  - subject → `triggerOutputs()?['body/subject']`
  - **messageId → `triggerOutputs()?['body/id']`**  ← critical; the agent passes this to Flow 2
  - from → `triggerOutputs()?['body/from']`

> If your environment can't pass a messageId cleanly into the agent and back out to the
> action, use the fallback in Part 7.

**Save Flow 1.**

---

## Part 6 — End-to-end test

Run these in order and confirm each:

1. **Happy path:** from an allowlisted address, email the mailbox:
   *"please export report 7942 as csv"*. → Within a minute, a **threaded reply** arrives
   with `report-7942.csv` attached, and it opens in Excel.
2. **Format mapping:** *"pull report 7942 in Excel"* → reply has `report-7942.xlsx`.
3. **Default format:** *"I need report 7942"* → reply has `report-7942.csv`.
4. **PDF:** *"export 7942 as pdf"* → `report-7942.pdf`.
5. **Ambiguous:** *"send me the incidents report"* → agent replies asking for the report
   ID; **no file** sent.
6. **Bad ID:** *"export report 999999 as csv"* → friendly failure reply, no stack trace.
7. **Allowlist (if enabled):** send from a non-allowlisted address → "not authorized"
   reply, no file.
8. **No base64 leak:** open the agent's conversation transcript / Flow 2 run history and
   confirm the **base64 string never appears in the agent** — only in Flow 2's HTTP +
   Parse JSON steps. This is the proof the design is correct.
9. **Audit:** confirm the facade `auditLogger` logged an `exportReport` entry with the
   caller identity for each successful run.

---

## Part 7 — Fallback if messageId can't round-trip through the agent

Some tenants make it awkward to pass the Outlook messageId into the agent and back into the
action. If you hit that:

- **Option A (simplest):** don't reply on-thread from inside the agent. Instead, have
  Flow 1 do the reply itself after the agent returns `reportId` + `format`. i.e. switch to
  the "agent extracts only" division of labor for the reply step. (You lose nothing except
  that the agent isn't literally the one sending — see `EMAIL_EXPORT_FLOW.md` §1.)
- **Option B:** have Flow 1 store the messageId + a correlation token, pass the token to the
  agent, and let Flow 2 look the messageId back up. More moving parts; only do this if you
  specifically need the agent to own the reply.

---

## Part 8 — Go-live checklist

- [ ] Azure facade URL hardcoded in Flow 2 (stable; no devtunnel).
- [ ] NAVEX Basic credential stored on the HTTP action's connection, **not** inline in text.
- [ ] Sender allowlist enabled (or a conscious, documented decision to run open).
- [ ] Flow 1 trigger **concurrency capped** (Settings → Concurrency Control) so an email
      burst can't hammer NAVEX.
- [ ] Friendly error reply verified for bad IDs / NAVEX downtime.
- [ ] Large-report path decided: attach if < ~25 MB, else write to SharePoint/OneDrive and
      reply with a link.
- [ ] Request log (sender, reportId, format, success, timestamp) written to a SharePoint
      list or Dataverse table.
- [ ] Agent published; both flows turned **On**.

---

## Appendix — every expression in one place

| Where | Expression |
|-------|------------|
| Flow 2 HTTP URI | `concat('https://<your-azure-url>/api/reports/', triggerBody()['reportId'], '/export?format=', triggerBody()['format'])` |
| Flow 2 Parse JSON content | `body('HTTP')` |
| Flow 2 attachment name | `concat('report-', triggerBody()['reportId'], '.', triggerBody()['format'])` |
| Flow 2 attachment content | `base64ToBinary(body('Parse_JSON')?['base64'])` |
| Flow 1 allowlist check | `contains('a@org.com;b@org.com', toLower(triggerOutputs()?['body/from']))` |
| Flow 1 → agent: body | `triggerOutputs()?['body/body']` |
| Flow 1 → agent: messageId | `triggerOutputs()?['body/id']` |
| Flow 1 → agent: subject | `triggerOutputs()?['body/subject']` |
| Flow 1 → agent: from | `triggerOutputs()?['body/from']` |
