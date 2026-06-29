# Email-Triggered Report Export — Copilot Studio Agent Flow

Send an email → a **Copilot Studio agent** reads the body, figures out which report and
format, exports it from NAVEX, and replies to the email with the file attached.

Architecture chosen (2026-06-18): **agent does everything, including the reply.**
The MCP server / facade is already deployed on **Azure Container Apps** and in use, so the
endpoint URLs are stable (no more devtunnel rotation).

---

## 1. The one rule that shapes this design

**The exported file (base64) must never pass back through the agent's LLM context.**

A CSV/XLSX/PDF export can be hundreds of KB to MB of base64. If the agent calls
`export_report`, receives the base64, and then hands it to a send-email step, that blob
goes through the model — it will blow the context window or get silently truncated, and
your `export_report` tool already truncates its inline CSV preview at 50 KB for exactly
this reason.

**Fix:** the agent never touches the file bytes. It extracts only `reportId` + `format`
from the email, then calls **one combined Power Automate action** that does
export + attach + reply *server-side*. The agent passes three small strings; the file
stays out of the model entirely.

```mermaid
flowchart TD
    A[Email arrives in shared mailbox] --> B[Power Automate trigger flow]
    B -->|body, subject, messageId, from| C[Copilot Studio agent]
    C --> D{Parse body:\nreportId + format}
    D -->|can't tell| E[Agent replies asking for clarification]
    D -->|got them| F[Agent calls action:\nExportAndReply(messageId, reportId, format)]
    F --> G[Action flow: HTTP GET /api/reports/id/export\nBasic auth → base64]
    G --> H[Action flow: Reply to email V3\nattach report.format]
    H --> I[Done — file never entered the LLM]
```

So there are **two Power Automate flows** plus the agent:
1. **Trigger flow** — fires on new email, calls the agent with the email fields.
2. **Action flow** (`ExportAndReply`) — invoked *by the agent* as a tool; does the real work.

---

## 2. ⚠️ Security note — "any sender" is still open

You chose **any sender can trigger.** Restating the risk plainly: `From` addresses are
spoofable, so this lets anyone email your mailbox and have GRC report data mailed back.
The cheapest mitigation is a sender allowlist check at the very start of the **trigger
flow** (Section 3, Step 2) — keep everything else identical. Strongly recommended before
this points at a real mailbox. To run fully open, just omit that one condition.

---

## 3. Build — Flow 1: the trigger flow

This flow's only job is to hand the email to the agent.

**Step 1 — Trigger:** Office 365 Outlook → **"When a new email arrives (V3)"**, folder
`Inbox`, on the shared mailbox (e.g. `navex-reports@yourorg.com`).

**Step 2 — (Recommended) allowlist gate:** a **Condition** —
`contains('alice@yourorg.com;bob@yourorg.com', toLower(triggerOutputs()?['body/from']))`.
On **If no** → "Reply to email" with "not authorized" and **Terminate**.

**Step 3 — Call the agent:** add the **Copilot Studio** action (or "Run a prompt / agent")
and pass these inputs to the agent:
- `emailBody` = `triggerOutputs()?['body/body']` (or `body/bodyPreview` for plain text)
- `subject` = `triggerOutputs()?['body/subject']`
- `messageId` = `triggerOutputs()?['body/id']`  ← needed so the agent can reply on-thread
- `from` = `triggerOutputs()?['body/from']`

That's it — the agent takes over from here.

---

## 4. Build — Flow 2: the `ExportAndReply` action flow

This is the flow the **agent calls as a tool**. Create it as an **instant cloud flow**
with trigger **"When Power Virtual Agents / Copilot calls a flow"** (or "Skill" trigger),
with three text inputs: `messageId`, `reportId`, `format`.

**Step 1 — HTTP (GET):** call the deployed Azure facade.
- **URI:** `@{concat('https://YOUR-AZURE-APP.azurecontainerapps.io/api/reports/', triggerBody()['reportId'], '/export?format=', triggerBody()['format'])}`
- **Authentication:** `Basic` → NAVEX local API account (API Access + Active; not SAML/SSO).

**Step 2 — Parse JSON** of `body('HTTP')`:
```json
{ "type": "object", "properties": {
  "base64": { "type": "string" }, "contentType": { "type": "string" } } }
```

**Step 3 — Reply to email (V3):**
- **Message Id:** `triggerBody()['messageId']`
- **Body:** `Attached is report @{triggerBody()['reportId']} (@{triggerBody()['format']}).`
- **Attachment → Name:** `@{concat('report-', triggerBody()['reportId'], '.', triggerBody()['format'])}`
- **Attachment → Content:** `@{base64ToBinary(body('Parse_JSON')?['base64'])}`

**Step 4 — Respond to Copilot:** return a small status string (e.g. `"sent"`) — **never**
the base64 — so the agent gets a clean confirmation, not the file bytes.

> `base64ToBinary` is the pivot: the facade returns base64, Outlook wants binary. This
> conversion happens here in the flow, so the bytes never reach the agent.

---

## 5. Build — the Copilot Studio agent

**Add the action:** in the agent, add **Flow 2 (`ExportAndReply`)** as a tool/action so the
agent can invoke it with `messageId`, `reportId`, `format`.

**Agent instructions (paste/adapt):**
```
You receive an email body, subject, messageId, and sender.
Determine which NAVEX report the user wants and the export format.
- reportId: the numeric report ID mentioned in the email (e.g. "report 7942" → 7942).
- format: one of csv, pdf, xlsx. Default to csv if the email does not specify.
If you cannot confidently determine the reportId, reply asking the sender to specify it —
do NOT guess.
Once you have reportId and format, call the ExportAndReply action with the messageId,
reportId, and format. Do not attempt to fetch or handle the file contents yourself.
Confirm to the sender that the report has been sent.
```

This keeps the model's job to NL understanding only; export and email delivery are
deterministic flow steps.

> **Note on "agent sends the email":** Copilot Studio agents don't send email with
> attachments directly — they trigger an action that does. Flow 2 is that action. The
> agent still "does everything" in the sense that it decides and drives the whole
> sequence; the Outlook reply is just its tool.

---

## 6. Test checklist

1. Allowlisted sender emails `Please export report 7942 as csv`. → Threaded reply with
   `report-7942.csv`, opens in Excel.
2. `…report 7942 in pdf` / `…xlsx`. → Correct extension and content type.
3. Vague email with no ID. → Agent replies asking which report, sends nothing.
4. Bad ID (`report 999999`). → Flow 2 HTTP fails; configure run-after to reply with a
   friendly error (no stack trace — facade already sanitizes).
5. Non-allowlisted sender (if gate enabled). → "Not authorized", no file.
6. Confirm facade **audit log** shows an `exportReport` entry with caller identity per run.
7. **Large report:** export a big one and confirm it still arrives — proves the base64
   never went through the agent (it would have failed if it did).

---

## 7. Optional simplification — autonomous agent trigger

If your Copilot Studio agent supports an **email event trigger** directly, you can drop
Flow 1 (the trigger flow) and let the agent fire on incoming mail itself, then call Flow 2.
Functionally identical; one fewer flow to maintain. Keep Flow 2 either way — it's what
keeps the file out of the LLM.

---

## 8. Production notes

- **URLs are stable now** (Azure Container Apps) — bake the app URL into Flow 2; no devtunnel.
- **Secrets:** NAVEX Basic credential lives in the connection reference on Flow 2, never inline.
- **Attachment size:** Outlook caps ~25–35 MB. For larger exports, have Flow 2 drop the
  file in SharePoint/OneDrive and reply with a link instead.
- **Throttling:** cap Flow 1 trigger concurrency so an email flood can't hammer NAVEX
  (facade rate limiting is a backstop).
- **Audit trail:** log each request (sender, reportId, format, success) to a SharePoint
  list or Dataverse for a record beyond the facade's `auditLogger`.

---

## 9. `ExportAndReply` action — exact schema

This is how Flow 2 surfaces to the Copilot Studio agent as a tool. **Descriptions are not
optional** — the agent uses them to decide when and how to call the action, so write them
for the model, not just for humans.

### Inputs (on the "When Copilot calls a flow" trigger)

| Input | Type | Required | Description to give it |
|-------|------|----------|------------------------|
| `messageId` | Text | Yes | "The Outlook message ID of the email to reply to. Use the messageId value passed in from the trigger — never invent or guess this." |
| `reportId` | Text | Yes | "The numeric NAVEX IRM report ID to export, e.g. 7942. Digits only, no quotes or words." |
| `format` | Text | Yes | "The export file format. Must be exactly one of: csv, pdf, xlsx. Use csv if the email does not specify." |

> Why all **Text**, not number/enum: per the Copilot Studio schema constraints you already
> hit on the MCP tools — enums come through as strings and primitive unions truncate the
> tool. Keep `reportId` and `format` as plain Text and validate inside the flow (e.g.
> `int(triggerBody()['reportId'])` will throw on non-numeric, which your run-after error
> branch then turns into a friendly reply). Constrain the *allowed values in the
> description*, not via a union type.

### Output (the "Respond to Copilot" action at the end of Flow 2)

| Output | Type | Value | Description |
|--------|------|-------|-------------|
| `status` | Text | `"sent"` on success; a short reason on failure (e.g. `"report not found"`) | "Result of the export-and-reply. 'sent' means the email reply with the attachment went out." |

**Return `status` only — never the base64 file.** That single rule is what keeps the file
out of the agent's context.

### How the agent calls it (conceptually)

```
ExportAndReply(
  messageId = <messageId from trigger>,
  reportId  = "7942",
  format    = "csv"
)  ->  { status: "sent" }
```

---

## 10. Sample trigger emails

Send these to the shared mailbox to exercise the flow. Subject is free-text; the agent
reads the body.

**A — explicit, happy path**
> **Subject:** Report export request
> **Body:** Hi, please export report 7942 as CSV and send it back to me. Thanks.

**B — format spelled differently**
> **Body:** Can you pull report 7942 in Excel format please?
> *(agent should map "Excel" → `xlsx`)*

**C — no format stated (should default to csv)**
> **Body:** I need report 7942 emailed to me.

**D — PDF**
> **Body:** Export 7942 as a PDF for the audit pack.

**E — ambiguous, should NOT guess**
> **Body:** Can you send me the latest incidents report?
> *(no numeric ID → agent replies asking the sender to specify the report ID; sends nothing)*

---

## 11. Agent test phrases (Copilot Studio test pane)

In the Copilot Studio **Test** panel you can paste an email body as the user turn and watch
the agent extract values and call the action. Expected behavior in brackets:

- `please export report 7942 as csv` → [reportId=7942, format=csv → ExportAndReply → "sent"]
- `pull report 7942 in excel` → [format=xlsx]
- `I need report 7942` → [format defaults to csv]
- `export 7942 as pdf` → [format=pdf]
- `send me the incidents report` → [no ID → agent asks for the report ID, no action call]
- `export report abc123` → [non-numeric → agent asks for a valid numeric report ID]
- `give me reports 7942 and 8001 as csv` → [out of scope for v1 — agent should handle one
  report per email, or ask the sender to send separate requests]

When validating, confirm three things each time: (1) the agent extracted the right
`reportId`/`format`, (2) it called `ExportAndReply` with those exact small values, and
(3) the action returned `status: "sent"` without any base64 appearing in the agent's
conversation transcript.
