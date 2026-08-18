/**
 * Every distinct call shape the BFF makes, run against each candidate.
 *
 * Parse accuracy alone is not enough to justify a swap: `/api/search` uses the
 * hosted `web_search` tool with `tool_choice: 'required'`, `/api/recommend`
 * sends a non-zero temperature, and the domain lookup uses plain
 * `json_object`. A model that nails parsing and cannot run the search tool
 * would break enrichment, which is the feature that calls the AI most.
 */
const ep = process.env.EVAL_EP.replace(/\/$/, '');
const key = process.env.EVAL_KEY;

const MODELS = [
  { name: 'gpt-4o', deployment: 'gpt-4o', sendTemp: true },
  { name: 'gpt-5.4-mini', deployment: 'eval-gpt54mini', sendTemp: true },
  { name: 'gpt-5.6-luna', deployment: 'eval-gpt56luna', sendTemp: false },
];

async function post(model, extra, temp, system) {
  const res = await fetch(`${ep}/openai/v1/responses`, {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model.deployment,
      input: [
        { role: 'system', content: system ?? 'You help with coffee data.' },
        { role: 'user', content: 'Roaster: Onyx Coffee Lab\nCoffee: Geometry' },
      ],
      ...(model.sendTemp && temp !== undefined ? { temperature: temp } : {}),
      ...extra,
      store: false,
    }),
  });
  if (!res.ok) return `${res.status} ${(await res.text()).replace(/\s+/g, ' ').slice(0, 150)}`;
  const data = await res.json();
  const used = (data.output ?? []).some((o) => String(o.type).includes('search'));
  return `OK${extra.tools ? (used ? ' (tool ran)' : ' (TOOL NOT RUN)') : ''}`;
}

const SHAPES = [
  {
    label: 'recommend: strict schema + temperature 0.4',
    temp: 0.4,
    extra: {
      text: {
        format: {
          type: 'json_schema',
          name: 'r',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['items'],
            properties: { items: { type: 'array', items: { type: 'string' } } },
          },
        },
      },
    },
  },
  {
    label: 'search domains: json_object + temperature 0',
    temp: 0,
    // The real DOMAIN_SYSTEM_PROMPT says "reply with JSON"; `json_object`
    // format is rejected unless the word appears, so mirror that here rather
    // than reporting a compatibility failure the app would never hit.
    system: 'You identify roaster store domains. Reply with JSON: {"domains":["example.com"]}.',
    extra: { text: { format: { type: 'json_object' } } },
  },
  {
    label: 'web search: hosted tool, tool_choice required',
    temp: 0,
    extra: {
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
      tool_choice: 'required',
    },
  },
];

for (const model of MODELS) {
  console.log(`\n=== ${model.name}`);
  for (const s of SHAPES) {
    await new Promise((r) => setTimeout(r, 1200));
    console.log(`  ${s.label.padEnd(46)} -> ${await post(model, s.extra, s.temp, s.system)}`);
  }
}
