// W3 — unit tests for the referential-integrity resolver.
// Run with: npm test  (node --test test/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDDL, topoOrder } from '../src/schema.js';
import { Engine } from '../src/engine.js';

// ---- 3-table FK graph: customers -> orders -> order_items ----
const DDL3 = `
CREATE TABLE customers (
  customer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  tier VARCHAR(10) NOT NULL CHECK (tier IN ('STD','GOLD','VIP'))
);
CREATE TABLE orders (
  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(customer_id),
  total NUMERIC(10,2) CHECK (total >= 0)
);
CREATE TABLE order_items (
  item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(order_id),
  qty INT NOT NULL CHECK (qty > 0),
  price NUMERIC(8,2) CHECK (price BETWEEN 1 AND 500)
);`;

const plan = (tables, rows) =>
  ({ tables: Object.fromEntries(Object.keys(tables).map(t => [t, { rows }])) });

test('topoOrder puts parents before children in a 3-table chain', () => {
  const t = parseDDL(DDL3);
  const order = topoOrder(t);
  assert.ok(order.indexOf('customers') < order.indexOf('orders'));
  assert.ok(order.indexOf('orders') < order.indexOf('order_items'));
});

test('every FK value resolves to a generated parent PK', () => {
  const t = parseDDL(DDL3);
  const data = new Engine(t, plan(t, 50), 42).run();
  const custIds = new Set(data.customers.map(r => r.customer_id));
  const orderIds = new Set(data.orders.map(r => r.order_id));
  for (const o of data.orders) assert.ok(custIds.has(o.customer_id), `dangling customer_id ${o.customer_id}`);
  for (const i of data.order_items) assert.ok(orderIds.has(i.order_id), `dangling order_id ${i.order_id}`);
});

test('FK without explicit column defaults to the parent PK', () => {
  const t = parseDDL(`
    CREATE TABLE a (a_id INT PRIMARY KEY);
    CREATE TABLE b (b_id INT PRIMARY KEY, a_ref INT REFERENCES a);`);
  assert.equal(t.b.columns.find(c => c.name === 'a_ref').fkColumn, 'a_id');
});

test('diamond graph (two paths to one ancestor) generates without dangling FKs', () => {
  const t = parseDDL(`
    CREATE TABLE root (id INT PRIMARY KEY);
    CREATE TABLE left1 (id INT PRIMARY KEY, root_id INT REFERENCES root(id));
    CREATE TABLE right1 (id INT PRIMARY KEY, root_id INT REFERENCES root(id));
    CREATE TABLE leaf (id INT PRIMARY KEY, l INT REFERENCES left1(id), r INT REFERENCES right1(id));`);
  const order = topoOrder(t);
  assert.equal(order.indexOf('root'), 0);
  assert.equal(order.indexOf('leaf'), 3);
  const data = new Engine(t, plan(t, 30), 7).run();
  const lIds = new Set(data.left1.map(r => r.id)), rIds = new Set(data.right1.map(r => r.id));
  for (const row of data.leaf) {
    assert.ok(lIds.has(row.l));
    assert.ok(rIds.has(row.r));
  }
});

test('self-referencing FK (manager hierarchy) never dangles and has roots', () => {
  const t = parseDDL(`
    CREATE TABLE emp (
      emp_id INT PRIMARY KEY,
      manager_id INT REFERENCES emp(emp_id),
      name VARCHAR(50) NOT NULL
    );`);
  const data = new Engine(t, plan(t, 200), 42).run();
  const ids = new Set(data.emp.map(r => r.emp_id));
  let roots = 0;
  for (const r of data.emp) {
    if (r.manager_id == null) roots++;
    else assert.ok(ids.has(r.manager_id), `dangling manager_id ${r.manager_id}`);
  }
  assert.ok(roots >= 1, 'hierarchy needs at least one root (NULL manager)');
});

test('zipf-distributed FK still only uses valid parent keys', () => {
  const t = parseDDL(DDL3);
  const p = plan(t, 40);
  p.tables.orders.columns = { customer_id: { gen: 'fk', distribution: 'zipf' } };
  const data = new Engine(t, p, 42).run();
  const custIds = new Set(data.customers.map(r => r.customer_id));
  for (const o of data.orders) assert.ok(custIds.has(o.customer_id));
});

test('unique FK column: exactly one child per parent, all resolving', () => {
  const t = parseDDL(`
    CREATE TABLE orders2 (order_id INT PRIMARY KEY);
    CREATE TABLE payments (
      pay_id INT PRIMARY KEY,
      order_id INT NOT NULL UNIQUE REFERENCES orders2(order_id)
    );`);
  const data = new Engine(t, plan(t, 100), 42).run();
  const used = data.payments.map(r => r.order_id);
  assert.equal(new Set(used).size, 100, 'order_id must be unique across payments');
  const parents = new Set(data.orders2.map(r => r.order_id));
  for (const id of used) assert.ok(parents.has(id));
});

test('composite UNIQUE(fk, choice) assigns distinct pairs at full pool size', () => {
  const t = parseDDL(`
    CREATE TABLE products (product_id INT PRIMARY KEY);
    CREATE TABLE inventory (
      inv_id INT PRIMARY KEY,
      product_id INT NOT NULL REFERENCES products(product_id),
      wh VARCHAR(5) NOT NULL CHECK (wh IN ('A','B','C')),
      UNIQUE (product_id, wh)
    );`);
  const p = { tables: { products: { rows: 10 }, inventory: { rows: 30 } } }; // 10 x 3 = exact pool
  const data = new Engine(t, p, 42).run();
  const keys = data.inventory.map(r => r.product_id + '|' + r.wh);
  assert.equal(new Set(keys).size, 30, 'all 30 (product, warehouse) pairs must be distinct');
});

test('generation respects CHECK constraints parsed from DDL', () => {
  const t = parseDDL(DDL3);
  const data = new Engine(t, plan(t, 50), 42).run();
  for (const c of data.customers) assert.ok(['STD','GOLD','VIP'].includes(c.tier));
  for (const o of data.orders) assert.ok(o.total == null || o.total >= 0);
  for (const i of data.order_items) {
    assert.ok(i.qty > 0);
    assert.ok(i.price == null || (i.price >= 1 && i.price <= 500));
  }
});

test('cross-column CHECK (a >= b) holds on every generated row', () => {
  const t = parseDDL(`
    CREATE TABLE grades (
      grade_id INT PRIMARY KEY,
      min_salary NUMERIC(10,2) NOT NULL CHECK (min_salary >= 0),
      max_salary NUMERIC(10,2) NOT NULL,
      CHECK (max_salary >= min_salary)
    );`);
  assert.deepEqual(t.grades.rowChecks, [{ left: 'max_salary', op: '>=', right: 'min_salary' }]);
  const data = new Engine(t, plan(t, 100), 42).run();
  for (const g of data.grades) assert.ok(g.max_salary >= g.min_salary);
});

test('same seed reproduces identical data; different seed differs', () => {
  const t1 = parseDDL(DDL3), t2 = parseDDL(DDL3);
  const a = new Engine(t1, plan(t1, 40), 123).run();
  const b = new Engine(t2, plan(t2, 40), 123).run();
  assert.deepEqual(a, b);
  const t3 = parseDDL(DDL3);
  const c = new Engine(t3, plan(t3, 40), 124).run();
  assert.notDeepEqual(a, c);
});

test('profiles keep referential integrity (edge) and tag violations (negative)', () => {
  const t = parseDDL(DDL3);
  const edge = new Engine(t, plan(t, 30), 42, 'edge').run();
  const custIds = new Set(edge.customers.map(r => r.customer_id));
  for (const o of edge.orders) assert.ok(custIds.has(o.customer_id), 'edge profile must not dangle FKs');
  const neg = new Engine(parseDDL(DDL3), plan(t, 30), 42, 'negative').run();
  for (const rows of Object.values(neg))
    for (const r of rows) assert.ok(typeof r._violation === 'string' && r._violation.length > 0);
});

test('parseDDL captures identity, unique, not-null, and check metadata', () => {
  const t = parseDDL(DDL3);
  const cust = t.customers;
  assert.equal(cust.columns.find(c => c.name === 'customer_id').identity, true);
  assert.equal(cust.columns.find(c => c.name === 'email').unique, true);
  assert.equal(cust.columns.find(c => c.name === 'email').notNull, true);
  assert.deepEqual(cust.columns.find(c => c.name === 'tier').checkIn, ['STD','GOLD','VIP']);
  const price = t.order_items.columns.find(c => c.name === 'price');
  assert.deepEqual(price.checkRange, [1, 500]);
});
