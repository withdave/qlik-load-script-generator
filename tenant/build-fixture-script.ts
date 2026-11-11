// Builds one load script that exercises every generator against the fixtures, for a test app in Qlik Cloud.
// Each section loads, records checks into [__checks] (pass/FAIL) and the actual table/field names
// into [__fields], then drops its own tables so sections cannot interfere.
//   npm run fixtures:tenant -- [restConnection] [tenant-host] [pagedConnection]   → tenant/out/fixtures.qvs
//   pagedConnection (optional): a REST connection whose Pagination type is Next URL with 'Next url' path
//   root/links/next/href; adds a section that checks paging done by the connection.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseTabular } from '../src/core/detect';
import { generateInline } from '../src/core/inline/generate';
import { generateEngine, type EngineOptions } from '../src/core/json/engine';
import { fieldOutputName, generateRest, type RestOptions } from '../src/core/json/rest';
import { tableLabel } from '../src/core/json/tables';
import type { Json } from '../src/core/parse/json';

const root = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const json = (p: string) => JSON.parse(read(p)) as Json;
const restConnection = process.argv[2] ?? 'monitoring_apps_REST';
const tenant = process.argv[3] ?? 'your-tenant.eu.qlikcloud.com';
const pagedConnection = process.argv[4];

/** Script string literal that may contain newlines, quotes and $( . */
function lit(s: string): string {
  const parts = s.split(/(\r\n|\n|\r)/);
  return (
    parts
      .map((p) =>
        p === '\r\n' ? 'Chr(13)&Chr(10)' : p === '\n' ? 'Chr(10)' : p === '\r' ? 'Chr(13)' : `'${p.replace(/'/g, "''").split('$(').join("'&Chr(36)&'(")}'`,
      )
      .filter((p) => p !== "''")
      .join('&') || "''"
  );
}

const out: string[] = [
  '///$tab Main',
  'SET ErrorMode = 0;',
  "SET DecimalSep = '.';",
  "SET ThousandSep = ',';",
  '',
  '// Record table/field names of the section, then drop its tables.',
  'SUB __snapshot(vSection)',
  '  FOR __t = NoOfTables() - 1 TO 0 STEP -1',
  '    LET __tn = TableName($(__t));',
  "    IF '$(__tn)' <> '__checks' AND '$(__tn)' <> '__fields' THEN",
  "      FOR __f = 1 TO NoOfFields('$(__tn)')",
  '        __fields:',
  "        LOAD '$(vSection)' AS field_section, '$(__tn)' AS field_table, FieldName($(__f), '$(__tn)') AS field_name, NoOfRows('$(__tn)') AS field_table_rows AUTOGENERATE 1;",
  '      NEXT',
  '      DROP TABLE [$(__tn)];',
  '    END IF',
  '  NEXT',
  'END SUB',
  '',
  'SUB __hasfields(vSection, vTable, vList)',
  "  LET __miss = '';",
  "  FOR __i = 1 TO SubStringCount('$(vList)', '|') + 1",
  "    LET __fn = SubField('$(vList)', '|', $(__i));",
  "    IF FieldNumber('$(__fn)', '$(vTable)') = 0 THEN",
  "      LET __miss = '$(__miss)' & '$(__fn) ';",
  '    END IF',
  '  NEXT',
  "  __checks: LOAD '$(vSection)' AS check_section, 'fields of $(vTable)' AS check_name, If(Len('$(__miss)') = 0, 'pass', 'FAIL') AS check_result, '$(__miss)' AS check_actual AUTOGENERATE 1;",
  'END SUB',
  '',
  "__checks: LOAD 'init' AS check_section, 'init' AS check_name, 'pass' AS check_result, '' AS check_actual AUTOGENERATE 1;",
  "__fields: LOAD 'init' AS field_section, '' AS field_table, '' AS field_name, 0 AS field_table_rows AUTOGENERATE 1;",
  '',
];

let n = 0;
/** A check row computed by a LOAD expression (avoids CALL argument quoting problems). */
function check(section: string, name: string, ok: string, actual = "''") {
  n++;
  return `__checks: LOAD '${section}' AS check_section, ${lit(name)} AS check_name, If(${ok}, 'pass', 'FAIL') AS check_result, Text(${actual}) AS check_actual AUTOGENERATE 1;`;
}

/** One check that all fields exist in a table; check_actual lists the missing ones. */
function fieldsCheck(section: string, table: string, fields: string[]) {
  n++;
  return `CALL __hasfields('${section}', ${lit(table)}, ${lit(fields.join('|'))});`;
}

function section(name: string, body: string[]) {
  out.push(`///$tab ${name}`, `TRACE ===== ${name};`, ...body, `CALL __snapshot('${name}');`, '');
}

// ---------- Inline tables ----------
for (const f of ['simple.csv', 'nasty.csv', 'excel-clipboard.tsv', 'table.md', 'table.html', 'dup-headers.csv']) {
  const { table } = parseTabular(read(`fixtures/tabular/${f}`));
  const name = `inline_${f.replace(/\W/g, '_')}`;
  const r = generateInline(table, { tableName: name });
  const checks = [check(name, 'rows', `NoOfRows('${name}') = ${table.rows.length}`, `NoOfRows('${name}')`)];
  checks.push(fieldsCheck(name, name, r.fields.map((f) => f.name)));
  // Whole-table content check: every cell, in load order, joined with | and ¶.
  const cells = r.fields.map((f) => `Text([${f.name.replace(/]/g, ']]')}])`).join(` & '|' & `);
  const expected = table.rows.map((row) => r.fields.map((_, c) => (row[c] ?? '').trim()).join('|')).join('¶');
  checks.push(
    `__checks: LOAD '${name}' AS check_section, 'content' AS check_name, If(Concat(${cells}, '¶', RecNo()) = ${lit(expected)}, 'pass', 'FAIL') AS check_result, Concat(${cells}, '¶', RecNo()) AS check_actual RESIDENT [${name}];`,
  );
  section(name, [r.script, ...checks]);
}

// Open questions: semicolons / REM / no quotes inside INLINE.
section('inline_probe', [
  'probe_semicolon:',
  'LOAD * INLINE [',
  'a,b',
  'x;y,REM not a comment',
  '];',
  check('inline_probe', 'semicolon kept', "Peek('a',0,'probe_semicolon') = 'x;y'", "Peek('a',0,'probe_semicolon')"),
  check('inline_probe', 'REM kept', "Peek('b',0,'probe_semicolon') = 'REM not a comment'", "Peek('b',0,'probe_semicolon')"),
  'probe_noquotes:',
  'LOAD * INLINE [',
  'nq',
  '"quoted"',
  '] (no quotes);',
  check('inline_probe', 'no quotes keeps quotes', `Peek('nq',0,'probe_noquotes') = Chr(34)&'quoted'&Chr(34)`, "Peek('nq',0,'probe_noquotes')"),
  'probe_brackets:',
  'LOAD * INLINE [',
  'br',
  'x]]y',
  '];',
  check('inline_probe', ']] doubling in data', "Peek('br',0,'probe_brackets') = 'x]y'", "Peek('br',0,'probe_brackets')"),
  'probe_zero:',
  'LOAD 1 AS zero_rows AUTOGENERATE 0;',
  check('inline_probe', 'zero-row load creates table', "NOT IsNull(TableNumber('probe_zero'))", "TableNumber('probe_zero')"),
]);

// ---------- Engine JSON ----------
function engineSection(name: string, samples: Json[], opts: EngineOptions, extra: string[] = []) {
  const r = generateEngine(samples, opts);
  const rootName = opts.rootName ?? 'Data';
  const checks: string[] = [];
  if (opts.mode !== 'alltables')
    for (const t of r.tables) {
      if (t.kind === 'empty' || t.kind === 'matrix') continue;
      if (opts.exclude?.includes(t.pointer)) continue;
      const tl = tableLabel(t, rootName);
      checks.push(check(name, `table ${tl}`, `NoOfRows(${lit(tl)}) > 0`, `NoOfRows(${lit(tl)})`));
      if (opts.source.kind === 'field' && opts.source.method === 'jsonget') continue;
      checks.push(fieldsCheck(name, tl, t.fields.map((f) => f.name)));
    }
  section(name, [r.script, ...checks, ...extra]);
}

const inline: EngineOptions['source'] = { kind: 'inline' };
engineSection('json_simple_explicit', [json('fixtures/json/simple.json')], { source: inline, mode: 'explicit', rootName: 'People' }, [
  check('json_simple_explicit', 'rows', "NoOfRows('People') = 3"),
  check('json_simple_explicit', 'unicode-escaped quote and $', `Peek('name', 2, 'People') = 'O''Connor '&Chr(36)&'(x)'`, "Peek('name', 2, 'People')"),
  check('json_simple_explicit', 'null score', "IsNull(Peek('score', 1, 'People'))", "Peek('score', 1, 'People')"),
  check('json_simple_explicit', 'boolean', "Peek('active', 0, 'People') = 'true' OR Peek('active', 0, 'People') = -1", "Peek('active', 0, 'People')"),
]);
engineSection('json_nested_star', [json('fixtures/json/nested.json')], { source: inline, rootName: 'Company', mode: 'star' }, [
  check('json_nested_star', 'projects rows', "NoOfRows('Company.employees.projects') = 3", "NoOfRows('Company.employees.projects')"),
  check('json_nested_star', 'tags rows', "NoOfRows('Company.employees.tags') = 2", "NoOfRows('Company.employees.tags')"),
]);
engineSection('json_nested_pathkeys', [json('fixtures/json/nested.json')], { source: inline, rootName: 'Company' }, [
  check('json_nested_pathkeys', 'projects rows', "NoOfRows('Company.employees.projects') = 3", "NoOfRows('Company.employees.projects')"),
  check('json_nested_pathkeys', 'projects link to 2 employees', "FieldValueCount('%Key_employees.projects') = 2", "FieldValueCount('%Key_employees.projects')"),
  check('json_nested_pathkeys', 'root links to employees', "FieldValueCount('%Key_employees') = 1", "FieldValueCount('%Key_employees')"),
]);
engineSection('json_dup_arrays', [json('fixtures/json/dup-arrays.json')], { source: inline, rootName: 'O' }, [
  check('json_dup_arrays', 'one line key per order', "FieldValueCount('%Key_lines') = 3", "FieldValueCount('%Key_lines')"),
  check('json_dup_arrays', 'one tag key per line', "FieldValueCount('%Key_lines.tags') = 3", "FieldValueCount('%Key_lines.tags')"),
  check('json_dup_arrays', 'line rows', "NoOfRows('O.lines') = 3", "NoOfRows('O.lines')"),
]);
engineSection('json_dup_arrays_star', [json('fixtures/json/dup-arrays.json')], { source: inline, rootName: 'O', mode: 'star' }, [
  check('json_dup_arrays_star', 'engine keys collide (expected)', "FieldValueCount('%Key_lines') = 2", "FieldValueCount('%Key_lines')"),
]);
engineSection('json_nested_alltables', [json('fixtures/json/nested.json')], { source: inline, mode: 'alltables' }, [
  check('json_nested_alltables', 'table count >= 4', 'NoOfTables() >= 6', 'NoOfTables()'),
]);
engineSection('json_matrix_native', [json('fixtures/json/matrix.json')], { source: inline, rootName: 'Life' }, [
  check('json_matrix_native', 'rows', "NoOfRows('Life') = 3", "NoOfRows('Life')"),
  check('json_matrix_native', 'header field', "FieldNumber('Life Expectancy', 'Life') > 0"),
]);
engineSection('json_matrix_jsonget', [json('fixtures/json/matrix.json')], { source: inline, rootName: 'Life', matrix: 'jsonget' }, [
  check('json_matrix_jsonget', 'rows', "NoOfRows('Life') = 3", "NoOfRows('Life')"),
  check('json_matrix_jsonget', 'country', "Peek('Country', 0, 'Life') = 'Australia'", "Peek('Country', 0, 'Life')"),
]);
engineSection('json_mixed', [json('fixtures/json/mixed-types.json')], { source: inline });
engineSection('json_oddkeys', [json('fixtures/json/odd-keys.json')], { source: inline }, [
  `__checks: LOAD 'json_oddkeys' AS check_section, 'escaped key links' AS check_name, If(FieldValueCount('%Key_arr/s') = 1, 'pass', 'FAIL') AS check_result, Concat(DISTINCT [%Key_arr/s], ',') AS check_actual RESIDENT [Data.arr/s];`,
]);
engineSection('json_users_engine', [json('fixtures/json/qlik-cloud-users-page.json')], { source: inline, rootName: 'Users' }, [
  `__checks: LOAD 'json_users_engine' AS check_section, 'root object key matches child paths' AS check_name, If(FieldValueCount('%Key_data') = 1, 'pass', 'FAIL') AS check_result, Concat(DISTINCT [%Key_data], ',') AS check_actual RESIDENT [Users.data];`,
]);

const orders = json('fixtures/db-column/orders.json') as Json[];
for (const method of ['reader', 'jsonget', 'fromfield'] as const) {
  const name = `db_${method}`;
  const extra: string[] = [];
  if (method === 'reader')
    extra.push(
      check(name, 'root rows = source rows (duplicates kept)', "NoOfRows('Order') = 3", "NoOfRows('Order')"),
      check(name, 'lines rows', "NoOfRows('Order.lines') = 4", "NoOfRows('Order.lines')"),
      check(name, 'rowid linked', "FieldNumber('__rowid', 'Order') > 0"),
      check(name, 'line keys unique per document', "FieldValueCount('%Key_lines') = 3", "FieldValueCount('%Key_lines')"),
      check(name, 'tag keys unique per line', "FieldValueCount('%Key_lines.tags') = 4", "FieldValueCount('%Key_lines.tags')"),
    );
  if (method === 'jsonget')
    extra.push(
      check(name, 'root rows', "NoOfRows('Order') = 3", "NoOfRows('Order')"),
      check(name, 'lines rows', "NoOfRows('Order.lines') = 4", "NoOfRows('Order.lines')"),
      check(name, 'tags rows', "NoOfRows('Order.lines.tags') = 5", "NoOfRows('Order.lines.tags')"),
    );
  if (method === 'fromfield') extra.push(check(name, 'distinct docs collapse', "NoOfRows('Order') = 2", "NoOfRows('Order')"));
  engineSection(name, orders, { source: { kind: 'field', table: 'Orders', field: 'payload', keyField: 'id', method, sampleTable: true }, rootName: 'Order' }, extra);
}

// ---------- REST connector ----------
const usersSample = json('fixtures/json/qlik-cloud-users-page.json');
function restSection(name: string, opts: RestOptions, extra: string[] = []) {
  const r = generateRest(usersSample, opts);
  section(name, [r.script, ...extra]);
}
const base = `https://${tenant}/api/v1/users`;
restSection('rest_faithful', { connection: restConnection, url: `${base}?limit=5`, flatten: false, naming: 'connector' }, [
  check('rest_faithful', 'data rows > 0', "NoOfRows('data') > 0", "NoOfRows('data')"),
  check('rest_faithful', 'next table', "NoOfRows('next') >= 0", "NoOfRows('next')"),
]);
restSection('rest_flat', { connection: restConnection, url: `${base}?limit=5` }, [
  check('rest_flat', 'data rows > 0', "NoOfRows('data') > 0", "NoOfRows('data')"),
  check('rest_flat', 'self href merged', `FieldNumber(${lit(fieldOutputName(generateRest(usersSample, { connection: '', url: '' }).meta, {}, 'self', 'href'))}, 'data') > 0`),
]);
restSection('rest_nexturl', { connection: restConnection, url: `${base}?limit=2`, pagination: { type: 'nexturl', table: 'next', field: 'href' }, maxPages: 5 }, [
  check('rest_nexturl', 'more than one page', "NoOfRows('data') > 2", "NoOfRows('data')"),
  check('rest_nexturl', 'unique data keys', "FieldValueCount('__KEY_data') = NoOfRows('data')", "FieldValueCount('__KEY_data')"),
  check('rest_nexturl', 'no leftover master table', "IsNull(TableNumber('RestConnectorMasterTable'))", 'NoOfTables()'),
]);

if (pagedConnection)
  restSection('rest_by_connection', { connection: pagedConnection, url: `${base}?limit=2`, pagination: { type: 'nexturl', table: 'next', field: 'href' }, pagingBy: 'connector' }, [
    check('rest_by_connection', 'more than one page from one SELECT', "NoOfRows('data') > 2", "NoOfRows('data')"),
    check('rest_by_connection', 'unique data keys', "FieldValueCount('__KEY_data') = NoOfRows('data')", "FieldValueCount('__KEY_data')"),
  ]);

out.push('///$tab Exit', "TRACE ===== checks: $(n);".replace('$(n)', String(n)), 'EXIT SCRIPT;');

mkdirSync(new URL('tenant/out/', root), { recursive: true });
writeFileSync(new URL('tenant/out/fixtures.qvs', root), out.join('\n') + '\n');
// Some script-upload tools decode \uXXXX escapes once; this copy survives that (\u005C is a backslash).
writeFileSync(new URL('tenant/out/fixtures.transport.qvs', root), out.join('\n').replace(/\\u/g, '\\u005Cu') + '\n');
console.log(`Wrote tenant/out/fixtures.qvs (${out.join('\n').length} chars, ${n} checks)`);
