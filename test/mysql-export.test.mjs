// W9 — MySQL/MariaDB export target (--mysql). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDDL } from '../src/schema.js';
import { ddlToMysql, toMysqlSql } from '../src/export.js';
import { generate, fixture } from './helpers.js';

const DDL = `
CREATE TABLE customers (
  customer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE orders (
  order_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(customer_id),
  parent_id INT REFERENCES orders(order_id) ON DELETE CASCADE,
  total NUMERIC(10,2) CHECK (total >= 0)
);`;

const tmp = (n) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'synth-my-')), n);

test('ddlToMysql: identity -> AUTO_INCREMENT, TIMESTAMP -> DATETIME', () => {
  const out = ddlToMysql(DDL);
  assert.match(out, /customer_id BIGINT AUTO_INCREMENT PRIMARY KEY/);
  assert.match(out, /order_id INT AUTO_INCREMENT PRIMARY KEY/);
  assert.match(out, /created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  assert.doesNotMatch(out, /GENERATED|TIMESTAMP NOT NULL/);
});

test('ddlToMysql: inline REFERENCES hoisted to table-level FOREIGN KEY (MySQL ignores inline)', () => {
  const out = ddlToMysql(DDL);
  assert.match(out, /FOREIGN KEY \(customer_id\) REFERENCES customers\(customer_id\)/);
  assert.match(out, /FOREIGN KEY \(parent_id\) REFERENCES orders\(order_id\) ON DELETE CASCADE/);
  // no column definition still carries an inline REFERENCES
  for (const line of out.split('\n'))
    if (/REFERENCES/.test(line)) assert.match(line.trim(), /^FOREIGN KEY/);
  // the transpiled DDL still parses to the same FK graph
  const t = parseDDL(out);
  assert.equal(t.orders.columns.find(c => c.name === 'customer_id').fkTable, 'customers');
});

test('toMysqlSql: escaping, booleans, NULLs, meta columns, FK order, header', () => {
  const tables = parseDDL(DDL);
  const data = {
    orders: [{ order_id: 1, customer_id: 1, parent_id: null, total: 5.5, _violation: 'x' }],
    customers: [{ customer_id: 1, email: "o'brien\\x@e.com", note: 'line1\nline2 ünï', is_active: 1,
                  created_at: '2026-01-01 00:00:00' }],
  };
  const f = tmp('o.sql');
  toMysqlSql(DDL, tables, data, f, 42);
  const sql = fs.readFileSync(f, 'utf-8');
  assert.match(sql, /seed=42/);
  assert.match(sql, /SET FOREIGN_KEY_CHECKS = 0;/);
  assert.match(sql, /'o''brien\\\\x@e\.com'/);          // quote doubled, backslash escaped
  assert.match(sql, /ünï/);
  assert.match(sql, /\bTRUE\b.*'2026-01-01 00:00:00'/s);
  assert.doesNotMatch(sql, /_violation/);               // meta column dropped
  assert.ok(sql.indexOf('INSERT INTO `customers`') < sql.indexOf('INSERT INTO `orders`'), 'parents first');
  assert.match(sql, /\(1, 1, NULL, 5\.5\)/);
});

test('toMysqlSql: batches large tables and is byte-reproducible for the same seed', () => {
  const ddl = fixture('schemas/schema_ecommerce.sql');
  const plan = (n) => ({ tables: Object.fromEntries(Object.keys(parseDDL(ddl)).map(t => [t, { rows: n }])) });
  const a = tmp('a.sql'), b = tmp('b.sql');
  let g = generate(ddl, plan(1200), 7);
  toMysqlSql(ddl, g.tables, g.data, a, 7);
  g = generate(ddl, plan(1200), 7);
  toMysqlSql(ddl, g.tables, g.data, b, 7);
  const sa = fs.readFileSync(a, 'utf-8');
  assert.equal(sa, fs.readFileSync(b, 'utf-8'));
  assert.equal((sa.match(/INSERT INTO `customers`/g) || []).length, 3);   // 1200 rows / 500 per batch
});
