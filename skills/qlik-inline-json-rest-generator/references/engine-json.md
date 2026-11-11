# Loading JSON with the engine

## The reader: `(json)`

The same reader works on three sources:

```
LOAD * FROM [lib://DataFiles/x.json] (json [, table is '<pointer>'] [, all tables] [, embedded labels] [, header is N]);
LOAD * INLINE '<json text>' (json, ...);
LOAD * From_Field(<Table>, <Field>) (json, ...);
```

### How the JSON maps to tables

Example document:

```json
{"company":"Acme","address":{"city":"Lund"},
 "employees":[{"name":{"first":"Ann"},"tags":["a"],"projects":[{"code":"P1"}]}]}
```

| Load | Table | Fields |
|---|---|---|
| `(json)` | root | `company`, `address.city`, `%Key_employees` |
| `(json, table is '/employees')` | employees | `%Key_employees`, `employees.name.first`, `%Key_employees.tags`, `%Key_employees.projects` |
| `(json, table is '/employees/*/tags')` | tags | `%Key_employees.tags`, `employees.tags.@1` |
| `(json, table is '/employees/*/projects')` | projects | `%Key_employees.projects`, `employees.projects.code` |

**Pointers**
- If the document root is an array, prefix the pointer with `/*`, e.g. `/*/employees`.
- Each array level adds `/*`.
- Inside a pointer, escape `/` in a key as `~1` and `~` as `~0`. The field name keeps the original key.

**Field names**
- A key that is sometimes a value and sometimes an object or array gives both `key` and `%Key_key`.
- Keys containing `.` are ambiguous with nesting. Use `SET FieldNameDelimiter = ':';` or the `delimiter is ':'` spec.

**Special fields and options**
- `%Path` holds the element's pointer. `%Raw` and `%Raw_<field>` hold the raw JSON text.
- `pos.0 AS x` reads one array element as a column, without creating a subtable.
- `all tables` creates every table in one statement. The names are automatic and not path-based for INLINE sources (`INLFED`, `INLFED-3`…), so prefer explicit `table is` loads when names matter.

### Link keys: the engine's `%Key_` vs `%Path` (important)

`%Key_<path>` is a hash of the array **content**, verified on Qlik Cloud, 31 Oct 2026. Take three orders, two of them with identical `lines`:
- The lines table has 3 rows but only 2 distinct `%Key_lines`.
- The tags table has 3 rows sharing 1 key.

So each duplicated order links to both copies of the line rows: counts and sums double. `LOAD DISTINCT` (the docs' tip) fixes the per-parent view but undercounts totals.

The fix is to rebuild the keys from `%Path`, which is only available with an explicit field list (it gives "Field Not Found" with `LOAD *`):

```
[Orders]:       LOAD id, [%Path] & '/lines' AS [%Key_lines] FROM [x.json] (json);                         // %Path = /0, /1 …
[Orders.lines]: LOAD Left([%Path], Index([%Path], '/', -1) - 1) AS [%Key_lines], [lines.sku],
                     [%Path] & '/tags' AS [%Key_lines.tags] FROM [x.json] (json, table is '/*/lines');  // %Path = /0/lines/0 …
[Orders.lines.tags]: LOAD Left([%Path], Index([%Path], '/', -1) - 1) AS [%Key_lines.tags], [lines.tags.@1]
                     FROM [x.json] (json, table is '/*/lines/*/tags');
```

- **Object root:** when the document root is a single object, the root table uses a literal (`'/lines' AS [%Key_lines]`).
- **Raw keys:** `%Path` keeps keys raw. A key `arr/s` appears as `/0/arr/s`, not `/0/arr~1s`.
- **Several documents** (From_Field): prefix both sides with `FileName() & '|' &`. `FileName()` returns `<0>`, `<1>` … per document; for INLINE it is a `<uuid>.inline` name.
- **Trade-off:** fields come from the sample, so fields that aren't in it won't load. Missing fields load as null without error. Use `LOAD *` when arrays can't repeat and you want new fields picked up automatically.

**Limits**
- 5,000 fields and 1,000 tables per load.
- Raise them with `SET FieldNumberLimit = n; SET TableNumberLimit = n;`.

### Matrix `[][]`

```
LOAD * FROM [...] (json, table is '/*/', embedded labels);   // verified on Qlik Cloud; older engines may not support it
```

The trailing `/` turns the inner arrays' elements into fields. With `embedded labels`, the first row becomes the field names. For older engines, use the JsonGet pattern in `examples/engine-matrix-jsonget.qvs`.

## Embedding a sample in script

```
LET vJson = '<compact json>';
LOAD * INLINE '$(vJson)' (json);
SET vJson = ;
```

- `\u`-escape `'` (`'`), `$` (`$`) and `` ` `` (```). Valid JSON only has them inside strings, so the reader decodes them back.
- Reuse the variable for each `table is` load.
- Keep it small: about 50k characters per script section.

## JSON in a column of a loaded table (database pattern)

There are four options. The first three were verified in Qlik Cloud with duplicate documents and empty arrays.

1. **`reader` (default).** Tag each document with its row, then let the reader expand everything:
   ```
   [Src_json]: LOAD id, RecNo() AS __rowid, JsonSet([payload], '/__rowid', RecNo()) AS __json
   RESIDENT [Src] WHERE IsJson([payload]);
   [Order]:       LOAD orderId, __rowid, FileName() & '|' & '/lines' AS [%Key_lines] From_Field([Src_json], __json) (json);
   [Order.lines]: LOAD FileName() & '|' & Left([%Path], Index([%Path], '/', -1) - 1) AS [%Key_lines], [lines.sku]
                  From_Field([Src_json], __json) (json, table is '/lines');
   DROP FIELD __json FROM [Src_json];
   ```
   - The root table gets `__rowid`, and `[Src_json]` links `__rowid` back to `id`.
   - Child tables link through keys rebuilt as `FileName() & '|' & <path key>`, as described in the link keys section. The engine's own `%Key_` would cross-link documents with identical arrays.
   - If the documents are arrays, wrap them first: `'{"__rowid":' & RecNo() & ',"doc":' & [payload] & '}'`.
2. **`jsonget`.** Preceding-load chains keep the source key directly:
   ```
   [Order.lines]:
   LOAD __k0 AS id, Hash128(__k0, __j1) AS [%Key_lines.tags], JsonGet(__j1, '/sku') AS [lines.sku]
   WHERE NOT IsNull(__j1);                       // an empty array yields one null row
   LOAD __k0, JsonGet(__j0, '/lines/*') AS __j1;
   LOAD id AS __k0, [payload] AS __j0 RESIDENT [Orders] WHERE IsJson([payload]);
   ```
   Two `/*` wildcards in one LOAD give a Cartesian product, so use one chain per array.
3. **`fromfield`.** Plain `From_Field(Src, payload) (json)`. It reads each distinct value once: identical documents collapse, and rows don't link back to the source unless the JSON carries its own id.
4. **Push down to the database.** If the SQL can change, the database can flatten the JSON (Snowflake `LATERAL FLATTEN`, BigQuery `UNNEST`, Postgres `jsonb_array_elements`). That's often the simplest option for large volumes.

## Functions

- `JsonGet(json, path)` returns a decoded dual on Qlik Cloud: strings come back without quotes, and objects/arrays come back as JSON text. The path is an RFC 6901 pointer; `*` returns one row per match.
- `JsonSet(json, path, value)` adds or replaces a member. `value` is JSON text; `Null()` removes the member.
- `IsJson(json [, 'object'|'array'|'string'|'number'|'null'|'value'])`.
- `JsonObject(name, value, …)` builds an object.
- `JsonArray([DISTINCT] value)` is an aggregation that builds an array.

## Gotchas

- **Double-encoded JSON:** a string holding JSON loads as text. Expand it with a second From_Field or JsonGet load.
- **Wizard labels:** the load wizard doesn't expose `embedded labels` for JSON. Add it in script.
- **Missing fields:** listing a field that isn't in the JSON loads nulls, not an error.

Sources:
- [Working with JSON](https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Scripting/working-with-JSON.htm)
- [JsonGet](https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Scripting/StringFunctions/JsonGet.htm)
