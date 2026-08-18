# Observability — AI paths

**Status:** implemented. Tracks [#227](https://github.com/saquibrashid/agentic-coffee-tracker/issues/227).

The BFF emits OpenTelemetry spans in the [GenAI semantic
conventions](https://github.com/open-telemetry/semantic-conventions-genai) for
every model call, tool call, and enrichment request.

Two reasons, in order of how much they matter:

1. **We cannot currently answer basic questions about enrichment.** How often
   does the search return nothing? Which step spends the tokens? How much of
   the domain ladder is wasted work? [#208](https://github.com/saquibrashid/agentic-coffee-tracker/issues/208)
   recommended keeping the pipeline and adding an agent fallback only where the
   pipeline fails — but nobody knows how often that is. The `enrich.search`
   span makes it a query.
2. **Foundry Agent Insights reads these spans.** It wants `gen_ai.*` spans in
   Application Insights, not a hosted agent runtime, so the pipeline as it
   stands can appear in that tooling. This is the prerequisite for
   [#228](https://github.com/saquibrashid/agentic-coffee-tracker/issues/228)
   and is worth having whether or not #228 goes anywhere.

---

## 1. What is instrumented

| Span                  | Where                         | Covers                                            |
| --------------------- | ----------------------------- | ------------------------------------------------- |
| `enrich.search`       | `functions/search.ts`         | One `/api/search` request, end to end             |
| `chat <deployment>`   | `lib/openai.ts`               | Every model call, including each of an agent turn |
| `execute_tool <name>` | `functions/*`, `lib/agent.ts` | Store search, paid web search, page fetch         |

`callResponsesTurn` is the single chokepoint through which every model call in
the app passes, agent turns included. Instrumenting there rather than at each
call site means nothing can be added later that escapes measurement.

The agent loop (`lib/agent.ts`, flagged off) emits the same span shape as the
pipeline, so the two can be compared in one query rather than two dashboards.

### Attributes

Convention attributes are `gen_ai.*`. Ours are `coffee.*`, namespaced so a
future convention cannot collide and so a query can tell them apart. Every name
is a constant in `api/src/lib/telemetry.ts` — the conventions are still marked
Development upstream, so when they rename something that is the one file that
changes.

| Attribute                     | On              | Notes                                                                               |
| ----------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `coffee.enrich.outcome`       | `enrich.search` | `found`, `no-candidates`, `mock`                                                    |
| `coffee.enrich.provider`      | `enrich.search` | `roaster-site`, `web-search`, `mock`                                                |
| `coffee.enrich.result_count`  | `enrich.search` |                                                                                     |
| `coffee.enrich.domains_tried` | `enrich.search` | How much ladder was walked                                                          |
| `coffee.tool.outcome`         | `execute_tool`  | `found`, `no-match`, `not-a-store`, `no-such-domain`, `empty-page`, `http-<status>` |
| `coffee.store.domain`         | `execute_tool`  | Which guessed domain                                                                |
| `coffee.page.text_length`     | `execute_tool`  | Extracted page text size                                                            |

## 2. Why `NoCandidatesError` is measured server-side

`NoCandidatesError` is thrown in the **client**
(`src/services/enrich/autoEnrich.ts`), which would ordinarily mean browser
telemetry. It does not, because `findCandidates`
(`src/services/enrich/index.ts`) is a pure pass-through of what `/api/search`
returned: **`/api/search` returning zero results _is_ `NoCandidatesError`.**
The same holds for `EmptyPageError` and `/api/scrape` returning empty text.

So the number #208 needs is available server-side, and no client SDK, no extra
bundle weight, and no user-identifying telemetry is required to get it.

## 3. What is deliberately _not_ instrumented

**All auto-instrumentation is off** (`api/src/bootstrap.ts`). The Azure Monitor
distro would otherwise span every outbound HTTP call, which here means every
page scrape and every domain in the ladder — a large multiple of the spans we
want, billed per GB ingested, against the budget alerts in
[#206](https://github.com/saquibrashid/agentic-coffee-tracker/issues/206).
Turning `http` back on is a one-line change and the manual spans nest under it
correctly.

`host.json` keeps `telemetryMode` at its default, so the host's own Application
Insights logging and portal log streaming are unchanged. This is purely
additive.

### Expected failures are outcomes, not errors

Most guessed roaster domains do not resolve — three of four is typical for a
single search. Recording that as a span exception would mark the majority of
tool spans failed, which makes a failure-rate dashboard or alert useless. It is
recorded as `coffee.tool.outcome = no-such-domain` on a **successful** span
instead. Only genuinely unexpected errors set span status to error.

## 4. Enabling it

Set `APPLICATIONINSIGHTS_CONNECTION_STRING`. The Function App already has it
(`infra/resources.bicep`), so production needs nothing.

Without it, `startTelemetry()` returns false and the OTel API's default no-op
tracer takes over: spans are still created at every call site and simply go
nowhere. That is deliberate — instrumentation that has to be guarded at every
call site stops being added. The test suite is additionally excluded outright,
so a developer with the production string in their environment cannot ship
spans by running tests.

The host logs `telemetry: Azure Monitor OpenTelemetry started` when it is on;
whether traces are running is otherwise invisible until you go looking for
spans that were never emitted.

## 5. Queries

Run these in Application Insights → Logs.

**How often does search find nothing?** (the #208 number)

```kusto
dependencies
| where name == "enrich.search" and timestamp > ago(30d)
| extend outcome = tostring(customDimensions["coffee.enrich.outcome"])
| summarize requests = count() by outcome
| extend share = round(100.0 * requests / toscalar(
    dependencies | where name == "enrich.search" and timestamp > ago(30d) | count), 1)
```

**Where do the tokens go?**

```kusto
dependencies
| where timestamp > ago(7d) and isnotempty(customDimensions["gen_ai.usage.input_tokens"])
| extend
    input = toint(customDimensions["gen_ai.usage.input_tokens"]),
    output = toint(customDimensions["gen_ai.usage.output_tokens"])
| summarize calls = count(), input = sum(input), output = sum(output) by name
| order by input desc
```

Note that `enrich.search` totals include what its tools spent, so it will
double-count against the `chat` rows. That is intended: an agent that reports
only its own usage under-reports it by whatever its tools spend, which is the
measurement error that reversed the result in `agentic-backend.md` §8.

**Is the domain ladder worth it?**

```kusto
dependencies
| where name startswith "execute_tool search_roaster_store" and timestamp > ago(7d)
| extend outcome = tostring(customDimensions["coffee.tool.outcome"])
| summarize count() by outcome
```

A large `no-such-domain` share is the cost of guessing; a large `found` share
is the ladder earning its place.

**Latency by step**

```kusto
dependencies
| where timestamp > ago(7d) and name in ("enrich.search", "execute_tool web_search_product")
| summarize p50 = percentile(duration, 50), p95 = percentile(duration, 95) by name
```

## 6. Verified

Confirmed end to end against the `rg-coffee-dev` Application Insights resource
with a live `/api/search` for Blue Bottle "Bella Donovan":

- All 14 functions still register (`main` in `api/package.json` is a **single
  glob**, not a list — a comma-separated value matches zero files and silently
  registers nothing, so the bootstrap is imported by `telemetry.ts` instead of
  being a second entry point).
- Eight spans arrived, all `success = true`, each carrying an outcome.
- They form one trace: `enrich.search` parents the tool spans, and
  `web_search_product` parents its own `chat` span.
