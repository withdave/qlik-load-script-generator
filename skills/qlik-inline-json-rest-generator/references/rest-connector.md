# REST connector JSON

## What the connector does with a response

These rules match the script the connector's Select data dialog generates.

**Tables and keys**
- Every nested **object** and every **array** becomes a table named after its property.
- Array elements merge into one table. An array of arrays nests a table with the same name.
- An array of scalars, or an empty array, gets the field `"@Value"` and `ArrayValueAlias "@Value"`.

**Which table is the root, and wrap on/off**
- The document object is read as a table called `root`.
- If `root` has any simple field, or more than one nested table, it is the root, with `(wrap on)`.
- Otherwise its single child becomes the root: `(wrap off)` for an object document, `(wrap on)` for an array document. An array document is wrapped as `"root"`.

**Aliases**
- Table aliases, then field aliases, are made unique across the **whole tree** in pre-order.
- The first occurrence keeps its name. Later ones get `_u0`, `_u1`, … (e.g. `"href" AS "href_u1"`).
- `[`, `]` and `"` become `_`.

**Key fields**
- Every child table gets `__FK_<name>`; every table with children gets `__KEY_<name>`. Both are made unique the same way.
- The generated LOAD for each table is:
  ```
  [t]: LOAD [fields], [__FK_t] AS [__KEY_parent] RESIDENT RestConnectorMasterTable WHERE NOT IsNull([__FK_t]);
  ```
- The script then ends with `DROP TABLE RestConnectorMasterTable;`.

Formatting matches the Select data dialog:

```
RestConnectorMasterTable:
SQL SELECT
	"totalResults",
	"__KEY_root",
	(SELECT
		"id",
		"__FK_data",
		"__KEY_data",
		(SELECT "@Value", "__FK_roles" FROM "roles" FK "__FK_roles" ArrayValueAlias "@Value"),
		...
	FROM "data" PK "__KEY_data" FK "__FK_data"),
	...
FROM JSON (wrap on) "root" PK "__KEY_root"
WITH CONNECTION (URL "https://host/api/v1/users?limit=100");
```

## WITH CONNECTION

```
WITH CONNECTION (
	URL "https://…",
	QUERY "name" "value",           // repeatable
	HTTPHEADER "name" "value",      // repeatable; can override Authorization per call
	BODY "text"                     // only sent if the connection's method is POST; the only multi-line literal
)
```

- **Only these four keywords:** anything else is a parse error.
- **Connection-only settings:** method, auth scheme, timeouts, retries, key generation and pagination.
- **Allow WITH CONNECTION:** the connection must have it switched on (`allowWithConnection`). Otherwise the call fails.
- **URL precedence:** a pagination next-URL first, then the `WITH CONNECTION` URL, then the connection URL.
- **Clashing parameter names:** if a QUERY or header name clashes with a pagination parameter, the call throws `InvalidConnectionPropertiesException`.
- **External calls:** blank the token with `HTTPHEADER "Authorization" ""`, as the monitoring apps do for GitHub.

## Retries and rate limits

Retries are a connection setting in Qlik Cloud ("Additional request parameters"). The client-managed connector has none.

- **Retry failed requests:** a checkbox. Retrying is always on for Qlik Cloud API hosts.
- **Retry codes:** a comma-separated list of codes to retry, e.g. `502, 503, 504`. Codes below 500 are ignored, so **429 can't be listed**.

What gets retried:

| Response | Retried | Wait |
|---|---|---|
| 429 or 503 with `Retry-After` | yes | the header's value (seconds or an HTTP date) |
| 429 without `Retry-After` | no | |
| A code in Retry codes | yes | 10 s, then 20 s, 30 s … |
| Any wait outside 1–60 s | no, the request fails | |

- **Count:** the number of retries is set by the service, not the connection, and is small.
- **Per SELECT:** retries are counted per SELECT. With the connection doing the paging, they're shared across every page.
- **Before data only:** a request is only retried if it fails before data starts arriving.

A failed request stops the reload with `HTTP protocol error <code> (<reason>):` and the start of the response body. For APIs that throttle without `Retry-After`, page in script: each page is its own SELECT, so each page gets its own retry.

## Tidy output: merge single-row objects

The connector's literal output is one table per nested object. For example, `links` → `self` → `href` produces three single-row tables per record.

The generator's default (`flatten`) keeps one table per array and `LEFT JOIN`s each nested object into it:

```
[data]: LOAD [id], [__KEY_data], [__FK_data] AS [__KEY_root] RESIDENT … WHERE NOT IsNull([__FK_data]);
LEFT JOIN ([data]) LOAD [__FK_links] AS [__KEY_data], [__KEY_links] RESIDENT … WHERE NOT IsNull([__FK_links]);
LEFT JOIN ([data]) LOAD [__FK_self] AS [__KEY_links], [href] AS [links.self.href] RESIDENT … WHERE NOT IsNull([__FK_self]);
DROP FIELDS [__KEY_links] FROM [data];
```

**Naming**
- Fields get dotted path names (`links.self.href`), like the engine's reader.
- If a name appears in two output tables, the first array table keeps it and the others are prefixed with their table alias. This avoids accidental associations.
- `--naming connector` keeps the connector's `_uN` aliases.

## Verified on Qlik Cloud (October 2026)

- Faithful, flattened and Next URL paging scripts all loaded against `/api/v1/users`.
- The paging script fetched 5 pages, and its keys were unique across pages.

Sources:
- [REST connector: Load data](https://help.qlik.com/en-US/connectors/Subsystems/REST_connector_help/Content/Connectors_REST/Load-REST-data/Load-data.htm)
- [REST connector loads many tables from nested JSON](https://community.qlik.com/t5/Official-Support-Articles/REST-connector-loads-a-large-number-of-table-from-a-nested-JSON/ta-p/1717623)
