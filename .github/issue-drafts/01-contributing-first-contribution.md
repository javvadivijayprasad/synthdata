---
title: "docs: add a 'Your first contribution' section to CONTRIBUTING.md"
labels: ["documentation", "good first issue"]
---
**What's missing**

CONTRIBUTING.md explains setup and the PR checklist, but has no walkthrough for a
first-time open-source contributor — fork, branch, make a change, run the checks,
open the PR. A short section written by someone who just went through it is more
useful than one written by the maintainer.

**How to reproduce**

Open https://github.com/javvadivijayprasad/synthdata/blob/main/CONTRIBUTING.md and
look for the word "fork" — it isn't there.

**Where to look**

- `CONTRIBUTING.md` — add a `## Your first contribution` section after "Getting started".

**Suggested content**

Fork → `git clone` your fork → branch → make the change → `npm test` +
`node --check` on changed files → push → open PR against `main`. 8–12 lines is plenty.
Mention that the CI checklist in the PR template mirrors what reviewers run.

**Done when**

- [ ] CONTRIBUTING.md has the section, written in plain language
- [ ] Every command in it was actually run once
- [ ] Links are full URLs (relative links break in some views)

---

**New here?** Comment on this issue to claim it, and we'll assign it to you.
Setup takes about five minutes: see
https://github.com/javvadivijayprasad/synthdata/blob/main/CONTRIBUTING.md.
Questions are welcome in the comments, and no question is too small.
