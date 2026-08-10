## What does this PR do?

<!-- Short description + link the related issue (e.g. "Closes #12") -->

## Checklist

- [ ] `node --check` passes on every changed file
- [ ] Smoke test passes: `node bin/cli.js auto -s examples/schema_ecommerce.sql -o /tmp/t.db --rows 100` → `FK violations: 0`
- [ ] Same `--seed` run twice produces identical file hashes (determinism contract)
- [ ] No new runtime dependencies (only `sql.js` + `yaml` allowed)
- [ ] If the RNG call sequence changed for existing plans: flagged as **breaking** above
- [ ] Conventional commit message (`feat:` / `fix:` / `docs:` / `test:` / `chore:`)
