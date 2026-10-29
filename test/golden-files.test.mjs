// W7 — golden-file (snapshot) tests for the real-world domain schemas.
//
// Each fixture schema under test/fixtures/schemas/ is generated once with a
// fixed seed via `auto`-style generation (uniform rows/table, no plan) and
// the output is committed as test/fixtures/golden/<name>.json. These tests
// re-generate the same schema+seed and diff against that snapshot: any
// unintended change to generation output (new/removed columns, a changed
// RNG draw order, a formatting change) fails loudly here, in addition to
// the existing behavioural regression tests.
//
// Regenerate deliberately (e.g. after an intentional output-format change)
// by running: node -e "..." — see CONTRIBUTING.md. Never hand-edit the
// golden files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDDL } from '../src/schema.js';
import { Engine } from '../src/engine.js';
import { assertReferentialIntegrity } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(HERE, 'fixtures', 'schemas');
const GOLDEN_DIR = path.join(HERE, 'fixtures', 'golden');
const ROWS = 25;
const SEED = 42;

// Domain schemas exercised: ecommerce, banking, healthcare, hr_payroll — the
// four real-world schemas shipped in this project's test corpus. (The
// roadmap's original 5th domain, logistics, has no fixture schema yet; add
// one here and a matching golden file when it does.)
const DOMAINS = ['ecommerce', 'banking', 'healthcare', 'hr_payroll'];

function loadSchema(name) {
  const ddl = fs.readFileSync(path.join(SCHEMA_DIR, `schema_${name}.sql`), 'utf-8');
  return parseDDL(ddl);
}

function autoPlan(tables, rows = ROWS) {
  return { tables: Object.fromEntries(Object.keys(tables).map(t => [t, { rows }])) };
}

function golden(name) {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, `${name}.json`), 'utf-8'));
}

for (const name of DOMAINS) {
  test(`golden: ${name} schema parses to 10 tables`, () => {
    const tables = loadSchema(name);
    assert.equal(Object.keys(tables).length, 10, `${name}: expected 10 tables`);
  });

  test(`golden: ${name} auto-generated output matches committed snapshot (seed=${SEED}, rows=${ROWS})`, () => {
    const tables = loadSchema(name);
    const data = new Engine(tables, autoPlan(tables), SEED).run();
    assert.deepEqual(data, golden(name),
      `${name}: generated output no longer matches test/fixtures/golden/${name}.json — ` +
      `if this change is intentional, regenerate the golden file (see CONTRIBUTING.md)`);
  });

  test(`golden: ${name} generation is reproducible for the same seed`, () => {
    const tables = loadSchema(name);
    const plan = autoPlan(tables);
    const a = new Engine(tables, plan, SEED).run();
    const b = new Engine(tables, plan, SEED).run();
    assert.deepEqual(a, b);
  });

  test(`golden: ${name} referential integrity holds`, () => {
    const tables = loadSchema(name);
    const data = new Engine(tables, autoPlan(tables), SEED).run();
    const checked = assertReferentialIntegrity(tables, data);
    assert.ok(checked > 0, `${name}: expected at least one FK value to be checked`);
  });
}
