// LLM plan authoring: schema DDL + business case -> generation plan YAML.
// Providers: Anthropic (Claude) and OpenAI. Key via flag or env
// (ANTHROPIC_API_KEY / OPENAI_API_KEY). Uses global fetch (Node >= 18).

import YAML from 'yaml';

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
      <col>: {gen: fk, ref: products.prod_id}         # when the DDL declares NO FOREIGN KEY but the
                                                      # column logically references another table —
                                                      # ALWAYS give ref explicitly in that case
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
                                                        # cross-column rules like max >= min
      <col>: {gen: expr, code: "addDays(row.rental_date, 7)"}  # DATE ARITHMETIC: dates are strings —
                                                        # NEVER write row.date_col + n (concatenates!);
                                                        # use addDays / addHours / addMinutes
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
6. NOT NULL columns must never get null_prob.
7. Small tables: if the business case implies an empty table, write rows: 0; a single-row table
   (settings, config, singleton) is rows: 1. Never give a child table rows > 0 when its parent has
   rows: 0 unless the FK column is nullable. With a 1-row parent, UNIQUE columns or composite
   UNIQUE over the FK allow at most 1 child row — keep rows within the pool size.
8. If the business case is empty or vague, use about 100 rows per table and sensible defaults;
   still output a complete, valid plan for every table.`;

export const DEFAULT_BUSINESS_CASE = 'No business case was provided. Use sensible defaults: about 100 rows per table, '
  + 'realistic values, respect every constraint and foreign key.';

// Empty / whitespace-only business cases must not produce an empty prompt section.
export function normalizeBusinessCase(text) {
  const t = typeof text === 'string' ? text.replace(/^\uFEFF/, '').trim() : '';
  return t || DEFAULT_BUSINESS_CASE;
}

// ---- Output parsing -------------------------------------------------------
// LLMs do not always honour "no fences, valid YAML". Seen in the wild:
//   * ```yaml ... ``` fences (sometimes unclosed, sometimes with prose around them)
//   * trailing commas in flow collections: {gen: choice, values: [A, B,],}
//   * a bare "yaml" language tag on the first line
// parsePlanOutput() normalises all of these and returns { text, plan }.

const FENCE_RE = /```[ \t]*(?:yaml|yml|json)?[ \t]*\r?\n?([\s\S]*?)```/gi;

export function extractYaml(text) {
  if (typeof text !== 'string') return '';
  const src = text.replace(/\r\n?/g, '\n');
  const blocks = [...src.matchAll(FENCE_RE)].map(m => m[1]);
  let body;
  if (blocks.length) {
    // Prefer the block that looks like a plan; else the longest one.
    body = blocks.find(b => /^\s*(seed|tables)\s*:/m.test(b))
        ?? blocks.reduce((a, b) => (b.length > a.length ? b : a), '');
  } else {
    const open = src.match(/```[ \t]*(?:yaml|yml|json)?[ \t]*\r?\n?/i);
    body = open ? src.slice(open.index + open[0].length) : src;   // unclosed fence
    body = body.replace(/```[\s\S]*$/, '');                       // stray closing fence
  }
  body = body.replace(/^\s*(?:yaml|yml)\s*\n/i, '');              // bare language tag
  // Drop prose before the first top-level plan key, if any.
  const start = body.search(/^(seed|tables)\s*:/m);
  if (start > 0) body = body.slice(start);
  return body.trim();
}

// Remove trailing commas inside YAML flow collections ({...} / [...]) while
// leaving quoted strings and block-scalar text untouched.
export function stripTrailingCommas(text) {
  let out = '', depth = 0, quote = null, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && quote === '"') { out += text[i + 1] ?? ''; i += 2; continue; }
      if (ch === quote) quote = null;
      i++; continue;
    }
    if (ch === '#' && depth === 0 && (i === 0 || /\s/.test(text[i - 1]))) {
      const nl = text.indexOf('\n', i); const end = nl === -1 ? text.length : nl;
      out += text.slice(i, end); i = end; continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; i++; continue; }
    if (ch === '{' || ch === '[') { depth++; out += ch; i++; continue; }
    if (ch === '}' || ch === ']') { depth = Math.max(0, depth - 1); out += ch; i++; continue; }
    if (ch === ',' && depth > 0) {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') { i++; continue; }   // trailing comma: drop
      let k = j;                                                   // ",," -> ","
      if (text[k] === ',') { i++; continue; }
    }
    out += ch; i++;
  }
  return out;
}

export function parsePlanOutput(text) {
  const cleaned = stripTrailingCommas(extractYaml(text));
  let plan;
  try { plan = YAML.parse(cleaned); }
  catch (e) { throw new Error(`LLM returned invalid YAML: ${e.message}\n--- output ---\n${cleaned.slice(0, 2000)}`); }
  if (!plan || typeof plan !== 'object' || !plan.tables || typeof plan.tables !== 'object')
    throw new Error("LLM output is not a plan: missing top-level 'tables' mapping");
  return { text: cleaned, plan };
}

export async function authorPlan({ ddl, businessCase, provider, apiKey, model }) {
  const userMsg = `SQL DDL:\n\n${ddl}\n\nBUSINESS CASE:\n\n${normalizeBusinessCase(businessCase)}\n\nWrite the generation plan YAML.`;
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
    return parsePlanOutput(j.content.map(b => b.text || '').join('')).text;
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
    return parsePlanOutput(j.choices[0].message.content).text;
  }
  if (provider === 'gemini') {
    const m = model || 'gemini-2.0-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      }),
    });
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
    const j = await res.json();
    const out = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    return parsePlanOutput(out).text;
  }
  throw new Error(`Unknown provider '${provider}' (use anthropic, openai or gemini)`);
}

export function detectProvider(flags) {
  if (flags.provider) return flags.provider;
  if (flags.key?.startsWith('sk-ant-')) return 'anthropic';
  if (flags.key?.startsWith('AIza')) return 'gemini';
  if (flags.key?.startsWith('sk-')) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return 'gemini';
  return null;
}

export function resolveKey(provider, flags) {
  return flags.key
    || (provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY
      : provider === 'gemini' ? (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
      : process.env.OPENAI_API_KEY);
}
