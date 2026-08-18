/**
 * Runs the fixed pipeline and the agentic path over the same coffees and
 * prints the comparison `specs/agentic-backend.md` §7 asks for.
 *
 * Both paths are driven through the **real HTTP endpoints** on a local
 * Functions host rather than by importing the libraries. Re-implementing the
 * ladder here to compare against would have measured the re-implementation,
 * which is the one result that would prove nothing.
 *
 *   cd api && pnpm build && func start --port 7072   # AGENT_ENRICH_ENABLED=true
 *   node scripts/agent-eval/run.mjs
 *
 * Costs real money: every case makes model calls on both paths, and Blue Bottle
 * makes a paid web search on each.
 */
import { CASES, completeness, isWrongPage } from './cases.mjs';

const BASE = process.env.AGENT_EVAL_BASE ?? 'http://localhost:7072';
const PRICE_PER_1M = { input: 0.75, output: 4.5 }; // gpt-5.4-mini, Global Standard

/**
 * Retries a request whose failure was Azure throttling rather than the path
 * under test.
 *
 * This is not defensive padding. The first run of this harness reported the
 * agent failing four of seven cases; every one of those failures was a 429
 * from a 10K-TPM deployment, and the table looked like a result. Throttling
 * masquerading as a failure rate is the specific way this measurement goes
 * wrong, so detecting it is part of the measurement.
 */
function isThrottled(payload) {
  return JSON.stringify(payload ?? {}).includes('rate_limit_exceeded');
}

async function post(path, body, timeoutMs = 180_000) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text.slice(0, 200) };
    }

    if (attempt < 5 && (res.status === 429 || isThrottled(json))) {
      const waitMs = 2000 * 2 ** attempt;
      process.stdout.write(`    throttled, waiting ${waitMs}ms\n`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    return { status: res.status, json };
  }
}

const zero = () => ({ inputTokens: 0, outputTokens: 0 });
function add(into, usage) {
  if (!usage) return into;
  into.inputTokens += usage.inputTokens ?? 0;
  into.outputTokens += usage.outputTokens ?? 0;
  return into;
}

/**
 * The current flow, exactly as the client drives it: search, then scrape the
 * best hit, then parse the text.
 */
async function runPipeline(testCase) {
  const startedAt = Date.now();
  const usage = zero();
  let paidSearches = 0;

  const search = await post('/api/search', {
    roaster: testCase.roaster,
    name: testCase.name,
    max: 5,
  });
  add(usage, search.json.usage);
  if (search.json.provider === 'web-search') paidSearches += 1;

  const top = search.json.results?.[0];
  if (!top) {
    return { ok: false, reason: 'no candidates', ms: Date.now() - startedAt, usage, paidSearches };
  }

  const scrape = await post('/api/scrape', { url: top.url });
  if (scrape.status !== 200) {
    return {
      ok: false,
      reason: `scrape ${scrape.status}`,
      ms: Date.now() - startedAt,
      usage,
      paidSearches,
    };
  }

  const parse = await post('/api/parse', { ocrText: scrape.json.extracted?.rawText ?? '' });
  add(usage, parse.json.usage);
  if (parse.status !== 200) {
    return {
      ok: false,
      reason: `parse ${parse.status}`,
      ms: Date.now() - startedAt,
      usage,
      paidSearches,
    };
  }

  return {
    ok: true,
    parsed: parse.json.parsed,
    sourceUrl: scrape.json.sourceUrl ?? top.url,
    ms: Date.now() - startedAt,
    usage,
    paidSearches,
    steps: 3,
  };
}

async function runAgent(testCase) {
  const startedAt = Date.now();
  const res = await post('/api/agent-enrich', { roaster: testCase.roaster, name: testCase.name });
  const trace = res.json.trace ?? {};
  const usage = add(zero(), trace.usage);

  if (res.status !== 200) {
    return {
      ok: false,
      reason: trace.stopReason ?? `http ${res.status}`,
      ms: Date.now() - startedAt,
      usage,
      paidSearches: trace.paidSearches ?? 0,
    };
  }
  return {
    ok: true,
    parsed: res.json.parsed,
    sourceUrl: res.json.sourceUrl,
    ms: Date.now() - startedAt,
    usage,
    paidSearches: trace.paidSearches ?? 0,
    steps: trace.steps,
    stopReason: trace.stopReason,
  };
}

function cost(usage) {
  return (
    (usage.inputTokens / 1e6) * PRICE_PER_1M.input +
    (usage.outputTokens / 1e6) * PRICE_PER_1M.output
  );
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarise(label, runs, cases) {
  const ok = runs.filter((r) => r.ok);
  const latencies = runs.map((r) => r.ms);
  // Zip against the cases before filtering: indexing `cases` by a position in
  // the filtered list would compare a run against the wrong coffee as soon as
  // one of them failed.
  const wrongPage = runs.filter(
    (r, i) => r.ok && isWrongPage(r.sourceUrl, cases[i].expectedDomain),
  ).length;
  const scores = ok.map((r) => completeness(r.parsed));
  return {
    label,
    succeeded: `${ok.length}/${runs.length}`,
    fieldsFilled: scores.length
      ? `${((scores.reduce((a, b) => a + b, 0) / scores.length) * 100).toFixed(1)}%`
      : 'n/a',
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    tokens: Math.round(
      runs.reduce((a, r) => a + r.usage.inputTokens + r.usage.outputTokens, 0) / runs.length,
    ),
    paidSearches: runs.reduce((a, r) => a + r.paidSearches, 0),
    costPer100: `$${((runs.reduce((a, r) => a + cost(r.usage), 0) / runs.length) * 100).toFixed(2)}`,
    wrongPage,
  };
}

const health = await fetch(`${BASE}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`No Functions host at ${BASE}. Start it with: cd api && func start --port 7072`);
  process.exit(1);
}

const pipelineRuns = [];
const agentRuns = [];

for (const testCase of CASES) {
  process.stdout.write(`${testCase.roaster} — ${testCase.name}\n`);

  const pipeline = await runPipeline(testCase);
  pipelineRuns.push(pipeline);
  process.stdout.write(
    `  pipeline: ${pipeline.ok ? 'ok' : `FAILED (${pipeline.reason})`} ${pipeline.ms}ms ` +
      `${pipeline.usage.inputTokens + pipeline.usage.outputTokens} tok ${pipeline.sourceUrl ?? ''}\n`,
  );

  const agent = await runAgent(testCase);
  agentRuns.push(agent);
  process.stdout.write(
    `  agent:    ${agent.ok ? 'ok' : `FAILED (${agent.reason})`} ${agent.ms}ms ` +
      `${agent.usage.inputTokens + agent.usage.outputTokens} tok ${agent.steps ?? '-'} steps ${agent.sourceUrl ?? ''}\n`,
  );
}

console.log('\n');
console.table([summarise('pipeline', pipelineRuns, CASES), summarise('agent', agentRuns, CASES)]);
