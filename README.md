# Qlik load script generator

A backend-free web app, and a matching Claude skill, that write Qlik Sense / Qlik Cloud load script for three fiddly jobs:

1. **Paste → INLINE.** Paste CSV, an Excel or Google Sheets selection, a Markdown or HTML table, or a JSON array, and get a `LOAD … INLINE` statement. It handles every escaping trap: `]`, `$(`, quotes, line breaks, `//`, delimiters in values, leading zeros, and duplicate or blank headers.
2. **JSON → Engine.** Native `(json)` loads from a file or URL, an embedded sample, or **JSON stored in a column of a loaded table** (the database case). You get one load per array with `table is`, link keys built from `%Path` (so records with identical arrays don't share child rows), matrix (`[][]`) support, and warnings for engine limits and double-encoded JSON.
3. **JSON → REST connector.** The connector's own `SQL SELECT … FROM JSON (wrap on) "root"` statement, reproduced exactly from a sample response. Nested objects can be merged into tidy tables, and pagination (Next URL, token, offset, or page number) either runs in script with page-unique keys, or is left to the connection's own pagination setting, in which case the tool lists the exact settings to enter.

Everything runs in the browser. Nothing you paste is sent anywhere.

**Use it:** https://withdave.github.io/qlik-load-script-generator/ · **Source:** https://github.com/withdave/qlik-load-script-generator

## Run it

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

- `npm run dev` serves the app at http://localhost:5173.
- `npm test` runs the unit and golden tests for parsers and generators.
- `npm run build` writes a static site to `dist/`, ready for GitHub Pages or any static host (`base: './'`).

## Layout

```
src/core/            pure TypeScript generators, shared by the UI, tests and CLI
  detect.ts, parse/  format detection; CSV/TSV, Markdown, HTML and JSON parsers
  inline/            INLINE generator (delimiter/enclosure choice, tokens, Text())
  json/shape.ts      merged JSON shape of samples
  json/tables.ts     the engine's table/field/key naming model
  json/engine.ts     (json) / From_Field / JsonGet generator
  json/rest.ts       REST connector metadata model (port of the connector's rules) and generator
src/ui/              vanilla TypeScript UI (three tabs, share links, local drafts)
src/cli.ts           CLI bundled into the skill
fixtures/            test inputs, including the nasty ones
tenant/              Qlik Cloud verification harness and skill example builder
skills/qlik-inline-json-rest-generator/   Claude skill: SKILL.md, references/, examples/, evals/, scripts/qlik-gen.mjs
.github/             CI, GitHub Pages deploy, Dependabot config and auto-merge
```

## How it was verified

The generator rules come from the Qlik help documentation, Qlik Community articles, and the script the REST connector's Select data dialog generates. They were then checked by reloading generated scripts in Qlik Cloud. `npm run fixtures:tenant -- <rest-connection> <tenant-host>` writes `tenant/out/fixtures.qvs`. That one script runs every generator over the fixtures and records pass/FAIL checks plus the actual table and field names. Reloaded in a test app, all 122 checks pass. The paging section fetched 5 pages from `/api/v1/users`.

Findings are listed in [skills/qlik-inline-json-rest-generator/references/gotchas.md](skills/qlik-inline-json-rest-generator/references/gotchas.md).

## The skill

`skills/qlik-inline-json-rest-generator/` is a Claude skill. To install it:

```bash
ln -s "$PWD/skills/qlik-inline-json-rest-generator" ~/.claude/skills/qlik-inline-json-rest-generator
```

It bundles the generator as `scripts/qlik-gen.mjs`, so Claude produces scripts with the same tested code. Rebuild it after changing `src/core` with:

```bash
npm run build:skill && npm run examples:skill
```

The tests run the committed bundle against the source generators. A stale or broken bundle therefore fails `npm test`.

## CI and dependency updates

- **`.github/workflows/ci.yml`** runs one job, `Verify`, on every pull request and every push to `main`, on the latest Node release (unpinned). It:
  - typechecks the code
  - runs the tests (parsers, escaping, generator golden output, share links, and the bundled skill CLI against the source)
  - builds the web app
  - rebuilds the skill CLI with the installed esbuild and smoke-tests it on the fixtures
  - checks that the skill examples are up to date
- **`.github/dependabot.yml`** opens weekly grouped PRs. A 3-day `cooldown` means it only proposes a version once it has been published for 3 days, a guard against compromised releases (security updates are not delayed):
  - `npm-minor-patch`: all minor and patch npm updates in one PR
  - `npm-major`: major npm updates, for review
  - `github-actions`: action updates
- **`.github/workflows/pages.yml`** tests and builds the web app, then publishes `dist/` to GitHub Pages at `https://<owner>.github.io/<repo>/`. It runs on every push to `main`, after each Dependabot auto-merge (those merges don't fire push events), and on demand. Asset paths are relative, so the subpath works.
- **`.github/workflows/dependabot-auto-merge.yml`** runs after CI completes. It approves and squash-merges a Dependabot PR from the `npm-minor-patch` or `github-actions` group only when CI passed on the PR's current head commit (`--match-head-commit`). It never checks out PR code. Major npm updates wait for a person.

Needs on GitHub:
- Settings → Pages → Build and deployment → Source: **GitHub Actions**.
- Actions must be allowed to use the `contents: write` / `pull-requests: write` permissions the workflow requests. An org policy can cap this.
- Settings → Actions → General → **Allow GitHub Actions to create and approve pull requests**, so the workflow's approval counts toward a required-review rule.
- In the `main` ruleset, require the **`Verify`** status check. Don't require `merge` (the auto-merge job) or the Pages jobs: they don't run on pull requests, so a required check on them would never report.
- Merges made with the workflow token don't trigger a new CI run on `main`. The PR's own CI run is the gate.

## Key decisions

- **Paging defaults to the script loop, not connector-native pagination.** `WITH CONNECTION` can only override `URL`, `QUERY`, `HTTPHEADER` and `BODY`; pagination, auth and method are connection-only. A single generic connection, the monitoring-app pattern, therefore can't vary pagination per endpoint. Paging by the connection is the other choice: one SELECT fetches every page, and the tool works out the connection's Pagination settings (type, parameter names, and paths such as `root/links/next/href`) from the sample.
- **JSON in a database column defaults to the JSON reader with a `__rowid` tag.** Plain `From_Field` reads each distinct value once, which collapses duplicates and loses the link to the source row. Tagging with `JsonSet(json, '/__rowid', RecNo())` keeps full expansion and links. A JsonGet preceding-load method is also available.
- **Engine link keys are rebuilt from `%Path` by default.** The engine's `%Key_` fields are content hashes, so records with identical arrays share child rows: two users who both have `["Developer"]` link to both copies, and sums double. This was verified on Qlik Cloud. `%Path` needs an explicit field list, so the generator lists fields from the sample. `LOAD *` is still an option for data where arrays can't repeat.
- **The REST output merges single-row objects into their parent table by default.** This avoids the "nested JSON creates many one-row tables" issue.
