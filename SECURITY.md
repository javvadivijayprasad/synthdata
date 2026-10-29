# Security Policy

## Supported versions

Only the latest published version on npm receives security fixes.

| Version | Supported |
|---|---|
| latest (`npm view @vijaypjavvadi/synthdata version`) | ✅ |
| older | ❌ — please upgrade |

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Email **jvijayprasad@gmail.com** with:

- a description of the issue and its impact
- steps or a schema/plan that reproduces it
- the version affected (`synthdata --version` or `npm ls @vijaypjavvadi/synthdata`)

You will get an acknowledgement within a few days. Once fixed, the fix ships as a
patch release and you will be credited in the CHANGELOG (unless you prefer not).

## Scope notes

- The web app (synthdata.testforge-ai.com) runs generation entirely in the
  browser; schemas, API keys, and generated data are never sent to its server.
  Issues with that property are in scope and high priority.
- `{gen: expr}` plan entries execute JavaScript during generation by design.
  Treat plan YAML from untrusted sources like code — this is documented behavior,
  not a vulnerability, but sandbox escapes beyond the documented behavior are in scope.
