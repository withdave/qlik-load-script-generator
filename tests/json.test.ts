import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateEngine, scriptSafeJson } from '../src/core/json/engine';
import { generateRest, restMetadata, selectStatement } from '../src/core/json/rest';
import { shapeOf } from '../src/core/json/shape';
import { engineTables } from '../src/core/json/tables';
import type { Json } from '../src/core/parse/json';

const fx = (p: string) => JSON.parse(readFileSync(new URL(`../fixtures/${p}`, import.meta.url), 'utf8')) as Json;

// Field/table names below were verified against a Qlik Cloud reload (tenant/build-fixture-script.ts).
describe('engineTables', () => {
  it('names nested objects, arrays and keys like the engine', () => {
    const t = engineTables(shapeOf(fx('json/nested.json')));
    expect(t.map((x) => [x.pointer, x.fields.map((f) => f.name)])).toEqual([
      ['', ['company', 'address.city', 'address.geo.lat', 'address.geo.lon', '%Key_employees']],
      ['/employees', ['%Key_employees', 'employees.name.first', 'employees.name.last', '%Key_employees.tags', '%Key_employees.projects']],
      ['/employees/*/tags', ['%Key_employees.tags', 'employees.tags.@1']],
      ['/employees/*/projects', ['%Key_employees.projects', 'employees.projects.code', 'employees.projects.hours']],
    ]);
  });
  it('escapes / in pointers and keeps odd keys', () => {
    const t = engineTables(shapeOf(fx('json/odd-keys.json')));
    expect(t[1].pointer).toBe('/*/arr~1s');
    expect(t[0].fields.map((f) => f.name)).toEqual(['G/L Account No.', 'a.b', 'tilde~key', '%Key_arr/s']);
  });
  it('treats mixed scalar/object members as both', () => {
    const t = engineTables(shapeOf(fx('json/mixed-types.json')));
    expect(t[0].fields.map((f) => f.name)).toEqual(['id', 'value', 'value.amount', 'value.currency', '%Key_value', 'meta']);
    expect(t[0].mixed).toEqual(['value']);
  });
  it('detects matrices', () => {
    expect(engineTables(shapeOf(fx('json/matrix.json')))[0]).toMatchObject({ kind: 'matrix', pointer: '/*/' });
  });
});

describe('generateEngine', () => {
  it('escapes quote, dollar and backtick inside JSON strings', () => {
    expect(scriptSafeJson({ a: "O'Connor $(x) `t`" })).toBe('{"a":"O\\u0027Connor \\u0024(x) \\u0060t\\u0060"}');
  });
  it('emits a star load per table from a file, with a warning about content-hash keys', () => {
    const r = generateEngine([fx('json/nested.json')], { source: { kind: 'file', path: 'lib://DataFiles/n.json' }, rootName: 'Company', mode: 'star' });
    expect(r.script).toContain("[Company.employees.projects]:\nLOAD * FROM [lib://DataFiles/n.json] (json, table is '/employees/*/projects');");
    expect(r.warnings.some((w) => w.message.includes('hashes of the array content'))).toBe(true);
  });
  it('rebuilds link keys from %Path by default (verified: identical arrays no longer share keys)', () => {
    const r = generateEngine([fx('json/dup-arrays.json')], { source: { kind: 'inline' }, rootName: 'O' });
    expect(r.script).toContain("[%Path] & '/lines' AS [%Key_lines]");
    expect(r.script).toContain("Left([%Path], Index([%Path], '/', -1) - 1) AS [%Key_lines],");
    expect(r.script).toContain("[%Path] & '/tags' AS [%Key_lines.tags]");
    const nested = generateEngine([fx('json/nested.json')], { source: { kind: 'file', path: 'x' }, rootName: 'C' });
    expect(nested.script).toContain("'/employees' AS [%Key_employees]");
  });
  it('tags documents with __rowid for a field source', () => {
    const r = generateEngine(fx('db-column/orders.json') as Json[], {
      source: { kind: 'field', table: 'Orders', field: 'payload', keyField: 'id' },
      rootName: 'Order',
    });
    expect(r.script).toContain("JsonSet([payload], '/__rowid', RecNo()) AS __json");
    expect(r.script).toContain("FileName() & '|' & Left([%Path], Index([%Path], '/', -1) - 1) AS [%Key_lines.tags],");
    expect(r.script).toContain("FileName() & '|' & '/lines' AS [%Key_lines]");
    expect(r.script).toContain("From_Field([Orders_json], __json) (json, table is '/lines/*/tags');");
  });
  it('builds JsonGet chains that skip empty arrays', () => {
    const r = generateEngine(fx('db-column/orders.json') as Json[], {
      source: { kind: 'field', table: 'Orders', field: 'payload', keyField: 'id', method: 'jsonget' },
      rootName: 'Order',
    });
    expect(r.script).toContain('WHERE NOT IsNull(__j2);\nLOAD Hash128(__k0, __j1) AS __k1, JsonGet(__j1, \'/tags/*\') AS __j2;');
  });
  it('warns about double-encoded JSON and dotted keys', () => {
    const r = generateEngine([fx('json/mixed-types.json')], { source: { kind: 'inline' } });
    expect(r.warnings.map((w) => w.message).join('\n')).toMatch(/double-encoded/);
    const o = generateEngine([fx('json/odd-keys.json')], { source: { kind: 'inline' } });
    expect(o.warnings.some((w) => w.message.includes('FieldNameDelimiter'))).toBe(true);
  });
});

describe('REST connector metadata', () => {
  it('matches the script the connector generates for a single nested table', () => {
    const doc = { presidents: { president: [{ POSITION: 1, LNAME: 'Washington', FNAME: 'George', PARTY: 'None' }] } };
    expect(selectStatement(restMetadata(doc))).toBe(
      [
        'SQL SELECT ',
        '\t"__KEY_presidents",',
        '\t(SELECT ',
        '\t\t"POSITION",',
        '\t\t"LNAME",',
        '\t\t"FNAME",',
        '\t\t"PARTY",',
        '\t\t"__FK_president"',
        '\tFROM "president" FK "__FK_president")',
        'FROM JSON (wrap off) "presidents" PK "__KEY_presidents"',
      ].join('\n'),
    );
  });
  it('names arrays of simple values like the connector (@Value, @Value_u0 ...)', () => {
    const m = restMetadata({ a1: [1], a2: [2], empty_array: [] });
    expect(m.tables.map((t) => t.valueField?.alias)).toEqual([undefined, '@Value', '@Value_u0', '@Value_u1']);
    expect(m.wrap).toBe(true);
  });
  it('wraps a root array as "root"', () => {
    const m = restMetadata([{ a: 1 }]);
    expect([m.root.name, m.wrap, m.root.pk]).toEqual(['root', true, undefined]);
  });
  it('suffixes duplicate names globally in pre-order', () => {
    const m = restMetadata(fx('json/qlik-cloud-users-page.json'));
    expect(m.tables.map((t) => t.alias)).toEqual(['root', 'data', 'roles', 'assignedGroups', 'links', 'self', 'links_u0', 'self_u0', 'next']);
    expect(m.tables.find((t) => t.alias === 'next')!.fields[0].alias).toBe('href_u1');
  });
});

describe('generateRest', () => {
  const users = fx('json/qlik-cloud-users-page.json');
  it('never emits unsupported WITH CONNECTION keywords', () => {
    const r = generateRest(users, { connection: 'c', url: 'https://x/api', query: [['limit', '5']], headers: [['Accept', 'application/json']] });
    expect(r.script).toMatch(/WITH CONNECTION \(\n\tURL "https:\/\/x\/api",\n\tQUERY "limit" "5",\n\tHTTPHEADER "Accept" "application\/json"\n\);/);
    expect(r.script).not.toMatch(/\b(METHOD|PAGINATION|TIMEOUT)\b/);
    expect(r.checklist.join(' ')).toContain('"Retry codes" to 502, 503, 504');
    expect(r.checklist.join(' ')).toContain('Retry-After');
  });
  it('flattens single-row objects into their parent', () => {
    const r = generateRest(users, { connection: 'c', url: 'u' });
    expect(r.script).toContain('LEFT JOIN ([data])');
    expect(r.script).toContain('[href] AS [links.self.href]');
    expect(r.script).toContain('DROP FIELDS [__KEY_links] FROM [data];');
  });
  it('pages with NOCONCATENATE page tables and page-unique keys', () => {
    const r = generateRest(users, { connection: 'c', url: 'u', pagination: { type: 'nexturl', table: 'next', field: 'href' } });
    expect(r.script).toContain("[__page_data]:\n\tNOCONCATENATE LOAD");
    expect(r.script).toContain("'$(vPage)|' & [__KEY_data] AS [__KEY_data]");
    expect(r.script).toContain('NOCONCATENATE LOAD [href_u1] AS __next');
    expect(r.script).toContain("LOOP WHILE Len('$(vNextUrl)') > 0 AND '$(vNextUrl)' <> '$(vLastUrl)';");
    expect(r.script).not.toContain('vMaxPages');
    const capped = generateRest(users, { connection: 'c', url: 'u', pagination: { type: 'nexturl', table: 'next', field: 'href' }, maxPages: 5 });
    expect(capped.script).toContain('LET vMaxPages = 5;');
    expect(capped.script).toContain("<> '$(vLastUrl)' AND vPage < vMaxPages;");
    expect(r.script).not.toMatch(/THEN DROP/);
  });
  it('supports offset paging on a records table', () => {
    const r = generateRest(users, {
      connection: 'c',
      url: 'u',
      pagination: { type: 'offset', offsetParam: 'offset', limitParam: 'limit', limit: 100, recordsTable: 'data' },
    });
    expect(r.script).toContain('QUERY "offset" "$(vOffset)"');
    expect(r.script).toContain("LET vRows = Alt(NoOfRows('__page_data'), 0);");
    expect(r.warnings).toEqual([]);
  });
});

describe('generateRest, paged by the connection', () => {
  const users = fx('json/qlik-cloud-users-page.json');
  const setting = (r: ReturnType<typeof generateRest>, label: string) => r.connectionSettings?.find((s) => s.label === label)?.value;

  it('Next URL: one SELECT, plain keys, and the link path the connection needs', () => {
    const r = generateRest(users, {
      connection: 'c',
      url: 'https://x/api/v1/users',
      query: [['limit', '100']],
      pagination: { type: 'nexturl', table: 'next', field: 'href' },
      pagingBy: 'connector',
    });
    expect(r.script).not.toMatch(/\bDO\b|LOOP WHILE|vPage/);
    expect(r.script.match(/SQL SELECT/g)).toHaveLength(1);
    expect(r.script).toContain('QUERY "limit" "100"');
    expect(setting(r, 'Pagination type')).toBe('Next URL');
    expect(setting(r, "'Next url' path")).toBe('root/links/next/href');
    expect(r.script).toContain("//   'Next url' path: root/links/next/href");
    expect(r.checklist.join(' ')).not.toContain('Leave the connection');
    expect(r.checklist.join(' ')).toContain('Retries are counted per SELECT');
    expect(r.warnings).toEqual([]);
  });

  it('Offset: leaves clashing QUERY parameters out and points the data indicator at the records', () => {
    const r = generateRest(users, {
      connection: 'c',
      url: 'u',
      query: [['limit', '100'], ['status', 'active']],
      pagination: { type: 'offset', offsetParam: 'offset', limitParam: 'limit', limit: 50, recordsTable: 'data' },
      pagingBy: 'connector',
    });
    expect(r.script).not.toContain('QUERY "limit"');
    expect(r.script).toContain('QUERY "status" "active"');
    expect(r.warnings.map((w) => w.message).join(' ')).toContain('QUERY "limit" left out');
    expect(setting(r, "'Count' initial value")).toBe('50');
    expect(setting(r, 'Data indicator path')).toBe('root/data/id');
  });

  it('Next page with a total uses the total path instead of a data indicator', () => {
    const r = generateRest(users, {
      connection: 'c',
      url: 'u',
      pagination: { type: 'page', pageParam: 'page', sizeParam: 'pageSize', size: 100, start: 1, recordsTable: 'data', total: { table: 'root', field: 'totalResults' } },
      pagingBy: 'connector',
    });
    expect(setting(r, 'Pagination type')).toBe('Next page');
    expect(setting(r, "'Total pages' path")).toBe('root/totalResults');
    expect(setting(r, 'Data indicator path')).toBe('');
  });

  it('Next token reserves the token parameter', () => {
    const r = generateRest(users, {
      connection: 'c',
      url: 'u',
      query: [['pageToken', 'x']],
      pagination: { type: 'token', table: 'next', field: 'href', param: 'pageToken' },
      pagingBy: 'connector',
    });
    expect(r.script).not.toContain('QUERY "pageToken"');
    expect(setting(r, "'Next token' parameter name")).toBe('pageToken');
  });

  it('keeps the older pagination type "connector" working', () => {
    const r = generateRest(users, { connection: 'c', url: 'u', pagination: { type: 'connector' } });
    expect(r.script).not.toContain('LOOP WHILE');
    expect(r.script).toContain('// Paged by the connection');
  });
});
