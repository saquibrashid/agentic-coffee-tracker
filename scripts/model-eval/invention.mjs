/**
 * Drills into the one metric that separated the candidates: invented fields.
 *
 * A field the text does not support, filled in anyway, is worse than a blank —
 * it lands in the user's library looking like fact and there is nothing on
 * screen to mark it as a guess. Accuracy percentages hide this, so print the
 * actual values.
 */
import { PARSE_SYSTEM_PROMPT } from '../../api/dist/src/lib/parsePrompt.js';
import { PARSED_BEAN_SCHEMA } from '../../api/dist/src/lib/beanSchema.js';
import { CASES } from './cases.mjs';

const ep = process.env.EVAL_EP.replace(/\/$/, '');
const key = process.env.EVAL_KEY;

const MODELS = [
  { name: 'gpt-4o', deployment: 'gpt-4o', sendTemp: true },
  { name: 'gpt-5.4-mini', deployment: 'eval-gpt54mini', sendTemp: true },
  { name: 'gpt-5.6-luna', deployment: 'eval-gpt56luna', sendTemp: false },
];

async function call(model, ocrText, attempt = 0) {
  const res = await fetch(`${ep}/openai/v1/responses`, {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
  });
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    return call(model, ocrText, attempt + 1);
  }
  const data = await res.json();
  const text = (data.output ?? [])
    .filter((i) => i.type === 'message')
    .flatMap((i) => i.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('');
  return JSON.parse(text || '{}');
}

// Only the cases where a field is genuinely absent can trap invention.
const TRAPS = [
  ['label-onyx-geometry', 'country', (p) => (p.origins ?? [])[0]?.country],
  ['label-onyx-geometry', 'process', (p) => p.process],
  ['sparse-label', 'name', (p) => p.name],
  ['sparse-label', 'country', (p) => (p.origins ?? [])[0]?.country],
  ['sparse-label', 'roastLevel', (p) => p.roastLevel],
  ['sparse-label', 'notes', (p) => (p.tastingNotes ?? []).join('/') || null],
  ['datasheet-anaerobic', 'roaster', (p) => p.roaster],
  ['ocr-noisy', 'process', (p) => p.process],
  ['ocr-noisy', 'roastLevel', (p) => p.roastLevel],
  ['prose-about-paragraph', 'roaster', (p) => p.roaster],
];

for (const model of MODELS) {
  console.log(`\n=== ${model.name}`);
  const byCase = new Map();
  for (const [caseId] of TRAPS) {
    if (byCase.has(caseId)) continue;
    const c = CASES.find((x) => x.id === caseId);
    await new Promise((r) => setTimeout(r, 1500));
    byCase.set(caseId, await call(model, c.text));
  }
  for (const [caseId, field, get] of TRAPS) {
    const v = get(byCase.get(caseId));
    if (v !== null && v !== undefined) {
      console.log(`  INVENTED  ${caseId} -> ${field} = ${JSON.stringify(v)}`);
    }
  }
}
