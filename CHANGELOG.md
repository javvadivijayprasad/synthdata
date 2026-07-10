# Changelog

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
