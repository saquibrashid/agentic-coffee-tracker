/**
 * Compares candidate models against the deployed `gpt-4o` for issue #223.
 *
 * Deliberately drives the *real* prompt and the *real* schema imported from the
 * built Function App, and validates with the same `validateParsedBean` gate the
 * BFF uses. A bespoke copy would measure a call this app never makes.
 *
 * Usage:
 *   $env:EVAL_EP=...; $env:EVAL_KEY=...; node scripts/model-eval/run.mjs
 */
import { PARSE_SYSTEM_PROMPT } from '../../api/dist/src/lib/parsePrompt.js';
import { PARSED_BEAN_SCHEMA, validateParsedBean } from '../../api/dist/src/lib/beanSchema.js';
import { CASES } from './cases.mjs';

const ep = process.env.EVAL_EP.replace(/\/$/, '');
const key = process.env.EVAL_KEY;

// gpt-4o is the incumbent; the rest are the candidates under test. `sendTemp`
// records whether the model tolerates the `temperature: 0` the BFF always
// sends today — a model needing `false` here cannot be adopted by config alone.
const MODELS = [
  { name: 'gpt-4o', deployment: 'gpt-4o', sendTemp: true },
  { name: 'gpt-5.4-mini', deployment: 'eval-gpt54mini', sendTemp: true },
  { name: 'gpt-5.6-luna', deployment: 'eval-gpt56luna', sendTemp: false },
];

const REPEATS = 3;

async function callParse(model, ocrText, attempt = 0) {
  const body = {
    model: model.deployment,
    input: [
      { role: 'system', content: PARSE_SYSTEM_PROMPT },
      { role: 'user', content: `Extract a bean object from this text:\n\n${ocrText}` },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'parsed_bean',
        strict: true,
        schema: PARSED_BEAN_SCHEMA,
      },
    },
    ...(model.sendTemp ? { temperature: 0 } : {}),
    store: false,
  };
  const started = Date.now();
  const res = await fetch(`${ep}/openai/v1/responses`, {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  // A 429 is a property of the eval deployment's tiny quota, not of the model.
  // Retrying keeps throttling out of the latency and accuracy numbers.
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    return callParse(model, ocrText, attempt + 1);
  }
  if (!res.ok) return { ms, error: `${res.status} ${(await res.text()).slice(0, 160)}` };
  const data = await res.json();
  const text = (data.output ?? [])
    .filter((i) => i.type === 'message')
    .flatMap((i) => i.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('');
  let parsed;
  try {
    parsed = JSON.parse(text || '{}');
  } catch {
    parsed = undefined;
  }
  return { ms, parsed, usage: data.usage, valid: parsed ? validateParsedBean(parsed) : null };
}

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

/** Scores one field, returning 1 correct / 0 wrong, and flags invention. */
function scoreField(actual, expected) {
  const a = norm(actual ?? null);
  const e = norm(expected ?? null);
  if (e === null) return { ok: a === null, invented: a !== null };
  if (a === null) return { ok: false, invented: false };
  // Names and roasters vary in punctuation and word order; accept containment
  // either way so "Ethiopia Guji" and "Guji, Ethiopia" both count.
  return { ok: a === e || a.includes(e) || e.includes(a), invented: false };
}

function scoreNotes(actual, expected) {
  const a = (actual ?? []).map(norm);
  const e = expected.map(norm);
  if (e.length === 0) return { ok: a.length === 0, invented: a.length > 0 };
  const hit = e.filter((n) => a.some((x) => x.includes(n) || n.includes(x))).length;
  return { ok: hit === e.length, invented: false, partial: `${hit}/${e.length}` };
}

function scoreCase(parsed, expect) {
  if (!parsed) return { fields: 0, total: 7, invented: 0, detail: {} };
  const origin = (parsed.origins ?? [])[0] ?? {};
  const checks = {
    roaster: scoreField(parsed.roaster, expect.roaster),
    name: scoreField(parsed.name, expect.name),
    country: scoreField(origin.country, expect.country),
    process: scoreField(parsed.process, expect.process),
    roastLevel: scoreField(parsed.roastLevel, expect.roastLevel),
    notes: scoreNotes(parsed.tastingNotes, expect.notes),
    roastDate: scoreField(parsed.roastDate, expect.roastDate),
  };
  const description = expect.descriptionExpected
    ? { ok: typeof parsed.roasterDescription === 'string' && parsed.roasterDescription.length > 20 }
    : { ok: true };
  checks.description = description;
  const fields = Object.values(checks).filter((c) => c.ok).length;
  const invented = Object.values(checks).filter((c) => c.invented).length;
  return { fields, total: Object.keys(checks).length, invented, detail: checks };
}

const results = [];
for (const model of MODELS) {
  let fields = 0;
  let total = 0;
  let invented = 0;
  let schemaFailures = 0;
  let errors = 0;
  const latencies = [];
  let inTok = 0;
  let outTok = 0;

  for (const c of CASES) {
    for (let r = 0; r < REPEATS; r++) {
      // All three deployments sit at the same small capacity, so pace the run
      // to keep the comparison about the models rather than about throttling.
      await new Promise((res) => setTimeout(res, 1500));
      const out = await callParse(model, c.text);
      if (out.error) {
        errors++;
        if (r === 0) console.log(`  ! ${model.name} ${c.id}: ${out.error}`);
        continue;
      }
      latencies.push(out.ms);
      inTok += out.usage?.input_tokens ?? 0;
      outTok += out.usage?.output_tokens ?? 0;
      if (!out.valid?.valid) {
        schemaFailures++;
        if (r === 0) console.log(`    schema: ${(out.valid?.errors ?? []).slice(0, 3).join('; ')}`);
      }
      const s = scoreCase(out.parsed, c.expect);
      fields += s.fields;
      total += s.total;
      invented += s.invented;
      if (r === 0) {
        const misses = Object.entries(s.detail)
          .filter(([, v]) => !v.ok)
          .map(([k, v]) => (v.partial ? `${k}(${v.partial})` : k));
        console.log(
          `  ${model.name.padEnd(13)} ${c.id.padEnd(26)} ${s.fields}/${s.total}` +
            (misses.length ? `  miss: ${misses.join(', ')}` : ''),
        );
      }
    }
  }

  latencies.sort((a, b) => a - b);
  results.push({
    model: model.name,
    accuracy: total ? ((fields / total) * 100).toFixed(1) : 'n/a',
    invented,
    schemaFailures,
    errors,
    median: latencies[Math.floor(latencies.length / 2)] ?? 0,
    p95: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
    inTok: Math.round(inTok / (latencies.length || 1)),
    outTok: Math.round(outTok / (latencies.length || 1)),
  });
}

console.log(
  '\n| model | field accuracy | invented | schema fails | errors | median ms | p95 ms | in tok | out tok |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of results) {
  console.log(
    `| ${r.model} | ${r.accuracy}% | ${r.invented} | ${r.schemaFailures} | ${r.errors} | ${r.median} | ${r.p95} | ${r.inTok} | ${r.outTok} |`,
  );
}
