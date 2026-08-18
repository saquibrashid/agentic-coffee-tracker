// Throwaway probe: does each candidate accept the exact call shape the BFF
// already sends? Run before any accuracy work, because these are the checks
// that disqualified the last round of candidates.
const ep = process.env.EVAL_EP.replace(/\/$/, '');
const key = process.env.EVAL_KEY;

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'roaster'],
  properties: { name: { type: ['string', 'null'] }, roaster: { type: ['string', 'null'] } },
};

async function probe(model, body) {
  const started = Date.now();
  const res = await fetch(`${ep}/openai/v1/responses`, {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, ms: Date.now() - started, text };
}

const base = (model) => ({
  model,
  input: [
    { role: 'system', content: 'Extract coffee fields.' },
    { role: 'user', content: 'ONYX COFFEE LAB — Geometry. Blend.' },
  ],
  store: false,
});

for (const model of ['gpt-4o', 'eval-gpt54mini', 'eval-gpt56luna']) {
  const withTemp = await probe(model, { ...base(model), temperature: 0 });
  const withSchema = await probe(model, {
    ...base(model),
    temperature: 0,
    text: { format: { type: 'json_schema', name: 'bean', strict: true, schema } },
  });
  const noTemp = await probe(model, {
    ...base(model),
    text: { format: { type: 'json_schema', name: 'bean', strict: true, schema } },
  });
  console.log(`\n=== ${model}`);
  console.log(
    `temperature:0      -> ${withTemp.status} ${withTemp.ok ? 'OK' : withTemp.text.slice(0, 220)}`,
  );
  console.log(
    `temperature+strict -> ${withSchema.status} ${withSchema.ok ? 'OK' : withSchema.text.slice(0, 220)}`,
  );
  console.log(
    `strict only        -> ${noTemp.status} ${noTemp.ok ? 'OK' : noTemp.text.slice(0, 220)}`,
  );
}
