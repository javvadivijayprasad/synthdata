// Shared assertions for the synthdata test suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';
import { parseDDL } from '../src/schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function fixture(name) {
  return fs.readFileSync(path.join(HERE, 'fixtures', name), 'utf-8');
}

// Parse DDL + run the engine in one step.
export function generate(ddl, plan, seed = 42, profile = 'functional') {
  const tables = parseDDL(ddl);
  const engine = new Engine(tables, plan, seed, profile);
  const data = engine.run();
  return { tables, engine, data };
}

// The core invariant: every non-null foreign-key value in every child row must
// match a value actually present in the referenced parent column. NULL is only
// tolerated where the column is nullable. Returns the number of FK values checked
// so a test can prove it did not vacuously pass.
export function assertReferentialIntegrity(tables, data) {
  const pools = {};
  for (const [tname, rows] of Object.entries(data)) {
    for (const col of tables[tname].columns) {
      pools[`${tname}.${col.name}`] = new Set(rows.map(r => r[col.name]).filter(v => v != null));
    }
  }
  let checked = 0;
  for (const [tname, rows] of Object.entries(data)) {
    for (const col of tables[tname].columns) {
      if (!col.fkTable) continue;
      assert.ok(col.fkColumn, `${tname}.${col.name}: FK target column was never resolved`);
      const pool = pools[`${col.fkTable}.${col.fkColumn}`];
      assert.ok(pool, `${tname}.${col.name}: parent ${col.fkTable}.${col.fkColumn} was not generated`);
      for (const row of rows) {
        const v = row[col.name];
        if (v == null) {
          assert.equal(col.notNull, false,
            `${tname}.${col.name} is NOT NULL but the engine produced NULL`);
          continue;
        }
        assert.ok(pool.has(v),
          `${tname}.${col.name}=${JSON.stringify(v)} has no parent row in ${col.fkTable}.${col.fkColumn}`);
        checked++;
      }
    }
  }
  return checked;
}

// Column-wise projection, used for seed-reproducibility comparisons.
export function project(data, tname, col) {
  return data[tname].map(r => r[col]);
}
