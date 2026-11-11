# Verified findings and gotchas

Each item was checked by reloading generated script in Qlik Cloud (October 2026), unless marked as from the documentation. The test script is built by `tenant/build-fixture-script.ts`: 122 checks, all passing.

## INLINE

| Finding | Result |
|---|---|
| `$(` in INLINE data | Expanded. Token + `Replace(..., Chr(36)&'(')` round-trips. |
| `;` in INLINE data | Kept as data. |
| Line starting `REM` in INLINE | Kept as data. |
| `//` in INLINE | Kept as data, URLs included. |
| `x]]y` inside `[ ]` | Loads as `x]y` on Cloud today. Older versions differ, so prefer switching enclosure. |
| `(no quotes)` | Keeps literal quotes. |
| Back-tick enclosure with tab delimiter | Works, including JSON text in a column. |
| Zero-row `LOAD … AUTOGENERATE 0` | Creates the table. |
| Two loads with identical field sets | Auto-concatenate silently, whatever their labels. This broke a REST paging loop until the page tables used `NOCONCATENATE`. |

## Engine JSON

| Finding | Result |
|---|---|
| `'`, `$` inside `INLINE '$(vJson)' (json)` | Decoded correctly (`O'Connor $(x)`). |
| JSON `null` | Loads as null. Booleans load as `true` / `false` text or a dual. |
| `From_Field(T, F) (json, table is '/lines/*/tags')` | Works: nested arrays expand from a field. |
| Plain From_Field on 3 rows with 2 distinct documents | 2 root rows: duplicates collapse. |
| `JsonSet(F, '/__rowid', RecNo())` tagging | 3 root rows, linked back to the source. |
| `%Key_` link fields | Hashes of the array content. 3 orders, 2 with identical lines: 3 line rows, 2 keys. Child rows cross-link and sums double. |
| `%Path` with an explicit field list | Root `/0`, `/1`; child `/0/lines/0`; grandchild `/0/lines/0/tags/0`. Keys built from it are unique. |
| `%Path` with `LOAD *` | "Field Not Found". It only works in a field list. |
| `%Path` with a key containing `/` | Raw key (`/0/arr/s`), not `~1`. |
| `FileName()` in From_Field | `<0>`, `<1>`, … one per document. For INLINE it's `<uuid>.inline`. |
| `JsonGet(x, '/tags/*')` on `[]` | One null row. Filter `WHERE NOT IsNull(...)`. |
| `table is '/*/', embedded labels` on a matrix | Works on this tenant. |
| `(json, all tables)` from INLINE | Table names `INLFED`, `INLFED-3`…, not paths. |
| Keys with `/`, `.`, `~` | Field names kept verbatim; the pointer uses `~1`. |

## REST connector

| Finding | Result |
|---|---|
| Faithful connector script (9 tables) on `/api/v1/users` | Loads. |
| Flattened script (4 tables) | Loads, with `links.self.href` merged into `data`. |
| Next URL loop, `limit=2`, 5 pages | Unique `__KEY_data` across pages. |
| One-line `IF … THEN DROP TABLE x; END IF` | Script validator error. Use multi-line. |
| `WITH CONNECTION` keywords | From the documentation: only URL, QUERY, HTTPHEADER and BODY. |
| Pagination type and paths | Connection properties only; there is no script keyword for them. |
