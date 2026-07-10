# INTEGRATION NOTES — synthdata (relational synthetic data)

Adds multi-table, FK-safe synthetic data to the platform, complementing the existing
single-table `data-gen` module. Per-user datasets, JWT-authed, LLM optional.

## What goes where (framework-generator-api)

| File in this folder        | Destination                                   |
|----------------------------|-----------------------------------------------|
| `synthdata-core.cjs`       | `src/lib/synthdata-core.cjs` (verbatim)       |
| `synthdata.service.ts`     | `src/services/synthdata.service.ts`           |
| `synthdata.controller.ts`  | `src/controllers/synthdata.controller.ts`     |
| `synthdata.routes.ts`      | `src/routes/synthdata.routes.ts`              |
| `synthdata-migrations.ts`  | `src/db/migrations/synthdata-migrations.ts`   |
| `page.tsx`                 | `apps/platform-ui/src/app/synthdata/page.tsx` |

## Wiring (4 edits)

1. `src/app.ts`:
   ```ts
   import synthdataRoutes from './routes/synthdata.routes';
   app.use('/api/v1/synthdata', synthdataRoutes);
   ```
2. Migration runner (wherever data-gen-migrations is registered):
   ```ts
   import { runSynthdataMigrations } from './migrations/synthdata-migrations';
   runSynthdataMigrations(db);
   ```
3. API workspace dep: `npm --workspace apps/framework-generator-api i yaml`
4. `synthdata.service.ts` line `import { getDb } from '../db'` — adjust to your actual
   db accessor (same one data-gen's repository uses).

Also check: `tsconfig.json` needs `"allowJs": true` OR keep the core as `.cjs` +
`require()` (as written) which bypasses tsc entirely — no config change needed.

## Env

- `SYNTHDATA_DIR` (optional) — where generated `.db` files land.
  Default: `<cwd>/data/synthdata`. Add to your GH Actions `.env` writer if you set it.
- LLM server keys (optional): `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — used by
  `POST /plan` when the request doesn't carry a BYOK key. If you already have BYOK
  per-user keys, pass them through as `apiKey` in the request body — the service
  accepts either.

## API surface (all JWT-authed)

```
POST   /api/v1/synthdata/plan       { ddl, businessCase, apiKey?, provider?, model? } -> { planYaml }
POST   /api/v1/synthdata            { name?, ddl, planYaml?, businessCase?, seed?, rows? } -> dataset + preview
GET    /api/v1/synthdata            -> { datasets: [...] }   (per-user)
GET    /api/v1/synthdata/:id        -> full row incl. plan_yaml
GET    /api/v1/synthdata/:id/file?format=db|csv|sql
DELETE /api/v1/synthdata/:id
```

Design choice worth knowing: the row stores `ddl + plan_yaml + seed`, so any dataset
can be regenerated **byte-identically** even if its `.db` file is cleaned up — csv/sql
downloads are derived by deterministic re-run, not stored.

## UI

`page.tsx` (route `/synthdata`) has three sections: hero with a how-it-works flow
diagram + distribution chart (pure SVG, no new deps), a create form (Auto mode =
schema-only/no LLM; AI mode = business case -> plan via `/plan`), and the per-user
dataset history with .db/.sql downloads. It imports `AppShell`, `Header`,
`apiFetch`, `getApiBase` from your existing lib — adjust names if they differ.

Add a sidebar/nav entry pointing to `/synthdata` (e.g. next to Data Gen).

## Relationship to the standalone pieces

- npm `@vijaypjavvadi/synthdata` — same engine, CLI form (`auto` command = no-LLM mode).
- `web/index.html` — the zero-backend variant for synthdata.testforge-ai.com; can stay
  as a public demo/lead-gen page that links to the platform for accounts + persistence.

## Smoke test

```bash
# after wiring, from the repo root
npm run dev:api
TOKEN=<jwt>  # login first
curl -X POST localhost:PORT/api/v1/synthdata -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"ddl":"CREATE TABLE t (id INT PRIMARY KEY, v VARCHAR(10) CHECK (v IN ('"'"'A'"'"','"'"'B'"'"')));","rows":50}'
# expect: 201, {tables:1, rows:50, preview:{...}}
```
