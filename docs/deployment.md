# Deployment

Coffee Bean Tracker deploys to Azure as two services:

| Service                           | Azure resource                   | azd service name |
| --------------------------------- | -------------------------------- | ---------------- |
| SPA (Vite/React PWA)              | Static Web App                   | `web`            |
| BFF (Azure Functions v4, Node 20) | Function App on Flex Consumption | `api`            |

Supporting resources: Log Analytics workspace, Application Insights (workspace-based) with a synthetic availability test, Storage account (Functions runtime + deployment package), Key Vault (RBAC) for AI keys, and a user-assigned managed identity used for both storage and Key Vault access.

Everything is defined in `infra/main.bicep` (subscription scope) and `infra/resources.bicep` (resource-group scope), orchestrated by `azure.yaml`.

## Client-side routes need `staticwebapp.config.json`

`public/staticwebapp.config.json` is copied into `dist/` by Vite and tells Static Web Apps to serve
`index.html` for any path it does not recognise as a file.

Without it, only `/` works: loading, refreshing or bookmarking `/beans`, `/settings` or `/analytics`
returns a **404 from the CDN**, because those paths only exist inside the React router and there is no
matching file on disk. The dev server does this fallback automatically, so the failure appears only
once deployed — it will not show up in `pnpm dev` or in Playwright.

The `exclude` list matters: without it the fallback also swallows missing assets, turning a genuine
404 into an HTML page served with a JS content type. `/api/*` is excluded so the linked-backend proxy
to the Function App keeps working.

## AI services are provisioned for you

`azd provision` creates an Azure AI Vision account and an Azure AI Foundry account with a `gpt-5.4-mini`
deployment, so `/api/ocr`, `/api/parse`, and `/api/recommend` are **live on a first deploy** with no
manual setup. Two things to know:

- **Azure AI Vision `F0` is limited to one free account per subscription per region.** A second
  environment in the same region will fail to provision until you set `visionSkuName=S1` (paid) or
  pick another region.
- **Web search needs no extra resource or key.** `/api/search` first resolves a roaster to its
  storefront domain with the model and queries that store's own product search, which costs nothing
  beyond an HTTP request. Only when that finds nothing does it fall back to a general web search,
  which runs as the `web_search` tool on the **same Azure OpenAI resource** — there is no Grounding
  with Bing resource to deploy, which matters because that resource cannot be created on
  credit-based subscriptions such as Visual Studio Enterprise at all.

  The fallback is billed per lookup (roughly 12k input tokens, so a few cents), so set
  `WEB_SEARCH_ENABLED=false` on the Function App to switch it off without a redeploy. Coffees found
  by the free path never reach it.

- **`AGENT_ENRICH_ENABLED` is off, and should stay off.** It exposes
  `POST /api/agent-enrich`, an experimental agentic enrichment loop kept as a measuring instrument
  rather than a feature. Unset, the route returns 404 and costs nothing. It was measured against the
  pipeline and lost on latency and cost at equal accuracy — see `specs/agentic-backend.md` §8 before
  turning it on, because it spends roughly 1.8× the tokens per enrichment.

Every AI parameter also accepts a bring-your-own value (`visionEndpoint`/`visionKey`,
`openAiEndpoint`/`openAiKey`/`openAiDeployment`). Set one and the provisioned account is bypassed in
favour of yours.

If an endpoint ever _does_ fall back to its mock, the capture screen says so explicitly rather than
presenting fixtures as a real read of your bag.

### Which Azure OpenAI API the BFF calls

The BFF calls the **v1 API** — `POST {endpoint}/openai/v1/responses` — not the older
`/openai/deployments/{deployment}/chat/completions` route. The v1 surface takes no dated
`api-version`, so there is no version string to keep current, and it still supports **strict**
structured outputs (`text.format` with `"strict": true`), which `/api/parse` and `/api/recommend`
depend on to guarantee schema-shaped output.

All calls go through `api/src/lib/openai.ts`. Requests set `"store": false` so bag text and taste
history are not retained in the service-side response store.

Authentication is the `api-key` header, with the key delivered as a Key Vault reference. Managed
identity is **not** required for the AI calls.

### The account is a Foundry resource, not a classic Azure OpenAI one

`infra/resources.bicep` provisions the account as `kind: 'AIServices'` with
`allowProjectManagement: true`, plus a `Microsoft.CognitiveServices/accounts/projects` child named
`coffee-tracker` (override with the `openAiProjectName` parameter).

This is the current resource model. The older `kind: 'OpenAI'` account is not deprecated and has no
announced retirement date, but it renders only in the classic Azure OpenAI portal — the new Foundry
portal works in terms of _projects_, so an account without one appears to be missing or empty there.
Microsoft is also auto-upgrading eligible classic accounts, so doing it deliberately is preferable to
being migrated unannounced.

Three things this template pins on purpose:

- **`disableLocalAuth: false`.** Microsoft's upgrade guidance shows `true`, which would disable API
  keys and break the Key Vault reference the Function App authenticates with.
- **A system-assigned identity on the account.** Required by the Foundry resource model. This is an
  identity _on the Cognitive Services account_; the BFF still authenticates with an API key, so it
  does not make managed identity a prerequisite for the application.
- **`AZURE_OPENAI_ENDPOINT` is built as `https://<account>.openai.azure.com/`, not read from
  `properties.endpoint`.** On an `AIServices` account that property returns the generic
  `*.cognitiveservices.azure.com` hostname. Both currently answer `/openai/v1/responses`, but only
  `*.openai.azure.com` is documented for that data plane.

Upgrading an existing account is an in-place `Modify` — run `azd provision`. The resource name,
endpoint, keys, and model deployments are all preserved, and no application code changes.

Avoid the **Standard agent** setup when adding to this resource: it provisions customer-owned Cosmos
DB, AI Search, and Storage, which carry real idle cost. A plain account plus project does not.

### Why `gpt-5.4-mini`

The model was `gpt-4o` until August 2026. It was re-tested against the catalog (issue #223) and
replaced, because a candidate finally matched it on accuracy while costing substantially less.

Re-run the comparison with `scripts/model-eval/` before changing this again. It drives the real
`PARSE_SYSTEM_PROMPT` and `PARSED_BEAN_SCHEMA` against eight bag texts — label fragments, noisy OCR,
a datasheet, a scraped product page and roaster prose — and scores field by field.

| Model                         | Result                                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gpt-5.4-mini` (`2026-03-17`) | **Adopted.** 95.3% field accuracy — identical to `gpt-4o` — at ~$0.00099 per parse vs ~$0.00259, and a 1531 ms median vs 1955 ms. Accepts `temperature` and strict schemas, and runs the hosted `web_search` tool, so it is a config change with no code change. |
| `gpt-5.6-luna` (`2026-07-09`) | Best accuracy measured (95.8%) but **rejects `temperature`**, which `callResponses` always sends. Also the slowest (2284 ms median) and ~1.5x the cost of `gpt-5.4-mini`. Adopting it means making `temperature` optional per model — not worth it for +0.5%.    |
| `DeepSeek-V4-Flash`           | In the catalog, but quota is **0** in every region checked (`eastus`, `eastus2`, `westus`, `westus3`, `swedencentral`). Deployment fails with `InsufficientQuota`. Needs a quota request before it can even be measured.                                         |
| `gpt-4o-mini` (`2024-07-18`)  | Deployment is rejected with `ServiceModelDeprecating`.                                                                                                                                                                                                           |
| `gpt-4.1-mini`                | No `GlobalStandard` quota — only the batch tiers.                                                                                                                                                                                                                |
| `gpt-5-mini`                  | Rejects `temperature`, and `parse.ts`/`recommend.ts` send `temperature: 0` for determinism. Usable only with code changes.                                                                                                                                       |

Two things are worth knowing before trusting a future re-run:

- **Published capability tables are not evidence.** `gpt-5.6-luna` is widely documented as supporting
  `temperature`; it returns `400 Unsupported parameter: 'temperature' is not supported with this
model`. Probe the deployment, do not read about it.
- **Accuracy alone does not decide it.** `gpt-5.4-mini` invents slightly more than `gpt-4o` on text
  that supports nothing — it guessed a `dark` roast for an espresso blend that never states one.
  Invented fields land in the library looking like fact, so the eval scores them as wrong and
  `scripts/model-eval/invention.mjs` prints them. This was accepted because the confirm step puts
  every parse in front of the user before it is saved.

## One-time setup

```bash
az login
azd auth login
azd env new coffee-dev
azd env set AZURE_LOCATION eastus2
```

Optional — bring your own AI resources instead of the provisioned ones:

```bash
azd env set AZURE_VISION_ENDPOINT   https://<your-vision>.cognitiveservices.azure.com/
azd env set AZURE_VISION_KEY        <key>
azd env set AZURE_OPENAI_ENDPOINT   https://<your-openai>.openai.azure.com/
azd env set AZURE_OPENAI_DEPLOYMENT gpt-5.4-mini
azd env set AZURE_OPENAI_KEY        <key>
```

Optional — enable studio product shots. This is a **separate account in a
separate region**, not another deployment on the Azure OpenAI resource: MAI
image models are not offered in `eastus2`, and they answer on the Foundry host
under `/mai/v1` rather than the OpenAI-compatible route. Leave it unset and
`/api/studio-photo` stays in mock mode (it echoes the source photo back), which
is the default because every generated image is billed.

```bash
# Provision an image account and model...
azd env set AZURE_IMAGE_MODEL      MAI-Image-2.5
# ...or point at a resource you already have.
azd env set AZURE_IMAGE_ENDPOINT   https://<your-foundry>.services.ai.azure.com/
azd env set AZURE_IMAGE_KEY        <key>
azd env set AZURE_IMAGE_DEPLOYMENT MAI-Image-2.5
```

`MAI-Image-2.5` was chosen over `gpt-image-1` on measurements, not preference.
Static Web Apps abandons a linked-backend call after **45 seconds** and returns
`Backend call failure`, discarding whatever the function eventually answers:

| model                  | latency | packaging text |
| ---------------------- | ------- | -------------- |
| `gpt-image-1` `high`   | ~46s    | preserved      |
| `gpt-image-1` `medium` | ~25s    | **corrupted**  |
| `MAI-Image-2.5`        | ~26s    | preserved      |

gpt-image-1 cannot fit inside that window at the only quality setting that
keeps a label intact — at `medium` it renders "Guji Natural" as "Guij Natural".
Note that MAI image models are in **preview**, with no SLA.

Optional — upgrade the Static Web App so the SPA reaches the BFF same-origin:

```bash
azd env set STATIC_WEB_APP_SKU Standard
```

`Standard` provisions a _linked backend_, which proxies `https://<swa-host>/api/*` to the Function App. The SPA then needs no API base URL and makes no cross-origin requests. `Free` (the default) is zero-cost; the SPA calls the Function App directly and `VITE_API_BASE_URL` is populated with the Function App URL.

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
curl "$(azd env get-value SERVICE_WEB_URI)/api/health"
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "services": {
    "ocr": "live",
    "parse": "live",
    "search": "mock",
    "recommend": "live",
    "studioPhoto": "mock"
  }
}
```

`live` means the endpoint has real credentials; `mock` means it will return synthetic data. `search`
is expected to be `mock` (see above), and so is `studioPhoto` unless you opted into an image
deployment.

> **Gotcha:** a Flex Consumption Function App does **not** pick up new app settings on its own. If
> `/api/health` still says `mock` right after adding credentials, run
> `az functionapp restart -g <rg> -n <function-app>` and check again.

Note that the check goes through `SERVICE_WEB_URI`, not `SERVICE_API_URI`. Linking the Function App as a Static Web Apps backend turns on Easy Auth for it, so the `*.azurewebsites.net` URL answers `401` to everyone — the Static Web App front door is the only supported way in. That is also why every function is `authLevel: 'anonymous'`: linked backends cannot forward a function key, and the Easy Auth lockdown replaces it.

Then open the SPA:

```bash
azd env get-value SERVICE_WEB_URI
```

Walk the smoke path: **Add coffee → capture a bag photo → confirm the parsed fields → save → rate a brew → For You → Analytics → Export**.

## Authentication (optional, off by default)

Sign-in is **on** wherever the topology can verify an identity, which in practice means the `Standard` SKU. `VITE_AUTH_ENABLED` is emitted as an infrastructure output by `infra/main.bicep` rather than set by hand, so a build cannot end up offering a sign-in button on a topology that cannot trust the result.

Nothing about the app requires an account. Local-only is a supported way to run it; an account exists to move data between devices, which is gated separately by the access policy below.

**No app registration is required.** SWA's pre-configured `aad` provider uses a Microsoft-managed application and authorises against `login.microsoftonline.com/common`, so both work/school and personal Microsoft accounts (`outlook.com`, `hotmail.com`) sign in with no setup at all. Register a dedicated Entra app and supply `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` only if you want to restrict the audience to a single tenant, or to control consent yourself.

Running `vite dev` locally leaves sign-in hidden, because the dev server does not serve `/.auth/*` and the button would be dead. Only the exact string `'true'` enables it — `1` and `yes` leave it off, deliberately failing closed on typos.

Two things the config already enforces:

- **Unused providers are 404'd.** `public/staticwebapp.config.json` explicitly blocks GitHub, Google, Facebook, Twitter and Apple so SWA's defaults cannot silently expose an identity source nobody reviewed. Microsoft is the only provider this project supports — Apple was dropped rather than deferred, because its client secret expires every 6 months and a rotation that fails closed on a schedule, long after anyone remembers why, is a poor trade for one identity provider (`specs/sync.md` → Decisions § 2).
- **Auth stays off when `VITE_API_BASE_URL` is set.** In that topology the browser calls the Function App directly, so the `x-ms-client-principal` header is attacker-supplied rather than injected by SWA. `VITE_AUTH_ENABLED` cannot override this; see `specs/sync.md` → Identity.

Because the pre-configured provider accepts any Microsoft account, anyone who finds the URL can sign in. That grants no storage on its own — sync is gated by the allowlist described in the next section, and records are partitioned by `userId` regardless, so no one can read anyone else's.

## Who may sync (required before sync works)

Signing in proves who someone is. It does not entitle them to storage in your subscription — Microsoft accounts are free and unlimited, so "signed in" means "anyone on the internet". Sync therefore enforces a second, explicit decision.

**Sync is closed until you configure it.** With no allowlist the endpoints return 403 to every account, including yours. That is deliberate: treating "unconfigured" as "unrestricted" would open the deployment the moment a parameter went missing.

To grant yourself access:

1. **Sign in to the deployed site.** You will be signed in but refused, and the
   refusal names the exact value you need: `This deployment is restricted to
approved accounts. Add "<id>" to SYNC_ALLOWLIST to grant access.` (You can
   also read it from `/.auth/me` as `userId`.)

2. **Set that id and redeploy:**

   ```bash
   gh variable set SYNC_ALLOWLIST --body "78e79d0a04914b5faee2cce05a7bfd6e"
   gh workflow run deploy.yml --ref main
   ```

Sign-in names are matched as well as ids, so a colleague can be pre-approved by
address before they have ever signed in. **Do not rely on this for your own
bootstrap.** It only works if the provider actually reports an address in
`userDetails`, and the `aad` provider does not for a personal Microsoft account
— it reports an opaque identifier, so an allowlist containing only the account's
email address 403s the very person who owns the deployment. The id path always
works, and the id is the durable identifier anyway: it survives an address
change.

Either way the value is baked into the Function App as an app setting at deploy
time, so **re-run the Deploy workflow afterwards** — setting the variable alone
changes nothing until the next deploy.

Until then the app shows the reason inline: `This deployment is restricted to approved accounts. Add "<id>" to SYNC_ALLOWLIST to grant access.` The message names your own id and never names anyone else's.

Two variables control the policy:

| Variable           | Values                                 | Effect                                                                                                                                              |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SYNC_ACCESS_MODE` | `owner` (default), `allowlist`, `open` | `owner`/`allowlist` admit only listed accounts; `open` admits any sign-in                                                                           |
| `SYNC_ALLOWLIST`   | comma-separated ids or sign-in names   | Empty denies everyone. Sign-in names are accepted for pre-approving others, but `aad` does not report one for personal Microsoft accounts — use ids |

`owner` and `allowlist` enforce identically — they differ only in stated intent, so widening from one person to a group is a one-word change with a legible meaning. An unrecognised mode falls back to membership, never to `open`: a typo must not be what publishes your library.

Opening up later is a configuration change, not a code change:

```bash
gh variable set SYNC_ACCESS_MODE --body "allowlist"
gh variable set SYNC_ALLOWLIST --body "id-one,id-two,colleague@example.com"
```

Before choosing `open`, note what is not built yet: there is no in-app way to delete another account's data, so a public deployment relies entirely on the per-user quotas below.

### Per-user quotas

Two ceilings bound what one account can store. Both are per user, and both are enforced server-side.

| Variable            | Default | Bounds                                                              |
| ------------------- | ------- | ------------------------------------------------------------------- |
| `SYNC_RECORD_QUOTA` | `20000` | Live sync records (beans, ratings, photo metadata) in one partition |
| —                   | 500 MB  | Photo bytes. Not configurable                                       |

20,000 records is far beyond a plausible human library — a bean a day for fifty years, with ratings, is under 40,000 — while still being a _number_, which is the only property that matters against a runaway client writing in a loop.

```bash
gh variable set SYNC_RECORD_QUOTA --body "50000"
```

A value the API cannot parse as a positive integer falls back to 20,000 rather than failing the deploy, so a typo cannot lock you out of your own data. Raising the ceiling takes effect on the next deploy; it is read per request, not cached.

## Monitoring

Application Insights is wired to the Function App via `APPLICATIONINSIGHTS_CONNECTION_STRING`; the Functions host emits requests, dependencies, traces, and exceptions with no code changes.

The same connection string also turns on the app's own OpenTelemetry spans over the AI paths — model calls, tool calls, and each `/api/search` — in the GenAI semantic conventions, so token spend and enrichment outcomes are queryable and the traces are readable by Foundry Agent Insights. Nothing extra to configure; see `specs/observability.md` for the attributes and queries. Auto-instrumentation is deliberately left off so ingestion volume tracks requests rather than the number of domains a search happened to try — relevant to the budget alerts below. The host logs `telemetry: Azure Monitor OpenTelemetry started` on boot when it is active.

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

```kusto
// How often enrichment finds nothing (see specs/observability.md for more)
dependencies
| where name == "enrich.search" and timestamp > ago(7d)
| summarize count() by outcome = tostring(customDimensions["coffee.enrich.outcome"])
```

## What this costs

Rough monthly estimate for personal usage (US East, pay-as-you-go, USD). Prices drift — check the [pricing calculator](https://azure.microsoft.com/pricing/calculator/) before relying on these.

| Resource                       | Default config                                                  | Est. / month |
| ------------------------------ | --------------------------------------------------------------- | ------------ |
| App Insights availability test | 3 locations × every 5 min ≈ 26,000 runs                         | **~$26**     |
| Static Web App                 | `Free` SKU                                                      | $0           |
| Function App                   | Flex Consumption; free grant covers 250k executions + 100k GB-s | $0           |
| App Insights / Log Analytics   | First 5 GB/month free; this app ingests ~100 MB                 | $0           |
| Storage                        | Standard_LRS, a few MB deployment package                       | ~$0.10       |
| Key Vault                      | $0.03 per 10k operations                                        | <$0.01       |
| Azure AI Vision                | `F0`: 5,000 transactions/month free                             | $0           |
| Azure OpenAI (`gpt-5.4-mini`)  | Pay-per-token; a bag scan is ~1k tokens, ~$0.001 each           | ~$0.20       |
| Cosmos DB (sync)               | Serverless; `Standard` SKU only. ~$0.25/1M RUs, $0.25/GB-month  | ~$0.02       |
| Photo Blob Storage (sync)      | Hot LRS; `Standard` SKU only. $0.02/GB-month, 500 MB user quota | ~$0.01       |
| **Total**                      |                                                                 | **~$27**     |

The availability test is the entire bill. Everything else combined is under a dollar, because a personal-scale workload sits inside the Functions and Azure Monitor free grants.

Knobs, in order of impact:

- **Availability test** — `infra/resources.bicep`, the `availabilityTest` resource. Billing is per location per run, so cost scales linearly with both. Dropping to one location every 15 minutes costs ~$3/month; setting `Enabled: false` costs nothing. Three locations is the right default for a service people depend on, and overkill for a personal app — pick deliberately.
- **`STATIC_WEB_APP_SKU=Standard`** — adds a flat **$9/month** in exchange for a linked backend (same-origin `/api`). The `Free` default works identically from the user's perspective; the SPA just makes a cross-origin call.
- **AI services** — barely register. Azure AI Vision `F0` includes 5,000 free transactions/month, and a bag scan through Azure OpenAI costs a fraction of a cent. Expect pennies. Note the `F0` one-per-subscription-per-region limit if you stand up a second environment.
- **Sync (Cosmos + photo storage)** — only provisioned on the `Standard` SKU, and effectively free at personal scale. Both are pure consumption with no idle floor, so an unused deployment bills nothing. The dominant cost is the 5-minute sync poll in `specs/sync.md` → Triggers: leaving a tab open 24/7 is ~288 polls/day at roughly 6 RU each, which is about 52,000 RUs a month, or **$0.013**. Records are a couple of megabytes and photos are capped at 500 MB per user by quota. Even a runaway sync loop is bounded — backoff caps at 8 attempts and one hour, and a pathological once-per-second retry sustained for a month would still only reach ~$4.

> **Note:** `/api/search` needs no search-API key. It asks the model for the roaster's storefront domain and then queries that store's own product search, so its only cost is the model call.

### Budget alerts

The estimate above is what a normal month looks like. The bill worth worrying about is the abnormal one — a retry loop, a runaway client, or a bulk re-shoot spending Azure OpenAI tokens for days before anyone opens the portal. `infra/budget.bicep` provisions two Azure Consumption budgets and an action group to catch that:

| Budget              | Watches                                     | Default |
| ------------------- | ------------------------------------------- | ------- |
| `budget-<token>`    | the whole resource group                    | $25/mo  |
| `budget-ai-<token>` | the Vision, OpenAI and image accounts alone | $15/mo  |

Both alert at 50%, 80% and 100% of actual spend, and at 100% of _forecast_. The forecast alert is the one that gives useful warning; the actual-cost alerts only confirm the money is gone. The second, narrower budget exists so an alert says **where** the money went — a single group-wide number tells you something is wrong but not what, and the AI accounts are the only resources here whose cost has no ceiling of its own.

Nothing is provisioned until you name a destination:

```bash
azd env set BUDGET_CONTACT_EMAILS you@example.com
azd env set MONTHLY_BUDGET_AMOUNT 25       # optional
azd env set AI_MONTHLY_BUDGET_AMOUNT 15    # optional
azd up
```

That gate is deliberate. A budget whose alerts go nowhere is not a control, and provisioning one by default would leave the template claiming a protection it does not provide. Set several addresses by separating them with commas.

Two limits worth being clear about:

- **A budget alerts; it does not cap.** Azure will not stop the spend when a threshold trips. If you want an actual ceiling, the effective place for it is the application — a per-user or per-day quota on AI calls refuses the request before it is billed, which is both cheaper and more surgical than anything at the billing layer.
- **Consumption budgets need a pay-as-you-go, EA or MCA subscription.** They are not available on sponsored, free-trial or CSP subscriptions, where the deployment of these two resources will fail. Leave `BUDGET_CONTACT_EMAILS` empty on those.

Pick the amount from evidence rather than instinct: run the deployment for a month, read the actual figure in Cost analysis, and set the budget somewhat above it. A budget set below normal spend trains you to ignore the alerts.

## CI/CD

`.github/workflows/deploy.yml` runs `azd provision` + `azd deploy api` on every push to `main`, publishes the SPA with `Azure/static-web-apps-deploy@v1`, then smoke-tests `/api/health`. It authenticates with OIDC federated credentials — no long-lived secrets.

> **Why CI does not use `azd deploy web`.** azd publishes a `staticwebapp` service by shelling out to `npx @azure/static-web-apps-cli`, which resolves a fresh dependency tree from the npm registry on every run, with no lockfile to pin it. On 2026-08-19 a broken `@azure/identity` release — it declared a dependency on a package that was never published — made that install fail and blocked every deploy for hours, with nothing wrong in this repository ([#234](https://github.com/saquibrashid/agentic-coffee-tracker/issues/234)). The official action ships its tooling in a container, so a deploy no longer depends on the registry being healthy at that moment. Our own build was never affected, because it installs from the lockfile. `azd deploy web` remains the right thing to run by hand.

The job needs these repository **variables**:

> **A green _Deploy_ run means the commit shipped.** If `AZURE_CLIENT_ID`,
> `AZURE_TENANT_ID` or `AZURE_SUBSCRIPTION_ID` is missing, the run **fails** with a
> "❌ Deploy failed — nothing was published" summary listing which variable is absent,
> rather than passing silently. Only **forks** skip the deploy and stay green, since
> they have no subscription to deploy into.
>
> This used to be a silent skip on every repo, which meant weeks of green checkmarks
> on `main` while the live site kept serving a stale build. If you ever need the old
> lenient behaviour, the discriminator is `github.event.repository.fork`.

| Variable                                                                    | Purpose                                     |
| --------------------------------------------------------------------------- | ------------------------------------------- |
| `AZURE_CLIENT_ID`                                                           | App registration used for OIDC              |
| `AZURE_TENANT_ID`                                                           | Directory tenant                            |
| `AZURE_SUBSCRIPTION_ID`                                                     | Target subscription                         |
| `AZURE_ENV_NAME`                                                            | azd environment name (default `coffee-dev`) |
| `AZURE_LOCATION`                                                            | Azure region (default `eastus2`)            |
| `STATIC_WEB_APP_SKU`                                                        | `Free` or `Standard` (default `Free`)       |
| `AZURE_VISION_ENDPOINT`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` | Non-secret AI config                        |
| `AZURE_IMAGE_ENDPOINT`, `AZURE_IMAGE_DEPLOYMENT`, `AZURE_IMAGE_MODEL`       | Optional studio-photo image model           |

Keys go in repository **secrets**: `AZURE_VISION_KEY`, `AZURE_OPENAI_KEY`, `AZURE_IMAGE_KEY`.

Configure the federated credential in one step:

```bash
azd pipeline config --provider github
```

Answer **yes** when it offers to create `azure-dev.yml` — declining aborts the whole
flow, so the identity and repository variables never get created. Then **delete**
that generated file and decline the final "commit and push" prompt: `deploy.yml`
already does everything it would, and two workflows triggering on `push: main`
would race each other with concurrent `azd provision` runs.

> **`azd pipeline config` alone is not enough for this repo.** It registers federated
> credentials for the `ref:refs/heads/main` and `pull_request` subjects only, but the
> deploy job runs with `environment: dev`, which changes the OIDC token's subject to
> `repo:<owner>/<repo>:environment:dev`. Without a matching credential the login step
> fails with `AADSTS700213: No matching federated identity record found`. Add it once:
>
> ```bash
> az identity federated-credential create \
>   --name "<repo>-env-dev" \
>   --identity-name msi-agentic-coffee-tracker \
>   --resource-group rg-coffee-dev \
>   --issuer https://token.actions.githubusercontent.com \
>   --subject "repo:<owner>/<repo>:environment:dev" \
>   --audiences api://AzureADTokenExchange
> ```
>
> If that returns `RequestDisallowedByAzure` about MFA, the `az` CLI's cached token
> predates an MFA sign-in. Either re-run `az login`, or reuse the token `azd` already
> holds and `PUT` the credential through the ARM REST API
> (`.../federatedIdentityCredentials/<name>?api-version=2023-01-31`).

## Tear down

```bash
azd down --purge
```

`--purge` also removes the soft-deleted Key Vault so the same environment name can be redeployed immediately.
