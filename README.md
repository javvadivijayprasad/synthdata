# @vijaypjavvadi/synthdata

**SynthData (TestForge AI)** — schema + business case + your LLM API key → realistic,
relationally consistent synthetic test data. No production data required.

Part of the TestForge toolchain: [sel2pw](https://www.npmjs.com/package/@vijaypjavvadi/sel2pw) ·
[bdd2pw](https://www.npmjs.com/package/@vijaypjavvadi/bdd2pw) ·
[pw-self-heal](https://www.npmjs.com/package/@vijaypjavvadi/pw-self-heal) ·
[usagecontract](https://www.npmjs.com/package/@vijaypjavvadi/usagecontract) ·
**synthdata**

## CLI

```bash
# author a plan with AI, then generate — one command
npx @vijaypjavvadi/synthdata run -s schema.sql -c business_case.txt -o data.db -k sk-ant-...

# or step by step
npx @vijaypjavvadi/synthdata plan     -s schema.sql -c business_case.txt -o plan.yaml
npx @vijaypjavvadi/synthdata generate -s schema.sql -P plan.yaml -o data.db --csv out/
```

- Providers: **Claude** (`sk-ant-...` / `ANTHROPIC_API_KEY`) and **OpenAI** (`sk-...` /
  `OPENAI_API_KEY`); auto-detected from the key, or force with `-p`, model with `-m`.
- Outputs: SQLite `.db` (verified with `PRAGMA foreign_key_check`), CSV per table
  (`--csv dir`), SQL inserts (`--sql file`), **PostgreSQL load script** (`--pg file.sql`,
  load with `psql -d your_db -f file.sql` — DDL + data in one transaction, identity
  columns handled with `OVERRIDING SYSTEM VALUE` and sequences resumed via `setval`).
- `--seed 42` → byte-identical output every run.
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

MIT © Vijay Prasad Javvadi
