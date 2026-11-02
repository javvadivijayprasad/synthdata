# @vijaypjavvadi/synthdata

[![npm](https://img.shields.io/npm/v/@vijaypjavvadi/synthdata)](https://www.npmjs.com/package/@vijaypjavvadi/synthdata)
[![CI](https://github.com/javvadivijayprasad/synthdata/actions/workflows/ci.yml/badge.svg)](https://github.com/javvadivijayprasad/synthdata/actions)
[![good first issues](https://img.shields.io/github/issues/javvadivijayprasad/synthdata/good%20first%20issue?color=7057ff&label=good%20first%20issues)](https://github.com/javvadivijayprasad/synthdata/labels/good%20first%20issue)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

**SynthData (TestForge AI)** — schema + business case + your LLM API key → realistic,
relationally consistent synthetic test data. No production data required.

**What it is:** a deterministic test-data generator driven by your `CREATE TABLE`
DDL — every foreign key resolves, CHECK/UNIQUE/length constraints hold, same seed
reproduces byte-identical data. An LLM (optional, bring your own key) writes the
generation plan from a plain-English business case; without a key, `auto` mode
generates structurally valid data from the schema alone.
**What it isn't:** an ML model trained on your production data — no real data is
ever needed or accepted.

Part of the TestForge toolchain: [sel2pw](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw) ·
[bdd2pw](https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw) ·
[pw-self-heal](https://www.npmjs.com/package/@vijaypjavvadi/pw-self-heal) ·
[usagecontract](https://www.npmjs.com/package/@vijaypjavvadi/usagecontract) ·
**synthdata**

## Quick start

Prerequisite: Node.js 18+ (`node --version`).

```bash
# no LLM, no key, no config — structurally valid data from your schema alone
npx @vijaypjavvadi/synthdata auto -s schema.sql -o data.db --rows 500

# author a plan with AI, then generate — one command (your key, Claude or OpenAI)
npx @vijaypjavvadi/synthdata run -s schema.sql -c business_case.txt -o data.db -k sk-ant-...

# or step by step
npx @vijaypjavvadi/synthdata plan     -s schema.sql -c business_case.txt -o plan.yaml
npx @vijaypjavvadi/synthdata generate -s schema.sql -P plan.yaml -o data.db --csv out/
```

**What to do with the output:** open the `.db` in
[DB Browser for SQLite](https://sqlitebrowser.org/) (Browse Data tab) or query it with
`sqlite3 data.db "SELECT ..."`; load `--pg` output with `psql -d db -f file.sql`;
load `--mysql` output with `mysql db < file.sql`; point your test suite at the CSVs.

## Try it on the bundled sample

```bash
git clone https://github.com/javvadivijayprasad/synthdata.git
cd synthdata
node bin/cli.js auto -s examples/schema_ecommerce.sql -o demo.db --rows 200 --seed 42
# -> OK: 10 tables, 2,000 rows (seed=42) -> demo.db   (zero FK violations, verified on write)
```

With an API key, the same schema plus `examples/ecommerce_business_case.txt` produces
business-realistic distributions (customer tiers, payment-method mix, zipf-skewed heavy
buyers) — compare `examples/ecommerce_plan.yaml` to see what the AI authors.

- Providers: **Claude** (`sk-ant-...` / `ANTHROPIC_API_KEY`) and **OpenAI** (`sk-...` /
  `OPENAI_API_KEY`); auto-detected from the key, or force with `-p`, model with `-m`.
- Outputs: SQLite `.db` (verified with `PRAGMA foreign_key_check`), CSV per table
  (`--csv dir`), SQL inserts (`--sql file`), **PostgreSQL load script** (`--pg file.sql`,
  load with `psql -d your_db -f file.sql` — DDL + data in one transaction, identity
  columns handled with `OVERRIDING SYSTEM VALUE` and sequences resumed via `setval`).
  **MySQL / MariaDB load script** (`--mysql file.sql`, load with `mysql your_db < file.sql` —
  identity → `AUTO_INCREMENT`, inline FKs hoisted to real `FOREIGN KEY` constraints).
- `--seed 42` → byte-identical output every run. `--table-seed products=7,orders=99`
  (or `seed:` under a table in the plan) re-rolls **only** those tables — every other
  table stays byte-identical, foreign keys still resolve.
- `--profile functional|edge|negative|volume` — the four kinds of test data teams need:
  **functional** realistic happy-path data (default) · **edge** valid boundary data
  (CHECK-range endpoints, max-length strings, NULLs where allowed, every enum value —
  still loads clean into a real database) · **negative** intentionally invalid rows for
  testing your validation, each tagged with a `_violation` column / SQL comment
  (`--csv`/`--sql` only) · **volume** performance-scale data (10,000 rows/table default).
- Node 18+, two small dependencies (`sql.js`, `yaml`).

## Web app — [synthdata.testforge-ai.com](https://synthdata.testforge-ai.com)

`web/index.html` is the entire application — one static file, no backend. Paste DDL +
business case + API key; the AI call goes **directly from the browser to the provider**,
data is generated **in the browser** (sql.js WASM), previewed, and downloaded as
`.db` + CSVs. Schema, key, and data never touch the server. Deployment: see `deploy/DEPLOY.md`.

## How it works: LLM plans, engine executes

Asking an LLM to emit data rows breaks referential integrity at volume. SynthData splits
the job: the LLM reads your DDL + business case **once** and writes a small reviewable
YAML *generation plan*. A deterministic engine executes it: FK-dependency ordering,
guaranteed-valid foreign keys (including self-references like `manager_id`),
unique-constraint retries (single + composite), CHECK-constraint awareness (enumerations
and BETWEEN parsed from the DDL), and full seed reproducibility.

## Plan format

```yaml
seed: 42
tables:
  customers:
    rows: 2000
    seed: 7            # optional per-table seed (CLI --table-seed customers=7 overrides it)
    columns:
      customer_id:  {gen: sequence}
      email:        {gen: template, format: "user{seq}@example.com", unique: true}
      customer_tier: {gen: choice, values: [STANDARD, SILVER, GOLD, PREMIUM], weights: [70, 15, 10, 5]}
  orders:
    rows: 8000
    columns:
      customer_id:  {gen: fk, distribution: zipf}   # heavy buyers
      order_total:  {gen: lognormal, mu: 7.6, sigma: 0.9, round: 2, min: 99}
```

Generators: `sequence`, `fk` (+`zipf`), `choice`, `int`, `float`, `lognormal`, `date`,
`datetime`, `template`, `const`, `faker`, `expr` (JS over the row — cross-column rules).
Plus `null_prob` / `unique` on any column. Unplanned columns get schema-driven defaults.

## Layout

```
bin/cli.js       CLI (plan / generate / run)
src/schema.js    DDL parser (tables, FKs, CHECK IN/BETWEEN, composite UNIQUE)
src/engine.js    seeded deterministic engine
src/fakelite.js  dependency-free fake values (Node + browser identical)
src/llm.js       Claude/OpenAI plan authoring + system prompt
src/export.js    SQLite (sql.js) / CSV / SQL inserts / PostgreSQL script
web/index.html   the whole web app (static, single file)
deploy/          nginx config + steps for synthdata.testforge-ai.com
```

## Known limitations

- The DDL parser is regex-based: standard PostgreSQL/MySQL/SQLite DDL parses well;
  exotic dialect features (partitioning clauses, expression indexes) are ignored.
- `expr` runs JavaScript from the plan — review plans from untrusted sources
  (see [SECURITY.md](SECURITY.md)).
- Open issues are tracked with honest labels:
  [good first issues](https://github.com/javvadivijayprasad/synthdata/labels/good%20first%20issue) ·
  [all issues](https://github.com/javvadivijayprasad/synthdata/issues).

## Contributing

New contributors are very welcome — setup takes about five minutes:

```bash
git clone https://github.com/javvadivijayprasad/synthdata.git
cd synthdata && npm install
npm test                    # 60+ unit tests, node:test, no extra tooling
node bin/cli.js auto -s examples/schema_ecommerce.sql -o check.db --rows 100
```

Start with a [good first issue](https://github.com/javvadivijayprasad/synthdata/labels/good%20first%20issue)
and see [CONTRIBUTING.md](CONTRIBUTING.md) for the ground rules (zero runtime
dependencies beyond `sql.js` + `yaml`; determinism is a contract).

## Contributors

- [@Toufiqul-27](https://github.com/Toufiqul-27) — wired the web-engine parity check
  into CI (#6) and brought the MySQL script download to the web app, matching the CLI
  exporter line-for-line (#7)

[![Contributors](https://contrib.rocks/image?repo=javvadivijayprasad/synthdata)](https://github.com/javvadivijayprasad/synthdata/graphs/contributors)

Your name could be next — pick a
[good first issue](https://github.com/javvadivijayprasad/synthdata/labels/good%20first%20issue).

MIT © Vijay Prasad Javvadi
