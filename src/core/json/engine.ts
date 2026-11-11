import type { Warning } from '../model';
import { generateInline } from '../inline/generate';
import type { Json } from '../parse/json';
import { field, JSON_FIELD_LIMIT, JSON_TABLE_LIMIT, label, pointerSegment, ref, SECTION_SOFT_LIMIT, str } from '../qlik';
import { matrixHeader, shapeOf, type Shape } from './shape';
import { engineTables, tableLabel, type EngineTable } from './tables';

export type EngineSource =
  | { kind: 'file'; path: string }
  | { kind: 'inline' }
  | {
      kind: 'field';
      table: string;
      field: string;
      /** Source key kept on the expanded tables (e.g. a primary key). Optional. */
      keyField?: string;
      /** reader: JSON reader via From_Field (default); jsonget: JsonGet preceding loads; fromfield: plain From_Field. */
      method?: 'reader' | 'jsonget' | 'fromfield';
      /** Also emit an INLINE table with the samples, to try the expansion end to end. */
      sampleTable?: boolean;
    };

export interface EngineOptions {
  source: EngineSource;
  /**
   * explicit (default): list the fields and rebuild the link keys from %Path, so records with
   * identical arrays don't share child rows; star: LOAD * with the engine's content-hash %Key_ fields;
   * alltables: one (json, all tables) load.
   */
  mode?: 'star' | 'explicit' | 'alltables';
  rootName?: string;
  /** Pointers of tables to leave out. */
  exclude?: string[];
  /** Skip tables deeper than this many array levels (root = 0). */
  maxDepth?: number;
  /** native: table is '/*\/', embedded labels (current Qlik Cloud); jsonget: JsonGet preceding load. */
  matrix?: 'native' | 'jsonget';
  /** Field name delimiter for nested objects (SET FieldNameDelimiter). Default '.'. */
  fieldDelimiter?: string;
}

export interface EngineResult {
  script: string;
  warnings: Warning[];
  tables: EngineTable[];
  shape: Shape;
}

/** JSON text that is safe inside a single-quoted INLINE/LET: ', $ and ` only occur inside strings, so \u-escape them. */
export function scriptSafeJson(v: Json): string {
  return JSON.stringify(v).replace(/'/g, '\\u0027').replace(/\$/g, '\\u0024').replace(/`/g, '\\u0060');
}

function tableIs(pointer: string): string {
  return pointer.includes("'") && !pointer.includes(']') ? `table is [${pointer}]` : `table is '${pointer}'`;
}

/** Generate engine-native JSON load script for the given samples (one document, or many for a field source). */
export function generateEngine(samples: Json[], opts: EngineOptions): EngineResult {
  const warnings: Warning[] = [];
  const src = opts.source;
  const rootName = opts.rootName || (src.kind === 'field' ? src.field : 'Data');
  const mode = opts.mode ?? 'explicit';
  const out: string[] = [];

  // Each field value is its own document. Tag it with a row id so expanded tables link back.
  const method = src.kind === 'field' ? (src.method ?? 'reader') : undefined;
  const docArray = samples.length > 0 && samples.every((s) => Array.isArray(s));
  const docs =
    method === 'reader'
      ? samples.map((d) => (docArray ? { __rowid: 1, [rootName]: d } : { ...(d as object), __rowid: 1 }))
      : samples;
  const shape = shapeOf(...docs);
  const all = engineTables(shape);
  const exclude = new Set(opts.exclude ?? []);
  const keep = (t: EngineTable): boolean =>
    !exclude.has(t.pointer) && (opts.maxDepth === undefined || t.depth <= opts.maxDepth) && (!t.parent || keep(t.parent));
  const tables = all.filter(keep);
  const skipped = all.filter((t) => !keep(t));

  lint(shape, all, warnings);
  if (mode !== 'explicit' && tables.filter((t) => t.kind !== 'empty').length > 1)
    warnings.push({
      level: 'warn',
      message:
        "The engine's %Key_ fields are hashes of the array content: records whose arrays are identical share one key, so their child rows link to all of them and sums double. 'List every field' rebuilds the keys from %Path instead.",
    });
  if (skipped.length)
    warnings.push({
      level: 'info',
      message: `Not loading ${skipped.length} nested table(s): ${skipped.map((t) => t.path.join('.')).join(', ')}. Their %Key_ fields stay in the parent table.`,
    });

  if (opts.fieldDelimiter && opts.fieldDelimiter !== '.') out.push(`SET FieldNameDelimiter = ${str(opts.fieldDelimiter)};`, '');

  if (src.kind === 'field') {
    if (src.sampleTable) out.push(...sampleTable(samples, src), '');
    if (method === 'jsonget') out.push(...jsonGetLoads(tables, src, rootName, samples, opts));
    else out.push(...fromFieldLoads(tables, src, rootName, method!, mode, opts, docArray, samples));
  } else {
    let from: string;
    if (src.kind === 'file') from = `FROM ${ref(src.path)}`;
    else {
      const json = scriptSafeJson(samples[0]);
      out.push(`LET vJson = '${json}';`, '');
      from = `INLINE '$(vJson)'`;
    }
    out.push(...readerLoads(tables, from, rootName, mode, opts, samples[0], { rootArray: Array.isArray(samples[0]), multiDoc: false }));
    if (src.kind === 'inline') out.push('', 'SET vJson = ;');
  }

  const script = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  if (script.length > SECTION_SOFT_LIMIT)
    warnings.push({
      level: 'warn',
      message: `Script is ${script.length.toLocaleString()} characters (Qlik recommends under 50,000 per section). Upload the JSON as a file and use FROM [lib://...] instead.`,
    });
  return { script, warnings, tables: all, shape };
}

function lint(shape: Shape, tables: EngineTable[], warnings: Warning[]) {
  const fieldCount = tables.reduce((n, t) => n + t.fields.length, 0);
  if (fieldCount > JSON_FIELD_LIMIT || tables.length > JSON_TABLE_LIMIT)
    warnings.push({
      level: 'warn',
      message: `This JSON yields ${fieldCount} fields / ${tables.length} tables; the engine stops at ${JSON_FIELD_LIMIT} / ${JSON_TABLE_LIMIT} per load. Add SET FieldNumberLimit / TableNumberLimit or exclude tables.`,
    });
  for (const t of tables) {
    for (const m of t.mixed)
      warnings.push({
        level: 'warn',
        message: `"${m}" is sometimes a value and sometimes an object/array; you will get both ${m} and its %Key_ field.`,
      });
    if (t.kind === 'empty') warnings.push({ level: 'info', message: `Array "${t.path.join('.')}" is empty in the sample, so its fields are unknown.` });
  }
  const walk = (s: Shape, path: string) => {
    if (s.jsonInString)
      warnings.push({
        level: 'warn',
        message: `"${path}" holds JSON as a string (double-encoded). The reader loads it as text; expand it with a second From_Field / JsonGet load.`,
      });
    for (const [k, c] of s.props ?? []) {
      if (k.includes('.'))
        warnings.push({ level: 'warn', message: `Key "${k}" contains "." which the engine also uses for nesting; consider SET FieldNameDelimiter = ':'.` });
      walk(c, path ? `${path}.${k}` : k);
    }
    if (s.items) walk(s.items, path);
  };
  walk(shape, '');
}

/**
 * LOAD statements for the JSON reader over a FROM / INLINE / From_Field source.
 *
 * The engine's %Key_ fields are hashes of the array content, so records with identical arrays
 * share a key and every copy of the child rows links to all of them (verified on Qlik Cloud).
 * In 'explicit' mode the keys are rebuilt from %Path instead: the parent row's path plus the
 * array's relative pointer equals the child row's path minus its index. %Path is only available
 * with an explicit field list, not with LOAD *. With several documents (From_Field) FileName()
 * (<0>, <1>, ...) tells them apart.
 */
function readerLoads(
  tables: EngineTable[],
  from: string,
  rootName: string,
  mode: string,
  opts: EngineOptions,
  sample: Json | undefined,
  ctx: { rootArray: boolean; multiDoc: boolean },
): string[] {
  const out: string[] = [];
  if (mode === 'alltables') {
    out.push('// One load creates every table; names follow the JSON paths.', `LOAD * ${from} (json, all tables);`);
    return out;
  }
  const pre = ctx.multiDoc ? `FileName() & '|' & ` : '';
  const childKey = `${pre}Left([%Path], Index([%Path], '/', -1) - 1)`;
  const parentKey = (t: EngineTable, c: EngineTable) => {
    // %Path holds the raw keys (verified: a key "arr/s" appears as /0/arr/s), not ~1-escaped pointers.
    const rel = str('/' + c.rel.join('/'));
    return !t.parent && !ctx.rootArray ? `${pre}${rel}` : `${pre}[%Path] & ${rel}`;
  };
  for (const t of tables) {
    if (t.kind === 'empty') continue;
    const specs = ['json'];
    if (t.kind === 'matrix') {
      if (opts.matrix === 'jsonget' && sample !== undefined && !t.parent) {
        out.push(...matrixJsonGet(t, from, rootName, sample));
        continue;
      }
      specs.push(tableIs(t.pointer));
      if (!t.parent && sample !== undefined && matrixHeader(sample)) specs.push('embedded labels');
      out.push(`// [][] matrix: supported on current Qlik Cloud. On older engines, choose the JsonGet matrix option.`);
    } else if (t.pointer) specs.push(tableIs(t.pointer));
    out.push(label(tableLabel(t, rootName)));
    if (mode === 'explicit' && t.kind !== 'matrix') {
      const lines = t.fields.map((f) => {
        if (f.name === t.parentKey) return `${childKey} AS ${field(f.name)}`;
        const child = tables.find((c) => c.parent === t && c.parentKey === f.name);
        return child ? `${parentKey(t, child)} AS ${field(f.name)}` : field(f.name);
      });
      out.push('LOAD');
      lines.forEach((l, i) => out.push(`    ${l}${i < lines.length - 1 ? ',' : ''}`));
      out.push(`${from} (${specs.join(', ')});`, '');
    } else out.push(`LOAD * ${from} (${specs.join(', ')});`, '');
  }
  return out;
}

/** JsonGet preceding-load pattern for [][] data on engines without native matrix support. */
function matrixJsonGet(t: EngineTable, from: string, rootName: string, sample: Json): string[] {
  const header = matrixHeader(sample);
  const width = Math.max(...(sample as Json[][]).map((r) => r.length));
  const names = header ?? Array.from({ length: width }, (_, i) => `Col${i + 1}`);
  const out = [label(tableLabel(t, rootName)), 'LOAD'];
  names.forEach((n, i) => out.push(`    JsonGet(__row, '/${i}') AS ${field(n)}${i < names.length - 1 ? ',' : ''}`));
  if (header) out.push('WHERE RecNo() > 1;');
  else out[out.length - 1] += ';';
  out.push(`LOAD JsonGet(__doc, '/*') AS __row;`);
  out.push(`LOAD @1:n AS __doc ${from} (fix, utf8, no labels, record is 1000000 lines);`, '');
  return out;
}

function sampleTable(samples: Json[], src: Extract<EngineSource, { kind: 'field' }>): string[] {
  const key = src.keyField || 'id';
  const r = generateInline(
    { columns: [key, src.field], rows: samples.map((s, i) => [String(i + 1), JSON.stringify(s)]) },
    { tableName: src.table, columns: [{ asText: false }, { asText: false }] },
  );
  return ['// Sample rows standing in for a database table with a JSON column.', ...r.script.trimEnd().split('\n')];
}

function fromFieldLoads(
  tables: EngineTable[],
  src: Extract<EngineSource, { kind: 'field' }>,
  rootName: string,
  method: 'reader' | 'fromfield',
  mode: string,
  opts: EngineOptions,
  docArray: boolean,
  samples: Json[],
): string[] {
  const out: string[] = [];
  const s = ref(src.table);
  const f = ref(src.field);
  if (method === 'fromfield') {
    out.push(
      '// From_Field reads each DISTINCT value once: identical documents collapse and',
      '// rows do not link back to the source table unless the JSON carries its own id.',
    );
    out.push(...readerLoads(tables, `From_Field(${s}, ${f})`, rootName, mode, opts, samples[0], { rootArray: docArray, multiDoc: true }));
    return out;
  }
  const tagged = `${src.table}_json`;
  const tag = docArray
    ? `'{"__rowid":' & RecNo() & ',${JSON.stringify(rootName).replace(/'/g, "''")}:' & ${f} & '}'`
    : `JsonSet(${f}, '/__rowid', RecNo())`;
  out.push(
    '// Tag every JSON document with its source row (__rowid), then let the JSON reader',
    '// expand it. The expanded tables link back through __rowid.',
    label(tagged),
    'LOAD',
  );
  if (src.keyField) out.push(`    ${field(src.keyField)},`);
  out.push(`    RecNo() AS __rowid,`, `    ${tag} AS __json`, `RESIDENT ${s}`, `WHERE IsJson(${f});`, '');
  out.push(...readerLoads(tables, `From_Field(${ref(tagged)}, __json)`, rootName, mode, opts, undefined, { rootArray: false, multiDoc: true }));
  out.push(`DROP FIELD __json FROM ${ref(tagged)};`);
  return out;
}

/** JsonGet preceding-load chains: one table per array, linked by the source key and Hash128 keys. */
function jsonGetLoads(
  tables: EngineTable[],
  src: Extract<EngineSource, { kind: 'field' }>,
  rootName: string,
  samples: Json[],
  opts: EngineOptions,
): string[] {
  const out: string[] = [];
  const f = ref(src.field);
  const rootKey = src.keyField ? field(src.keyField) : '__rowid';
  const rootKeyExpr = src.keyField ? field(src.keyField) : 'RecNo()';
  const docArray = samples.every((s) => Array.isArray(s));
  const ptr = (segs: string[]) => '/' + segs.map(pointerSegment).join('/');
  // Arrays directly under the document link on the source key; deeper ones on Hash128 keys.
  const linkName = (t: EngineTable) => (t.parent && t.parent.depth === 0 && !docArray ? rootKey : field(t.parentKey!));
  const bottom = `LOAD ${rootKeyExpr} AS __k0, ${f} AS __j0 RESIDENT ${ref(src.table)} WHERE IsJson(${f});`;

  if (opts.matrix !== 'native' && tables[0]?.kind === 'matrix') {
    out.push(...matrixJsonGet(tables[0], `RESIDENT ${ref(src.table)}`, rootName, samples[0]).slice(0, -2));
    out.push(`LOAD ${f} AS __doc RESIDENT ${ref(src.table)} WHERE IsJson(${f});`, '');
    return out;
  }

  for (const t of tables) {
    if (t.kind === 'empty' || t.kind === 'matrix') continue;
    // Ancestors from the root down to this table.
    const chain: EngineTable[] = [];
    for (let a: EngineTable | undefined = t; a; a = a.parent) chain.unshift(a);
    // Level 0 is the document; when documents are arrays, root rows are its elements (level 1).
    const d = t.depth + (docArray ? 1 : 0);
    const relOf = (s: number) => (docArray ? (s === 1 ? '' : ptr(chain[s - 1].rel)) : ptr(chain[s].rel));
    const j = d === 0 ? f : `__j${d}`;
    const top: string[] = [];
    if (d === 0) top.push(rootKeyExpr === rootKey ? rootKey : `${rootKeyExpr} AS ${rootKey}`);
    else top.push(`__k${d - 1} AS ${linkName(t)}`);
    if (d > 0) for (const c of t.childKeys) top.push(`Hash128(__k${d - 1}, ${j}) AS ${field(c)}`);
    for (const fl of t.fields) {
      if (fl.name.startsWith('%Key_')) continue;
      const name = fl.name.endsWith('@1') ? fl.name.replace(/\.?@1$/, '') || rootName : fl.name;
      top.push(fl.rel.length ? `JsonGet(${j}, '${ptr(fl.rel)}') AS ${field(name)}` : `${j} AS ${field(name)}`);
    }
    out.push(label(tableLabel(t, rootName)), 'LOAD');
    top.forEach((x, i) => out.push(`    ${x}${i < top.length - 1 ? ',' : ''}`));
    if (d === 0) {
      out.push(`RESIDENT ${ref(src.table)}`, `WHERE IsJson(${f});`, '');
      continue;
    }
    // JsonGet(x, '/arr/*') yields one null row for an empty array.
    out.push(`WHERE NOT IsNull(${j});`);
    for (let s = d; s >= 1; s--) {
      const k = s === 1 ? '__k0' : `Hash128(__k${s - 2}, __j${s - 1}) AS __k${s - 1}`;
      out.push(`LOAD ${k}, JsonGet(__j${s - 1}, '${relOf(s)}/*') AS __j${s};`);
    }
    out.push(bottom, '');
  }
  return out;
}
