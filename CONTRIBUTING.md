# Contributing to synthdata

Thanks for your interest in improving synthdata! Contributions of all kinds are
welcome — bug reports, documentation fixes, new generators, export targets, and
test schemas.

## Ground rules

- **Zero runtime dependencies beyond `sql.js` and `yaml`.** This is a deliberate
  design constraint — the same engine must run unchanged in Node and in the
  browser. PRs that add runtime dependencies need a strong justification.
- **Determinism is a contract.** The same schema + plan + seed must produce
  byte-identical output, forever. Any change that alters the RNG call sequence
  for existing plans is a breaking change and must be flagged in the PR.
- **The LLM never generates rows.** It writes a reviewable YAML plan once; the
  deterministic engine does everything else. Keep that boundary intact.

## Getting started

```bash
git clone https://github.com/javvadivijayprasad/synthdata.git
cd synthdata
npm install          # installs sql.js + yaml only
node bin/cli.js auto -s examples/schema_ecommerce.sql -o /tmp/demo.db --rows 100
```

Requires Node 18+.

## Project layout

| Path | Purpose |
|---|---|
| `bin/cli.js` | CLI entry — `plan`, `generate`, `auto`, `run` |
| `src/schema.js` | DDL parser (PK/FK/NOT NULL/UNIQUE/CHECK) + topological table ordering |
| `src/engine.js` | Deterministic generation engine (seeded mulberry32 RNG) |
| `src/fakelite.js` | Dependency-free fake values |
| `src/llm.js` | Plan authoring via Claude / OpenAI (optional — bring your own key) |
| `src/export.js` | SQLite (.db via sql.js), CSV, SQL-insert exports |
| `web/index.html` | Single-file browser app (synthdata.testforge-ai.com) |
| `standalone/` | Optional Express backend (accounts + saved dataset recipes) |
| `examples/` | Sample schema, plan, and business case |

## Before you open a PR

1. **Syntax check** every changed file: `node --check src/engine.js` (etc.)
2. **Smoke test**: `node bin/cli.js auto -s examples/schema_ecommerce.sql -o /tmp/t.db --rows 100`
   must finish with `FK violations: 0`.
3. **Reproducibility**: run the same command twice with the same `--seed`; the
   two output files must have identical hashes.
4. Code style: ESM (`import`/`export`), 2-space indent, no semicolon-free style,
   match the surrounding code.

CI (`.github/workflows/ci.yml`) runs the same checks on Node 18/20/22.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `test:`, `chore:` — e.g.
`feat: add PostgreSQL export target`.

## Reporting bugs

Open a [GitHub issue](https://github.com/javvadivijayprasad/synthdata/issues) with:

- the schema (or a minimal version that reproduces the problem)
- the plan YAML (if any) and the seed
- the exact command and full error output

Because generation is deterministic, a schema + plan + seed is a complete,
perfectly reproducible bug report — please include all three.

## Proposing features

Open an issue first for anything larger than a small fix so we can agree on the
approach. The [public roadmap](https://github.com/javvadivijayprasad/synthdata/issues)
is tracked through issues and release milestones (v1.1.0, v1.2.0, v1.3.0).

## License

By contributing you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
