# Deployment Guide — NAVEX IRM MCP Server

## 1. Environment variables

| Variable | Required | Description |
|---|---|---|
| `NAVEX_BASE_URL` | yes | e.g. `https://yourco.lockpath.app:4443` |
| `NAVEX_SERVICE_USERNAME` | for API-key auth | NAVEX account with API Access enabled, least-privilege Security Role |
| `NAVEX_SERVICE_PASSWORD` | for API-key auth | Store in Key Vault, never in source |
| `API_KEYS` | optional | Comma-separated keys (min 16 chars) accepted in `x-api-key` |
| `PORT` | no | Default 3000 |
| `LOG_LEVEL` | no | `info` default |
| `SESSION_IDLE_TTL_MS` / `SESSION_PING_INTERVAL_MS` / `METADATA_CACHE_TTL_MS` | no | Session + cache tuning |
| `NAVEX_MAX_CONCURRENT` / `NAVEX_RETRY_MAX` | no | Outbound throttling |

## 2. Local run

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # http://localhost:3000
npm test               # 22 unit/integration tests with mocked NAVEX
```

Smoke test:

```bash
curl http://localhost:3000/healthz
curl -u NAVEXUSER:PASSWORD http://localhost:3000/api/components
```

## 3. Azure Container Apps

```bash
az group create -n rg-navex-mcp -l eastus
az acr create -n yourregistry -g rg-navex-mcp --sku Basic
az acr build -r yourregistry -t navex-mcp:latest .

az containerapp env create -n cae-navex -g rg-navex-mcp -l eastus

az containerapp create \
  -n navex-mcp -g rg-navex-mcp \
  --environment cae-navex \
  --image yourregistry.azurecr.io/navex-mcp:latest \
  --registry-server yourregistry.azurecr.io \
  --target-port 3000 --ingress external \
  --min-replicas 1 --max-replicas 3 \
  --secrets navex-pass=<from-keyvault> api-keys=<keys> \
  --env-vars NAVEX_BASE_URL=https://yourco.lockpath.app:4443 \
             NAVEX_SERVICE_USERNAME=apisvc \
             NAVEX_SERVICE_PASSWORD=secretref:navex-pass \
             API_KEYS=secretref:api-keys
```

Notes:
- Keep `--min-replicas 1` so NAVEX sessions and metadata cache stay warm.
- Bind secrets from Key Vault (`--secrets ...keyvaultref`) in production.
- Outbound: the app must reach your NAVEX instance on port 4443; Power Platform must reach the app's HTTPS ingress.

## 4. Wire up Copilot Studio (agents)

Auth is **Basic (NAVEX username/password)** by default. The MCP onboarding wizard doesn't offer Basic auth, so import the connector manually:

1. Set `host` in `docs/connector/mcp-connector.swagger.yaml` to your deployed hostname.
2. Power Apps/Power Automate → **Custom connectors** → **Import an OpenAPI file** → select the file. Security is already defined as Basic.
3. In Copilot Studio → your agent → **Tools** → **Add a tool** → select the imported connector; create a connection with your NAVEX username/password.
4. Mark destructive tools (delete_record, delete_user, delete_group, delete_attachments) as requiring human confirmation in the agent's tool settings.

(If you later opt in to API keys, the MCP wizard route works: Server URL `https://<your-app>/mcp`, API key auth, header `x-api-key`.)

## 5. Wire up Power Automate (your 30+ cloud flows)

1. Power Automate → **Custom connectors** → **Import an OpenAPI file** → `docs/connector/rest-connector.swagger.yaml` (set `host` to your deployed hostname first).
2. Security: **Basic auth** — each connection stores a NAVEX username/password and runs with that account's permissions. (API-key connections use the shared service account.)
3. Migrate flows incrementally: replace each HTTP action chain (Login → call → cookie juggling) with a single connector action. Login/Ping/retry are handled server-side.

## 6. Production recommendations

- Front with Azure API Management if you want OAuth 2.0 / Entra ID inbound auth, per-subscriber quotas, and IP restrictions without code changes.
- Alert on `healthz` and on audit-log failures (`success:false` spikes).
- Rotate `API_KEYS` and the service-account password on a schedule.
- Validate NAVEX session concurrency limits with your instance before raising `NAVEX_MAX_CONCURRENT`.
- Power Platform DLP: classify the two custom connectors appropriately so agents/flows are governed.
