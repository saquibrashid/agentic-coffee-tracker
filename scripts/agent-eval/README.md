# agent-eval

Compares two enrichment strategies over the same coffees: the existing pipeline
(`/api/search` → `/api/scrape` → `/api/parse`) and the bounded agent loop
(`/api/agent-enrich`). Produces the table in `specs/agentic-backend.md` §8.

Both paths are driven as **real HTTP requests against a running Functions host**,
not by importing the modules. That is deliberate: the point of comparison is the
whole path a client actually gets, including rate limiting, error mapping and
the real network. Importing the libraries directly would measure a system nobody
uses.

## Running it

```powershell
# 1. api/local.settings.json with AZURE_OPENAI_*, WEB_SEARCH_ENABLED=true
#    and AGENT_ENRICH_ENABLED=true. It holds a live key — delete it afterwards.
cd api; pnpm build; func start --port 7072

# 2. in another shell, from the repo root
node scripts/agent-eval/run.mjs
```

`API_BASE` overrides the host (default `http://localhost:7072`).

## Two ways this lies to you

Both were hit for real; both produced a plausible table that was wrong.

**Throttling reads as a failure rate.** An Azure deployment at its default
capacity is 10K TPM, and one agent request is ~5K tokens. The first run reported
the agent failing 4 of 7 — every one was a `429`. The harness now retries on 429,
but if a run looks decisive, read the host log before believing it. Raise the
deployment capacity for the duration and **put it back afterwards**.

**Token counts miss what the tools spend.** The paid web search runs a model call
of its own and is the most expensive single thing either path does. Both paths
now report it (`usage` on `/api/search` and `/api/parse`, `WebSearchOutcome.usage`
inside the agent). Any new tool that calls a model must thread its usage back the
same way, or the path that uses it will look artificially cheap.

## Cases

`cases.mjs` is seven real coffees. Six are Shopify stores, where the pipeline's
fallback ladder is on its home ground. Blue Bottle is there because it is not:
its store search fails and the paid web search takes over, which is the case that
would justify an agent if anything would.

Cases are compared on fields filled rather than exact values — roasters edit
their own copy, so pinning strings would make this fail for the wrong reason.
`wrongPage` is the check that matters for correctness: it catches a confident
answer sourced from someone else's product page.
