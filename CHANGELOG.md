# Changelog

## 1.1.0 — 2026-08-15

- **Test-data profiles** (`--profile functional|edge|negative|volume`):
  edge = valid boundary data (CHECK endpoints, max-length strings, NULLs, full enum
  coverage) that loads clean into a real database; negative = intentionally invalid
  rows tagged with the rule each one breaks (CSV/SQL export, INSERTs stay runnable
  with the violation as a SQL comment); volume = 10,000 rows/table default.
  Verified on PostgreSQL 18: edge loads clean, negative rows individually rejected.
- **PostgreSQL export target** (`--pg file.sql`): psql-loadable script — DDL + batched
  INSERTs in FK dependency order, single transaction, `OVERRIDING SYSTEM VALUE` for
  `GENERATED ALWAYS AS IDENTITY`, `TRUE`/`FALSE` for BOOLEAN columns, `setval()` so
  identity sequences resume after the loaded data. Verified against PostgreSQL 18.
- Auto mode respects `CHAR(n)`/`VARCHAR(n)` length limits (real databases enforce them;
  SQLite doesn't — found by loading generated data into PostgreSQL)
- Cross-column CHECK constraints supported: `CHECK (max_salary >= min_salary)` parsed
  from DDL and honored during generation
- Web app: auto mode when the plan box is empty (schema-only generation, 100 rows/table)
- Web app: home page, accounts — register / login / forgot-password, saved dataset
  recipes (schema + plan + seed, regenerated deterministically on download)
- `standalone/` Express backend for the accounts API
- Docs: CONTRIBUTING.md, SUPPORT.md, CODE_OF_CONDUCT.md

## 1.0.0 — 2026-07-10

First public release.

- `plan` — LLM (Claude/OpenAI) writes a generation plan from DDL + a plain-language business case
- `generate` — deterministic engine executes a plan: FK-safe, CHECK-aware, seed-reproducible
- `auto` — no-LLM mode: instant structurally-valid data from schema alone
- `run` — plan + generate in one command
- Engine guarantees validated against AI-authored plans:
  - composite UNIQUE (e.g. `UNIQUE(product_id, warehouse_code)`) filled by deterministic
    combination assignment — supports rows == full pool size
  - single-column `unique: true` over FK/choice assigned deterministically
    (e.g. exactly one payment per order)
  - CHECK constraints parsed from DDL: `IN (...)`, `BETWEEN`, and `>/>=/</<= comparisons
  - self-referencing FKs (manager hierarchies) generated cycle-free
- Outputs: SQLite `.db` (FK-verified), CSV per table, SQL inserts
- `web/index.html` — zero-backend browser app (synthdata.testforge-ai.com)
- `platform-integration/` — drop-in module for the TestForge AI platform
