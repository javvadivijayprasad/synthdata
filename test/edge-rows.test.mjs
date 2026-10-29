// W10 — empty / single-row tables and empty business cases are handled gracefully.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, assertReferentialIntegrity } from './helpers.js';
import { SYSTEM_PROMPT, normalizeBusinessCase, DEFAULT_BUSINESS_CASE } from '../src/llm.js';

const DDL = `
CREATE TABLE settings (id INT PRIMARY KEY, name VARCHAR(40) NOT NULL);
CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(80) NOT NULL UNIQUE);
CREATE TABLE posts (id INT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id), title VARCHAR(60));
CREATE TABLE notes (id INT PRIMARY KEY, user_id INT REFERENCES users(id), body VARCHAR(60));`;

test('rows: 0 yields an empty table and does not crash', () => {
  const { data } = generate(DDL, { tables: { settings: { rows: 0 }, users: { rows: 0 }, posts: { rows: 0 }, notes: { rows: 0 } } });
  for (const t of Object.keys(data)) assert.equal(data[t].length, 0);
});

test('single-row table generates exactly one valid row', () => {
  const { data } = generate(DDL, { tables: { settings: { rows: 1 }, users: { rows: 1 }, posts: { rows: 5 }, notes: { rows: 3 } } });
  assert.equal(data.settings.length, 1);
  assert.equal(data.users.length, 1);
  assert.ok(data.posts.every(r => r.user_id === data.users[0].id));
});

test('NOT NULL FK to an empty parent warns and never aborts (v1.2.2 contract)', () => {
  const msgs = []; const orig = console.error; console.error = (m) => msgs.push(String(m));
  let data;
  try { ({ data } = generate(DDL, { tables: { users: { rows: 0 }, posts: { rows: 3 } } })); }
  finally { console.error = orig; }
  assert.equal(data.posts.length, 3);
  assert.ok(msgs.some(m => /NOT NULL foreign key but parent table 'users' has 0 rows/.test(m)), 'expected pointed warning, got: ' + msgs.join('|'));
});

test('nullable FK to an empty parent becomes NULL (no dangling keys)', () => {
  const { tables, data } = generate(DDL, { tables: { users: { rows: 0 }, posts: { rows: 0 }, notes: { rows: 4 } } });
  assert.equal(data.notes.length, 4);
  assert.ok(data.notes.every(r => r.user_id === null));
  assertReferentialIntegrity(tables, data);
});

test('same seed is reproducible with tiny tables', () => {
  const p = { tables: { users: { rows: 1 }, posts: { rows: 2 } } };
  assert.deepEqual(generate(DDL, p, 7).data, generate(DDL, p, 7).data);
});

test('empty / whitespace business case falls back to a default, real text is untouched', () => {
  for (const v of ['', '   \n\t', undefined, null]) assert.equal(normalizeBusinessCase(v), DEFAULT_BUSINESS_CASE);
  assert.equal(normalizeBusinessCase('  100 users  '), '100 users');
});

test('system prompt documents empty and single-row table rules', () => {
  assert.match(SYSTEM_PROMPT, /rows: 0/);
  assert.match(SYSTEM_PROMPT, /rows: 1/);
});
