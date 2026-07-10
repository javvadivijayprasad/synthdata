/**
 * synthdata-core.cjs — CommonJS bundle of the @vijaypjavvadi/synthdata engine
 * for use inside the framework-generator-api (tsconfig module=commonjs).
 * Zero dependencies. Mirrors the tested ESM sources 1:1.
 */
'use strict';

/* ---------------- DDL parser ---------------- */
function splitTopLevel(body) {
  const parts = []; let depth = 0, cur = '', inStr = false;
  for (const ch of body) {
    if (ch === "'") inStr = !inStr;
    if (!inStr) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseCheck(text, col) {
  const im = text.match(new RegExp(col.name + '\\s+IN\\s*\\(([^)]*)\\)', 'i'));
  if (im) col.checkIn = im[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  const bm = text.match(new RegExp(col.name + '\\s+BETWEEN\\s+(-?[\\d.]+)\\s+AND\\s+(-?[\\d.]+)', 'i'));
  if (bm) { col.checkRange = [parseFloat(bm[1]), parseFloat(bm[2])]; return; }
  const cmp = text.match(new RegExp(col.name + '\\s*(>=|>|<=|<)\\s*(-?[\\d.]+)', 'i'));
  if (cmp) {
    const n = parseFloat(cmp[2]);
    const r = col.checkRange || [null, null];
    if (cmp[1] === '>=') r[0] = n; else if (cmp[1] === '>') r[0] = n + 1;
    else if (cmp[1] === '<=') r[1] = n; else r[1] = n - 1;
    col.checkRange = r;
  }
}

function parseDDL(sql) {
  sql = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const tables = {};
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1];
    let depth = 1, i = re.lastIndex, inStr = false;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === "'") inStr = !inStr;
      if (!inStr) { if (ch === '(') depth++; if (ch === ')') depth--; }
      i++;
    }
    const body = sql.slice(re.lastIndex, i - 1);
    const table = { name, columns: [], uniqueSets: [] };
    for (const part of splitTopLevel(body)) {
      const up = part.toUpperCase();
      if (up.startsWith('PRIMARY KEY')) {
        const cols = (part.match(/\(([^)]*)\)/) || [])[1] || '';
        for (const cn of cols.split(',').map(s => s.trim().replace(/["`]/g, ''))) {
          const c = table.columns.find(x => x.name === cn);
          if (c) { c.isPk = true; c.notNull = true; }
        }
      } else if (up.startsWith('UNIQUE')) {
        const cols = (part.match(/\(([^)]*)\)/) || [])[1] || '';
        const names = cols.split(',').map(s => s.trim().replace(/["`]/g, '')).filter(Boolean);
        if (names.length) table.uniqueSets.push(names);
      } else if (up.startsWith('FOREIGN KEY')) {
        const fk = part.match(/FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+["`]?(\w+)["`]?\s*(?:\(([^)]*)\))?/i);
        if (fk) {
          const c = table.columns.find(x => x.name === fk[1].trim().replace(/["`]/g, ''));
          if (c) { c.fkTable = fk[2]; c.fkColumn = fk[3] ? fk[3].trim() : null; }
        }
      } else if (up.startsWith('CHECK') || up.startsWith('CONSTRAINT')) {
        for (const c of table.columns) parseCheck(part, c);
      } else {
        const cm = part.match(/^["`]?(\w+)["`]?\s+([A-Za-z]+(?:\s*\(\s*[\d,\s]+\s*\))?)([\s\S]*)$/);
        if (!cm) continue;
        const col = { name: cm[1], dtype: cm[2].toUpperCase().replace(/\s+/g, ''),
                      notNull: false, unique: false, isPk: false,
                      fkTable: null, fkColumn: null, checkIn: null, checkRange: null };
        const rest = cm[3] || '';
        const restUp = rest.toUpperCase();
        if (restUp.includes('PRIMARY KEY')) { col.isPk = true; col.notNull = true; }
        if (/\bNOT\s+NULL\b/i.test(rest)) col.notNull = true;
        if (/\bUNIQUE\b/i.test(rest)) col.unique = true;
        const ref = rest.match(/REFERENCES\s+["`]?(\w+)["`]?\s*(?:\(\s*["`]?(\w+)["`]?\s*\))?/i);
        if (ref) { col.fkTable = ref[1]; col.fkColumn = ref[2] || null; }
        if (restUp.includes('CHECK')) parseCheck(rest, col);
        table.columns.push(col);
      }
    }
    tables[name] = table;
  }
  for (const t of Object.values(tables)) {
    for (const c of t.columns) {
      if (c.fkTable && !c.fkColumn && tables[c.fkTable]) {
        const pk = tables[c.fkTable].columns.find(x => x.isPk);
        c.fkColumn = pk ? pk.name : null;
      }
    }
  }
  return tables;
}

function topoOrder(tables) {
  const order = [], seen = new Set();
  function visit(name, stack) {
    if (seen.has(name) || !tables[name]) return;
    if (stack.includes(name)) return;
    for (const c of tables[name].columns) {
      if (c.fkTable && c.fkTable !== name) visit(c.fkTable, stack.concat(name));
    }
    if (!seen.has(name)) { seen.add(name); order.push(name); }
  }
  for (const n of Object.keys(tables)) visit(n, []);
  return order;
}

/* ---------------- seeded RNG + fake values ---------------- */
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    random: next,
    randint: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    uniform: (lo, hi) => lo + next() * (hi - lo),
    choice: (arr) => arr[Math.floor(next() * arr.length)],
    choices: (arr, w) => {
      if (!w) return rng.choice(arr);
      const tot = w.reduce((s, x) => s + x, 0);
      let r = next() * tot;
      for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; }
      return arr[arr.length - 1];
    },
    gauss: () => {
      const u = Math.max(next(), 1e-12), v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    lognormal: (mu, s) => Math.exp(mu + s * rng.gauss()),
    pareto: (al) => 1 / Math.pow(1 - next(), 1 / al),
  };
  return rng;
}

const FIRST = ['Aarav','Vivaan','Aditya','Arjun','Reyansh','Ishaan','Kabir','Ananya','Diya','Ira','Myra','Sara','Aadhya','Kiara','James','Mary','John','Priya','Rahul','Sneha','Vikram','Neha','Amit','Pooja','Ravi','Anjali','Karan','Meera','Suresh','Lakshmi'];
const LAST = ['Sharma','Verma','Iyer','Patel','Reddy','Nair','Gupta','Mehta','Singh','Khan','Das','Roy','Chopra','Malhotra','Joshi','Kulkarni','Rao','Menon','Smith','Johnson','Bhat','Pillai','Saxena','Trivedi','Banerjee','Mukherjee','Chatterjee','Desai','Shah','Kapoor'];
const CITIES = ['Bengaluru','Mumbai','Delhi','Hyderabad','Chennai','Pune','Kolkata','Ahmedabad','Jaipur','Kochi','Indore','Nagpur','Lucknow','Surat'];
const STATES = ['Karnataka','Maharashtra','Delhi','Telangana','Tamil Nadu','West Bengal','Gujarat','Rajasthan','Kerala','Madhya Pradesh'];
const STREETS = ['MG Road','Brigade Road','Link Road','Station Road','Mall Road','Ring Road','Church Street','Park Street','Hill Road','Lake View Road'];
const WORDS = ['alpha','vertex','nova','pulse','matrix','orbit','prism','quartz','zenith','delta','ember','flux','harbor','signal','summit','vector','willow','beacon','cascade','meridian'];
const CA = ['Blue','Prime','Nex','Apex','Uni','Meta','Omni','True','Bright','Swift'];
const CB = ['Tech','Soft','Works','Labs','Systems','Solutions','Retail','Traders','Mart','Industries'];

function fakerValue(method, rng) {
  const p = (a) => a[Math.floor(rng.random() * a.length)];
  switch (method) {
    case 'name': case 'fullName': return p(FIRST) + ' ' + p(LAST);
    case 'first_name': return p(FIRST);
    case 'last_name': return p(LAST);
    case 'email': return p(FIRST).toLowerCase() + '.' + p(LAST).toLowerCase() + rng.randint(1, 9999) + '@example.com';
    case 'phone_number': case 'phone': return '+91-9' + rng.randint(100000000, 999999999);
    case 'city': return p(CITIES);
    case 'state': return p(STATES);
    case 'street_address': return rng.randint(1, 999) + ', ' + p(STREETS);
    case 'postcode': return String(rng.randint(110001, 999999));
    case 'company': return p(CA) + p(CB);
    case 'catch_phrase': return p(WORDS)[0].toUpperCase() + p(WORDS).slice(1) + ' ' + p(WORDS) + ' ' + p(WORDS);
    case 'word': return p(WORDS);
    case 'sentence': {
      const n = rng.randint(6, 12);
      const ws = Array.from({ length: n }, () => p(WORDS));
      return ws[0][0].toUpperCase() + ws.join(' ').slice(1) + '.';
    }
    case 'user_name': return p(FIRST).toLowerCase() + rng.randint(1, 999);
    default: return p(WORDS);
  }
}

/* ---------------- engine ---------------- */
const MAX_RETRIES = 50;
const round2 = (v, d) => { const p = Math.pow(10, d == null ? 2 : d); return Math.round(v * p) / p; };
const fmtTpl = (tpl, seq) => tpl.replace(/\{seq(?::0(\d+)d)?\}/g, (_, w) => w ? String(seq).padStart(+w, '0') : String(seq));

class Engine {
  constructor(tables, plan, seed) {
    this.tables = tables; this.plan = plan || {};
    this.rng = makeRng(seed == null ? 42 : seed);
    this.data = {}; this.keys = {};
  }
  value(spec, tname, col, seq, row, partial) {
    const rng = this.rng;
    if (spec.null_prob && rng.random() < spec.null_prob) return null;
    switch (spec.gen || 'auto') {
      case 'sequence': return seq;
      case 'faker': return fakerValue(spec.method, rng);
      case 'choice': return rng.choices(spec.values, spec.weights);
      case 'int': return rng.randint(Math.trunc(spec.min != null ? spec.min : 0), Math.trunc(spec.max != null ? spec.max : 100));
      case 'float': return round2(rng.uniform(+(spec.min != null ? spec.min : 0), +(spec.max != null ? spec.max : 100)), spec.round);
      case 'lognormal': {
        let v = rng.lognormal(spec.mu != null ? spec.mu : 6.5, spec.sigma != null ? spec.sigma : 1.0);
        if (spec.max != null) v = Math.min(v, spec.max);
        if (spec.min != null) v = Math.max(v, spec.min);
        return round2(v, spec.round);
      }
      case 'date': {
        const s = new Date(String(spec.start || '2024-01-01') + 'T00:00:00Z');
        const e = new Date(String(spec.end || '2026-01-01') + 'T00:00:00Z');
        return new Date(s.getTime() + rng.randint(0, Math.floor((e - s) / 86400000)) * 86400000).toISOString().slice(0, 10);
      }
      case 'datetime': {
        const s = new Date(String(spec.start || '2024-01-01 00:00').replace(' ', 'T') + ':00Z');
        const e = new Date(String(spec.end || '2026-01-01 00:00').replace(' ', 'T') + ':00Z');
        return new Date(s.getTime() + rng.randint(0, Math.floor((e - s) / 1000)) * 1000).toISOString().slice(0, 19).replace('T', ' ');
      }
      case 'template': return fmtTpl(spec.format, seq);
      case 'const': return spec.value != null ? spec.value : null;
      case 'fk': {
        if (col.fkTable === tname) {
          const pool = partial.map(r => r[col.fkColumn]).filter(v => v != null);
          if (!pool.length || rng.random() < 0.02) return null;
          return rng.choice(pool);
        }
        const pool = this.keys[col.fkTable + '.' + col.fkColumn] || [];
        if (!pool.length) throw new Error(tname + '.' + col.name + ': no parent keys for ' + col.fkTable + '.' + col.fkColumn);
        if (spec.distribution === 'zipf') {
          const idx = Math.min(Math.floor(rng.pareto(1.2)) - 1, pool.length - 1);
          return pool[Math.max(0, idx)];
        }
        return rng.choice(pool);
      }
      case 'expr': {
        const fn = new Function('row', 'rng', 'return (' + spec.code + ');');
        return fn(row, rng);
      }
      default: throw new Error(tname + '.' + col.name + ": unknown generator '" + spec.gen + "'");
    }
  }
  autoSpec(col) {
    if (col.isPk) return { gen: 'sequence' };
    if (col.fkTable) return { gen: 'fk' };
    if (col.unique && !/INT|NUMERIC|DECIMAL|REAL|FLOAT|DATE|TIME/.test(col.dtype))
      return { gen: 'template', format: col.name + '_{seq}' };
    if (col.checkIn) return { gen: 'choice', values: col.checkIn };
    const d = col.dtype;
    if (col.checkRange) {
      const lo = col.checkRange[0] != null ? col.checkRange[0] : 0;
      const hi = col.checkRange[1] != null ? col.checkRange[1] : Math.max(1000, lo + 1000);
      return d.includes('INT') ? { gen: 'int', min: lo, max: hi } : { gen: 'float', min: lo, max: hi };
    }
    if (d.includes('INT')) return { gen: 'int', min: 0, max: 1000 };
    if (/NUMERIC|DECIMAL|REAL|FLOAT|DOUBLE/.test(d)) return { gen: 'float', min: 0, max: 10000 };
    if (d.includes('BOOL')) return { gen: 'choice', values: [0, 1] };
    if (/TIMESTAMP|DATETIME/.test(d)) return { gen: 'datetime', start: '2025-01-01 00:00', end: '2026-07-01 00:00' };
    if (d.includes('DATE')) return { gen: 'date', start: '2025-01-01', end: '2026-07-01' };
    return { gen: 'faker', method: 'word' };
  }
  precomputeUniqueCombos(table, colPlans, nRows, tname) {
    const assigns = [], covered = new Set();
    for (const uset of table.uniqueSets) {
      if (uset.some(c => covered.has(c))) continue;
      const pools = []; let ok = true;
      for (const cn of uset) {
        const col = table.columns.find(x => x.name === cn);
        const spec = colPlans[cn] || this.autoSpec(col);
        if (spec.gen === 'fk' && col.fkTable !== tname) pools.push(this.keys[col.fkTable + '.' + col.fkColumn] || []);
        else if (spec.gen === 'choice') pools.push(spec.values);
        else { ok = false; break; }
      }
      if (!ok || pools.some(p => !p.length)) continue;
      const total = pools.reduce((s, p) => s * p.length, 1);
      if (nRows > total) throw new Error(tname + ': UNIQUE(' + uset + ') allows only ' + total + ' combinations but the plan asks for ' + nRows + ' rows — reduce rows or grow the parent tables');
      let idxs;
      if (total > nRows * 4) { const st = new Set(); while (st.size < nRows) st.add(this.rng.randint(0, total - 1)); idxs = [...st]; }
      else {
        idxs = Array.from({ length: total }, (_, i) => i);
        for (let i = total - 1; i > 0; i--) { const j = this.rng.randint(0, i); const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t; }
        idxs = idxs.slice(0, nRows);
      }
      const combos = idxs.map(ix0 => { let ix = ix0; const vals = []; for (const p of pools) { vals.push(p[ix % p.length]); ix = Math.floor(ix / p.length); } return vals; });
      assigns.push({ uset, combos });
      uset.forEach(c => covered.add(c));
    }
    for (const col of table.columns) {
      const spec = colPlans[col.name] || this.autoSpec(col);
      const isU = col.unique || (colPlans[col.name] && colPlans[col.name].unique);
      if (!isU || covered.has(col.name)) continue;
      let pool = null;
      if (spec.gen === 'fk' && col.fkTable !== tname) pool = this.keys[col.fkTable + '.' + col.fkColumn] || [];
      else if (spec.gen === 'choice') pool = spec.values;
      if (!pool || !pool.length) continue;
      if (nRows > pool.length) throw new Error(tname + '.' + col.name + ': UNIQUE allows only ' + pool.length + ' distinct values but the plan asks for ' + nRows + ' rows — reduce rows or grow ' + (col.fkTable || 'the value list'));
      const idxs = Array.from({ length: pool.length }, (_, i) => i);
      for (let i = idxs.length - 1; i > 0; i--) { const j = this.rng.randint(0, i); const t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t; }
      assigns.push({ uset: [col.name], combos: idxs.slice(0, nRows).map(i => [pool[i]]) });
      covered.add(col.name);
    }
    return assigns;
  }
  generateTable(name) {
    const table = this.tables[name];
    const tplan = (this.plan.tables || {})[name] || {};
    const nRows = Math.trunc(tplan.rows != null ? tplan.rows : 100);
    const colPlans = tplan.columns || {};
    const rows = []; const uniq = {};
    const comboAssigns = this.precomputeUniqueCombos(table, colPlans, nRows, name);
    const comboCols = new Set(comboAssigns.flatMap(a => a.uset));
    for (const c of table.columns)
      if (c.unique || (colPlans[c.name] && colPlans[c.name].unique)) uniq[c.name] = new Set();
    for (let seq = 1; seq <= nRows; seq++) {
      const row = {};
      for (const col of table.columns) {
        const spec = colPlans[col.name] || this.autoSpec(col);
        let val = this.value(spec, name, col, seq, row, rows);
        if (uniq[col.name] && !comboCols.has(col.name) && val != null) {
          let tries = 0;
          while (uniq[col.name].has(val) && tries < MAX_RETRIES) { val = this.value(spec, name, col, seq, row, rows); tries++; }
          if (uniq[col.name].has(val)) throw new Error(name + '.' + col.name + ": can't satisfy UNIQUE (pool too small)");
          uniq[col.name].add(val);
        }
        row[col.name] = val;
      }
      for (const a of comboAssigns) a.uset.forEach((cn, j) => { row[cn] = a.combos[seq - 1][j]; });
      for (const uset of table.uniqueSets) {
        const k = 'U::' + uset.join('::');
        uniq[k] = uniq[k] || new Set();
        let key = uset.map(c => row[c]).join('');
        let tries = 0;
        while (uniq[k].has(key) && tries < MAX_RETRIES) {
          for (const cn of uset) {
            const col = table.columns.find(x => x.name === cn);
            const spec = colPlans[cn] || this.autoSpec(col);
            row[cn] = this.value(spec, name, col, seq, row, rows);
          }
          key = uset.map(c => row[c]).join(''); tries++;
        }
        if (uniq[k].has(key)) throw new Error(name + ": can't satisfy UNIQUE(" + uset + ') — reduce rows');
        uniq[k].add(key);
      }
      rows.push(row);
    }
    this.data[name] = rows;
    for (const col of table.columns)
      this.keys[name + '.' + col.name] = rows.map(r => r[col.name]).filter(v => v != null);
  }
  run() { for (const n of topoOrder(this.tables)) this.generateTable(n); return this.data; }
}

/* ---------------- export helpers ---------------- */
function csvString(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

function ddlToSqlite(ddl) {
  return ddl
    .replace(/(BIGINT|INT|INTEGER)\s+GENERATED\s+ALWAYS\s+AS\s+IDENTITY/gi, 'INTEGER')
    .replace(/\bBOOLEAN\b/gi, 'INTEGER')
    .replace(/\bTIMESTAMP\b/gi, 'TEXT')
    .replace(/DEFAULT\s+CURRENT_TIMESTAMP/gi, "DEFAULT (datetime('now'))");
}

module.exports = { parseDDL, topoOrder, makeRng, fakerValue, Engine, csvString, ddlToSqlite };
