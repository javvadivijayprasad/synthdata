---
title: "test: add a logistics domain schema + golden-file fixture (5th domain)"
labels: ["enhancement", "good first issue"]
---
**What's missing**

The golden-file suite (`test/golden-files.test.mjs`) covers four domains —
ecommerce, banking, healthcare, hr_payroll (`test/fixtures/schemas/`). The roadmap
calls for five, with **logistics** (shipments, routes, drivers, vehicles, depots)
as the fifth. A new domain regularly shakes out parser/engine edge cases.

**How to reproduce**

```bash
ls test/fixtures/schemas/   # 4 files, no logistics
```

**Where to look**

- `test/fixtures/schemas/schema_ecommerce.sql` — the shape to follow: ~10 related
  tables, PostgreSQL-compatible DDL, FKs, CHECK constraints, a composite UNIQUE.
- `test/golden-files.test.mjs` — how the four existing domains are registered and
  how a golden JSON is produced/committed on first run.

**Suggested fix**

Write `schema_logistics.sql` (8–10 tables, e.g. depots, vehicles, drivers, routes,
route_stops with `UNIQUE(route_id, stop_order)`, shipments, shipment_events with a
status CHECK, delivery_proofs 1:1 to shipments), register it in the golden test,
generate and commit the golden JSON.

**Done when**

- [ ] `npm test` passes with the new domain included
- [ ] The schema uses at least one composite UNIQUE, one self- or 1:1-FK, and
      CHECK constraints (IN and comparison)
- [ ] Golden JSON committed; a second run is byte-identical

---

**New here?** Comment on this issue to claim it, and we'll assign it to you.
Setup takes about five minutes: see
https://github.com/javvadivijayprasad/synthdata/blob/main/CONTRIBUTING.md.
Questions are welcome in the comments, and no question is too small.
