---
title: "feat(cli): per-table row counts in auto mode, e.g. --rows orders=500,default=100"
labels: ["enhancement", "help wanted"]
---
**What's missing**

`auto` mode generates the same row count for every table (`--rows 200` → 200 rows in
all 10 tables). Real schemas want asymmetry — 50 customers but 5,000 order_items —
without authoring a plan. We already have the precedent: `--table-seed products=7,orders=99`
parses exactly this `name=value,name=value` syntax for seeds.

**How to reproduce**

```bash
node bin/cli.js auto -s examples/schema_ecommerce.sql -o t.db --rows 200 --seed 42
# every table gets 200 rows; there is no way to vary counts per table without a plan
```

**Where to look**

- `bin/cli.js` → `cmdAuto()` — builds `{tables: {each: {rows}}}`; this is where
  `orders=500,default=100` would be parsed (copy the `--table-seed` parsing pattern).
- Keep backwards compatibility: a bare number (`--rows 200`) must keep working.

**Done when**

- [ ] `--rows orders=500,default=100` → orders has 500 rows, every other table 100
- [ ] Bare `--rows 200` unchanged; `--rows orders=500` alone → others default to 100
- [ ] Unknown table name in the flag → clear error naming the table
- [ ] A unit test covers the parsing and the generated counts
- [ ] `npm test` passes

*(Labelled `help wanted` rather than `good first issue`: it touches arg parsing,
auto-plan construction, and tests together.)*

---

**New here?** Comment on this issue to claim it, and we'll assign it to you.
Setup takes about five minutes: see
https://github.com/javvadivijayprasad/synthdata/blob/main/CONTRIBUTING.md.
Questions are welcome in the comments, and no question is too small.
