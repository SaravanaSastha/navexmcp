# Deploying the NAVEX IRM MCP Server to Azure Container Apps

**Target:** Azure Container Apps (ACA)
**Method:** Azure Portal click-through (+ one Cloud Shell step to build the image)
**Inbound auth:** Basic auth — every caller uses their own NAVEX username/password (strict default)

The container is a stateless Streamable-HTTP MCP server:

| Thing | Value |
|---|---|
| Listen port (ingress target) | `3000` |
| Health probe (unauthenticated) | `GET /healthz` |
| MCP endpoint | `POST /mcp` |
| REST facade | `/api/*` (Basic auth) |
| Demo web console | `/` (static) |
| Required env var | `NAVEX_BASE_URL=https://hp-inc-sandbox.keylightgrc.com:4443` |

> **Why a Cloud Shell build step?** The Azure Portal can only *pull* a pre-built image — it can't build your `Dockerfile`. Cloud Shell runs inside the portal (no local Docker required) and `az acr build` builds the image in the cloud. Everything after that is pure portal clicking.

---

## Phase 0 — Prerequisites (2 min)

- An Azure subscription with permission to create resources (Contributor on a resource group).
- Your NAVEX sandbox reachable from Azure: `https://hp-inc-sandbox.keylightgrc.com:4443`.
- The project source available in Cloud Shell (clone from Git, or upload the folder via Cloud Shell's **Upload** button).

---

## Phase 1 — Create a Resource Group (portal)

1. Portal → search **Resource groups** → **+ Create**.
2. **Subscription:** your subscription.
3. **Resource group:** `rg-navex-mcp`.
4. **Region:** pick one close to your users / NAVEX instance (e.g. *East US 2* or *West Europe*). **Use this same region everywhere below.**
5. **Review + create** → **Create**.

---

## Phase 2 — Create an Azure Container Registry (portal)

1. Portal → search **Container registries** → **+ Create**.
2. **Resource group:** `rg-navex-mcp`.
3. **Registry name:** `navexmcpacr` (must be globally unique, lowercase letters/numbers only — add digits if taken).
4. **Region:** same as Phase 1.
5. **SKU:** **Basic** is fine.
6. **Review + create** → **Create**.

After it deploys: open the registry → **Settings → Access keys** → toggle **Admin user = Enabled** (simplest way for ACA to pull the image; leave it on for now, we can switch to managed identity later).

---

## Phase 3 — Build & push the image (local Docker Desktop)

> **Why not `az acr build` / Cloud Shell?** This subscription has **ACR Tasks disabled** (`TasksOperationsNotAllowed`), so cloud build is blocked. We build locally with Docker Desktop and push the finished image instead — no ACR Tasks required. (Cloud Shell can't build either: it has no Docker daemon.)

1. Start **Docker Desktop** and confirm it's running: `docker info` should succeed.
2. From the project folder (`~/Navex MCP Server`), authenticate Docker to the registry:

   ```bash
   az acr login --name navexmcpcr
   ```

   If this errors, run `az login` first and confirm Admin user is enabled on the registry (Phase 2) or that your account has the **AcrPush** role.
3. Build the image. **`--platform linux/amd64` is required on Apple Silicon (M-series) Macs** — ACA runs amd64, and an arm64 image crash-loops with `exec format error`:

   ```bash
   docker build --platform linux/amd64 -t navexmcpcr.azurecr.io/navex-mcp:v2 .
   ```

4. Push it (first push is ~150–200 MB, takes a minute or two):

   ```bash
   docker push navexmcpcr.azurecr.io/navex-mcp:v1
   ```

5. Verify: `az acr repository show-tags --name navexmcpcr --repository navex-mcp` should list `v1`.

> Re-deploying later? Bump the tag (`navex-mcp:v2`), rebuild + push, then point the Container App revision at the new tag.

---

## Phase 4 — Create the Container App (portal)

1. Portal → search **Container Apps** → **+ Create**.
2. **Basics tab**
   - **Resource group:** `rg-navex-mcp`.
   - **Container app name:** `navex-mcp`.
   - **Region:** same as above.
   - **Container Apps Environment:** click **Create new** → name `cae-navex-mcp` → OK. (Defaults — Consumption plan, Log Analytics auto-created — are fine.)
3. **Container tab**
   - **Uncheck** "Use quickstart image."
   - **Image source:** **Azure Container Registry**.
   - **Registry:** `navexmcpacr`.
   - **Image:** `navex-mcp`.
   - **Image tag:** `v1`.
   - **CPU/Memory:** `0.5 CPU / 1 Gi` is plenty to start.
   - **Environment variables** → **+ Add** (see Phase 5 — add `NAVEX_BASE_URL` now).
4. **Ingress tab**
   - **Ingress:** **Enabled**.
   - **Ingress traffic:** **Accepting traffic from anywhere** (external).
   - **Ingress type:** **HTTP**.
   - **Target port:** **`3000`**  ← must match the container's listen port.
   - Leave session affinity off (server is stateless).
5. **Review + create** → **Create**. Wait for deployment to finish.

---

## Phase 5 — Environment variables & secrets

On the **Container** tab (or later via **Application → Containers → Edit and deploy → Edit** the container), set:

**Required**

| Name | Value |
|---|---|
| `NAVEX_BASE_URL` | `https://hp-inc-sandbox.keylightgrc.com:4443` |
| `PORT` | `3000` |
| `LOG_LEVEL` | `info` |

**Optional tuning** (defaults exist in code — only set to override)

| Name | Default |
|---|---|
| `SESSION_IDLE_TTL_MS` | `900000` |
| `SESSION_PING_INTERVAL_MS` | `300000` |
| `METADATA_CACHE_TTL_MS` | `600000` |
| `NAVEX_MAX_CONCURRENT` | `4` |
| `NAVEX_RETRY_MAX` | `3` |

**Basic auth = nothing else to configure.** Each caller sends their own NAVEX username/password on every request, so there are no inbound credentials to store in Azure.

> **If you later want shared-credential access** (e.g. one API key for Copilot Studio), use **Container App → Settings → Secrets** to add `navex-service-password`, then reference it from env vars `API_KEYS`, `NAVEX_SERVICE_USERNAME`, `NAVEX_SERVICE_PASSWORD`. Setting `API_KEYS` *without* the service account is a deliberate startup error. Add `NAVEX_LDAP_SETTINGS_ID` only if your NAVEX accounts are LDAP/SSO-backed.

---

## Phase 6 — Configure the health probe (recommended)

1. Container App → **Application → Containers → Edit and deploy** → select the container → **Health probes**.
2. Add a **Liveness** and **Readiness** probe:
   - **Transport:** HTTP
   - **Path:** `/healthz`
   - **Port:** `3000`
3. **Save** → this creates a new revision.

`/healthz` is unauthenticated and makes no NAVEX call, so it's safe for probes.

---

## Phase 7 — Verify the deployment

1. Container App **Overview** → copy the **Application Url** (e.g. `https://navex-mcp.<hash>.<region>.azurecontainerapps.io`).
2. **Health check** (from Cloud Shell or any terminal):

   ```bash
   curl https://navex-mcp.<hash>.<region>.azurecontainerapps.io/healthz
   # → {"status":"ok","activeNavexSessions":0}
   ```

3. **MCP initialize** (Basic auth = your NAVEX username/password):

   ```bash
   # --user with NO password lets curl PROMPT for it — avoids shell-quoting
   # issues with special characters (backticks, quotes) in NAVEX passwords.
   curl --user 'YOUR_NAVEX_USER' \
     -X POST https://navex-mcp.<hash>.<region>.azurecontainerapps.io/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
   ```

   Paste the password at curl's `Enter host password` prompt.

   > **Two gotchas with hand-rolled curl:**
   > - The `Accept` header **must list both** `application/json` and `text/event-stream` — the MCP spec requires it even though this server replies with plain JSON. Omit `text/event-stream` and you get `Not Acceptable`. Real MCP clients (Copilot Studio, MCP Inspector) send both automatically.
   > - Don't inline a password with special chars; let curl prompt for it (above) or use `read -rs PASS` then `-u "user:$PASS"`.

   A JSON-RPC result (server info + capabilities) means MCP is live end-to-end.
4. **Logs:** Container App → **Monitoring → Log stream** to watch "MCP request received" lines as you test.

---

## Phase 8 — Hook up Copilot Studio (if applicable)

Point your custom connector / MCP client at:

```
https://navex-mcp.<hash>.<region>.azurecontainerapps.io/mcp
```

with HTTP Basic auth. The server replies with plain `application/json` (SSE disabled) specifically so it passes cleanly through the Power Platform connector gateway.

---

## Production hardening (do these before real traffic)

1. **Pull image via managed identity, not admin keys.** Container App → **Identity** → enable system-assigned → grant it **AcrPull** on the registry → switch the registry config off admin user. Disable the ACR admin user afterward.
2. **Restrict ingress** if only Copilot Studio / known clients call it — add IP restrictions on the Container App ingress, or front it with Azure API Management / Front Door + WAF.
3. **Scale rules.** Default scales to zero (cold starts ~ a few seconds). For always-warm, set **min replicas = 1** under **Scale**. Set **max replicas** based on expected concurrency.
4. **Secrets in Key Vault.** If you add the service account, store the password in **Azure Key Vault** and reference it as a Container Apps secret, rather than inline.
5. **Custom domain + cert** via the Container App **Custom domains** blade if you don't want the `azurecontainerapps.io` URL.
6. **Alerts.** Add an alert on `/healthz` failures and on container restarts via the auto-created Log Analytics workspace.

---

## Quick rollback / redeploy

- **New code:** rebuild + push a new tag locally (`docker build --platform linux/amd64 -t navexmcpacr.azurecr.io/navex-mcp:vN . && docker push navexmcpacr.azurecr.io/navex-mcp:vN`) → Container App → **Revision management** → **Create new revision** → pick tag `vN` → set 100% traffic.
- **Bad release:** **Revision management** → shift 100% traffic back to the previous healthy revision. Instant rollback, no rebuild.
