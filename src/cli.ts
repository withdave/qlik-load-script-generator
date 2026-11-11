// Command-line front end to the generators; bundled into the Claude skill as scripts/qlik-gen.mjs.
//   qlik-gen inline [file|-] [--table T] [--format auto|delimited|markdown|html|json|ndjson] [--mapping] [--null] [--verbatim]
//   qlik-gen engine [file|-] [--source file|inline|field] [--path lib://...] [--table T --field F --key K --method reader|jsonget|fromfield --sample]
//                   [--mode explicit|star|alltables] [--root Name] [--matrix native|jsonget] [--max-depth N] [--exclude /ptr]...
//   qlik-gen rest   [file|-] --connection C --url U [--query k=v]... [--header 'K: V']... [--body text] [--no-flatten] [--naming path|connector]
//                   [--paging none|nexturl|token|offset|page] [--paging-by script|connector] [--next json.path.to.field] [--token-param p]
//                   [--offset-param p] [--limit-param p] [--limit N] [--page-param p] [--size-param p] [--start N] [--records table]
//                   [--total json.path.to.total] [--max-pages N] [--exclude table]...
//   qlik-gen inspect [file|-]   print the engine tables and REST connector tables for a JSON sample
// The script goes to stdout; warnings, the connection checklist and connection pagination settings go to stderr.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseTabular } from './core/detect';
import { generateInline } from './core/inline/generate';
import { generateEngine, type EngineOptions } from './core/json/engine';
import { generateRest, restMetadata, type ConnectionSetting, type FieldRef, type Pagination } from './core/json/rest';
import { shapeOf } from './core/json/shape';
import { engineTables, tableLabel } from './core/json/tables';
import type { InputFormat, Warning } from './core/model';
import { parseNdjson, tryParseJson, type Json } from './core/parse/json';

const [cmd, ...rest] = process.argv.slice(2);
const { values: o, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    table: { type: 'string' },
    format: { type: 'string' },
    mapping: { type: 'boolean' },
    null: { type: 'boolean' },
    verbatim: { type: 'boolean' },
    source: { type: 'string' },
    path: { type: 'string' },
    field: { type: 'string' },
    key: { type: 'string' },
    method: { type: 'string' },
    sample: { type: 'boolean' },
    mode: { type: 'string' },
    root: { type: 'string' },
    matrix: { type: 'string' },
    'max-depth': { type: 'string' },
    exclude: { type: 'string', multiple: true },
    connection: { type: 'string' },
    url: { type: 'string' },
    query: { type: 'string', multiple: true },
    header: { type: 'string', multiple: true },
    body: { type: 'string' },
    'no-flatten': { type: 'boolean' },
    naming: { type: 'string' },
    paging: { type: 'string' },
    'paging-by': { type: 'string' },
    total: { type: 'string' },
    next: { type: 'string' },
    'token-param': { type: 'string' },
    'offset-param': { type: 'string' },
    'limit-param': { type: 'string' },
    limit: { type: 'string' },
    'page-param': { type: 'string' },
    'size-param': { type: 'string' },
    start: { type: 'string' },
    records: { type: 'string' },
    'max-pages': { type: 'string' },
  },
});

const input = (): string => readFileSync(positionals[0] && positionals[0] !== '-' ? positionals[0] : 0, 'utf8');
const num = (s: string | undefined, d: number) => (s && Number.isFinite(Number(s)) ? Number(s) : d);
const report = (warnings: Warning[], checklist: string[] = [], settings: ConnectionSetting[] = []) => {
  for (const w of warnings) process.stderr.write(`// ${w.level.toUpperCase()}: ${w.message}\n`);
  for (const c of checklist) process.stderr.write(`// CHECK: ${c}\n`);
  for (const s of settings) process.stderr.write(`// CONNECTION: ${s.label} = ${s.value || '(empty)'}${s.hint ? `  (${s.hint})` : ''}\n`);
};
function json(text: string, perRow: boolean): Json[] {
  const r = tryParseJson(text.trim());
  if (r.ok) return perRow && Array.isArray(r.value) && r.value.length ? r.value : [r.value];
  const nd = parseNdjson(text);
  if (nd) return perRow ? nd : [nd];
  throw new Error(`Invalid JSON: ${r.error}`);
}

try {
  switch (cmd) {
    case 'inline': {
      const { table } = parseTabular(input(), o.format && o.format !== 'auto' ? { format: o.format as InputFormat } : {});
      const r = generateInline(table, { tableName: o.table, mapping: o.mapping, emptyAsNull: o.null, preserveWhitespace: o.verbatim });
      process.stdout.write(r.script);
      report(r.warnings);
      break;
    }
    case 'engine': {
      const kind = o.source ?? (o.path ? 'file' : o.field ? 'field' : 'inline');
      const source: EngineOptions['source'] =
        kind === 'file'
          ? { kind: 'file', path: o.path ?? 'lib://DataFiles/data.json' }
          : kind === 'field'
            ? {
                kind: 'field',
                table: o.table ?? 'Source',
                field: o.field ?? 'json',
                keyField: o.key,
                method: (o.method as 'reader' | 'jsonget' | 'fromfield') ?? 'reader',
                sampleTable: o.sample,
              }
            : { kind: 'inline' };
      const r = generateEngine(json(input(), kind === 'field'), {
        source,
        mode: (o.mode as EngineOptions['mode']) ?? 'explicit',
        rootName: o.root,
        matrix: (o.matrix as EngineOptions['matrix']) ?? 'native',
        maxDepth: o['max-depth'] ? num(o['max-depth'], 99) : undefined,
        exclude: o.exclude,
      });
      process.stdout.write(r.script);
      report(r.warnings);
      break;
    }
    case 'rest': {
      // Accept a JSON path (links.next.href, meta.nextCursor) or connector table.field (next.href):
      // the connector names a table after its property, so the last two segments are table and field.
      const fieldRef = (p: string): FieldRef => {
        const segs = p.split('.');
        return { table: segs.length > 1 ? segs[segs.length - 2] : 'root', field: segs[segs.length - 1] };
      };
      const { table, field: nextField } = fieldRef(o.next ?? 'next.href');
      const f = [nextField];
      const total = o.total ? fieldRef(o.total) : undefined;
      let type = (o.paging ?? 'none') as Pagination['type'];
      let pagingBy = (o['paging-by'] ?? 'script') as 'script' | 'connector';
      // Older form: --paging connector meant "paged by the connection, Next URL".
      if (type === 'connector') [type, pagingBy] = ['nexturl', 'connector'];
      const pagination: Pagination =
        type === 'nexturl'
          ? { type, table, field: f.join('.') }
          : type === 'token'
            ? { type, table, field: f.join('.'), param: o['token-param'] ?? 'pageToken' }
            : type === 'offset'
              ? { type, offsetParam: o['offset-param'] ?? 'offset', limitParam: o['limit-param'] ?? 'limit', limit: num(o.limit, 100), recordsTable: o.records ?? 'data', total }
              : type === 'page'
                ? { type, pageParam: o['page-param'] ?? 'page', sizeParam: o['size-param'], size: num(o.limit, 100), start: num(o.start, 1), recordsTable: o.records ?? 'data', total }
                : { type: 'none' };
      const split = (s: string, sep: string): [string, string] => {
        const i = s.indexOf(sep);
        return i < 0 ? [s.trim(), ''] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
      };
      const r = generateRest(json(input(), false)[0], {
        connection: o.connection ?? 'REST connection',
        url: o.url ?? 'https://api.example.com/items',
        query: (o.query ?? []).map((q) => split(q, '=')),
        headers: (o.header ?? []).map((q) => split(q, ':')),
        body: o.body,
        flatten: !o['no-flatten'],
        naming: (o.naming as 'path' | 'connector') ?? 'path',
        exclude: o.exclude,
        pagination,
        pagingBy,
        maxPages: o['max-pages'] ? num(o['max-pages'], 0) : undefined,
      });
      process.stdout.write(r.script);
      report(r.warnings, r.checklist, r.connectionSettings);
      break;
    }
    case 'inspect': {
      const doc = json(input(), false)[0];
      process.stdout.write('// Engine (json) tables\n');
      for (const t of engineTables(shapeOf(doc)))
        process.stdout.write(`//   ${tableLabel(t, o.root ?? 'Data')}  table is '${t.pointer}'  [${t.kind}]  ${t.fields.map((x) => x.name).join(', ')}\n`);
      const m = restMetadata(doc);
      process.stdout.write(`// REST connector tables (root "${m.root.name}", wrap ${m.wrap ? 'on' : 'off'})\n`);
      for (const t of m.tables)
        process.stdout.write(
          `//   ${t.alias}${t.isArray ? '[]' : '{}'}  ${t.fields.map((x) => (x.alias === x.name ? x.name : `${x.name} AS ${x.alias}`)).join(', ')}${t.pk ? `  PK ${t.pk}` : ''}${t.fk ? `  FK ${t.fk}` : ''}\n`,
        );
      break;
    }
    default:
      process.stderr.write('Usage: qlik-gen <inline|engine|rest|inspect> [file|-] [options]. See the header of src/cli.ts or SKILL.md.\n');
      process.exit(2);
  }
} catch (e) {
  process.stderr.write(`Error: ${(e as Error).message}\n`);
  process.exit(1);
}
