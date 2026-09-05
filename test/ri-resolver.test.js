// Unit tests for the referential-integrity resolver across a 3-table graph.
//
// The resolver is what makes synthdata different from Faker/Mimesis: FK values
// are drawn from keys that were actually generated for the parent table, in
// dependency order. These tests pin that behaviour down — dependency ordering,
// FK target resolution, non-null pools, self-references, uniqueness interaction,
// determinism, and the failure modes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDDL, topoOrder } from '../src/schema.js';
import { Engine } from '../src/engine.js';
import { toSqliteDb } from '../src/export.js';
import { fixture, generate, assertReferentialIntegrity, project } from './helpers.js';

const GRAPH = fixture('three_table_graph.sql');
const GRAPH_PLAN = {
  tables: {
    customers:   { rows: 25 },
    orders:      { rows: 80 },
    order_items: { rows: 200 },
  },
};

// Reverse the order the CREATE TABLE statements appear in, to prove the
// resolver depends on the FK graph and not on declaration order.
const reorderDdl = (ddl) =>
  ddl.split(/(?=CREATE\s+TABLE)/i).filter(s => s.trim()).reverse().join('\n\n');

describe('schema: FK target resolution', () => {
  const tables = parseDDL(GRAPH);

  it('resolves an inline REFERENCES parent(col) clause', () => {
    const col = tables.orders.columns.find(c => c.name === 'customer_id');
    assert.equal(col.fkTable, 'customers');
    assert.equal(col.fkColumn, 'customer_id');
    assert.equal(col.notNull, true);
  });

  it('resolves a table-level FOREIGN KEY (...) REFERENCES clause', () => {
    const col = tables.order_items.columns.find(c => c.name === 'order_id');
    assert.equal(col.fkTable, 'orders');
    assert.equal(col.fkColumn, 'order_id');
  });

  it('defaults an unqualified REFERENCES to the parent primary key', () => {
    const t = parseDDL(`
      CREATE TABLE parent (parent_id INTEGER PRIMARY KEY, label VARCHAR(20) NOT NULL);
      CREATE TABLE child  (child_id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent);
    `);
    const col = t.child.columns.find(c => c.name === 'parent_id');
    assert.equal(col.fkTable, 'parent');
    assert.equal(col.fkColumn, 'parent_id', 'FK column should default to the parent PK');
  });

  it('carries two FKs from one child to the same parent independently', () => {
    const cols = tables.orders.columns.filter(c => c.fkTable === 'customers');
    assert.equal(cols.length, 2);
    assert.deepEqual(cols.map(c => c.name).sort(), ['customer_id', 'referred_by']);
    assert.equal(cols.find(c => c.name === 'referred_by').notNull, false);
  });
});

describe('schema: topological ordering', () => {
  it('emits every parent before its children', () => {
    const order = topoOrder(parseDDL(GRAPH));
    assert.deepEqual(order.length, 3);
    assert.ok(order.indexOf('customers') < order.indexOf('orders'), `got ${order}`);
    assert.ok(order.indexOf('orders') < order.indexOf('order_items'), `got ${order}`);
  });

  it('is independent of CREATE TABLE declaration order', () => {
    const order = topoOrder(parseDDL(reorderDdl(GRAPH)));
    assert.equal(order.length, 3);
    assert.ok(order.indexOf('customers') < order.indexOf('orders'), `got ${order}`);
    assert.ok(order.indexOf('orders') < order.indexOf('order_items'), `got ${order}`);
  });

  it('terminates and keeps every table when two tables reference each other', () => {
    const order = topoOrder(parseDDL(`
      CREATE TABLE a (a_id INTEGER PRIMARY KEY, b_id INTEGER REFERENCES b(b_id));
      CREATE TABLE b (b_id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(a_id));
    `));
    assert.deepEqual([...order].sort(), ['a', 'b']);
  });
});

describe('engine: referential integrity across the 3-table graph', () => {
  it('resolves every foreign key to a row that exists in the parent', () => {
    const { tables, data } = generate(GRAPH, GRAPH_PLAN);
    assert.equal(data.customers.length, 25);
    assert.equal(data.orders.length, 80);
    assert.equal(data.order_items.length, 200);
    const checked = assertReferentialIntegrity(tables, data);
    // 80 customer_id + 80 referred_by + 200 order_id
    assert.equal(checked, 360);
  });

  it('holds transitively two levels deep (order_items -> orders -> customers)', () => {
    const { data } = generate(GRAPH, GRAPH_PLAN);
    const customerIds = new Set(project(data, 'customers', 'customer_id'));
    const ordersById = new Map(data.orders.map(o => [o.order_id, o]));
    for (const item of data.order_items) {
      const order = ordersById.get(item.order_id);
      assert.ok(order, `order_item ${item.order_item_id} points at missing order ${item.order_id}`);
      assert.ok(customerIds.has(order.customer_id),
        `order ${order.order_id} points at missing customer ${order.customer_id}`);
    }
  });

  it('keeps NULLs out of the parent key pools', () => {
    const plan = {
      tables: {
        ...GRAPH_PLAN.tables,
        orders: { rows: 80, columns: { referred_by: { gen: 'fk', null_prob: 0.5 } } },
      },
    };
    const { tables, engine, data } = generate(GRAPH, plan);
    assert.ok(data.orders.some(o => o.referred_by == null), 'expected some NULL referred_by');
    assert.ok(engine.keys['orders.referred_by'].every(v => v != null));
    assert.ok(engine.keys['orders.referred_by'].length < 80);
    assertReferentialIntegrity(tables, data);
  });

  it('honours a zipf FK distribution without leaving the parent key pool', () => {
    const plan = {
      tables: {
        customers: { rows: 25 },
        orders: { rows: 300, columns: { customer_id: { gen: 'fk', distribution: 'zipf' } } },
        order_items: { rows: 50 },
      },
    };
    const { tables, data } = generate(GRAPH, plan);
    assertReferentialIntegrity(tables, data);
    const counts = new Map();
    for (const o of data.orders) counts.set(o.customer_id, (counts.get(o.customer_id) ?? 0) + 1);
    const sorted = [...counts.values()].sort((a, b) => b - a);
    assert.ok(sorted[0] > 300 / 25, 'zipf should concentrate rows on a few parents');
  });

  it('resolves an FK that targets a non-PK UNIQUE column', () => {
    const ddl = `
      CREATE TABLE warehouses (
        warehouse_id INTEGER PRIMARY KEY,
        code VARCHAR(8) NOT NULL UNIQUE
      );
      CREATE TABLE stock (
        stock_id INTEGER PRIMARY KEY,
        warehouse_code VARCHAR(8) NOT NULL REFERENCES warehouses(code),
        qty INTEGER NOT NULL CHECK (qty BETWEEN 0 AND 99)
      );`;
    const { tables, data } = generate(ddl, { tables: { warehouses: { rows: 6 }, stock: { rows: 40 } } });
    assert.equal(tables.stock.columns.find(c => c.name === 'warehouse_code').fkColumn, 'code');
    const codes = new Set(project(data, 'warehouses', 'code'));
    assert.equal(codes.size, 6);
    for (const s of data.stock) assert.ok(codes.has(s.warehouse_code));
    assertReferentialIntegrity(tables, data);
  });

  it('fails loudly, naming the child column, when the parent has no rows', () => {
    assert.throws(
      () => generate(GRAPH, { tables: { customers: { rows: 0 }, orders: { rows: 10 }, order_items: { rows: 10 } } }),
      /orders\.customer_id: no parent keys for customers\.customer_id/,
    );
  });
});

describe('engine: self-referencing foreign keys', () => {
  const SELF_DDL = `
    CREATE TABLE employees (
      employee_id INTEGER PRIMARY KEY,
      full_name   VARCHAR(60) NOT NULL,
      manager_id  INTEGER REFERENCES employees(employee_id)
    );`;

  it('only points at rows generated earlier, so the hierarchy cannot cycle', () => {
    const { tables, data } = generate(SELF_DDL, { tables: { employees: { rows: 150 } } });
    const byId = new Map(data.employees.map(e => [e.employee_id, e]));
    for (const e of data.employees) {
      if (e.manager_id == null) continue;
      assert.ok(byId.has(e.manager_id), `manager ${e.manager_id} does not exist`);
      assert.ok(e.manager_id < e.employee_id, 'manager must be an earlier row');
    }
    assertReferentialIntegrity(tables, data);
  });

  it('walks every manager chain to a root in finite steps', () => {
    const { data } = generate(SELF_DDL, { tables: { employees: { rows: 150 } } });
    const byId = new Map(data.employees.map(e => [e.employee_id, e]));
    let roots = 0;
    for (const e of data.employees) {
      let cur = e, steps = 0;
      while (cur.manager_id != null) {
        cur = byId.get(cur.manager_id);
        assert.ok(++steps <= data.employees.length, 'manager chain did not terminate');
      }
      if (cur === e) roots++;
    }
    assert.ok(roots >= 1, 'expected at least one root employee');
  });
});

describe('engine: uniqueness over foreign keys', () => {
  const INV_DDL = `
    CREATE TABLE products   (product_id INTEGER PRIMARY KEY, sku VARCHAR(16) NOT NULL UNIQUE);
    CREATE TABLE warehouses (warehouse_id INTEGER PRIMARY KEY, code VARCHAR(8) NOT NULL UNIQUE);
    CREATE TABLE inventory (
      inventory_id INTEGER PRIMARY KEY,
      product_id   INTEGER NOT NULL REFERENCES products(product_id),
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
      on_hand      INTEGER NOT NULL CHECK (on_hand BETWEEN 0 AND 500),
      UNIQUE (product_id, warehouse_id)
    );`;

  it('fills a composite UNIQUE of two FKs with distinct, valid combinations', () => {
    const plan = { tables: { products: { rows: 5 }, warehouses: { rows: 4 }, inventory: { rows: 20 } } };
    const { tables, data } = generate(INV_DDL, plan);
    const combos = new Set(data.inventory.map(r => `${r.product_id}::${r.warehouse_id}`));
    assert.equal(combos.size, 20, 'all 20 product x warehouse combinations must be distinct');
    assertReferentialIntegrity(tables, data);
  });

  it('refuses to exceed the combination pool and says why', () => {
    const plan = { tables: { products: { rows: 5 }, warehouses: { rows: 4 }, inventory: { rows: 21 } } };
    assert.throws(() => generate(INV_DDL, plan), /allows only 20 combinations/);
  });
});

describe('engine: seed reproducibility of FK assignments', () => {
  it('produces identical foreign keys for the same seed', () => {
    const a = generate(GRAPH, GRAPH_PLAN, 42).data;
    const b = generate(GRAPH, GRAPH_PLAN, 42).data;
    assert.deepEqual(project(a, 'orders', 'customer_id'), project(b, 'orders', 'customer_id'));
    assert.deepEqual(project(a, 'order_items', 'order_id'), project(b, 'order_items', 'order_id'));
    assert.deepEqual(a, b);
  });

  it('produces different foreign keys for a different seed', () => {
    const a = project(generate(GRAPH, GRAPH_PLAN, 42).data, 'order_items', 'order_id');
    const b = project(generate(GRAPH, GRAPH_PLAN, 1337).data, 'order_items', 'order_id');
    assert.notDeepEqual(a, b);
  });
});

describe('export: the generated graph loads into SQLite with FKs enforced', () => {
  it('passes PRAGMA foreign_key_check', async () => {
    const { data } = generate(GRAPH, GRAPH_PLAN);
    const out = path.join(os.tmpdir(), `synthdata-ri-${process.pid}.db`);
    try {
      await toSqliteDb(GRAPH, data, out);   // throws if foreign_key_check reports rows
      assert.ok(fs.statSync(out).size > 0, 'database file should not be empty');
    } finally {
      fs.rmSync(out, { force: true });
    }
  });
});
