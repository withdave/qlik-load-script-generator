---
name: qlik-inline-json-rest-generator
description: Generate correct Qlik Sense / Qlik Cloud load script for (1) pasted tabular data as an INLINE table (CSV, TSV/Excel/Google Sheets clipboard, Markdown, HTML tables, JSON arrays), with all escaping handled; (2) JSON loaded natively by the engine with (json), table is, From_Field and JsonGet, including JSON stored in a database column; (3) JSON from an HTTP API over the REST connector (RestConnectorMasterTable, wrap on, __KEY_/__FK_, WITH CONNECTION) including pagination loops. Use whenever someone wants to turn pasted data into an inline table, load or expand JSON in Qlik, write or fix a REST connector script, paginate a REST API in Qlik script, or asks about JsonGet, From_Field, (json) or "table is". Also use when someone pastes JSON or a table together with any mention of Qlik, a load script or the data load editor.
---

# Qlik inline, JSON and REST generator

Three jobs, one bundled generator. The rules below were verified by reloading generated scripts in
Qlik Cloud. When a rule here disagrees with general Qlik knowledge, trust this file.

## Use the bundled generator first

`scripts/qlik-gen.mjs` is a self-contained Node script (Node 18+, no install). It implements every
rule in this skill and was tested against a real tenant. Prefer running it to writing script by
hand; then review, adapt names, and explain the result.

```bash
# Paste → INLINE (reads a file or stdin; auto-detects CSV/TSV/Markdown/HTML/JSON)
node scripts/qlik-gen.mjs inline data.csv --table Products [--mapping] [--null] [--verbatim]

# JSON → engine
node scripts/qlik-gen.mjs engine sample.json --path 'lib://DataFiles/orders.json' --root Orders
node scripts/qlik-gen.mjs engine sample.json --source inline --root Orders          # embed the sample
node scripts/qlik-gen.mjs engine rows.json --field payload --table Orders --key id --root Order [--method reader|jsonget|fromfield] [--sample]
#   (for --field, the input is the column values: a JSON array of documents, or NDJSON)

# JSON → REST connector
node scripts/qlik-gen.mjs rest response.json --connection 'Space:REST' --url https://host/api/v1/items \
  [--query limit=100] [--header 'Authorization: Bearer $(vToken)'] \
  [--paging nexturl --next links.next.href | --paging offset --records data | --paging token --next meta.nextCursor --token-param cursor | --paging page]
  [--paging-by connector [--total meta.total]]    # one SELECT; the connection's own pagination fetches the pages
  [--naming connector] [--no-flatten]

# See what tables the engine and the connector will create for a sample
node scripts/qlik-gen.mjs inspect sample.json
```

The script goes to stdout; warnings, the connection checklist (lines starting `// CHECK:`) and,
with `--paging-by connector`, the connection's pagination settings (`// CONNECTION:`) go to stderr. Pass the warnings on to the user. If there is no sample, ask for one page of the real
response: names, `_uN` aliases and table paths all come from the sample.

The same generator runs as a web app in the repo (`npm run dev`) for people who'd rather click.

## Decide which path

| Situation | Use |
|---|---|
| A small table pasted from Excel, Sheets, a wiki or a CSV | INLINE, see [references/inline-tables.md](references/inline-tables.md) |
| A JSON file in a space, or a JSON URL via a web-file connection | Engine `(json)`, see [references/engine-json.md](references/engine-json.md) |
| JSON in a column of a table already loaded (database, QVD, API text) | Engine via From_Field or JsonGet, see the same file |
| An HTTP API needing auth headers, POST bodies or paging | REST connector, see [references/rest-connector.md](references/rest-connector.md) and [references/pagination.md](references/pagination.md) |
| `[[…],[…]]` matrix data | Engine `table is '/*/', embedded labels` (current Qlik Cloud), or the JsonGet fallback for older engines |

Default to the engine's JSON reader (one load per array via `table is`) rather than hand-written
JsonGet walks. Name the fields explicitly and rebuild the link keys from `%Path`, as the generator
does by default.

Why not plain `LOAD *`? The engine's `%Key_` fields are hashes of the array **content**, which was
verified on Qlik Cloud. If two records hold identical arrays (two users who both have `["Developer"]`,
two orders with the same lines), they get the same key. Every copy of those child rows then links
to all of them, and sums double. `LOAD *` is fine only when arrays can't repeat. `%Path` isn't
available with `LOAD *`, so the fix needs a field list (taken from the sample).

If the JSON comes from a database that can parse it, such as Snowflake `LATERAL FLATTEN`, BigQuery
`UNNEST` or Postgres `jsonb_array_elements`, pushing the expansion into the SQL is a valid
alternative. Mention it.

## Must-know rules (each one has bitten real users)

**INLINE**
- Choose an enclosure (`[ ]`, `` ` ` ``, `" "`, `' '`) and a delimiter that never occur in the data.
- `$(` inside INLINE data is still dollar-expanded. Replace it with a token and restore it with `Replace(f, '{#DOLLAR#}', Chr(36)&'(')`.
- Line breaks and boundary quotes in values: use the same token + `Replace()` approach.
- `//` and `REM` inside INLINE are data, not comments. `;` inside the block is fine.
- Leading zeros collapse (`007` → `7`): wrap code-like columns in `Text()`. Surrounding spaces are stripped unless `SET Verbatim = 1`.
- Header names must be unique. If a name needs escaping, use `(no labels)` and `@1 AS [Name]`.

**Engine JSON**
- Nested objects become dotted fields (`address.city`).
- Each array becomes its own table via `table is '<pointer>'`. The engine links them with `%Key_<path>`, but that is a content hash: identical arrays in different records share it.
- To link correctly, list the fields and rebuild the keys from `%Path`:
  - parent table: `[%Path] & '/lines' AS [%Key_lines]` (a literal `'/lines'` when the root is a single object)
  - child table: `Left([%Path], Index([%Path], '/', -1) - 1) AS [%Key_lines]`
  - `%Path` holds raw keys (no `~1` escaping), and it errors with `LOAD *`.
- In a child table, field names carry the full path (`employees.projects.code`). Scalar arrays land in `<path>.@1`.
- Pointers escape `/` as `~1` and `~` as `~0`; field names keep the original key.
- Embedding JSON in script: write it compact, then `\u`-escape `'`, `$` and `` ` ``. Valid JSON has these only inside strings, so the data is unchanged.
- `From_Field(T, F) (json, table is …)` works for nested arrays. It reads each **distinct** value once, so duplicates collapse and rows lose their link to the source.
  - First tag each document with `JsonSet(F, '/__rowid', RecNo())`.
  - Then prefix the path keys with `FileName() & '|' &`. `FileName()` is `<0>`, `<1>` … per document.
  - The generator's default `reader` method does both.
- `JsonGet(x, '/arr/*')` returns one row per element, but also one **null** row for an empty array. Filter with `WHERE NOT IsNull(...)`.
- Limits: 5,000 fields and 1,000 tables per load. Raise them with `SET FieldNumberLimit` / `SET TableNumberLimit`, or exclude tables.

**REST connector**
- `WITH CONNECTION` accepts only `URL`, `QUERY "k" "v"`, `HTTPHEADER "k" "v"` and `BODY "…"`.
- Method, authentication, timeouts, retries and **pagination** can only be set on the connection. Page in script by default; use the connection's pagination (one SELECT, `--paging-by connector`) when the connection serves only this API. See [references/pagination.md](references/pagination.md).
- The connection needs "Allow WITH CONNECTION" switched on. `BODY` is only sent when the method is POST.
- Retries are connection settings: "Retry failed requests" plus "Retry codes" (5xx only, e.g. `502, 503, 504`). A 429 is retried only when the API sends `Retry-After` of 60 seconds or less. See [references/rest-connector.md](references/rest-connector.md).
- Every nested object and every array becomes a separate table with `__KEY_`/`__FK_` keys.
- Duplicate names get `_u0`, `_u1`… suffixes in pre-order across the whole response. Take them from the sample (or `inspect`); never guess.
- Merging single-row object tables into their parent with `LEFT JOIN` avoids the "many one-row tables" problem.
- When paging in a loop:
  - Key values restart every request. Prefix them per page: `'$(vPage)|' & [__KEY_x]`.
  - Load each page into `NOCONCATENATE` temp tables, then append them to the final tables. Otherwise page 2 silently auto-concatenates into the final table and the loop corrupts itself.
  - Guard joins and drops with `IF NOT IsNull(TableNumber('…')) THEN … END IF`, written on separate lines: a one-line `IF … THEN DROP …; END IF` fails validation.

More detail, with sources, is in [references/gotchas.md](references/gotchas.md). Ready-to-adapt
scripts are in `examples/`.

## When you answer

1. Run the generator, or apply the rules by hand if Node isn't available.
2. Show the script, then list the warnings and the connection checklist.
3. Point out anything you assumed: table names, the key field, where the next link lives, page size.
4. For REST, remind the user the default single request usually returns only the first page (often 100 items).
