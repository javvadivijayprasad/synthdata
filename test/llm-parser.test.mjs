// W5: the LLM output parser must survive code fences, trailing commas, and prose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractYaml, stripTrailingCommas, parsePlanOutput } from '../src/llm.js';

const PLAN = `seed: 42
tables:
  users:
    rows: 10
    columns:
      id: {gen: sequence}
      role: {gen: choice, values: [admin, user], weights: [10, 90]}`;

test('plain YAML passes through unchanged', () => {
  const { text, plan } = parsePlanOutput(PLAN);
  assert.equal(text, PLAN);
  assert.equal(plan.tables.users.rows, 10);
});

test('strips ```yaml fences', () => {
  const { plan } = parsePlanOutput('```yaml\n' + PLAN + '\n```');
  assert.deepEqual(plan.tables.users.columns.role.values, ['admin', 'user']);
});

test('strips bare ``` fences and CRLF', () => {
  const { plan } = parsePlanOutput('```\r\n' + PLAN.replace(/\n/g, '\r\n') + '\r\n```\r\n');
  assert.equal(plan.seed, 42);
});

test('handles prose before and after the fence', () => {
  const src = 'Here is your plan:\n\n```yaml\n' + PLAN + '\n```\n\nLet me know if you need changes.';
  const { text, plan } = parsePlanOutput(src);
  assert.equal(text, PLAN);
  assert.equal(plan.tables.users.rows, 10);
});

test('handles unclosed fence', () => {
  const { plan } = parsePlanOutput('```yaml\n' + PLAN);
  assert.equal(plan.tables.users.rows, 10);
});

test('picks the plan block when several fences exist', () => {
  const src = '```sql\nCREATE TABLE x(id INT);\n```\n```yaml\n' + PLAN + '\n```';
  assert.equal(extractYaml(src), PLAN);
});

test('bare "yaml" language tag on first line is dropped', () => {
  const { plan } = parsePlanOutput('yaml\n' + PLAN);
  assert.equal(plan.seed, 42);
});

test('trailing commas in flow maps and sequences are removed', () => {
  const src = PLAN.replace('values: [admin, user], weights: [10, 90]}', 'values: [admin, user,], weights: [10, 90,],}');
  assert.throws(() => JSON.parse('{"a":[1,],}'));       // sanity: the yaml lib also rejects these
  const { plan } = parsePlanOutput(src);
  assert.deepEqual(plan.tables.users.columns.role.values, ['admin', 'user']);
  assert.deepEqual(plan.tables.users.columns.role.weights, [10, 90]);
});

test('trailing comma before newline-then-bracket', () => {
  const src = 'tables:\n  t:\n    rows: 1\n    columns:\n      c: {gen: choice, values: [\n        A,\n        B,\n        ],\n        }';
  const { plan } = parsePlanOutput(src);
  assert.deepEqual(plan.tables.t.columns.c.values, ['A', 'B']);
});

test('commas inside quoted strings are preserved', () => {
  const src = 'tables:\n  t:\n    rows: 1\n    columns:\n      c: {gen: const, value: "a, b,"}\n      d: {gen: template, format: \'x,{seq},\',}';
  const { plan } = parsePlanOutput(src);
  assert.equal(plan.tables.t.columns.c.value, 'a, b,');
  assert.equal(plan.tables.t.columns.d.format, 'x,{seq},');
});

test('stripTrailingCommas leaves block YAML and comments alone', () => {
  const src = 'a: 1 # note, with, commas,\nb:\n  - x\n  - y\n';
  assert.equal(stripTrailingCommas(src), src);
});

test('JSON output with trailing commas is accepted (JSON is YAML)', () => {
  const src = '```json\n{"seed": 1, "tables": {"t": {"rows": 2, "columns": {"id": {"gen": "sequence",},},},},}\n```';
  const { plan } = parsePlanOutput(src);
  assert.equal(plan.tables.t.columns.id.gen, 'sequence');
});

test('invalid YAML raises a descriptive error', () => {
  assert.throws(() => parsePlanOutput('tables: {unclosed: [1, 2'), /invalid YAML/);
});

test('output without a tables mapping is rejected', () => {
  assert.throws(() => parsePlanOutput('Sorry, I cannot help with that.'), /not a plan/);
});
