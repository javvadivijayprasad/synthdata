// Deterministic generation engine (JS port of synthkit).
// Executes a plan against a parsed schema with guaranteed referential
// integrity, uniqueness, and seed reproducibility.
import { topoOrder } from './schema.js';
import { fakerValue } from './fakelite.js';

const MAX_RETRIES = 50;

// ---- seeded RNG (mulberry32) ----
export function makeRng(seed) {
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
    choices: (arr, weights) => {
      if (!weights) return rng.choice(arr);
      const total = weights.reduce((s, w) => s + w, 0);
      let r = next() * total;
      for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
      return arr[arr.length - 1];
    },
    gauss: () => {
      const u = Math.max(next(), 1e-12), v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    lognormal: (mu, sigma) => Math.exp(mu + sigma * rng.gauss()),
    pareto: (alpha) => 1 / Math.pow(1 - next(), 1 / alpha),
  };
  return rng;
}

const round2 = (v, d) => { const p = Math.pow(10, d ?? 2); return Math.round(v * p) / p; };
const pad = (n, w) => String(n).padStart(w, '0');

function fmtTemplate(tpl, seq) {
  return tpl.replace(/\{seq(?::0(\d+)d)?\}/g, (_, w) => (w ? pad(seq, +w) : String(seq)));
}

export class Engine {
  constructor(tables, plan, seed = 42) {
    this.tables = tables;
    this.plan = plan || {};
    this.seed = seed;
    this.rng = makeRng(seed);
    this.data = {};
    this.keys = {};   // "table.column" -> [values]
  }

  value(spec, tname, col, seq, row, partialRows) {
    if (spec.null_prob && this.rng.random() < spec.null_prob) return null;
    const g = spec.gen || 'auto';
    const rng = this.rng;
    switch (g) {
      case 'sequence': return seq;
      case 'faker': return fakerValue(spec.method, rng);
      case 'choice': return rng.choices(spec.values, spec.weights);
      case 'int': return rng.randint(Math.trunc(spec.min ?? 0), Math.trunc(spec.max ?? 100));
      case 'float': return round2(rng.uniform(+(spec.min ?? 0), +(spec.max ?? 100)), spec.round);
      case 'lognormal': {
        let v = rng.lognormal(spec.mu ?? 6.5, spec.sigma ?? 1.0);
        if (spec.max != null) v = Math.min(v, spec.max);
        if (spec.min != null) v = Math.max(v, spec.min);
        return round2(v, spec.round);
      }
      case 'date': {
        const s = new Date(String(spec.start ?? '2024-01-01') + 'T00:00:00Z');
        const e = new Date(String(spec.end ?? '2026-01-01') + 'T00:00:00Z');
        const d = new Date(s.getTime() + rng.randint(0, Math.floor((e - s) / 86400000)) * 86400000);
        return d.toISOString().slice(0, 10);
      }
      case 'datetime': {
        const s = new Date(String(spec.start ?? '2024-01-01 00:00').replace(' ', 'T') + ':00Z');
        const e = new Date(String(spec.end ?? '2026-01-01 00:00').replace(' ', 'T') + ':00Z');
        const d = new Date(s.getTime() + rng.randint(0, Math.floor((e - s) / 1000)) * 1000);
        return d.toISOString().slice(0, 19).replace('T', ' ');
      }
      case 'template': return fmtTemplate(spec.format, seq);
      case 'const': return spec.value ?? null;
      case 'fk': {
        if (col.fkTable === tname) {           // self-reference (manager_id)
          const pool = partialRows.map(r => r[col.fkColumn]).filter(v => v != null);
          if (!pool.length || rng.random() < 0.02) return null;   // tree roots
          return rng.choice(pool);
        }
        const pool = this.keys[`${col.fkTable}.${col.fkColumn}`] || [];
        if (!pool.length) throw new Error(`${tname}.${col.name}: no parent keys for ${col.fkTable}.${col.fkColumn}`);
        if (spec.distribution === 'zipf') {
          const idx = Math.min(Math.floor(rng.pareto(1.2)) - 1, pool.length - 1);
          return pool[Math.max(0, idx)];
        }
        return rng.choice(pool);
      }
      case 'expr': {
        const fn = new Function('row', 'rng', `return (${spec.code});`);
        return fn(row, rng);
      }
      default: throw new Error(`${tname}.${col.name}: unknown generator '${g}'`);
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
      const lo = col.checkRange[0] ?? 0;
      const hi = col.checkRange[1] ?? Math.max(1000, lo + 1000);
      return d.includes('INT') ? { gen: 'int', min: lo, max: hi }
                               : { gen: 'float', min: lo, max: hi };
    }
    if (d.includes('INT')) return { gen: 'int', min: 0, max: 1000 };
    if (/NUMERIC|DECIMAL|REAL|FLOAT|DOUBLE/.test(d)) return { gen: 'float', min: 0, max: 10000 };
    if (d.includes('BOOL')) return { gen: 'choice', values: [0, 1] };
    if (/TIMESTAMP|DATETIME/.test(d)) return { gen: 'datetime', start: '2025-01-01 00:00', end: '2026-07-01 00:00' };
    if (d.includes('DATE')) return { gen: 'date', start: '2025-01-01', end: '2026-07-01' };
    return { gen: 'faker', method: 'word' };
  }

  // For composite UNIQUE sets whose columns are all fk/choice (finite pools),
  // assign distinct combinations deterministically — supports rows == pool size.
  precomputeUniqueCombos(table, colPlans, nRows, tname) {
    const assigns = [], covered = new Set();
    for (const uset of table.uniqueSets) {
      if (uset.some(c => covered.has(c))) continue;
      const pools = [];
      let ok = true;
      for (const cn of uset) {
        const col = table.columns.find(x => x.name === cn);
        const spec = colPlans[cn] || this.autoSpec(col);
        if (spec.gen === 'fk' && col.fkTable !== tname) {
          pools.push(this.keys[`${col.fkTable}.${col.fkColumn}`] || []);
        } else if (spec.gen === 'choice') {
          pools.push(spec.values);
        } else { ok = false; break; }
      }
      if (!ok || pools.some(p => !p.length)) continue;
      const total = pools.reduce((s, p) => s * p.length, 1);
      if (nRows > total)
        throw new Error(`${tname}: UNIQUE(${uset}) allows only ${total} combinations but the plan asks for ${nRows} rows — reduce rows or grow the parent tables`);
      let idxs;
      if (total > nRows * 4) {
        const set = new Set();
        while (set.size < nRows) set.add(this.rng.randint(0, total - 1));
        idxs = [...set];
      } else {
        idxs = Array.from({ length: total }, (_, i) => i);
        for (let i = total - 1; i > 0; i--) {
          const j = this.rng.randint(0, i);
          [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
        }
        idxs = idxs.slice(0, nRows);
      }
      const combos = idxs.map(ix0 => {
        let ix = ix0; const vals = [];
        for (const p of pools) { vals.push(p[ix % p.length]); ix = Math.floor(ix / p.length); }
        return vals;
      });
      assigns.push({ uset, combos });
      uset.forEach(c => covered.add(c));
    }
    // single-column UNIQUE over fk/choice: assign distinct values deterministically
    for (const col of table.columns) {
      const spec = colPlans[col.name] || this.autoSpec(col);
      const isUnique = col.unique || (colPlans[col.name] && colPlans[col.name].unique);
      if (!isUnique || covered.has(col.name)) continue;
      let pool = null;
      if (spec.gen === 'fk' && col.fkTable !== tname) pool = this.keys[`${col.fkTable}.${col.fkColumn}`] || [];
      else if (spec.gen === 'choice') pool = spec.values;
      if (!pool || !pool.length) continue;
      if (nRows > pool.length)
        throw new Error(`${tname}.${col.name}: UNIQUE allows only ${pool.length} distinct values but the plan asks for ${nRows} rows — reduce rows or grow ${col.fkTable ?? 'the value list'}`);
      const idxs = Array.from({ length: pool.length }, (_, i) => i);
      for (let i = idxs.length - 1; i > 0; i--) {
        const j = this.rng.randint(0, i);
        [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
      }
      assigns.push({ uset: [col.name], combos: idxs.slice(0, nRows).map(i => [pool[i]]) });
      covered.add(col.name);
    }
    return assigns;
  }

  generateTable(name) {
    const table = this.tables[name];
    const tplan = (this.plan.tables || {})[name] || {};
    const nRows = Math.trunc(tplan.rows ?? 100);
    const colPlans = tplan.columns || {};
    const rows = [];
    const uniq = {};
    const comboAssigns = this.precomputeUniqueCombos(table, colPlans, nRows, name);
    const comboCols = new Set(comboAssigns.flatMap(a => a.uset));
    for (const c of table.columns) {
      if (c.unique || (colPlans[c.name] && colPlans[c.name].unique)) uniq[c.name] = new Set();
    }
    for (let seq = 1; seq <= nRows; seq++) {
      const row = {};
      for (const col of table.columns) {
        const spec = colPlans[col.name] || this.autoSpec(col);
        let val = this.value(spec, name, col, seq, row, rows);
        if (uniq[col.name] && !comboCols.has(col.name) && val != null) {
          let tries = 0;
          while (uniq[col.name].has(val) && tries < MAX_RETRIES) {
            val = this.value(spec, name, col, seq, row, rows); tries++;
          }
          if (uniq[col.name].has(val))
            throw new Error(`${name}.${col.name}: can't satisfy UNIQUE (pool too small for ${nRows} rows)`);
          uniq[col.name].add(val);
        }
        row[col.name] = val;
      }
      for (const a of comboAssigns)
        a.uset.forEach((cn, j) => { row[cn] = a.combos[seq - 1][j]; });
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
        if (uniq[k].has(key))
          throw new Error(`${name}: can't satisfy UNIQUE(${uset}) — pool too small for ${nRows} rows`);
        uniq[k].add(key);
      }
      rows.push(row);
    }
    this.data[name] = rows;
    for (const col of table.columns) {
      this.keys[`${name}.${col.name}`] = rows.map(r => r[col.name]).filter(v => v != null);
    }
  }

  run() {
    for (const name of topoOrder(this.tables)) this.generateTable(name);
    return this.data;
  }
}
