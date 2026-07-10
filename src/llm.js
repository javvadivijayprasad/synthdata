// LLM plan authoring: schema DDL + business case -> generation plan YAML.
// Providers: Anthropic (Claude) and OpenAI. Key via flag or env
// (ANTHROPIC_API_KEY / OPENAI_API_KEY). Uses global fetch (Node >= 18).

export const SYSTEM_PROMPT = `You are a test-data architect. Given SQL DDL and a business case,
you write a generation plan in YAML for the testforge engine. Output ONLY valid YAML, no prose,
no markdown fences.

Plan format:
seed: 42
tables:
  <table_name>:            # every table from the DDL, in FK dependency order (parents first)
    rows: <int>            # scale from the business case
    columns:
      <col>: {gen: sequence}                          # primary keys
      <col>: {gen: fk}                                # foreign keys (picks real parent keys)
      <col>: {gen: fk, distribution: zipf}            # skewed parent pick (heavy users)
      <col>: {gen: choice, values: [A, B], weights: [70, 30]}
      <col>: {gen: int, min: 1, max: 10}
      <col>: {gen: float, min: 0, max: 100, round: 2}
      <col>: {gen: lognormal, mu: 6.5, sigma: 1.0, round: 2, min: 49, max: 99999}
      <col>: {gen: date, start: 2025-01-01, end: 2026-07-01}
      <col>: {gen: datetime, start: 2025-01-01 00:00, end: 2026-07-01 23:59}
      <col>: {gen: template, format: "SKU-{seq:06d}"}  # seq = row number
      <col>: {gen: const, value: X}
      <col>: {gen: faker, method: name}   # methods: name, first_name, last_name, email,
                                          # phone_number, city, state, street_address, postcode,
                                          # company, catch_phrase, word, sentence, user_name, uuid
      <col>: {gen: expr, code: "row.min_salary * 1.5"}  # JS expression over same row; use for
                                                        # cross-column rules like max >= min or
                                                        # end_date after start_date
Any column may add null_prob: 0.1 (fraction of NULLs) and unique: true.

Rules you must follow:
1. Respect every CHECK constraint: enumerations via choice with values copied exactly;
   numeric BETWEEN via min/max; cross-column CHECKs via expr.
2. UNIQUE columns: use template with {seq} or add unique: true; for composite UNIQUE
   over an FK + category, keep rows well below the combination pool size.
3. Distributions and weights must reflect the business case percentages.
4. Date columns representing workflow order (shipped after ordered): use expr or
   non-overlapping date windows so the ordering holds.
5. rows counts must respect ratios stated in the business case.
6. NOT NULL columns must never get null_prob.`;

function extractYaml(text) {
  const fence = text.match(/```(?:yaml)?\s*([\s\S]*?)```/);
  return (fence ? fence[1] : text).trim();
}

export async function authorPlan({ ddl, businessCase, provider, apiKey, model }) {
  const userMsg = `SQL DDL:\n\n${ddl}\n\nBUSINESS CASE:\n\n${businessCase}\n\nWrite the generation plan YAML.`;
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey,
                 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: model || 'claude-sonnet-5',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return extractYaml(j.content.map(b => b.text || '').join(''));
  }
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'system', content: SYSTEM_PROMPT },
                   { role: 'user', content: userMsg }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return extractYaml(j.choices[0].message.content);
  }
  throw new Error(`Unknown provider '${provider}' (use anthropic or openai)`);
}

export function detectProvider(flags) {
  if (flags.provider) return flags.provider;
  if (flags.key?.startsWith('sk-ant-')) return 'anthropic';
  if (flags.key?.startsWith('sk-')) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export function resolveKey(provider, flags) {
  return flags.key
    || (provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
}
