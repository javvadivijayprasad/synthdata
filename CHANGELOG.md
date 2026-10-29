# Changelog

## 1.3.0 — 2026-10-29

- test: LLM output-shape contract tests (`test/llm-contract.test.mjs`) — offline stubs of the
  Anthropic, OpenAI and Gemini response envelopes assert request shape (URL, auth header,
  body fields; Gemini key kept out of the URL) and that bare / fenced / prose-wrapped / CRLF /
  trailing-comma outputs all normalise to the same plan and yield referentially-intact data for
  all four domain schemas; malformed or non-plan replies and HTTP errors fail loudly. Opt-in
  live checks run with `SYNTHDATA_LIVE_CONTRACT=1` + provider keys (skipped otherwise).
- feat: Gemini provider for `plan`/`auto` (`-p gemini`, `AIza…` keys, `GEMINI_API_KEY`/`GOOGLE_API_KEY`).

- fix: LLM plan authoring handles empty and single-row tables — the system prompt now
  instructs `rows: 0` / `rows: 1` handling and the 1-row-parent UNIQUE limit; an empty or
  whitespace-only business case falls back to sensible defaults (CLI warns) instead of
  sending a blank prompt section; a nullable FK whose parent has `rows: 0` is now NULL
  instead of a dangling placeholder int (NOT NULL keeps the never-abort contract but warns
  explicitly). 7 new tests (99 total).

- feat: MySQL / MariaDB export target — `--mysql file.sql` (works with `generate` and `auto`).
  One loadable script: DDL transpiled (identity -> AUTO_INCREMENT, TIMESTAMP -> DATETIME,
  backtick-quoted identifiers, backslash-safe string escaping), batched INSERTs in FK
  dependency order, FK checks off during load. Inline `REFERENCES` are hoisted to
  table-level `FOREIGN KEY` constraints (MySQL silently ignores the inline form, so
  without this the loaded DB would have no enforced RI). Verified by loading all four
  domain schemas into MariaDB 10.11: 0 load errors, 0 orphan FK rows. 4 new tests (92 total).

- test: golden-file (snapshot) regression tests for the four real-world domain
  schemas shipped in this repo's test corpus (ecommerce, banking, healthcare,
  hr_payroll) — `auto`-mode output at a fixed seed is committed under
  `test/fixtures/golden/` and diffed on every run, catching any unintended change
  to generation output beyond the existing behavioural tests. Schema DDL copied
  into `test/fixtures/schemas/` so the suite is self-contained in CI. 16 new tests
  (88 total, up from 72).

- feat: per-table seed overrides — `--table-seed users=7,orders=99` (repeatable) on the
  CLI, or `seed:` under a table in the plan (CLI wins). Every table now draws from its
  own RNG stream derived from (global seed, table name), so overriding one table re-rolls
  only that table: all other tables stay byte-identical and FKs still resolve. Unknown
  tables / non-integer seeds are rejected upfront. Web engine ported (parity check green).
  Note: because streams are now per-table, output for a given `--seed` differs from
  1.2.x (still fully reproducible run-to-run). 6 new tests (72 total)

## 1.2.3 — 2026-09-11

- feat: date arithmetic in `expr` — `addDays` / `addHours` / `addMinutes` helpers in
  scope (documented in the LLM system prompt: never `row.date_col + n`); the classic
  concat mistake (`"…16:25:00" + 7` → `"…16:25:007"`) is detected on date/timestamp
  columns, repaired as +days, and warned once (Pagila GPT-4o: 443 rejected rows → 0)
- fix: `{gen: fk}` on a single-column PRIMARY KEY samples WITHOUT replacement —
  deterministic distinct assignment from the parent pool (dellstore2
  products/inventory: 187 duplicate PKs → 0); asking for more rows than the parent
  pool has keys fails upfront with a clear message
- 3 new regression tests (66 total)

## 1.2.2 — 2026-09-11

- fix: `varchar(n)`/`char(n)` enforced for ALL generators — plan-driven `template`,
  `faker`, `const`, `expr` outputs are length-checked and truncated with a one-line
  warning (Northwind `state_abbr varchar(2)` with an overflowing template now loads
  51/51); UNIQUE columns at tight widths stay unique via base-36 sequence fallback
- feat: `{gen: fk, ref: parent_table.column}` — explicit FK target for columns whose
  DDL declares no FOREIGN KEY (added to the LLM system prompt)
- fix: `{gen: fk}` with no declared FK never aborts — resolution order: plan `ref` →
  DDL FOREIGN KEY → same-named PK/UNIQUE column in another table (dellstore2, Pagila
  partitioned tables) → warn + int fallback; generation order follows inferred FKs
  so inferred parents generate first
- 5 new regression tests (63 total)

## 1.2.1 — 2026-09-11

- fix: composite PRIMARY KEY with a non-integer member (1.2.0 regression) —
  `sequence` is now integer-PK-only; a timestamp/varchar PK member keeps its own
  type generator, tuple uniqueness enforced separately (Pagila
  `PRIMARY KEY (payment_date, payment_id)` loads 100%)
- fix: table-level `UNIQUE (col)` never aborts on a small fake-value pool —
  single-column sets route through the per-column unique machinery; shared
  deterministic `_seq` suffix fallback (length-capped, never on date/time
  columns, one-line stderr warning) also covers composite all-text sets
- fix: single-column non-integer PK (`char(4)` dept codes) generates unique
  length-safe values instead of integer sequences
- 5 new regression tests (58 total)

## 1.2.0 — 2026-09-11

Real-world schema fixes (found testing against Pagila, Chinook, and MySQL employees):

- fix: `NUMERIC(p,s)` precision respected in auto mode — `numeric(4,2)` now caps at
  99.99 instead of overflowing (Pagila loaded 60%; now 100%). Applies with and
  without CHECK ranges; scale controls rounding.
- fix: composite PRIMARY KEY registered as a uniqueness set — `PRIMARY KEY (a, b)`
  junction tables (Chinook playlist_track) generate zero duplicate keys, including
  under plan-authored fk generators. FK now wins over PK in auto-spec so composite-PK
  FK columns draw from real parent keys; single-column PK+FK (1:1 children) enforced unique.
- fix: UNIQUE text column with a small fake-value pool no longer aborts — deterministic
  `_seq` suffix fallback keeps values unique and within VARCHAR length (employees dept_name).
- 7 new regression tests (test/real-world.test.mjs)
- fix: LLM output parser (`parsePlanOutput` in src/llm.js) tolerates ```yaml / ``` / ```json
  fences (closed, unclosed, or surrounded by prose), CRLF, a bare `yaml` language tag, and
  trailing commas inside flow collections (`{…,}` / `[…,]`) — quoted strings and comments
  untouched; rejects non-plan output with a clear error. 14 new tests (test/llm-parser.test.mjs)
- chore(ci): GitHub Actions matrix — node 18/20/22 × ubuntu/windows/macos (9 jobs),
  bash shell on all runners, portable sha256 reproducibility check (no `cmp` dependency)
- test: 33 unit tests for the referential-integrity resolver (`npm test`, node:test,
  zero new dependencies) — FK target resolution, dependency ordering independent of
  declaration order, 3-table chains, diamond graphs, self-referencing FKs,
  unique/composite-unique FK assignment, CHECK + cross-column CHECK, seed determinism,
  profile integrity, sqlite export FK verification

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
