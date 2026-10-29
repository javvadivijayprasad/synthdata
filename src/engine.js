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

// date helpers — exposed inside {gen: expr} code as addDays/addHours/addMinutes
function shiftDate(s, ms) {
  const str = String(s);
  const hasTime = str.length > 10;
  const d = new Date(str.replace(' ', 'T') + (hasTime ? 'Z' : 'T00:00:00Z'));
  const iso = new Date(d.getTime() + ms).toISOString();
  return hasTime ? iso.slice(0, 19).replace('T', ' ') : iso.slice(0, 10);
}
export const addDays = (s, n) => shiftDate(s, n * 86400000);
export const addHours = (s, n) => shiftDate(s, n * 3600000);
export const addMinutes = (s, n) => shiftDate(s, n * 60000);

const round2 = (v, d) => { const p = Math.pow(10, d ?? 2); return Math.round(v * p) / p; };
const pad = (n, w) => String(n).padStart(w, '0');

function fmtTemplate(tpl, seq) {
  return tpl.replace(/\{seq(?::0(\d+)d)?\}/g, (_, w) => (w ? pad(seq, +w) : String(seq)));
}

export const PROFILES = ['functional', 'edge', 'negative', 'volume'];

export class Engine {
  constructor(tables, plan, seed = 42, profile = 'functional', tableSeeds = {}) {
    this.tables = tables;
    this.plan = plan || {};
    this.seed = seed;
    this.profile = profile;
    this.rng = makeRng(seed);
    // per-table seed overrides: CLI --table-seed beats plan `tables.<t>.seed`
    this.tableSeeds = {};
    for (const [t, tp] of Object.entries(this.plan.tables || {}))
      if (tp && tp.seed != null) this.tableSeeds[t] = +tp.seed;
    for (const [t, v] of Object.entries(tableSeeds || {})) this.tableSeeds[t] = +v;
    for (const [t, v] of Object.entries(this.tableSeeds)) {
      if (!this.tables[t]) throw new Error(`--table-seed: unknown table '${t}'`);
      if (!Number.isInteger(v)) throw new Error(`--table-seed: seed for '${t}' must be an integer`);
    }
    this.data = {};
    this.keys = {};   // "table.column" -> [values]
  }

  value(spec, tname, col, seq, row, partialRows) {
    if (spec.null_prob && this.rng.random() < spec.null_prob) return null;
    const g = spec.gen || 'auto';
    const rng = this.rng;
    switch (g) {
      case 'sequence': return seq;
      case 'faker': {
        let v = fakerValue(spec.method, rng);
        if (spec.max_len != null && typeof v === 'string' && v.length > spec.max_len)
          v = v.slice(0, spec.max_len);
        return v;
      }
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
        const tgt = this.resolveFkTarget(tname, col, spec);
        if (tgt && tgt.table === tname) {      // self-reference (manager_id)
          const pool = partialRows.map(r => r[tgt.column]).filter(v => v != null);
          if (!pool.length || rng.random() < 0.02) return null;   // tree roots
          return rng.choice(pool);
        }
        const pool = tgt ? (this.keys[`${tgt.table}.${tgt.column}`] || []) : [];
        if (!pool.length && tgt && this.data[tgt.table] && this.data[tgt.table].length === 0) {
          // parent was generated with 0 rows (rows: 0): a nullable FK is NULL (no dangling keys).
          // NOT NULL keeps the v1.2.2 never-abort contract below, with a pointed warning.
          if (!col.notNull) return null;
          this.warnOnce(`${tname}.${col.name}`, `warning: ${tname}.${col.name}: NOT NULL foreign key but parent table '${tgt.table}' has 0 rows`
            + ` — generating placeholder ints that match no parent row; give '${tgt.table}' at least 1 row or set rows: 0 for '${tname}'`);
          return rng.randint(1, 1000);
        }
        if (!pool.length) {
          // never abort the whole run: warn and fall back to a plausible int range
          this.warnOnce(`${tname}.${col.name}`, `warning: ${tname}.${col.name}: plan says fk but no FOREIGN KEY is declared and no target could be resolved`
            + (tgt ? ` (parent ${tgt.table}.${tgt.column} generated no keys)` : '')
            + ` — falling back to int; declare {gen: fk, ref: parent_table.column} in the plan for real referential integrity`);
          return rng.randint(1, 1000);
        }
        if (spec.distribution === 'zipf') {
          const idx = Math.min(Math.floor(rng.pareto(1.2)) - 1, pool.length - 1);
          return pool[Math.max(0, idx)];
        }
        return rng.choice(pool);
      }
      case 'expr': {
        const fn = new Function('row', 'rng', 'addDays', 'addHours', 'addMinutes',
          `return (${spec.code});`);
        let v = fn(row, rng, addDays, addHours, addMinutes);
        // repair the classic LLM mistake `row.some_date + 7`: string concatenation
        // yields "2025-03-18 16:25:007" — reinterpret the glued digits as +days
        if (typeof v === 'string' && /DATE|TIME/.test(col.dtype)) {
          const m = /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?)(\d+(?:\.\d+)?)$/.exec(v);
          if (m) {
            this.warnOnce(`expr:${tname}.${col.name}`,
              `warning: ${tname}.${col.name}: expr added a number to a date string (concatenation) — interpreting as +days; use addDays(row.col, n) in the plan instead`);
            v = addDays(m[1], parseFloat(m[2]));
          }
        }
        return v;
      }
      default: throw new Error(`${tname}.${col.name}: unknown generator '${g}'`);
    }
  }

  autoSpec(col) {
    // FK wins over PK: a composite-PK / 1:1-child FK column must draw from the
    // parent's generated keys (uniqueness is enforced separately)
    if (col.fkTable) return { gen: 'fk' };
    // sequence is only valid for integer PKs — a timestamp/varchar member of a
    // composite PK keeps its own type generator (tuple uniqueness handled below)
    if (col.isPk && /INT|SERIAL/.test(col.dtype)) return { gen: 'sequence' };
    // length limit from CHAR(n)/VARCHAR(n) — real databases enforce it
    const lenM = /^(?:VAR)?CHAR(?:ACTER)?\((\d+)/.exec(col.dtype);
    const maxLen = lenM ? +lenM[1] : null;
    if ((col.unique || col.isPk) && !/INT|NUMERIC|DECIMAL|REAL|FLOAT|DATE|TIME/.test(col.dtype)) {
      let format = col.name + '_{seq}';
      if (maxLen != null && maxLen < col.name.length + 7)
        format = maxLen >= 6 ? '{seq:0' + Math.min(maxLen, 6) + 'd}' : '{seq}';
      return { gen: 'template', format };
    }
    if (col.checkIn) return { gen: 'choice', values: col.checkIn };
    const d = col.dtype;
    if (col.checkRange) {
      const lo = col.checkRange[0] ?? 0;
      let hi = col.checkRange[1] ?? Math.max(1000, lo + 1000);
      const nm = /^(?:NUMERIC|DECIMAL)\((\d+)(?:,(\d+))?\)/.exec(d);
      if (nm) {   // cap by physical precision
        const s = +(nm[2] || 0);
        hi = Math.min(hi, Math.pow(10, +nm[1] - s) - Math.pow(10, -s));
        return { gen: 'float', min: lo, max: +hi.toFixed(s), round: s };
      }
      return d.includes('INT') ? { gen: 'int', min: lo, max: hi }
                               : { gen: 'float', min: lo, max: hi };
    }
    if (d.includes('INT')) return { gen: 'int', min: 0, max: 1000 };
    // NUMERIC(p,s): the column physically cannot hold more than 10^(p-s) - 10^-s
    const numM = /^(?:NUMERIC|DECIMAL)\((\d+)(?:,(\d+))?\)/.exec(d);
    if (numM) {
      const p = +numM[1], s = +(numM[2] || 0);
      const cap = Math.pow(10, p - s) - Math.pow(10, -s);
      return { gen: 'float', min: 0, max: +Math.min(10000, cap).toFixed(s), round: s };
    }
    if (/NUMERIC|DECIMAL|REAL|FLOAT|DOUBLE/.test(d)) return { gen: 'float', min: 0, max: 10000 };
    if (d.includes('BOOL')) return { gen: 'choice', values: [0, 1] };
    if (/TIMESTAMP|DATETIME/.test(d)) return { gen: 'datetime', start: '2025-01-01 00:00', end: '2026-07-01 00:00' };
    if (d.includes('DATE')) return { gen: 'date', start: '2025-01-01', end: '2026-07-01' };
    return maxLen != null ? { gen: 'faker', method: 'word', max_len: maxLen }
                          : { gen: 'faker', method: 'word' };
  }

  // ---- edge profile: valid boundary values, cycled deterministically ----
  // Still constraint-clean (loads into a real database) but exercises the
  // extremes: CHECK-range endpoints, every enum value, max-length strings,
  // NULL wherever allowed, date-range endpoints.
  edgeCandidates(col, spec) {
    const cands = [];
    const lenM = /^(?:VAR)?CHAR(?:ACTER)?\((\d+)/.exec(col.dtype);
    const numM = /^(?:NUMERIC|DECIMAL)\((\d+),(\d+)\)/.exec(col.dtype);
    if (col.checkIn) cands.push(...col.checkIn);
    else if (spec.gen === 'choice' && spec.values) cands.push(...spec.values);
    else if (col.checkRange) {
      const lo = col.checkRange[0] ?? 0;
      const hi = col.checkRange[1] ?? Math.max(1000, lo + 1000);
      cands.push(lo, hi, Math.round((lo + hi) / 2));
    } else if (col.dtype.includes('BOOL')) cands.push(0, 1);
    else if (col.dtype.startsWith('SMALLINT')) cands.push(0, 1, 32767);
    else if (col.dtype.includes('INT')) cands.push(0, 1, 2147483647);
    else if (numM) {
      const max = Math.pow(10, +numM[1] - +numM[2]) - Math.pow(10, -numM[2]);
      cands.push(0, +max.toFixed(+numM[2]));
    } else if (/REAL|FLOAT|DOUBLE/.test(col.dtype)) cands.push(0, 0.01, 999999.99);
    else if (/TIMESTAMP|DATETIME/.test(col.dtype))
      cands.push(spec.start ?? '2025-01-01 00:00:00', spec.end ?? '2026-07-01 00:00:00');
    else if (col.dtype.includes('DATE'))
      cands.push(spec.start ?? '2025-01-01', spec.end ?? '2026-07-01');
    else if (lenM) cands.push('A', 'X'.repeat(+lenM[1]));       // min + max length
    else cands.push('A', 'X'.repeat(1000));                      // unbounded TEXT
    if (!col.notNull) cands.push(null);
    return cands;
  }

  // ---- negative profile: corrupt valid rows, one named violation each ----
  corruptData() {
    for (const [tname, rows] of Object.entries(this.data)) {
      const table = this.tables[tname];
      const viols = [];
      for (const c of table.columns) {
        const lenM = /^(?:VAR)?CHAR(?:ACTER)?\((\d+)/.exec(c.dtype);
        if (c.fkTable && c.fkTable !== tname) viols.push({ kind: 'fk_dangling', col: c.name });
        if (c.checkIn) viols.push({ kind: 'check_in', col: c.name });
        if (c.checkRange) viols.push({ kind: 'check_range', col: c.name });
        if (c.notNull && !c.isPk) viols.push({ kind: 'not_null', col: c.name });
        if (lenM) viols.push({ kind: 'too_long', col: c.name, len: +lenM[1] });
      }
      for (const rc of table.rowChecks || []) viols.push({ kind: 'cross_column', rc });
      rows.forEach((row, i) => {
        if (!viols.length) { row._violation = 'none_applicable'; return; }
        const v = viols[i % viols.length];
        if (v.kind === 'fk_dangling') { row[v.col] = 999999999; row._violation = `${v.col}: dangling FK (999999999)`; }
        else if (v.kind === 'check_in') { row[v.col] = 'INVALID'; row._violation = `${v.col}: value not in allowed set`; }
        else if (v.kind === 'check_range') {
          const col = table.columns.find(c => c.name === v.col);
          const [lo, hi] = col.checkRange;
          row[v.col] = hi != null ? hi + 1 : (lo ?? 0) - 1;
          row._violation = `${v.col}: outside CHECK range (${row[v.col]})`;
        }
        else if (v.kind === 'not_null') { row[v.col] = null; row._violation = `${v.col}: NULL in NOT NULL column`; }
        else if (v.kind === 'too_long') { row[v.col] = 'X'.repeat(v.len + 10); row._violation = `${v.col}: exceeds max length ${v.len}`; }
        else if (v.kind === 'cross_column') {
          const { left, op, right } = v.rc;
          if (typeof row[right] === 'number')
            row[left] = op.startsWith('>') ? row[right] - 1 : row[right] + 1;
          row._violation = `violates CHECK (${left} ${op} ${right})`;
        }
      });
    }
  }

  warnOnce(key, msg) {
    this._warned ??= new Set();
    if (this._warned.has(key)) return;
    this._warned.add(key);
    if (typeof console !== 'undefined') console.error(msg);
  }

  // FK target resolution, in priority order:
  //  1. explicit plan target: {gen: fk, ref: parent_table.column}
  //  2. FOREIGN KEY declared in the DDL
  //  3. name inference: a same-named PK/UNIQUE column in another table
  //     (dellstore2, Pagila partitioned tables — FKs often not declared)
  resolveFkTarget(tname, col, spec) {
    if (spec && spec.ref) {
      const [t, c] = String(spec.ref).split('.');
      if (this.tables[t]) {
        const pk = this.tables[t].columns.find(x => x.isPk);
        return { table: t, column: c || (pk ? pk.name : null) };
      }
    }
    if (col.fkTable && (this.tables[col.fkTable] || col.fkTable === tname))
      return { table: col.fkTable, column: col.fkColumn };
    for (const [t, tab] of Object.entries(this.tables)) {
      if (t === tname) continue;
      const c = tab.columns.find(x => x.name === col.name && (x.isPk || x.unique));
      if (c) return { table: t, column: c.name };
    }
    return null;
  }

  // Every string value must fit the column's declared CHAR/VARCHAR length —
  // plan-driven generators (template/faker/const/expr) included.
  enforceLen(tname, col, val) {
    if (typeof val !== 'string') return val;
    const lenM = /^(?:VAR)?CHAR(?:ACTER)?\((\d+)/.exec(col.dtype);
    if (!lenM || val.length <= +lenM[1]) return val;
    this.warnOnce(`len:${tname}.${col.name}`,
      `warning: ${tname}.${col.name}: generated value exceeds ${col.dtype.toLowerCase()} — truncating to ${lenM[1]} chars (adjust the plan generator to fit)`);
    return val.slice(0, +lenM[1]);
  }

  // Deterministic last resort when a UNIQUE text pool is exhausted: append a
  // seq suffix, respecting the column's declared length. Never applied to
  // date/time columns (a suffix would corrupt the value). Warns once per column.
  uniqueTextFallback(tname, col, spec, val, seq) {
    if (typeof val !== 'string' || /DATE|TIME/.test(col.dtype)) return null;
    const lenM = /^(?:VAR)?CHAR(?:ACTER)?\((\d+)/.exec(col.dtype);
    const maxLen = spec.max_len ?? (lenM ? +lenM[1] : null);
    const suffix = '_' + seq;
    let out;
    if (maxLen != null && maxLen < suffix.length + 1) {
      // width too tight for a suffix (varchar(2) etc.): base-36 sequence,
      // unique up to 36^n values
      out = seq.toString(36).padStart(maxLen, '0').slice(-maxLen);
    } else {
      let base = val;
      if (maxLen != null && base.length + suffix.length > maxLen)
        base = base.slice(0, Math.max(1, maxLen - suffix.length));
      out = base + suffix;
    }
    this.warnOnce(`uniq:${tname}.${col.name}`,
      `warning: ${tname}.${col.name}: fake-value pool smaller than requested rows — using deterministic sequence-based values to keep the column unique`);
    return out;
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
        if (spec.gen === 'fk') {
          const tgt = this.resolveFkTarget(tname, col, spec);
          if (!tgt || tgt.table === tname) { ok = false; break; }
          pools.push(this.keys[`${tgt.table}.${tgt.column}`] || []);
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
      const singlePkFk = col.isPk && table.columns.filter(c => c.isPk).length === 1
        && spec.gen !== 'sequence';   // fk-generated PK: sample WITHOUT replacement
      const isUnique = col.unique || (colPlans[col.name] && colPlans[col.name].unique) || singlePkFk;
      if (!isUnique || covered.has(col.name)) continue;
      let pool = null;
      if (spec.gen === 'fk') {
        const tgt = this.resolveFkTarget(tname, col, spec);
        if (tgt && tgt.table !== tname) pool = this.keys[`${tgt.table}.${tgt.column}`] || [];
      }
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

  // Every table draws from its own RNG stream, derived from (global seed, table
  // name) — so a per-table override re-rolls ONLY that table: all other tables
  // stay byte-identical (children still pick FK values from the parent's keys,
  // which for sequence PKs are unchanged).
  tableSeed(name) {
    if (this.tableSeeds[name] != null) return this.tableSeeds[name] >>> 0;
    let h = (0x811c9dc5 ^ (this.seed >>> 0)) >>> 0;        // FNV-1a over the name, keyed by seed
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
    return (h ^ Math.imul(this.seed >>> 0, 0x9e3779b1)) >>> 0;
  }

  generateTable(name) {
    const saved = this.rng;
    this.rng = makeRng(this.tableSeed(name));
    try { return this.generateTableInner(name); }
    finally { this.rng = saved; }
  }

  generateTableInner(name) {
    const table = this.tables[name];
    const tplan = (this.plan.tables || {})[name] || {};
    const nRows = Math.trunc(tplan.rows ?? 100);
    const colPlans = tplan.columns || {};
    const rows = [];
    const uniq = {};
    const comboAssigns = this.precomputeUniqueCombos(table, colPlans, nRows, name);
    const comboCols = new Set(comboAssigns.flatMap(a => a.uset));
    const pkCount = table.columns.filter(c => c.isPk).length;
    for (const c of table.columns) {
      // a single-column PK is implicitly UNIQUE; only the sequence generator is
      // unique by construction — fk/choice/anything else must be deduplicated
      const spec = colPlans[c.name] || this.autoSpec(c);
      const pkNeedsUnique = c.isPk && pkCount === 1 && spec.gen !== 'sequence';
      if (c.unique || (colPlans[c.name] && colPlans[c.name].unique) || pkNeedsUnique)
        uniq[c.name] = new Set();
    }
    const edgeCache = {};
    for (let seq = 1; seq <= nRows; seq++) {
      const row = {};
      for (const col of table.columns) {
        const spec = colPlans[col.name] || this.autoSpec(col);
        let val;
        if (this.profile === 'edge' && !col.isPk && !col.fkTable &&
            !uniq[col.name] && !comboCols.has(col.name)) {
          const cands = edgeCache[col.name] ??= this.edgeCandidates(col, spec);
          val = cands[(seq - 1) % cands.length];
        } else val = this.value(spec, name, col, seq, row, rows);
        val = this.enforceLen(name, col, val);
        if (uniq[col.name] && !comboCols.has(col.name) && val != null) {
          let tries = 0;
          while (uniq[col.name].has(val) && tries < MAX_RETRIES) {
            val = this.enforceLen(name, col, this.value(spec, name, col, seq, row, rows)); tries++;
          }
          if (uniq[col.name].has(val))
            val = this.uniqueTextFallback(name, col, spec, val, seq) ?? val;
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
            row[cn] = this.enforceLen(name, col, this.value(spec, name, col, seq, row, rows));
          }
          key = uset.map(c => row[c]).join(''); tries++;
        }
        if (uniq[k].has(key)) {
          // last resort: suffix a text member of the set to break the tie
          for (const cn of uset) {
            const col = table.columns.find(x => x.name === cn);
            const spec = colPlans[cn] || this.autoSpec(col);
            const fb = this.uniqueTextFallback(name, col, spec, row[cn], seq);
            if (fb != null) { row[cn] = fb; key = uset.map(c => row[c]).join(''); break; }
          }
        }
        if (uniq[k].has(key))
          throw new Error(`${name}: can't satisfy UNIQUE(${uset}) — pool too small for ${nRows} rows`);
        uniq[k].add(key);
      }
      // cross-column CHECK comparisons, e.g. CHECK (max_salary >= min_salary)
      const cmpOk = (a, op, b) => a == null || b == null ? true
        : op === '>=' ? a >= b : op === '>' ? a > b : op === '<=' ? a <= b : a < b;
      for (const rc of table.rowChecks || []) {
        let tries = 0;
        while (!cmpOk(row[rc.left], rc.op, row[rc.right]) && tries < MAX_RETRIES) {
          for (const cn of [rc.left, rc.right]) {
            if (comboCols.has(cn) || uniq[cn]) continue;  // never disturb unique assignments
            const col = table.columns.find(x => x.name === cn);
            row[cn] = this.value(colPlans[cn] || this.autoSpec(col), name, col, seq, row, rows);
          }
          tries++;
        }
        if (!cmpOk(row[rc.left], rc.op, row[rc.right]))
          throw new Error(`${name}: can't satisfy CHECK (${rc.left} ${rc.op} ${rc.right}) — widen the plan ranges for those columns`);
      }
      rows.push(row);
    }
    this.data[name] = rows;
    for (const col of table.columns) {
      this.keys[`${name}.${col.name}`] = rows.map(r => r[col.name]).filter(v => v != null);
    }
  }

  run() {
    if (!PROFILES.includes(this.profile))
      throw new Error(`unknown profile '${this.profile}' — use ${PROFILES.join('|')}`);
    // order by EFFECTIVE FK graph: declared FKs plus plan refs and name-inferred
    // targets, so inferred parents generate before their children
    const pseudo = {};
    for (const [tn, tab] of Object.entries(this.tables)) {
      const colPlans = ((this.plan.tables || {})[tn] || {}).columns || {};
      pseudo[tn] = { columns: tab.columns.map(c => {
        const spec = colPlans[c.name];
        const isFk = spec ? spec.gen === 'fk' : !!c.fkTable;
        const tgt = isFk ? this.resolveFkTarget(tn, c, spec) : null;
        return { fkTable: tgt ? tgt.table : null };
      }) };
    }
    for (const name of topoOrder(pseudo)) this.generateTable(name);
    if (this.profile === 'negative') this.corruptData();
    return this.data;
  }
}
