# Model evaluation harness

Compares candidate chat models against the one this app currently deploys, using the app's own
prompt and schema. Written for issue #223 and kept so the next model comparison is a re-run rather
than a fresh argument.

## Why it exists

The model choice is recorded in `docs/deployment.md`, and every previous entry in that table was a
_capability_ claim — "rejects `temperature`", "no `GlobalStandard` quota". Those age badly, and
published capability tables turned out to be wrong at least once: `gpt-5.6-luna` is documented as
supporting `temperature` and returns `400 Unsupported parameter` when you send it.

So this harness probes real deployments instead of reading about them.

## What each script does

| Script          | Question it answers                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `smoke.mjs`     | Does the model accept the call shape at all — `temperature`, strict `json_schema`?                |
| `shapes.mjs`    | Do **all four** BFF call shapes work, including the hosted `web_search` tool `/api/search` needs? |
| `run.mjs`       | Field-by-field accuracy, invention, latency and token counts across eight bag texts.              |
| `invention.mjs` | Which fields did a model fill in that the text does not support?                                  |

`run.mjs` is the one that produces the table. The others exist because accuracy is not the only way
a swap can fail: a model that parses well but cannot run `web_search` would break enrichment, which
is the feature that calls the AI most.

## Running it

Deploy the candidates alongside the incumbent, then point the scripts at the account:

```powershell
az cognitiveservices account deployment create -n <account> -g <rg> `
  --deployment-name eval-gpt54mini --model-name gpt-5.4-mini --model-version 2026-03-17 `
  --model-format OpenAI --sku-name GlobalStandard --sku-capacity 10

$env:EVAL_EP = az cognitiveservices account show -n <account> -g <rg> --query properties.endpoint -o tsv
$env:EVAL_KEY = az cognitiveservices account keys list -n <account> -g <rg> --query key1 -o tsv

node scripts/model-eval/smoke.mjs     # cheap disqualifiers first
node scripts/model-eval/shapes.mjs
node scripts/model-eval/run.mjs
```

Add candidates to the `MODELS` array in each script. `sendTemp: false` marks a model that cannot
take `temperature` — it will still be measured, but it cannot be adopted without a code change,
because `callResponses` always sends one.

`run.mjs` imports from `api/dist`, so run `pnpm build` in `api/` first.

## Reading the results

- **Give every candidate the same deployment capacity.** Throttling otherwise shows up as latency.
  The harness retries 429s and paces itself for this reason.
- **`invented` matters more than the accuracy percentage.** A wrong field the user can see is a
  nuisance; a plausible invented one is written to the library as fact. The cases include texts that
  deliberately support almost nothing, to catch exactly that.
- **Check `schema fails` is 0.** A non-zero count usually means the harness is out of step with
  `validateParsedBean`, not that the model is broken.

## Tearing down

The eval deployments bill per token but cost nothing idle. Remove them anyway once the decision is
recorded:

```powershell
az cognitiveservices account deployment delete -n <account> -g <rg> --deployment-name eval-gpt54mini
```
