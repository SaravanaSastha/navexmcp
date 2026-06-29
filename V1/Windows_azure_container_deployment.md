# Windows → Azure Container Apps: Production Deployment Guide

**Project:** `navex-irm-mcp-server` (MCP server + REST facade for NAVEX IRM Platform)
**Source machine:** your office **Windows** workstation
**Target:** **Azure Container Apps (ACA)** + **Azure Container Registry (ACR)**
**Audience:** the person doing the build & deploy (you), plus whoever maintains it later

This guide is the Windows-native, production-oriented companion to `docs/AZURE_CONTAINER_APPS_DEPLOYMENT.md` (which is written for macOS/Cloud Shell). All commands here are **PowerShell** on Windows. It documents **both build paths** (local Docker Desktop and cloud `az acr build`) and **both registry-auth paths** (ACR admin keys to get running, then managed identity for hardening).

---

## 0. What you are deploying (read this first)

The container is a **stateless Streamable-HTTP MCP server**. It holds no database; each request authenticates to NAVEX with the caller's own credentials and the server keeps short-lived in-memory NAVEX sessions.

| Thing | Value |
|---|---|
| Listen port (ingress target) | `3000` |
| Health probe (unauthenticated) | `GET /healthz` → `{"status":"ok","activeNavexSessions":0}` |
| MCP endpoint | `POST /mcp` (Basic auth) |
| REST facade | `/api/*` (Basic auth) |
| Demo web console | `/` (static) |
| Base image | `node:20-alpine`, multi-stage, runs as non-root user `app` |
| Architecture | **linux/amd64** — ACA runs amd64; never push an arm64 image |
| Required env var | `NAVEX_BASE_URL` |

**Inbound auth model (strict default):** every caller sends their **own NAVEX username/password** via HTTP Basic on every request. There are *no* inbound credentials to store in Azure unless you opt into the shared-API-key path (see §8.3).

---

## 1. Prerequisites on the Windows machine

Install once (all are free; use winget so it's repeatable and IT-auditable):

```powershell
# Run PowerShell as your normal user (not admin unless winget asks)
winget install --id Microsoft.AzureCLI -e
winget install --id Docker.DockerDesktop -e        # needed only for the local-build path
winget install --id Git.Git -e                     # to clone the repo
winget install --id Microsoft.PowerShell -e        # PowerShell 7+ (recommended)
```

After install, **close and reopen** PowerShell so PATH updates take effect, then verify:

```powershell
az version          # Azure CLI present
docker --version    # Docker Desktop CLI present (local-build path only)
git --version
```

**Corporate network notes (common in office environments):**

- If you sit behind an HTTPS proxy, set it before `az login` / `docker pull`:
  ```powershell
  $env:HTTP_PROXY  = "http://proxy.corp.example:8080"
  $env:HTTPS_PROXY = "http://proxy.corp.example:8080"
  ```
  In Docker Desktop, also set the proxy under **Settings → Resources → Proxies**.
- **Docker Desktop on Windows** requires either WSL2 (recommended) or Hyper-V. If your laptop has neither enabled and IT won't enable them, use the **cloud-build path (§5B)** — it needs no local Docker at all.
- Confirm your office network can reach the NAVEX instance host: `Test-NetConnection -ComputeName your-instance.keylightgrc.com -Port 4443`.

**Azure permissions you need:** at minimum **Contributor** on the target resource group, and **AcrPush** on the registry (Contributor includes it). For the managed-identity step you also need **User Access Administrator** or **Owner** to assign the AcrPull role.

---

## 2. Get the source onto the machine

```powershell
# Choose a working folder
cd $HOME\source
git clone <your-repo-url> "navex-mcp"     # or copy the project folder from your file share
cd "navex-mcp"

# Verify the build artifacts the Dockerfile expects are present
Test-Path .\Dockerfile, .\package.json, .\tsconfig.json, .\src
```

> The Dockerfile builds from source inside the image (`npm ci` → `npm run build`), so you do **not** need to run `npm install` or `npm run build` on the Windows host. You only need the source files committed.

---

## 3. Sign in to Azure and pick your scope

```powershell
az login                                   # opens a browser; complete MFA
az account list --output table
az account set --subscription "<YOUR-SUBSCRIPTION-NAME-OR-ID>"

# Register the providers ACA needs (idempotent; safe to re-run)
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
az provider register --namespace Microsoft.ContainerRegistry
```

Set reusable variables for the rest of the guide. **Pick ONE region and use it everywhere.**

```powershell
$RG       = "rg-navex-mcp"
$LOCATION = "eastus2"                       # choose nearest to users / NAVEX
$ACR      = "navexmcpacr"                    # must be globally unique, lowercase a-z0-9
$ENVNAME  = "cae-navex-mcp"                  # Container Apps environment
$APP      = "navex-mcp"
$IMAGE    = "navex-mcp"
$TAG      = "v1"
$NAVEXURL = "https://your-instance.keylightgrc.com:4443"   # <-- set your real instance
```

---

## 4. Create the cloud resources (one-time)

### 4.1 Resource group

```powershell
az group create --name $RG --location $LOCATION
```

### 4.2 Container registry

```powershell
az acr create --resource-group $RG --name $ACR --sku Basic --location $LOCATION
$ACR_LOGINSERVER = az acr show --name $ACR --query loginServer --output tsv
$ACR_LOGINSERVER     # e.g. navexmcpacr.azurecr.io
```

### 4.3 Container Apps environment (with Log Analytics)

```powershell
az containerapp env create `
  --name $ENVNAME `
  --resource-group $RG `
  --location $LOCATION
```

This auto-creates a Log Analytics workspace used for log streaming and alerts.

---

## 5. Build & push the image

> Your subscription has historically had **ACR Tasks disabled** (`TasksOperationsNotAllowed`), which blocks cloud build. The **local Docker Desktop path (5A) is the reliable primary path.** Use the cloud path (5B) only if ACR Tasks has since been enabled — it's the cleaner option when available because it needs no local Docker.

### 5A. Primary path — local build with Docker Desktop

Start Docker Desktop (wait until the whale icon is steady), then:

```powershell
# 1. Authenticate Docker to the registry
az acr login --name $ACR

# 2. Build for linux/amd64 — REQUIRED. ACA is amd64; an arm64 image crash-loops
#    with "exec format error". On Windows/Intel this is the default, but pass it
#    explicitly so the build is correct on any host (incl. ARM Windows devices).
docker build --platform linux/amd64 -t "$ACR_LOGINSERVER/${IMAGE}:$TAG" .

# 3. Push (first push ~150-200 MB)
docker push "$ACR_LOGINSERVER/${IMAGE}:$TAG"

# 4. Verify the tag landed
az acr repository show-tags --name $ACR --repository $IMAGE --output table
```

If `az acr login` fails, run `az login` again and confirm you have the **AcrPush** role (or enable the admin user per §7.1).

### 5B. Fallback path — cloud build (no local Docker)

Only works if ACR Tasks is enabled. Test first; if it errors with `TasksOperationsNotAllowed`, use 5A.

```powershell
az acr build `
  --registry $ACR `
  --image "${IMAGE}:$TAG" `
  --platform linux/amd64 `
  .
```

`az acr build` uploads your source, builds the Dockerfile in Azure, and pushes the result in one step. Verify with the same `az acr repository show-tags` command as above.

---

## 6. Create the Container App

This first deploy uses **ACR admin credentials** so you can get running quickly; §7 migrates it to **managed identity** for production. The `az containerapp create` command can read admin creds automatically when `--registry-server` points at an ACR in the same subscription.

```powershell
# Enable admin user temporarily so the create command can wire up the pull credential
az acr update --name $ACR --admin-enabled true

az containerapp create `
  --name $APP `
  --resource-group $RG `
  --environment $ENVNAME `
  --image "$ACR_LOGINSERVER/${IMAGE}:$TAG" `
  --registry-server $ACR_LOGINSERVER `
  --target-port 3000 `
  --ingress external `
  --min-replicas 1 `
  --max-replicas 3 `
  --cpu 0.5 --memory 1.0Gi `
  --env-vars NAVEX_BASE_URL=$NAVEXURL PORT=3000 LOG_LEVEL=info

# Capture the public URL
$APP_URL = az containerapp show --name $APP --resource-group $RG --query properties.configuration.ingress.fqdn --output tsv
"https://$APP_URL"
```

> `--min-replicas 1` keeps one instance always warm (no cold starts) — appropriate for production. Use `--min-replicas 0` only for cost-sensitive dev environments.

---

## 7. Production registry auth: migrate to managed identity

Admin keys are a stored shared secret. The production-grade approach is a **system-assigned managed identity** with the **AcrPull** role — no credentials stored anywhere.

```powershell
# 1. Give the Container App a system-assigned identity
az containerapp identity assign --name $APP --resource-group $RG --system-assigned

# 2. Grant that identity AcrPull on the registry
$APP_PRINCIPAL = az containerapp identity show --name $APP --resource-group $RG --query principalId --output tsv
$ACR_ID        = az acr show --name $ACR --query id --output tsv
az role assignment create --assignee $APP_PRINCIPAL --role AcrPull --scope $ACR_ID

# 3. Point the app's registry config at the identity instead of admin creds
az containerapp registry set `
  --name $APP --resource-group $RG `
  --server $ACR_LOGINSERVER `
  --identity system

# 4. Now disable the ACR admin user — it is no longer needed
az acr update --name $ACR --admin-enabled false
```

Role assignment can take a minute to propagate. Confirm pulls still work by forcing a new revision (§9) and checking it reaches **Running**.

---

## 8. Environment & configuration schema

The server validates all config with Zod at startup (`src/config.ts`). Invalid/missing values fail fast — and error messages never echo secret values.

### 8.1 Required

| Name | Example | Notes |
|---|---|---|
| `NAVEX_BASE_URL` | `https://your-instance.keylightgrc.com:4443` | Must be a valid URL; include the `:4443` port. |
| `PORT` | `3000` | Must match `--target-port`. |
| `LOG_LEVEL` | `info` | One of `trace` `debug` `info` `warn` `error`. |

### 8.2 Optional tuning (defaults live in code — set only to override)

| Name | Default | Meaning |
|---|---|---|
| `SESSION_IDLE_TTL_MS` | `900000` | Evict idle NAVEX sessions after 15 min. |
| `SESSION_PING_INTERVAL_MS` | `300000` | Keep-alive Ping every 5 min. |
| `METADATA_CACHE_TTL_MS` | `600000` | Component/field metadata cache TTL (10 min). |
| `NAVEX_MAX_CONCURRENT` | `4` | Max concurrent outbound calls to NAVEX. |
| `NAVEX_RETRY_MAX` | `3` | Retry attempts on transient NAVEX failures. |

### 8.3 Optional shared-credential / API-key mode (opt-in only)

By default there is nothing to store — Basic auth passes the caller's own NAVEX credentials through. If a non-interactive client (e.g. **Copilot Studio**) needs a single shared key, opt in. **Setting `API_KEYS` without the service account is a deliberate startup error.**

Store the password as a **Container Apps secret**, never inline:

```powershell
az containerapp secret set --name $APP --resource-group $RG `
  --secrets navex-service-password=<THE-PASSWORD> api-keys=<COMMA-SEPARATED-KEYS-MIN-16-CHARS>

az containerapp update --name $APP --resource-group $RG `
  --set-env-vars `
    NAVEX_SERVICE_USERNAME=<service-account-user> `
    NAVEX_SERVICE_PASSWORD=secretref:navex-service-password `
    API_KEYS=secretref:api-keys
```

| Name | When required | Notes |
|---|---|---|
| `API_KEYS` | opt-in only | Comma-separated; each key ≥ 16 chars. |
| `NAVEX_SERVICE_USERNAME` | if `API_KEYS` set | The shared NAVEX service account. |
| `NAVEX_SERVICE_PASSWORD` | if `API_KEYS` set | Use `secretref:` — never plaintext. |
| `NAVEX_LDAP_SETTINGS_ID` | LDAP/SSO accounts only | Numeric LDAP Profile ID; ask your NAVEX admin. |

### 8.4 Move secrets into Key Vault (recommended for prod)

For audit and rotation, back the secret with Azure Key Vault instead of a raw Container Apps secret:

```powershell
$KV = "kv-navex-mcp"
az keyvault create --name $KV --resource-group $RG --location $LOCATION
az keyvault secret set --vault-name $KV --name navex-service-password --value "<THE-PASSWORD>"

# App identity (from §7) reads the secret
$KV_ID = az keyvault show --name $KV --query id --output tsv
az role assignment create --assignee $APP_PRINCIPAL --role "Key Vault Secrets User" --scope $KV_ID

# Reference the Key Vault secret as a Container Apps secret
$KV_URI = az keyvault secret show --vault-name $KV --name navex-service-password --query id --output tsv
az containerapp secret set --name $APP --resource-group $RG `
  --secrets navex-service-password=keyvaultref:$KV_URI,identityref:system
```

---

## 9. Health probes & redeploy mechanics

### 9.1 Configure liveness/readiness probes

`/healthz` is unauthenticated and makes no NAVEX call, so it's safe to probe.

```powershell
az containerapp update --name $APP --resource-group $RG `
  --liveness-probe-path /healthz --liveness-probe-port 3000 `
  --readiness-probe-path /healthz --readiness-probe-port 3000
```

(If your CLI version rejects those flags, set the probes in the Portal: **Container App → Containers → Edit and deploy → Health probes**.)

### 9.2 Ship new code (versioned, with instant rollback)

```powershell
$TAG = "v2"                                  # always bump the tag; never reuse :latest
docker build --platform linux/amd64 -t "$ACR_LOGINSERVER/${IMAGE}:$TAG" .   # or: az acr build ...
docker push "$ACR_LOGINSERVER/${IMAGE}:$TAG"

az containerapp update --name $APP --resource-group $RG `
  --image "$ACR_LOGINSERVER/${IMAGE}:$TAG"   # creates a new revision automatically
```

**Rollback (no rebuild):** shift traffic back to the previous healthy revision.

```powershell
az containerapp revision list --name $APP --resource-group $RG --output table
az containerapp ingress traffic set --name $APP --resource-group $RG `
  --revision-weight <previous-revision-name>=100
```

---

## 10. Verify the deployment end-to-end

From the same PowerShell session:

```powershell
# 1. Health (no auth)
curl.exe "https://$APP_URL/healthz"
# Expect: {"status":"ok","activeNavexSessions":0}

# 2. MCP initialize (Basic auth = your own NAVEX username/password)
#    Use curl.exe (the real curl shipped with Windows), not the PowerShell alias.
#    --user with no password makes curl PROMPT, avoiding quoting issues with
#    special characters in NAVEX passwords.
curl.exe --user "YOUR_NAVEX_USER" `
  -X POST "https://$APP_URL/mcp" `
  -H "Content-Type: application/json" `
  -H "Accept: application/json, text/event-stream" `
  -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{},\"clientInfo\":{\"name\":\"curl\",\"version\":\"1\"}}}'
```

**Two gotchas with hand-rolled curl:**

- The `Accept` header **must list both** `application/json` and `text/event-stream` — the MCP spec requires it even though this server replies with plain JSON. Omit `text/event-stream` and you get `Not Acceptable`. Real MCP clients (Copilot Studio, MCP Inspector) send both automatically.
- On Windows, call **`curl.exe`** explicitly. Bare `curl` is a PowerShell alias for `Invoke-WebRequest`, which has different syntax and will choke on the flags above.

**Watch logs while testing:**

```powershell
az containerapp logs show --name $APP --resource-group $RG --follow
```

A JSON-RPC result (server info + capabilities) confirms MCP is live through ingress, auth, and the NAVEX round-trip.

---

## 11. Connect Copilot Studio (if applicable)

Point your custom connector / MCP client at:

```
https://<your-app-fqdn>/mcp
```

with HTTP **Basic** auth. The server replies with plain `application/json` (SSE disabled) specifically so it passes cleanly through the Power Platform connector gateway. For an unattended connector, use the shared-API-key mode from §8.3.

---

## 12. Production hardening checklist

Do these before real traffic:

- [ ] **Managed identity for pulls** (§7) done; **ACR admin user disabled**.
- [ ] **Secrets in Key Vault** (§8.4), not inline; rotation plan agreed with your security team.
- [ ] **Ingress restriction** — if only known clients call it, add IP allow-rules, or front it with **Azure API Management / Front Door + WAF**:
      ```powershell
      az containerapp ingress access-restriction set --name $APP --resource-group $RG `
        --rule-name allow-corp --ip-address <office-egress-CIDR> --action Allow
      ```
- [ ] **Scale rules** — `--min-replicas 1` for always-warm; set `--max-replicas` to your expected concurrency ceiling.
- [ ] **Probes** configured (§9.1).
- [ ] **Alerts** — alert on `/healthz` failures and on container restarts via the Log Analytics workspace.
- [ ] **Custom domain + managed certificate** via the Container App **Custom domains** blade if you don't want the `azurecontainerapps.io` URL.
- [ ] **CPU/memory** reviewed under load; bump from `0.5 / 1Gi` only if metrics justify it.
- [ ] **Image tags are immutable & versioned** (`v1`, `v2`, …) — never deploy `:latest` to prod.

---

## 13. Troubleshooting (Windows-specific)

| Symptom | Cause / Fix |
|---|---|
| `exec format error` in container logs, crash loop | arm64 image pushed. Rebuild with `--platform linux/amd64` (§5A). |
| `bare curl` flags error / weird output | You hit the PowerShell `curl` alias. Use `curl.exe`. |
| `TasksOperationsNotAllowed` on `az acr build` | ACR Tasks disabled in this subscription. Use local Docker build (§5A). |
| `az acr login` fails | Run `az login`; ensure AcrPush role or admin user enabled (§7.1 toggles it). |
| Revision stuck **Provisioning/Failed**, "unauthorized" on pull | AcrPull role not yet propagated, or registry still pointed at disabled admin user. Re-run §7 steps; wait ~1 min. |
| Docker build can't pull base image | Corporate proxy. Set proxy in Docker Desktop **Settings → Resources → Proxies** and `HTTPS_PROXY` env var. |
| Docker Desktop won't start | WSL2/Hyper-V not enabled. Either ask IT to enable WSL2, or skip local build entirely via cloud build (§5B). |
| `Invalid configuration for: navexBaseUrl` at startup | `NAVEX_BASE_URL` missing/not a URL. Set it as an env var (§8.1). |
| 401 on `/mcp` with correct password | Account is LDAP/SSO-backed; set `NAVEX_LDAP_SETTINGS_ID` (§8.3). |
| `Not Acceptable` from `/mcp` | Missing `text/event-stream` in the `Accept` header (§10). |

---

## 14. Command cheat-sheet (copy/paste order)

```powershell
# --- one-time setup ---
az login
az account set --subscription "<SUB>"
$RG="rg-navex-mcp"; $LOCATION="eastus2"; $ACR="navexmcpacr"
$ENVNAME="cae-navex-mcp"; $APP="navex-mcp"; $IMAGE="navex-mcp"; $TAG="v1"
$NAVEXURL="https://your-instance.keylightgrc.com:4443"

az group create -n $RG -l $LOCATION
az acr create -g $RG -n $ACR --sku Basic -l $LOCATION
$ACR_LOGINSERVER = az acr show -n $ACR --query loginServer -o tsv
az containerapp env create -n $ENVNAME -g $RG -l $LOCATION

# --- build & push (local) ---
az acr login -n $ACR
docker build --platform linux/amd64 -t "$ACR_LOGINSERVER/${IMAGE}:$TAG" .
docker push "$ACR_LOGINSERVER/${IMAGE}:$TAG"

# --- deploy ---
az acr update -n $ACR --admin-enabled true
az containerapp create -n $APP -g $RG --environment $ENVNAME `
  --image "$ACR_LOGINSERVER/${IMAGE}:$TAG" --registry-server $ACR_LOGINSERVER `
  --target-port 3000 --ingress external --min-replicas 1 --max-replicas 3 `
  --cpu 0.5 --memory 1.0Gi `
  --env-vars NAVEX_BASE_URL=$NAVEXURL PORT=3000 LOG_LEVEL=info

# --- harden: managed identity ---
az containerapp identity assign -n $APP -g $RG --system-assigned
$APP_PRINCIPAL = az containerapp identity show -n $APP -g $RG --query principalId -o tsv
$ACR_ID = az acr show -n $ACR --query id -o tsv
az role assignment create --assignee $APP_PRINCIPAL --role AcrPull --scope $ACR_ID
az containerapp registry set -n $APP -g $RG --server $ACR_LOGINSERVER --identity system
az acr update -n $ACR --admin-enabled false

# --- verify ---
$APP_URL = az containerapp show -n $APP -g $RG --query properties.configuration.ingress.fqdn -o tsv
curl.exe "https://$APP_URL/healthz"
```

---

*Companion docs: `docs/AZURE_CONTAINER_APPS_DEPLOYMENT.md` (Portal/macOS walkthrough), `docs/DEPLOYMENT.md`, `README.md`. Config source of truth: `src/config.ts`.*
