// Regression tests for bugs found on real-world schemas (Pagila, Chinook,
// MySQL employees) — reported 2026-09-11.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDDL } from '../src/schema.js';
import { Engine } from '../src/engine.js';

const plan = (tables, rows) =>
  ({ tables: Object.fromEntries(Object.keys(tables).map(t => [t, { rows }])) });

test('Pagila: NUMERIC(4,2) auto values never exceed 99.99', () => {
  const t = parseDDL(`
    CREATE TABLE film (
      film_id INT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      rental_rate NUMERIC(4,2) NOT NULL,
      replacement_cost NUMERIC(5,2) NOT NULL
    );`);
  const data = new Engine(t, plan(t, 200), 42).run();
  for (const f of data.film) {
    assert.ok(f.rental_rate <= 99.99, `rental_rate ${f.rental_rate} overflows NUMERIC(4,2)`);
    assert.ok(f.replacement_cost <= 999.99, `replacement_cost ${f.replacement_cost} overflows NUMERIC(5,2)`);
    // scale respected: at most 2 decimals
    assert.equal(Math.round(f.rental_rate * 100) / 100, f.rental_rate);
  }
});

test('Pagila: NUMERIC(p,s) with a CHECK range still respects precision', () => {
  const t = parseDDL(`
    CREATE TABLE payment (
      payment_id INT PRIMARY KEY,
      amount NUMERIC(4,2) NOT NULL CHECK (amount >= 0)
    );`);
  const data = new Engine(t, plan(t, 200), 42).run();
  for (const p of data.payment) assert.ok(p.amount >= 0 && p.amount <= 99.99);
});

test('Chinook: composite PRIMARY KEY produces zero duplicate keys', () => {
  const t = parseDDL(`
    CREATE TABLE playlist (playlist_id INT PRIMARY KEY, name VARCHAR(120));
    CREATE TABLE track (track_id INT PRIMARY KEY, name VARCHAR(200) NOT NULL);
    CREATE TABLE playlist_track (
      playlist_id INT NOT NULL REFERENCES playlist(playlist_id),
      track_id INT NOT NULL REFERENCES track(track_id),
      PRIMARY KEY (playlist_id, track_id)
    );`);
  // composite PK must be registered as a uniqueness set
  assert.deepEqual(t.playlist_track.uniqueSets, [['playlist_id', 'track_id']]);
  const p = { tables: { playlist: { rows: 20 }, track: { rows: 50 },
                        playlist_track: { rows: 700 } } };  // 70% of the 1000-combo pool
  const data = new Engine(t, p, 42).run();
  const keys = data.playlist_track.map(r => r.playlist_id + '|' + r.track_id);
  assert.equal(new Set(keys).size, 700, 'every composite PK must be distinct');
  // and both sides must still resolve to real parents
  const pl = new Set(data.playlist.map(r => r.playlist_id));
  const tr = new Set(data.track.map(r => r.track_id));
  for (const r of data.playlist_track) {
    assert.ok(pl.has(r.playlist_id));
    assert.ok(tr.has(r.track_id));
  }
});

test('Chinook: plan-authored fk generators on composite PK also deduplicate', () => {
  const t = parseDDL(`
    CREATE TABLE a (a_id INT PRIMARY KEY);
    CREATE TABLE b (b_id INT PRIMARY KEY);
    CREATE TABLE ab (
      a_id INT NOT NULL REFERENCES a(a_id),
      b_id INT NOT NULL REFERENCES b(b_id),
      PRIMARY KEY (a_id, b_id)
    );`);
  const p = { tables: { a: { rows: 10 }, b: { rows: 10 },
    ab: { rows: 100, columns: { a_id: { gen: 'fk' }, b_id: { gen: 'fk' } } } } }; // exact pool
  const data = new Engine(t, p, 42).run();
  const keys = data.ab.map(r => r.a_id + '|' + r.b_id);
  assert.equal(new Set(keys).size, 100);
});

test('1:1 child (single-column PK that is also FK) gets unique parent keys', () => {
  const t = parseDDL(`
    CREATE TABLE person (person_id INT PRIMARY KEY);
    CREATE TABLE passport (
      person_id INT PRIMARY KEY REFERENCES person(person_id),
      number VARCHAR(20) NOT NULL UNIQUE
    );`);
  const data = new Engine(t, plan(t, 80), 42).run();
  const ids = data.passport.map(r => r.person_id);
  assert.equal(new Set(ids).size, 80, 'PK+FK column must be unique');
  const parents = new Set(data.person.map(r => r.person_id));
  for (const id of ids) assert.ok(parents.has(id));
});

test('employees: UNIQUE text column survives a small fake-value pool', () => {
  const t = parseDDL(`
    CREATE TABLE departments (
      dept_no INT PRIMARY KEY,
      dept_name VARCHAR(40) NOT NULL UNIQUE
    );`);
  // a plan that forces the 20-word faker pool (what the AI authored)
  const p = { tables: { departments: { rows: 100,
    columns: { dept_name: { gen: 'faker', method: 'word', unique: true } } } } };
  const data = new Engine(t, p, 42).run();
  const names = data.departments.map(r => r.dept_name);
  assert.equal(new Set(names).size, 100, 'must not abort; suffix fallback keeps values unique');
  for (const n of names) assert.ok(n.length <= 40);
});

test('Pagila: composite PK with a timestamp member keeps each column type (1.2.0 regression)', () => {
  const t = parseDDL(`
    CREATE TABLE payment (
        payment_id integer NOT NULL,
        customer_id integer NOT NULL,
        amount numeric(5,2) NOT NULL,
        payment_date timestamp NOT NULL,
        PRIMARY KEY (payment_date, payment_id)
    );`);
  const data = new Engine(t, plan(t, 200), 42).run();
  const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  for (const r of data.payment) {
    assert.match(String(r.payment_date), TS, `payment_date '${r.payment_date}' is not a timestamp`);
    assert.equal(typeof r.payment_id, 'number');
    assert.ok(r.amount <= 999.99);
  }
  const keys = data.payment.map(r => r.payment_date + '|' + r.payment_id);
  assert.equal(new Set(keys).size, 200, 'composite (payment_date, payment_id) must be unique');
});

test('employees: table-level UNIQUE(dept_name) at 200 rows never aborts (auto mode)', () => {
  const t = parseDDL(`
    CREATE TABLE departments (
        dept_no char(4) NOT NULL,
        dept_name varchar(40) NOT NULL,
        PRIMARY KEY (dept_no),
        UNIQUE (dept_name)
    );`);
  const data = new Engine(t, plan(t, 200), 42).run();   // must not throw
  const names = data.departments.map(r => r.dept_name);
  assert.equal(new Set(names).size, 200);
  for (const n of names) assert.ok(String(n).length <= 40);
  const codes = data.departments.map(r => String(r.dept_no));
  assert.equal(new Set(codes).size, 200, 'char(4) PK must be unique');
  for (const c of codes) assert.ok(c.length <= 4, `dept_no '${c}' exceeds char(4)`);
});

test('table-level UNIQUE(dept_name) with a plan-forced small faker pool falls back with suffixes', () => {
  const t = parseDDL(`
    CREATE TABLE departments (
        dept_no char(4) NOT NULL PRIMARY KEY,
        dept_name varchar(40) NOT NULL,
        UNIQUE (dept_name)
    );`);
  const p = { tables: { departments: { rows: 200,
    columns: { dept_name: { gen: 'faker', method: 'word', unique: true } } } } };
  const data = new Engine(t, p, 42).run();               // must not throw
  const names = data.departments.map(r => r.dept_name);
  assert.equal(new Set(names).size, 200);
  for (const n of names) assert.ok(n.length <= 40);
});

test('all-text composite UNIQUE(email, tenant) deduplicates without corrupting types', () => {
  const t = parseDDL(`
    CREATE TABLE members (
      member_id INT PRIMARY KEY,
      email VARCHAR(60) NOT NULL,
      tenant VARCHAR(10) NOT NULL CHECK (tenant IN ('A','B')),
      UNIQUE (email, tenant)
    );`);
  const p = { tables: { members: { rows: 150, columns: {
    email: { gen: 'faker', method: 'word' } } } } };     // 20-word pool x 2 tenants = 40 combos
  const data = new Engine(t, p, 42).run();               // must not throw
  const keys = data.members.map(r => r.email + '|' + r.tenant);
  assert.equal(new Set(keys).size, 150);
  for (const r of data.members) {
    assert.ok(['A','B'].includes(r.tenant), 'tenant must stay in its CHECK set');
    assert.ok(r.email.length <= 60);
  }
});

test('Northwind: plan template exceeding varchar(2) is truncated, all rows kept', () => {
  const t = parseDDL(`
    CREATE TABLE us_states (
      state_id smallint PRIMARY KEY,
      state_name varchar(100),
      state_abbr varchar(2)
    );`);
  const p = { tables: { us_states: { rows: 51,
    columns: { state_abbr: { gen: 'template', format: 'S{seq:02d}' } } } } };
  const data = new Engine(t, p, 42).run();               // must not throw
  assert.equal(data.us_states.length, 51);
  for (const r of data.us_states)
    assert.ok(String(r.state_abbr).length <= 2, `'${r.state_abbr}' exceeds varchar(2)`);
});

test('varchar(2) UNIQUE with an overflowing template stays unique via base-36 fallback', () => {
  const t = parseDDL(`
    CREATE TABLE codes (id INT PRIMARY KEY, code varchar(2) UNIQUE);`);
  const p = { tables: { codes: { rows: 60,
    columns: { code: { gen: 'template', format: 'S{seq:02d}', unique: true } } } } };
  const data = new Engine(t, p, 42).run();               // must not throw
  const vals = data.codes.map(r => r.code);
  assert.equal(new Set(vals).size, 60);
  for (const v of vals) assert.ok(v.length <= 2);
});

test('dellstore2: {gen: fk} with no declared FOREIGN KEY resolves by column name', () => {
  const t = parseDDL(`
    CREATE TABLE orderlines (
      orderlineid INT PRIMARY KEY,
      prod_id INT NOT NULL,
      quantity INT NOT NULL CHECK (quantity > 0)
    );
    CREATE TABLE products (
      prod_id INT PRIMARY KEY,
      title VARCHAR(50) NOT NULL
    );`);
  // child declared BEFORE parent, no FK in DDL — name inference + ordering must both work
  const p = { tables: {
    products: { rows: 40 },
    orderlines: { rows: 120, columns: { prod_id: { gen: 'fk' } } } } };
  const data = new Engine(t, p, 42).run();               // must not throw
  const parents = new Set(data.products.map(r => r.prod_id));
  for (const r of data.orderlines)
    assert.ok(parents.has(r.prod_id), `prod_id ${r.prod_id} not in products`);
});

test('{gen: fk, ref: table.column} explicit plan target works without a DDL FK', () => {
  const t = parseDDL(`
    CREATE TABLE payment (payment_id INT PRIMARY KEY, cust INT NOT NULL);
    CREATE TABLE customer (customer_id INT PRIMARY KEY);`);
  const p = { tables: { customer: { rows: 30 },
    payment: { rows: 90, columns: { cust: { gen: 'fk', ref: 'customer.customer_id' } } } } };
  const data = new Engine(t, p, 42).run();
  const parents = new Set(data.customer.map(r => r.customer_id));
  for (const r of data.payment) assert.ok(parents.has(r.cust));
});

test('unresolvable {gen: fk} warns and falls back to int — other tables still generate', () => {
  const t = parseDDL(`
    CREATE TABLE a (id INT PRIMARY KEY, mystery INT NOT NULL);
    CREATE TABLE b (id INT PRIMARY KEY, v INT);`);
  const p = { tables: { a: { rows: 20, columns: { mystery: { gen: 'fk' } } },
                        b: { rows: 20 } } };
  const data = new Engine(t, p, 42).run();               // must not throw
  assert.equal(data.a.length, 20);
  assert.equal(data.b.length, 20, 'other tables must not be lost');
  for (const r of data.a) assert.equal(typeof r.mystery, 'number');
});

test('Pagila: expr date arithmetic — addDays helper and +n concat repair', () => {
  const t = parseDDL(`
    CREATE TABLE rental (
      rental_id INT PRIMARY KEY,
      rental_date timestamp NOT NULL,
      return_date timestamp,
      due_date timestamp
    );`);
  const p = { tables: { rental: { rows: 100, columns: {
    rental_date: { gen: 'datetime', start: '2025-01-01 00:00', end: '2025-06-01 00:00' },
    return_date: { gen: 'expr', code: 'addDays(row.rental_date, 7)' },   // correct form
    due_date:    { gen: 'expr', code: 'row.rental_date + 7' },           // GPT-4o's mistake
  } } } };
  const data = new Engine(t, p, 42).run();
  const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  for (const r of data.rental) {
    assert.match(String(r.return_date), TS, `return_date '${r.return_date}' invalid`);
    assert.match(String(r.due_date), TS, `due_date '${r.due_date}' not repaired`);
    const day = 86400000, ms = s => new Date(String(s).replace(' ', 'T') + 'Z').getTime();
    assert.equal(ms(r.return_date) - ms(r.rental_date), 7 * day);
    assert.equal(ms(r.due_date) - ms(r.rental_date), 7 * day, 'concat repair must mean +7 days');
  }
});

test('dellstore2: {gen: fk} on a PRIMARY KEY column samples without replacement', () => {
  const t = parseDDL(`
    CREATE TABLE inventory (
      prod_id INT PRIMARY KEY,
      quan_in_stock INT NOT NULL
    );
    CREATE TABLE products (
      prod_id INT PRIMARY KEY,
      title VARCHAR(50) NOT NULL
    );`);
  const p = { tables: {
    inventory: { rows: 200 },
    products:  { rows: 200, columns: { prod_id: { gen: 'fk', ref: 'inventory.prod_id' } } } } };
  const data = new Engine(t, p, 42).run();
  const ids = data.products.map(r => r.prod_id);
  assert.equal(new Set(ids).size, 200, 'PK sampled with replacement — duplicates found');
  const parents = new Set(data.inventory.map(r => r.prod_id));
  for (const id of ids) assert.ok(parents.has(id));
});

test('fk on PK asking for more rows than the parent pool fails with a clear message', () => {
  const t = parseDDL(`
    CREATE TABLE src (id INT PRIMARY KEY);
    CREATE TABLE mirror (id INT PRIMARY KEY, v INT);`);
  const p = { tables: { src: { rows: 10 },
    mirror: { rows: 50, columns: { id: { gen: 'fk', ref: 'src.id' } } } } };
  assert.throws(() => new Engine(t, p, 42).run(), /UNIQUE|pool|distinct/);
});

test('unique suffix fallback respects max_len', () => {
  const t = parseDDL(`
    CREATE TABLE x (id INT PRIMARY KEY, code VARCHAR(8) NOT NULL UNIQUE);`);
  const p = { tables: { x: { rows: 60,
    columns: { code: { gen: 'faker', method: 'word', unique: true, max_len: 8 } } } } };
  const data = new Engine(t, p, 42).run();
  const codes = data.x.map(r => r.code);
  assert.equal(new Set(codes).size, 60);
  for (const c of codes) assert.ok(c.length <= 8, `'${c}' exceeds VARCHAR(8)`);
});
