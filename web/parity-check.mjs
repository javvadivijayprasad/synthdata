// Verifies the engine embedded in web/index.html produces byte-identical
// output to the npm engine (src/). Run after every web sync:
//   node web/parity-check.mjs
import fs from 'node:fs';
import { parseDDL as npmParse } from '../src/schema.js';
import { Engine as NpmEngine } from '../src/engine.js';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf-8');
const start = html.indexOf('function splitTopLevel');
const endMark = "return lines.join('\\n');}";
const end = html.indexOf(endMark, start) + endMark.length;
if (start < 0 || end <= start) { console.error('FAIL: cannot locate embedded engine'); process.exit(1); }
const web = new Function(html.slice(start, end) + '\nreturn {parseDDL, Engine};')();

const CASES = {
  ecommerce: fs.readFileSync(new URL('../examples/schema_ecommerce.sql', import.meta.url), 'utf-8'),
  pagila_composite_pk: `CREATE TABLE payment (payment_id integer NOT NULL, customer_id integer NOT NULL,
    amount numeric(5,2) NOT NULL, payment_date timestamp NOT NULL, PRIMARY KEY (payment_date, payment_id));`,
  employees_unique: `CREATE TABLE departments (dept_no char(4) NOT NULL, dept_name varchar(40) NOT NULL,
    PRIMARY KEY (dept_no), UNIQUE (dept_name));`,
  numeric_precision: `CREATE TABLE film (film_id INT PRIMARY KEY, rental_rate NUMERIC(4,2) NOT NULL);`,
  dellstore_inference: `CREATE TABLE orderlines (orderlineid INT PRIMARY KEY, prod_id INT NOT NULL);
    CREATE TABLE products (prod_id INT PRIMARY KEY, title VARCHAR(50) NOT NULL);`,
};
const PLANS = {
  dellstore_inference: (t) => ({ tables: { products: { rows: 30 },
    orderlines: { rows: 90, columns: { prod_id: { gen: 'fk' } } } } }),
  expr_dates: null,
};
const mkPlan = (tables, rows) => ({ tables: Object.fromEntries(Object.keys(tables).map(t => [t, { rows }])) });

let fail = 0;
for (const [label, ddl] of Object.entries(CASES)) {
  for (const profile of ['functional', 'edge', 'negative']) {
    const wt = web.parseDDL(ddl), nt = npmParse(ddl);
    const p = PLANS[label] ? PLANS[label](wt) : mkPlan(wt, 50);
    let wd, nd, werr = null, nerr = null;
    try { wd = new web.Engine(wt, p, 42, profile).run(); } catch (e) { werr = e.message; }
    try { nd = new NpmEngine(npmParse(ddl), PLANS[label] ? PLANS[label](nt) : mkPlan(nt, 50), 42, profile).run(); } catch (e) { nerr = e.message; }
    const same = werr || nerr ? werr === nerr : JSON.stringify(wd) === JSON.stringify(nd);
    console.log(`${same ? 'OK  ' : 'FAIL'} ${label} / ${profile}${werr ? ' (both threw: ' + werr + ')' : ''}`);
    if (!same) { fail++; console.log('  web:', (werr ?? JSON.stringify(wd)).slice(0, 200)); console.log('  npm:', (nerr ?? JSON.stringify(nd)).slice(0, 200)); }
  }
}
// expr date arithmetic parity
{
  const ddl = `CREATE TABLE rental (rental_id INT PRIMARY KEY, rental_date timestamp NOT NULL, due_date timestamp);`;
  const p = { tables: { rental: { rows: 40, columns: {
    rental_date: { gen: 'datetime', start: '2025-01-01 00:00', end: '2025-06-01 00:00' },
    due_date: { gen: 'expr', code: 'row.rental_date + 7' } } } } };
  const wd = new web.Engine(web.parseDDL(ddl), p, 42).run();
  const nd = new NpmEngine(npmParse(ddl), p, 42).run();
  const same = JSON.stringify(wd) === JSON.stringify(nd);
  const valid = wd.rental.every(r => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.due_date));
  console.log(`${same && valid ? 'OK  ' : 'FAIL'} expr_date_repair (identical=${same}, all timestamps valid=${valid})`);
  if (!same || !valid) fail++;
}
console.log(fail ? `\n${fail} PARITY FAILURE(S)` : '\nWEB ENGINE PARITY: ALL IDENTICAL');
process.exit(fail ? 1 : 0);
