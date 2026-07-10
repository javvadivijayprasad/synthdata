// DDL parser: CREATE TABLE statements -> schema model.
// Tolerant regex-based parser covering standard PostgreSQL/MySQL/SQLite DDL:
// columns, types, PK/FK, NOT NULL, UNIQUE (column + table level),
// CHECK (col IN (...)), CHECK (col BETWEEN a AND b).

function splitTopLevel(body) {
  const parts = []; let depth = 0, cur = '', inStr = false;
  for (const ch of body) {
    if (ch === "'" ) inStr = !inStr;
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
  const inMatch = text.match(new RegExp(`${col.name}\\s+IN\\s*\\(([^)]*)\\)`, 'i'));
  if (inMatch) {
    col.checkIn = inMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  }
  const btMatch = text.match(new RegExp(`${col.name}\\s+BETWEEN\\s+(-?[\\d.]+)\\s+AND\\s+(-?[\\d.]+)`, 'i'));
  if (btMatch) { col.checkRange = [parseFloat(btMatch[1]), parseFloat(btMatch[2])]; return; }
  const cmp = text.match(new RegExp(`${col.name}\\s*(>=|>|<=|<)\\s*(-?[\\d.]+)`, 'i'));
  if (cmp) {
    const n = parseFloat(cmp[2]);
    const r = col.checkRange || [null, null];
    if (cmp[1] === '>=') r[0] = n;
    else if (cmp[1] === '>') r[0] = n + 1;
    else if (cmp[1] === '<=') r[1] = n;
    else r[1] = n - 1;
    col.checkRange = r;
  }
}

export function parseDDL(sql) {
  // strip comments
  sql = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const tables = {};
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1];
    // find balanced closing paren
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
        // column definition: name TYPE rest
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
  // default FK column = referenced table's PK
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

export function topoOrder(tables) {
  const order = [], seen = new Set();
  function visit(name, stack) {
    if (seen.has(name) || !tables[name]) return;
    if (stack.includes(name)) return; // cycle guard
    for (const c of tables[name].columns) {
      if (c.fkTable && c.fkTable !== name) visit(c.fkTable, [...stack, name]);
    }
    if (!seen.has(name)) { seen.add(name); order.push(name); }
  }
  for (const name of Object.keys(tables)) visit(name, []);
  return order;
}
