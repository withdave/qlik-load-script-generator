// Writes the skill's examples/*.qvs from the fixtures, using the same options the tenant harness
// verified (tenant/build-fixture-script.ts). Run: npm run examples:skill
import { readFileSync, writeFileSync } from 'node:fs';
import { parseTabular } from '../src/core/detect';
import { generateInline } from '../src/core/inline/generate';
import { generateEngine } from '../src/core/json/engine';
import { generateRest } from '../src/core/json/rest';
import type { Json } from '../src/core/parse/json';

const root = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const json = (p: string) => JSON.parse(read(p)) as Json;
const dir = 'skills/qlik-inline-json-rest-generator/examples/';
const VERIFIED = '// Verified by reloading in Qlik Cloud (see tenant/build-fixture-script.ts).';
const write = (name: string, header: string, script: string, note = VERIFIED) =>
  writeFileSync(new URL(dir + name, root), `// ${header}\n${note}\n\n${script}`);

write('inline-tricky.qvs', 'Pasted CSV with ], $(, quotes, a line break, // and leading zeros.', generateInline(parseTabular(read('fixtures/tabular/nasty.csv')).table, { tableName: 'Notes' }).script);
write('inline-excel.qvs', 'Excel / Google Sheets clipboard (tab separated).', generateInline(parseTabular(read('fixtures/tabular/excel-clipboard.tsv')).table, { tableName: 'Products' }).script);
write('engine-file-nested.qvs', 'Nested JSON file: one load per array, linked by keys rebuilt from %Path.', generateEngine([json('fixtures/json/nested.json')], { source: { kind: 'file', path: 'lib://DataFiles/company.json' }, rootName: 'Company' }).script, '// Verified in Qlik Cloud with the same JSON loaded INLINE (same table is paths, field names and keys).');
write('engine-file-star.qvs', 'Nested JSON file with LOAD * (engine %Key_ content hashes: identical arrays share keys).', generateEngine([json('fixtures/json/nested.json')], { source: { kind: 'file', path: 'lib://DataFiles/company.json' }, rootName: 'Company', mode: 'star' }).script, '// Verified in Qlik Cloud with the same JSON loaded INLINE. Prefer engine-file-nested.qvs when arrays can repeat.');
write('engine-inline-sample.qvs', "Embedded JSON sample (', $ and ` are \\u-escaped).", generateEngine([json('fixtures/json/simple.json')], { source: { kind: 'inline' }, rootName: 'People' }).script);
write('engine-matrix.qvs', '[][] matrix with a header row (native, current Qlik Cloud).', generateEngine([json('fixtures/json/matrix.json')], { source: { kind: 'inline' }, rootName: 'Life' }).script);
write('engine-matrix-jsonget.qvs', '[][] matrix for older engines (JsonGet preceding load).', generateEngine([json('fixtures/json/matrix.json')], { source: { kind: 'inline' }, rootName: 'Life', matrix: 'jsonget' }).script);
const orders = json('fixtures/db-column/orders.json') as Json[];
for (const method of ['reader', 'jsonget'] as const)
  write(
    `engine-db-column-${method}.qvs`,
    `JSON held in a column of a loaded table (method: ${method}).`,
    generateEngine(orders, { source: { kind: 'field', table: 'Orders', field: 'payload', keyField: 'id', method, sampleTable: true }, rootName: 'Order' }).script,
  );
const users = json('fixtures/json/qlik-cloud-users-page.json');
write('rest-faithful.qvs', 'REST connector, exactly as the Select data dialog generates it.', generateRest(users, { connection: 'monitoring_apps_REST', url: 'https://your-tenant.eu.qlikcloud.com/api/v1/users?limit=100', flatten: false, naming: 'connector' }).script);
write('rest-flat.qvs', 'REST connector with nested objects merged into their parent table.', generateRest(users, { connection: 'monitoring_apps_REST', url: 'https://your-tenant.eu.qlikcloud.com/api/v1/users', query: [['limit', '100']] }).script);
write(
  'rest-nexturl-paging.qvs',
  'REST connector, Next URL pagination in script (Qlik Cloud APIs: links.next.href).',
  generateRest(users, { connection: 'monitoring_apps_REST', url: 'https://your-tenant.eu.qlikcloud.com/api/v1/users', query: [['limit', '100']], pagination: { type: 'nexturl', table: 'next', field: 'href' } }).script,
);
write(
  'rest-offset-paging.qvs',
  'REST connector, offset/limit pagination in script.',
  generateRest(users, { connection: 'My REST', url: 'https://api.example.com/v1/users', pagination: { type: 'offset', offsetParam: 'offset', limitParam: 'limit', limit: 100, recordsTable: 'data' } }).script,
  '// Not reloaded (Qlik Cloud APIs page by next link); same loop structure as the verified rest-nexturl-paging.qvs.',
);
write(
  'rest-paged-by-connection.qvs',
  "REST connector, one SELECT paged by the connection's own Next URL pagination.",
  generateRest(users, { connection: 'Qlik Cloud API (paged)', url: 'https://your-tenant.eu.qlikcloud.com/api/v1/users', query: [['limit', '100']], pagination: { type: 'nexturl', table: 'next', field: 'href' }, pagingBy: 'connector' }).script,
  "// Not reloaded yet: the settings follow the REST connector's own pagination rules.",
);
console.log('examples written');
