/**
 * synthdata.service.ts — relational synthetic data generation.
 *
 * Uses the dependency-free engine in ../lib/synthdata-core.cjs (copy the file
 * to src/lib/). Storage strategy: the .db file goes to SYNTHDATA_DIR; the DDL,
 * plan and seed are stored in the row, so any dataset can be regenerated
 * byte-identically even if the file is cleaned up.
 *
 * npm deps to add in the API workspace:  yaml   (better-sqlite3 already present)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import YAML from 'yaml';
import { getDb } from '../db';                       // adjust to your db accessor
// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('../lib/synthdata-core.cjs');

const SYNTHDATA_DIR = process.env.SYNTHDATA_DIR
  ?? path.join(process.cwd(), 'data', 'synthdata');

const SYSTEM_PROMPT = `You are a test-data architect. Given SQL DDL and a business case, you write a generation plan in YAML for the synthdata engine. Output ONLY valid YAML, no prose, no markdown fences.
Generators: sequence, fk (+distribution: zipf), choice (values/weights), int (min/max), float, lognormal (mu/sigma/min/max/round), date (start/end), datetime, template (format with {seq}), const (value), faker (method: name/first_name/last_name/email/phone_number/city/state/street_address/postcode/company/catch_phrase/word/sentence/user_name), expr (code: JS over row).
Any column may add null_prob and unique: true. Respect every CHECK constraint (enumerations via choice with exact values, BETWEEN and comparisons via min/max, cross-column via expr). UNIQUE columns use template with {seq}. Weights must reflect business-case percentages. NOT NULL columns never get null_prob.
Format:
seed: 42
tables:
  <table>:
    rows: <int>
    columns:
      <col>: {gen: ...}`;

export async function authorPlanWithLLM(args: {
  ddl: string; businessCase: string; provider?: string; apiKey?: string; model?: string;
}): Promise<string> {
  const provider = args.provider
    ?? (args.apiKey?.startsWith('sk-ant-') ? 'anthropic'
      : args.apiKey ? 'openai'
      : process.env.ANTHROPIC_API_KEY ? 'anthropic'
      : process.env.OPENAI_API_KEY ? 'openai' : null);
  if (!provider) throw new Error('no LLM key: pass apiKey or configure ANTHROPIC_API_KEY / OPENAI_API_KEY');
  const key = args.apiKey
    ?? (provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
  const userMsg = `SQL DDL:\n\n${args.ddl}\n\nBUSINESS CASE:\n\n${args.businessCase}\n\nWrite the generation plan YAML.`;

  let text: string;
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: args.model ?? 'claude-sonnet-5', max_tokens: 8000,
        system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMsg }] }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const j: any = await res.json();
    text = j.content.map((b: any) => b.text ?? '').join('');
  } else {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: args.model ?? 'gpt-4o',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMsg }] }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    const j: any = await res.json();
    text = j.choices[0].message.content;
  }
  const fence = text.match(/```(?:yaml)?\s*([\s\S]*?)```/);
  const yaml = (fence ? fence[1] : text).trim();
  YAML.parse(yaml); // validate before returning
  return yaml;
}

export async function generateDataset(uid: string, args: {
  name?: string; ddl: string; planYaml?: string; businessCase?: string; seed?: number; rows?: number;
}) {
  const tables = core.parseDDL(args.ddl);
  const tableNames = Object.keys(tables);
  if (!tableNames.length) throw new Error('no CREATE TABLE statements found in ddl');

  let planYaml = args.planYaml;
  let mode: 'auto' | 'ai' | 'manual' = planYaml ? 'manual' : 'auto';
  if (!planYaml) {
    const rows = args.rows ?? 100;
    planYaml = YAML.stringify({ tables: Object.fromEntries(tableNames.map(t => [t, { rows }])) });
  }
  const plan = YAML.parse(planYaml);
  const seed = args.seed ?? plan.seed ?? 42;

  const engine = new core.Engine(tables, plan, seed);
  const data: Record<string, any[]> = engine.run();
  const rowsCount = Object.values(data).reduce((s, r) => s + r.length, 0);

  // write .db with better-sqlite3 and verify FKs
  fs.mkdirSync(SYNTHDATA_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const filePath = path.join(SYNTHDATA_DIR, `${id}.db`);
  const out = new Database(filePath);
  out.pragma('foreign_keys = ON');
  out.exec(core.ddlToSqlite(args.ddl));
  const insertAll = out.transaction(() => {
    for (const [tname, rows] of Object.entries(data)) {
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const stmt = out.prepare(`INSERT INTO ${tname} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of rows) stmt.run(cols.map(c => r[c] ?? null));
    }
  });
  insertAll();
  const violations = out.pragma('foreign_key_check') as unknown[];
  out.close();
  if (violations.length) { fs.unlinkSync(filePath); throw new Error(`FK check failed: ${violations.length} violations`); }

  getDb().prepare(`
    INSERT INTO synthdata_datasets
      (id, user_id, name, ddl, business_case, plan_yaml, seed, mode, tables_count, rows_count, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, uid, args.name ?? `dataset-${id.slice(0, 8)}`, args.ddl, args.businessCase ?? null,
        planYaml, seed, mode, tableNames.length, rowsCount, filePath);

  return { id, name: args.name ?? `dataset-${id.slice(0, 8)}`, seed, mode,
           tables: tableNames.length, rows: rowsCount,
           preview: Object.fromEntries(Object.entries(data).map(([t, r]) => [t, r.slice(0, 5)])) };
}

export function listDatasets(uid: string) {
  return getDb().prepare(`
    SELECT id, name, mode, seed, tables_count, rows_count, status, created_at
    FROM synthdata_datasets WHERE user_id = ? ORDER BY created_at DESC`).all(uid);
}

export function getDataset(uid: string, id: string) {
  return getDb().prepare(`
    SELECT id, name, ddl, business_case, plan_yaml, seed, mode, tables_count, rows_count, status, created_at
    FROM synthdata_datasets WHERE user_id = ? AND id = ?`).get(uid, id);
}

export function datasetFile(uid: string, id: string, format: string) {
  const row: any = getDb().prepare(
    `SELECT * FROM synthdata_datasets WHERE user_id = ? AND id = ?`).get(uid, id);
  if (!row) return null;

  if (format === 'db') {
    // regenerate if the file was cleaned up (ddl+plan+seed are stored)
    if (!fs.existsSync(row.file_path)) throw new Error('file expired — regenerate the dataset');
    return { filename: `${row.name}.db`, buffer: fs.readFileSync(row.file_path) };
  }
  // csv / sql are derived on the fly from a deterministic re-run
  const tables = core.parseDDL(row.ddl);
  const data = new core.Engine(tables, YAML.parse(row.plan_yaml), row.seed).run() as Record<string, any[]>;
  if (format === 'csv') {
    const parts = Object.entries(data).map(([t, r]) => `-- ${t}.csv\n` + core.csvString(r));
    return { filename: `${row.name}.csv.txt`, buffer: Buffer.from(parts.join('\n\n')) };
  }
  if (format === 'sql') {
    const out: string[] = [];
    for (const [t, rows] of Object.entries(data))
      for (const r of rows) {
        const vals = Object.values(r).map(v => v == null ? 'NULL'
          : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
        out.push(`INSERT INTO ${t} (${Object.keys(r).join(',')}) VALUES (${vals.join(',')});`);
      }
    return { filename: `${row.name}.sql`, buffer: Buffer.from(out.join('\n')) };
  }
  throw new Error(`unknown format '${format}'`);
}

export function deleteDataset(uid: string, id: string) {
  const row: any = getDb().prepare(
    `SELECT file_path FROM synthdata_datasets WHERE user_id = ? AND id = ?`).get(uid, id);
  if (row?.file_path && fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path);
  getDb().prepare(`DELETE FROM synthdata_datasets WHERE user_id = ? AND id = ?`).run(uid, id);
}
