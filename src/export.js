// Exporters: CSV files, SQL insert script, and SQLite .db (via sql.js WASM).
import fs from 'node:fs';
import path from 'node:path';

export function toCsv(data, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [tname, rows] of Object.entries(data)) {
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))];
    fs.writeFileSync(path.join(outDir, `${tname}.csv`), lines.join('\n'), 'utf-8');
  }
}

const sqlVal = (v) => v == null ? 'NULL'
  : typeof v === 'number' ? String(v)
  : "'" + String(v).replace(/'/g, "''") + "'";

export function insertStatements(data) {
  const out = [];
  for (const [tname, rows] of Object.entries(data)) {
    for (const r of rows) {
      out.push(`INSERT INTO ${tname} (${Object.keys(r).join(',')}) VALUES (${Object.values(r).map(sqlVal).join(',')});`);
    }
  }
  return out;
}

export function toSqlFile(data, filePath) {
  fs.writeFileSync(filePath, insertStatements(data).join('\n') + '\n', 'utf-8');
}

// Transpile our supported DDL subset to SQLite-compatible DDL.
export function ddlToSqlite(ddl) {
  return ddl
    .replace(/(BIGINT|INT|INTEGER)\s+GENERATED\s+ALWAYS\s+AS\s+IDENTITY/gi, 'INTEGER')
    .replace(/\bBOOLEAN\b/gi, 'INTEGER')
    .replace(/\bTIMESTAMP\b/gi, 'TEXT')
    .replace(/DEFAULT\s+CURRENT_TIMESTAMP/gi, "DEFAULT (datetime('now'))");
}

export async function toSqliteDb(ddl, data, dbPath) {
  const { default: initSqlJs } = await import('sql.js');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.run(ddlToSqlite(ddl));
  for (const [tname, rows] of Object.entries(data)) {
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    const stmt = db.prepare(`INSERT INTO ${tname} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    db.run('BEGIN');
    for (const r of rows) stmt.run(cols.map(c => r[c] === undefined ? null : r[c]));
    db.run('COMMIT');
    stmt.free();
  }
  const violations = db.exec('PRAGMA foreign_key_check');
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  if (violations.length) throw new Error(`FK check failed: ${violations[0].values.length} violations`);
}
