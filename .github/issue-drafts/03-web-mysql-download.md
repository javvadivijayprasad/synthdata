---
title: "feat(web): add a MySQL script download button next to the PostgreSQL one"
labels: ["enhancement", "good first issue"]
---
**What's missing**

The CLI exports a MySQL/MariaDB load script (`--mysql file.sql`, since v1.3.0), but the
web app at https://synthdata.testforge-ai.com only offers `.db`, CSV, and PostgreSQL
downloads. `grep -ci mysql web/index.html` → 0.

**How to reproduce**

Open `web/index.html` in a browser → Load sample → Generate data → the downloads row
has "⬇ Download .db (SQLite)" and "⬇ PostgreSQL script (.sql)" but no MySQL button.

**Where to look**

- `src/export.js` → `toMysqlSql()` (line ~159) — the Node implementation to mirror.
- `web/index.html` → `toPgScript()` function — the existing browser-side PG mirror;
  a `toMysqlScript()` goes right next to it, same structure.
- `web/index.html` → search `PostgreSQL script` — the `mkBtn(...)` call to copy for
  the new button.

**Suggested fix**

Port `toMysqlSql` into the page the same way `toPostgresSql` was ported as `toPgScript`
(no `fs`, return a string), add one `mkBtn('⬇ MySQL script (.sql)', ...)` line.

**Done when**

- [ ] Generate → "MySQL script (.sql)" button appears (except in negative profile)
- [ ] The downloaded file loads into MySQL/MariaDB (or at minimum matches
      `node bin/cli.js auto -s examples/schema_ecommerce.sql --mysql ref.sql --rows 50 --seed 42`
      output body line-for-line apart from the header comment)
- [ ] `node web/parity-check.mjs` still ends with ALL IDENTICAL

---

**New here?** Comment on this issue to claim it, and we'll assign it to you.
Setup takes about five minutes: see
https://github.com/javvadivijayprasad/synthdata/blob/main/CONTRIBUTING.md.
Questions are welcome in the comments, and no question is too small.
