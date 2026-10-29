// W12 — contract tests for LLM output-shape stability across providers.
//
// Offline (always run): global fetch is stubbed with each provider's real
// response envelope (Anthropic Messages, OpenAI Chat Completions, Gemini
// generateContent). We assert (1) the REQUEST we send keeps the shape each
// API requires and (2) every plausible way a model wraps the same plan
// (bare, fenced, prose-wrapped, trailing commas) normalises to a plan that
// the engine turns into referentially-intact data for all domain schemas.
//
// Live (opt-in): set SYNTHDATA_LIVE_CONTRACT=1 plus ANTHROPIC_API_KEY /
// OPENAI_API_KEY / GEMINI_API_KEY to also hit the real APIs; each provider is
// skipped when its key is absent. Never runs in CI by default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { authorPlan, detectProvider, resolveKey, parsePlanOutput } from '../src/llm.js';
import { parseDDL } from '../src/schema.js';
import { Engine } from '../src/engine.js';
import { assertReferentialIntegrity } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS = path.join(HERE, 'fixtures', 'schemas');
const DOMAINS = ['ecommerce', 'banking', 'healthcare', 'hr_payroll'];
const ddlOf = d => fs.readFileSync(path.join(SCHEMAS, `schema_${d}.sql`), 'utf-8');

function planFor(domain) {
  const t = parseDDL(ddlOf(domain));
  return YAML.stringify({ seed: 7, tables: Object.fromEntries(Object.keys(t).map(n => [n, { rows: 8 }])) });
}

// Ways real models wrap the same payload.
const WRAPPERS = {
  bare: y => y,
  fenced: y => '```yaml\n' + y + '```',
  prose: y => 'Here is the plan:\n\n```yaml\n' + y + '```\n\nLet me know if you want changes.',
  crlf: y => y.replace(/\n/g, '\r\n'),
};

const ENVELOPES = {
  anthropic: text => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
  openai: text => ({ choices: [{ index: 0, message: { role: 'assistant', content: text } }] }),
  gemini: text => ({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] }),
};

async function withFetch(envelope, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => envelope, text: async () => JSON.stringify(envelope) };
  };
  try { return { result: await fn(), calls }; } finally { globalThis.fetch = real; }
}

const REQ = { ddl: ddlOf('ecommerce'), businessCase: 'Small online shop', apiKey: 'k' };

// ---- request-shape contracts -------------------------------------------------
test('contract: anthropic request shape', async () => {
  const { calls } = await withFetch(ENVELOPES.anthropic(planFor('ecommerce')),
    () => authorPlan({ ...REQ, provider: 'anthropic' }));
  const [c] = calls;
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.init.headers['x-api-key'], 'k');
  assert.ok(c.init.headers['anthropic-version']);
  assert.ok(c.body.model && c.body.max_tokens > 0);
  assert.equal(typeof c.body.system, 'string');
  assert.equal(c.body.messages[0].role, 'user');
  assert.match(c.body.messages[0].content, /BUSINESS CASE/);
});

test('contract: openai request shape', async () => {
  const { calls } = await withFetch(ENVELOPES.openai(planFor('ecommerce')),
    () => authorPlan({ ...REQ, provider: 'openai' }));
  const [c] = calls;
  assert.equal(c.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(c.init.headers.authorization, 'Bearer k');
  assert.deepEqual(c.body.messages.map(m => m.role), ['system', 'user']);
  assert.ok(c.body.model);
});

test('contract: gemini request shape', async () => {
  const { calls } = await withFetch(ENVELOPES.gemini(planFor('ecommerce')),
    () => authorPlan({ ...REQ, provider: 'gemini', model: 'gemini-2.0-flash' }));
  const [c] = calls;
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
  assert.equal(c.init.headers['x-goog-api-key'], 'k');
  assert.ok(!c.url.includes('key='), 'API key must not leak into the URL');
  assert.equal(c.body.contents[0].role, 'user');
  assert.ok(c.body.systemInstruction.parts[0].text.length > 100);
});

test('contract: request carries DDL and business case verbatim for every provider', async () => {
  for (const provider of Object.keys(ENVELOPES)) {
    const { calls } = await withFetch(ENVELOPES[provider](planFor('ecommerce')),
      () => authorPlan({ ...REQ, provider }));
    assert.ok(calls[0].init.body.includes('Small online shop'), provider);
    assert.ok(calls[0].init.body.includes('CREATE TABLE'), provider);
  }
});

// ---- response-shape contracts: provider x wrapper x domain --------------------
for (const provider of Object.keys(ENVELOPES)) {
  for (const [wname, wrap] of Object.entries(WRAPPERS)) {
    test(`contract: ${provider} / ${wname} output -> valid plan -> RI-intact data (all domains)`, async () => {
      for (const d of DOMAINS) {
        const y = planFor(d);
        const { result } = await withFetch(ENVELOPES[provider](wrap(y)),
          () => authorPlan({ ...REQ, ddl: ddlOf(d), provider }));
        assert.deepEqual(YAML.parse(result), YAML.parse(y), `${provider}/${wname}/${d}: plan changed in transit`);
        const tables = parseDDL(ddlOf(d));
        const data = new Engine(tables, YAML.parse(result), 7).run();
        assert.ok(assertReferentialIntegrity(tables, data) > 0, `${d}: no FK checked`);
      }
    });
  }
}

test('contract: trailing commas in a flow mapping are repaired for every provider', async () => {
  const raw = 'tables:\n  users:\n    rows: 3\n    columns:\n      role: {gen: choice, values: [a, b,], weights: [1, 2,],}\n';
  for (const provider of Object.keys(ENVELOPES)) {
    const { result } = await withFetch(ENVELOPES[provider]('```yaml\n' + raw + '```'),
      () => authorPlan({ ...REQ, provider }));
    assert.deepEqual(YAML.parse(result).tables.users.columns.role.values, ['a', 'b']);
  }
});

// ---- failure contracts ---------------------------------------------------------
test('contract: non-plan / empty / malformed responses fail loudly, not silently', async () => {
  for (const provider of Object.keys(ENVELOPES)) {
    for (const bad of ['', 'I cannot help with that.', 'tables: [1, 2', 'foo: bar']) {
      await assert.rejects(
        withFetch(ENVELOPES[provider](bad), () => authorPlan({ ...REQ, provider })),
        /LLM|plan|YAML/i, `${provider}: ${JSON.stringify(bad)}`);
    }
  }
});

test('contract: HTTP errors surface provider name and status', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  try {
    for (const [provider, name] of [['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['gemini', 'Gemini']])
      await assert.rejects(authorPlan({ ...REQ, provider }), new RegExp(`${name} API 429`));
  } finally { globalThis.fetch = real; }
});

test('contract: unknown provider is rejected', async () => {
  await assert.rejects(authorPlan({ ...REQ, provider: 'nope' }), /Unknown provider/);
});

test('contract: detectProvider / resolveKey cover all three providers', () => {
  const saved = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete process.env[k];
  try {
    assert.equal(detectProvider({ key: 'sk-ant-x' }), 'anthropic');
    assert.equal(detectProvider({ key: 'sk-x' }), 'openai');
    assert.equal(detectProvider({ key: 'AIzaX' }), 'gemini');
    assert.equal(detectProvider({}), null);
    process.env.GEMINI_API_KEY = 'g';
    assert.equal(detectProvider({}), 'gemini');
    assert.equal(resolveKey('gemini', {}), 'g');
    assert.equal(resolveKey('gemini', { key: 'AIzaY' }), 'AIzaY');
  } finally { process.env = saved; }
});

// ---- opt-in live contract ------------------------------------------------------
const LIVE = process.env.SYNTHDATA_LIVE_CONTRACT === '1';
for (const [provider, envKey] of [['anthropic', 'ANTHROPIC_API_KEY'], ['openai', 'OPENAI_API_KEY'], ['gemini', 'GEMINI_API_KEY']]) {
  test(`live contract: ${provider} returns a parseable, RI-intact plan`,
    { skip: !(LIVE && process.env[envKey]) && `set SYNTHDATA_LIVE_CONTRACT=1 and ${envKey}`, timeout: 120000 },
    async () => {
      const ddl = ddlOf('ecommerce');
      const yamlText = await authorPlan({ ddl, businessCase: 'Small shop, ~20 rows per table.', provider, apiKey: process.env[envKey] });
      const plan = parsePlanOutput(yamlText).plan;
      const tables = parseDDL(ddl);
      assert.ok(assertReferentialIntegrity(tables, new Engine(tables, plan, 1).run()) > 0);
    });
}
