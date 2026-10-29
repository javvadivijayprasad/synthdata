// W6 — per-table seed overrides (plan `tables.<t>.seed` / CLI --table-seed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDDL } from '../src/schema.js';
import { Engine } from '../src/engine.js';

const DDL = `
CREATE TABLE customers (
  customer_id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  tier VARCHAR(10) NOT NULL CHECK (tier IN ('STD','GOLD','VIP'))
);
CREATE TABLE products (
  product_id BIGINT PRIMARY KEY,
  sku VARCHAR(20) NOT NULL UNIQUE,
  price NUMERIC(8,2) CHECK (price BETWEEN 1 AND 500)
);
CREATE TABLE orders (
  order_id BIGINT PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(customer_id),
  product_id BIGINT NOT NULL REFERENCES products(product_id),
  total NUMERIC(10,2) CHECK (total >= 0)
);`;
const tables = parseDDL(DDL);
const plan = (extra = {}) => ({ tables: {
  customers: { rows: 50, ...(extra.customers || {}) },
  products:  { rows: 50, ...(extra.products  || {}) },
  orders:    { rows: 80, ...(extra.orders    || {}) },
} });
const gen = (p, seed = 42, ts) => new Engine(tables, p, seed, 'functional', ts).run();
const J = JSON.stringify;

test('no overrides: same seed is reproducible, different seed differs', () => {
  assert.equal(J(gen(plan())), J(gen(plan())));
  assert.notEqual(J(gen(plan(), 42)), J(gen(plan(), 43)));
});

test('--table-seed re-rolls ONLY that table; every other table is byte-identical', () => {
  const base = gen(plan());
  const ovr = gen(plan(), 42, { products: 7 });
  assert.notEqual(J(base.products), J(ovr.products));
  assert.equal(J(base.customers), J(ovr.customers));
  assert.equal(J(base.orders), J(ovr.orders));   // FK pool (sequence PKs) unchanged
});

test('plan tables.<t>.seed is equivalent to the CLI override', () => {
  const viaCli = gen(plan(), 42, { products: 7 });
  const viaPlan = gen(plan({ products: { seed: 7 } }));
  assert.equal(J(viaCli), J(viaPlan));
});

test('CLI override beats plan seed; overrides are reproducible', () => {
  const a = gen(plan({ products: { seed: 7 } }), 42, { products: 9 });
  const b = gen(plan(), 42, { products: 9 });
  assert.equal(J(a), J(b));
  assert.equal(J(gen(plan(), 42, { products: 9 })), J(gen(plan(), 42, { products: 9 })));
});

test('overridden table still passes referential integrity', () => {
  const d = gen(plan(), 42, { products: 3, customers: 4 });
  const pids = new Set(d.products.map(r => r.product_id));
  const cids = new Set(d.customers.map(r => r.customer_id));
  for (const o of d.orders) { assert.ok(pids.has(o.product_id)); assert.ok(cids.has(o.customer_id)); }
});

test('unknown table / non-integer seed is rejected upfront', () => {
  assert.throws(() => gen(plan(), 42, { nope: 1 }), /unknown table 'nope'/);
  assert.throws(() => gen(plan(), 42, { products: 1.5 }), /must be an integer/);
});
