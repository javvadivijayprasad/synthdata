#!/usr/bin/env node
// @vijaypjavvadi/synthdata CLI (TestForge AI)
//   npx @vijaypjavvadi/synthdata plan     -s schema.sql -c case.txt [-p anthropic|openai] [-k KEY] [-m model] [-o plan.yaml]
//   npx @vijaypjavvadi/synthdata generate -s schema.sql -P plan.yaml -o out.db [--csv dir] [--sql out.sql] [--seed 42]
//   npx @vijaypjavvadi/synthdata run      -s schema.sql -c case.txt -o out.db [same flags]   (plan + generate)
import fs from 'node:fs';
import YAML from 'yaml';
import { parseDDL } from '../src/schema.js';
import { Engine } from '../src/engine.js';
import { toCsv, toSqlFile, toSqliteDb, toPostgresSql } from '../src/export.js';
import { authorPlan, detectProvider, resolveKey } from '../src/llm.js';

function parseArgs(argv) {
  const flags = { _: [] };
  const map = { '-s': 'schema', '-c': 'case', '-P': 'plan', '-o': 'out', '-k': 'key',
                '-p': 'provider', '-m': 'model', '--csv': 'csv', '--sql': 'sql', '--pg': 'pg',
                '--seed': 'seed', '--rows': 'rows', '--profile': 'profile',
                '--schema': 'schema', '--case': 'case', '--plan': 'plan',
                '--out': 'out', '--key': 'key', '--provider': 'provider', '--model': 'model' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (map[a]) flags[map[a]] = argv[++i];
    else if (a === '--dry-run') flags.dryRun = true;
    else flags._.push(a);
  }
  return flags;
}

const die = (msg) => { console.error('error: ' + msg); process.exit(1); };

async function cmdPlan(flags) {
  if (!flags.schema || !flags.case) die('plan needs -s schema.sql and -c business_case.txt');
  const ddl = fs.readFileSync(flags.schema, 'utf-8');
  const businessCase = fs.readFileSync(flags.case, 'utf-8');
  if (flags.dryRun) {
    const { SYSTEM_PROMPT } = await import('../src/llm.js');
    console.log('--- system prompt ---\n' + SYSTEM_PROMPT.slice(0, 400) + '...\n--- would send DDL ('
      + ddl.length + ' chars) + case (' + businessCase.length + ' chars) ---');
    return;
  }
  const provider = detectProvider(flags) || die('no API key found: pass -k KEY or set ANTHROPIC_API_KEY / OPENAI_API_KEY');
  const apiKey = resolveKey(provider, flags) || die(`no API key for ${provider}`);
  console.error(`authoring plan with ${provider}${flags.model ? ' (' + flags.model + ')' : ''}...`);
  const yamlText = await authorPlan({ ddl, businessCase, provider, apiKey, model: flags.model });
  YAML.parse(yamlText); // validate before writing
  if (flags.out) { fs.writeFileSync(flags.out, yamlText); console.error(`plan -> ${flags.out}`); }
  else console.log(yamlText);
  return yamlText;
}

async function cmdGenerate(flags, planText = null) {
  if (!flags.schema || (!flags.plan && !planText)) die('generate needs -s schema.sql and -P plan.yaml');
  if (!flags.out && !flags.csv && !flags.sql && !flags.pg)
    die('give an output: -o out.db and/or --csv dir / --sql file / --pg file');
  const profile = flags.profile || 'functional';
  if (profile === 'negative' && flags.out)
    die('negative profile produces intentionally invalid rows — a real .db would reject them; use --csv dir or --sql file');
  const ddl = fs.readFileSync(flags.schema, 'utf-8');
  const plan = YAML.parse(planText ?? fs.readFileSync(flags.plan, 'utf-8'));
  const tables = parseDDL(ddl);
  const seed = flags.seed != null ? +flags.seed : (plan.seed ?? 42);
  const eng = new Engine(tables, plan, seed, profile);
  const data = eng.run();
  const total = Object.values(data).reduce((s, r) => s + r.length, 0);
  if (flags.out) await toSqliteDb(ddl, data, flags.out);
  if (flags.csv) toCsv(data, flags.csv);
  if (flags.sql) toSqlFile(data, flags.sql);
  if (flags.pg) toPostgresSql(ddl, tables, data, flags.pg, seed);
  console.error(`OK: ${Object.keys(data).length} tables, ${total.toLocaleString()} rows (seed=${seed}`
    + (profile !== 'functional' ? `, profile=${profile}` : '') + ')'
    + (flags.out ? ` -> ${flags.out}` : ''));
}

async function cmdAuto(flags) {
  if (!flags.schema) die('auto needs -s schema.sql');
  if (!flags.out && !flags.csv && !flags.sql && !flags.pg)
    die('give an output: -o out.db and/or --csv dir / --sql file / --pg file');
  const ddl = fs.readFileSync(flags.schema, 'utf-8');
  const tables = parseDDL(ddl);
  const rows = flags.rows != null ? +flags.rows : (flags.profile === 'volume' ? 10000 : 100);
  const plan = { tables: Object.fromEntries(Object.keys(tables).map(t => [t, { rows }])) };
  const planText = YAML.stringify(plan);
  console.error(`auto mode: no LLM, schema-driven generation (${rows} rows/table)`);
  await cmdGenerate({ ...flags, plan: null }, planText);
}

const flags = parseArgs(process.argv.slice(2));
const cmd = flags._[0];
try {
  if (cmd === 'plan') await cmdPlan(flags);
  else if (cmd === 'auto') await cmdAuto(flags);
  else if (cmd === 'generate') await cmdGenerate(flags);
  else if (cmd === 'run') {
    const planText = await cmdPlan({ ...flags, out: flags.out ? flags.out.replace(/\.\w+$/, '') + '.plan.yaml' : 'plan.yaml' });
    await cmdGenerate(flags, planText);
  } else {
    console.log(`synthdata (TestForge AI) — schema + business case + LLM key -> synthetic test data

usage:
  synthdata plan     -s schema.sql -c case.txt [-p anthropic|openai] [-k KEY] [-o plan.yaml]
  synthdata generate -s schema.sql -P plan.yaml -o out.db [--csv dir] [--sql file] [--pg file.sql] [--seed 42]
  synthdata auto     -s schema.sql -o out.db [--rows 500]      (no LLM, no plan — instant)
  synthdata run      -s schema.sql -c case.txt -o out.db [-k KEY]

profiles (--profile, default functional):
  functional  realistic happy-path data
  edge        valid boundary data — CHECK endpoints, max-length strings, NULLs, every enum value
  negative    intentionally invalid rows, each tagged with a _violation column (--csv/--sql only)
  volume      performance-scale data (auto defaults to 10,000 rows/table)

keys: -k flag, or env ANTHROPIC_API_KEY / OPENAI_API_KEY
web:  https://synthdata.testforge-ai.com`);
  }
} catch (e) { die(e.message); }
