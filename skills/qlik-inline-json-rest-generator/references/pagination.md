# Pagination with the REST connector

Most APIs return one page per request (often 100 items). A single SELECT therefore silently loads only the first page. This is the "only 100 items" problem people keep reporting.

## Option A: page in script (the default)

This works with one generic connection that has **no** pagination configured. It's what the Qlik Cloud monitoring apps do: the installer creates `monitoring_apps_REST` with no `PaginationType`.

**Why page in script rather than on the connection (Option B)?**
- Pagination can't be set or overridden in script; `WITH CONNECTION` has no keyword for it.
- A connection-level setting only works if every endpoint behind that connection pages the same way, e.g. puts its next link at the same path.

**Loop structure** (verified on Qlik Cloud with `/api/v1/users?limit=2`: 5 pages, unique keys):

```
LIB CONNECT TO 'monitoring_apps_REST';
LET vPage = 0;
LET vNextUrl = 'https://tenant/api/v1/users?limit=100';   // query parameters go on the first URL only
DO
	LET vPage = vPage + 1;
	RestConnectorMasterTable:
	SQL SELECT ... FROM JSON (wrap on) "root" PK "__KEY_root"
	WITH CONNECTION (URL "$(vNextUrl)");

	[__page_data]:
	NOCONCATENATE LOAD                                   // (1)
		[id], '$(vPage)|' & [__KEY_data] AS [__KEY_data], '$(vPage)|' & [__FK_data] AS [__KEY_root]   // (2)
	RESIDENT RestConnectorMasterTable WHERE NOT IsNull([__FK_data]);
	IF NOT IsNull(TableNumber('__page_data')) THEN       // (3)
		LEFT JOIN ([__page_data]) LOAD ...;               // merge nested objects
	END IF

	__next:
	NOCONCATENATE LOAD [href_u1] AS __next RESIDENT RestConnectorMasterTable WHERE NOT IsNull([__FK_next]);
	LET vLastUrl = vNextUrl;
	LET vNextUrl = Peek('__next', 0, '__next');
	IF NOT IsNull(TableNumber('__next')) THEN
		DROP TABLE __next;
	END IF

	IF NOT IsNull(TableNumber('__page_data')) THEN
		IF IsNull(TableNumber('data')) THEN
			[data]: NOCONCATENATE LOAD * RESIDENT [__page_data];
		ELSE
			CONCATENATE ([data]) LOAD * RESIDENT [__page_data];
		END IF
		DROP TABLE [__page_data];
	END IF
	DROP TABLE RestConnectorMasterTable;
LOOP WHILE Len('$(vNextUrl)') > 0 AND '$(vNextUrl)' <> '$(vLastUrl)';   // (4)
```

The numbered lines matter:

1. **`NOCONCATENATE`.** A page table has the same fields as its final table. Without NOCONCATENATE, page 2 auto-concatenates into the final table. The later `CONCATENATE`/`DROP` then fail with "Table Not Found", the master table piles up, and data duplicates. This was reproduced on Qlik Cloud.
2. **Page-unique keys.** `__KEY_`/`__FK_` values restart on every SELECT (the key cache resets unless pagination is Custom), so prefix them with the page number.
3. **Guards.** A page can be empty, so guard the joins and drops. Write the `IF … THEN` on its own line, because the one-line form fails validation.
4. **Stop on a repeat.** Next URL and token loops also stop if the API returns the same link or token twice, so a misbehaving API can't loop forever.

**Other styles** use the same skeleton:

| Style | First request | Next request | Stop when |
|---|---|---|---|
| Next URL in the body | your URL | the link from the response | the link is empty |
| Token / cursor | no token | `$(vTokenQuery)` adds `, QUERY "pageToken" "<token>"` | the token is empty |
| Offset + limit | `QUERY "offset" "$(vOffset)", QUERY "limit" "$(vLimit)"` | offset + limit | a page returns fewer than `vLimit` records |
| Page number | `QUERY "page" "$(vPageNo)"` | page + 1 | a page returns fewer than the page size |

A page cap is optional (`--max-pages N` adds `LET vMaxPages = N;` and `AND vPage < vMaxPages`). Consider one for offset and page-number APIs: one that ignores the offset parameter returns full pages forever.

## Option B: pagination on the connection

The REST connection has its own Pagination section. With it set, **one SELECT returns every page**: the connector keeps requesting and appends the rows, and `__KEY_`/`__FK_` values stay unique across pages because the key cache only resets per SELECT. There is no loop, no page prefix and no page tables. The generator writes the script plus the exact settings (`--paging-by connector`; CLI lines starting `// CONNECTION:`), and a comment above the SELECT records them.

**Choose it when** the connection is dedicated to one API, or every endpoint behind it pages the same way. **Choose Option A when** one shared connection serves several endpoints (the monitoring-app pattern), or when you want a page cap.

**Settings by style.** Labels are as the connection dialog shows them:

| Style | Pagination type | Settings |
|---|---|---|
| Next link in the body | Next URL | `'Next url' path`: `root/links/next/href` |
| Token / cursor | Next token | `'Next token' parameter name`: `pageToken`; `'Next token' path`: `root/meta/nextCursor` |
| Offset + limit | Offset | `'Start' parameter name`: `offset`; `'Start' initial value`: `0`; `'Count' parameter name`: `limit`; `'Count' initial value`: `100`; then a total **or** a data indicator path (below) |
| Page number | Next page | `'Next page' parameter name`: `page`; `'Next page' initial value`: `1`; `'Page size' parameter name` and `'Page size' value` (optional); then a total **or** a data indicator path |

**Paths** are JSON property names joined with `/`, starting at the root table: `root` for a wrapped response (`FROM JSON (wrap on) "root"`). An array of records counts as one step, so a field inside each record of `data` is `root/data/id`. The field doesn't need to be in the SELECT; the connector reads it anyway.

**How each style stops:**
- **Next URL:** when the link is empty, repeats, or isn't an absolute `http(s)` URL.
- **Next token:** when the token is empty. The token goes back as a query parameter, or as a header with "Pass via header".
- **Offset:** with `'Total records' path`, it stops once start + count reaches the total. With `Data indicator path` (any field every record has), it continues while a page returns that field, so the last request returns an empty page.
- **Next page:** the same, with `'Total pages' path` counting pages, not records.
- "Look in header" reads a response header's raw value. It suits a header holding a bare URL or token, not an RFC 8288 `Link: <…>; rel="next"` header.

**Rules the connector enforces:**
- A pagination parameter must not also be a `QUERY` in `WITH CONNECTION`: the connector stops with an error. Leave `limit`/`offset`/`page`/the token out of `QUERY`; the generator drops them and warns. A value in the URL string itself is simply replaced.
- With Next URL, `WITH CONNECTION` `QUERY` values go on the first request only. Later requests use the next link as is, unless "Add missing query parameters to final request" is ticked.
- There is no page limit.
- The "Custom" type doesn't page. It makes the Select data dialog write a `FOR` loop template, and keeps key values running on across SELECTs.

**Trade-off:** the script is shorter, but correctness depends on a setting outside the app. That is easy to miss when the app moves to another tenant, and it ties the connection to one response shape.

## Diagnosing

When the connector gives opaque errors, call the endpoint directly first (curl, or a browser with a token). That separates API problems from connector problems.

**Not covered:**
- GraphQL paging
- OAuth flows: use an API key or bearer token in a header
