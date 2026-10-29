---
title: "chore(ci): run web/parity-check.mjs in the CI workflow"
labels: ["chore", "good first issue"]
---
**What's missing**

`web/parity-check.mjs` verifies that the engine embedded in `web/index.html` produces
byte-identical output to the npm engine in `src/`. It exists and passes locally, but CI
never runs it — so a change to `src/` without a matching web sync would merge green and
silently leave the web app behind.

**How to reproduce**

```bash
git clone https://github.com/javvadivijayprasad/synthdata.git && cd synthdata && npm install
node web/parity-check.mjs    # ends with: WEB ENGINE PARITY: ALL IDENTICAL
grep parity .github/workflows/ci.yml   # no matches — CI never runs it
```

**Where to look**

- `.github/workflows/ci.yml` — add a step after "Unit tests", e.g.:

```yaml
      - name: Web engine parity
        run: node web/parity-check.mjs
```

**Done when**

- [ ] CI runs the parity check on every push/PR (one new step, all matrix jobs)
- [ ] The workflow still passes (check the Actions tab on your fork)

---

**New here?** Comment on this issue to claim it, and we'll assign it to you.
Setup takes about five minutes: see
https://github.com/javvadivijayprasad/synthdata/blob/main/CONTRIBUTING.md.
Questions are welcome in the comments, and no question is too small.
