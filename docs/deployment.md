# Deployment

Agentic Coffee Tracker deploys to Azure as two services:

| Service | Azure resource | azd service name |
| --- | --- | --- |
| SPA (Vite/React PWA) | Static Web App | `web` |
| BFF (Azure Functions v4, Node 20) | Function App on Flex Consumption | `api` |

Supporting resources: Log Analytics workspace, Application Insights (workspace-based) with a synthetic availability test, Storage account (Functions runtime + deployment package), Key Vault (RBAC) for AI keys, and a user-assigned managed identity used for both storage and Key Vault access.

Everything is defined in `infra/main.bicep` (subscription scope) and `infra/resources.bicep` (resource-group scope), orchestrated by `azure.yaml`.

## Zero-credential deploys are supported

Every AI parameter (`visionKey`, `openAiKey`, `bingSearchKey`, …) defaults to an empty string. When a key is absent:

- no Key Vault secret is created for it,
- no corresponding app setting is added to the Function App,
- the BFF endpoint returns a deterministic, schema-shaped mock response.

That means you can deploy the whole app with only a subscription and still click through the entire flow. Add credentials later and re-run `azd provision` to switch the affected endpoints to live.

## One-time setup

```bash
az login
azd auth login
azd env new coffee-dev
azd env set AZURE_LOCATION eastus2
```

Optional — supply real AI credentials:

```bash
azd env set AZURE_VISION_ENDPOINT   https://<your-vision>.cognitiveservices.azure.com/
azd env set AZURE_VISION_KEY        <key>
azd env set AZURE_OPENAI_ENDPOINT   https://<your-openai>.openai.azure.com/
azd env set AZURE_OPENAI_DEPLOYMENT gpt-4o
azd env set AZURE_OPENAI_KEY        <key>
azd env set BING_SEARCH_KEY         <key>
```

Optional — upgrade the Static Web App so the SPA reaches the BFF same-origin:

```bash
azd env set STATIC_WEB_APP_SKU Standard
```

`Standard` provisions a *linked backend*, which proxies `https://<swa-host>/api/*` to the Function App. The SPA then needs no API base URL and makes no cross-origin requests. `Free` (the default) is zero-cost; the SPA calls the Function App directly and `VITE_API_BASE_URL` is populated with the Function App URL.

## Deploy

```bash
azd up
```

`azd up` provisions infrastructure and deploys both services. To repeat only part of it:

```bash
azd provision        # infrastructure only
azd deploy api       # BFF only
azd deploy web       # SPA only
```

## Verify the deployment

```bash
curl "$(azd env get-value SERVICE_API_URI)/api/health"
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "services": { "ocr": "mock", "parse": "mock", "search": "mock", "recommend": "mock" }
}
```

`live` means the endpoint has real credentials; `mock` means it will return synthetic data. `/api/health` is the only anonymous endpoint — the rest use function-key auth.

Then open the SPA:

```bash
azd env get-value SERVICE_WEB_URI
```

Walk the smoke path: **Add coffee → capture a bag photo → confirm the parsed fields → save → rate a brew → For You → Analytics → Export**.

## Monitoring

Application Insights is wired to the Function App via `APPLICATIONINSIGHTS_CONNECTION_STRING`; the Functions host emits requests, dependencies, traces, and exceptions with no code changes.

A standard availability test (`api-health`) probes `/api/health` every 5 minutes from three regions and alerts on non-200 responses or a certificate within 7 days of expiry.

Useful queries in the Log Analytics workspace:

```kusto
// Endpoint health over the last day
requests
| where timestamp > ago(1d)
| summarize count(), avg(duration), percentile(duration, 95) by name, resultCode
| order by count_ desc
```

```kusto
// Upstream Azure AI failures
dependencies
| where timestamp > ago(1d) and success == false
| project timestamp, name, target, resultCode, duration
```

## CI/CD

`.github/workflows/deploy.yml` runs `azd provision` + `azd deploy` on every push to `main`, then smoke-tests `/api/health`. It authenticates with OIDC federated credentials — no long-lived secrets.

The job skips itself unless these repository **variables** are set:

| Variable | Purpose |
| --- | --- |
| `AZURE_CLIENT_ID` | App registration used for OIDC |
| `AZURE_TENANT_ID` | Directory tenant |
| `AZURE_SUBSCRIPTION_ID` | Target subscription |
| `AZURE_ENV_NAME` | azd environment name (default `coffee-dev`) |
| `AZURE_LOCATION` | Azure region (default `eastus2`) |
| `STATIC_WEB_APP_SKU` | `Free` or `Standard` (default `Free`) |
| `AZURE_VISION_ENDPOINT`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` | Non-secret AI config |

Keys go in repository **secrets**: `AZURE_VISION_KEY`, `AZURE_OPENAI_KEY`, `BING_SEARCH_KEY`.

Configure the federated credential in one step:

```bash
azd pipeline config --provider github
```

## Tear down

```bash
azd down --purge
```

`--purge` also removes the soft-deleted Key Vault so the same environment name can be redeployed immediately.
