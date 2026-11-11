// REST connector script generator. Reproduces the script the connector's Select data dialog writes:
//  - every nested object AND array becomes a sub-table (by property name); the root is a
//    synthetic "root" (wrap on) unless the document is an object with exactly one nested table
//    and no simple fields, in which case that child is the root (wrap off).
//  - table and field aliases are made unique across the whole tree in pre-order with _u0, _u1 ...
//    suffixes; [ ] " become _; arrays of simple values get "@Value".
//    Every child gets __FK_<name>, every table with children __KEY_<name>.
//  - one RESIDENT LOAD per table, [__FK_x] AS [__KEY_parent].
// WITH CONNECTION only supports URL, QUERY, HTTPHEADER and BODY.

import type { Warning } from '../model';
import { isObject, type Json } from '../parse/json';
import { label, ref, str } from '../qlik';

export interface RestField {
  name: string;
  alias: string;
}

export interface RestTable {
  name: string;
  alias: string;
  isArray: boolean;
  simpleItems: boolean;
  fields: RestField[];
  /** The "@Value" field for arrays of simple values. */
  valueField?: RestField;
  children: RestTable[];
  parent?: RestTable;
  pk?: string;
  fk?: string;
}

export interface RestMeta {
  root: RestTable;
  wrap: boolean;
  tables: RestTable[];
}

const mkTable = (name: string, isArray: boolean): RestTable => ({
  name,
  alias: name,
  isArray,
  simpleItems: false,
  fields: [],
  children: [],
});

function addTable(parent: RestTable, name: string, isArray: boolean): RestTable {
  let t = parent.children.find((c) => c.name === name);
  if (!t) {
    t = mkTable(name, isArray);
    parent.children.push(t);
  }
  return t;
}

function addField(t: RestTable, name: string) {
  if (!t.fields.some((f) => f.name === name)) t.fields.push({ name, alias: name });
}

function parseObject(o: Record<string, Json>, t: RestTable) {
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) parseArray(v, addTable(t, k, true));
    else if (isObject(v)) parseObject(v, addTable(t, k, false));
    else addField(t, k);
  }
}

function parseArray(a: Json[], t: RestTable) {
  for (const el of a) {
    if (Array.isArray(el)) parseArray(el, addTable(t, t.name, true));
    else if (isObject(el)) parseObject(el, t);
    else t.simpleItems = true;
  }
}

export const preorder = (t: RestTable): RestTable[] => [t, ...t.children.flatMap(preorder)];

const escapeName = (s: string) => (s.trim() ? s : 'unknown' + '_'.repeat(s.length)).replace(/[\[\]"]/g, '_');

function uniqueIn(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  for (let n = 0; ; n++) if (!used.has(`${name}_u${n}`)) return `${name}_u${n}`;
}

/** Build the connector's table metadata for a sample response. */
export function restMetadata(doc: Json): RestMeta {
  const wrapper = mkTable('root', false);
  if (Array.isArray(doc)) parseArray(doc, addTable(wrapper, 'root', true));
  else if (isObject(doc)) parseObject(doc, wrapper);
  else throw new Error('The REST connector needs a JSON object or array as the response');

  let root: RestTable;
  let wrap: boolean;
  if (wrapper.children.length > 1 || wrapper.fields.length) {
    root = wrapper;
    wrap = true;
  } else if (wrapper.children.length === 1) {
    root = wrapper.children[0];
    wrap = Array.isArray(doc);
  } else throw new Error('The response has no fields');

  const tables = preorder(root);
  for (const t of tables) {
    if (t.isArray && !t.fields.length && !t.children.length) t.simpleItems = true;
    if (t.simpleItems) {
      const used = new Set(t.fields.map((f) => f.name));
      let name = '@Value';
      for (let n = 0; used.has(name); n++) name = `@Value_val${n}`;
      t.valueField = { name, alias: name };
      t.fields.push(t.valueField);
    }
  }
  // Unique table aliases, then unique field aliases across all tables.
  const tUsed = new Set<string>();
  for (const t of tables) tUsed.add((t.alias = uniqueIn(escapeName(t.name), tUsed)));
  const fUsed = new Set<string>();
  for (const t of tables) for (const f of t.fields) fUsed.add((f.alias = uniqueIn(escapeName(f.name), fUsed)));
  // Key fields, pre-order.
  for (const t of tables) for (const c of t.children) c.parent = t;
  for (const t of tables) {
    const e = escapeName(t.name);
    if (t.parent) fUsed.add((t.fk = uniqueIn(`__FK_${e}`, fUsed)));
    if (t.children.length) fUsed.add((t.pk = uniqueIn(`__KEY_${e}`, fUsed)));
  }
  return { root, wrap, tables };
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** The `SQL SELECT ... FROM JSON ...` statement, formatted like the connector's Select data dialog. */
export function selectStatement(meta: RestMeta): string {
  const lines: string[] = [];
  const emit = (t: RestTable, depth: number) => {
    const ind = '\t'.repeat(depth + 1);
    const items: string[] = [];
    for (const f of t.fields) items.push(`${ind}${q(f.name)}${f.alias !== f.name ? ` AS ${q(f.alias)}` : ''}`);
    if (t.fk) items.push(`${ind}${q(t.fk)}`);
    if (t.pk) items.push(`${ind}${q(t.pk)}`);
    const nested: RestTable[] = t.children;
    return { items, nested, ind };
  };
  const write = (t: RestTable, depth: number, prefix: string) => {
    const { items, nested, ind } = emit(t, depth);
    lines.push(`${prefix}SELECT `);
    const all = items.length + nested.length;
    let i = 0;
    for (const it of items) lines.push(`${it}${++i < all ? ',' : ''}`);
    for (const c of nested) {
      write(c, depth + 1, `${ind}(`);
      lines[lines.length - 1] += `)${++i < all ? ',' : ''}`;
    }
    const from = t === meta.root ? `FROM JSON (wrap ${meta.wrap ? 'on' : 'off'}) ` : 'FROM ';
    let tail = `${'\t'.repeat(depth)}${from}${q(t.name)}`;
    if (t.pk) tail += ` PK ${q(t.pk)}`;
    if (t.fk) tail += ` FK ${q(t.fk)}`;
    if (t.valueField) tail += ` ArrayValueAlias ${q(t.valueField.alias)}`;
    lines.push(tail);
  };
  write(meta.root, 0, 'SQL ');
  return lines.join('\n');
}

export type Pagination =
  | { type: 'none' }
  /** Next URL in the response body (e.g. links.next.href in Qlik Cloud APIs). */
  | { type: 'nexturl'; table: string; field: string }
  /** Offset + limit query parameters; stops when a page returns fewer than limit records. */
  | { type: 'offset'; offsetParam: string; limitParam: string; limit: number; recordsTable: string; total?: FieldRef }
  /** Page number query parameter. */
  | { type: 'page'; pageParam: string; sizeParam?: string; size: number; start: number; recordsTable: string; total?: FieldRef }
  /** Cursor/token in the body, sent back as a query parameter. */
  | { type: 'token'; table: string; field: string; param: string }
  /** Pagination set on the connection, style not specified; single SELECT. Prefer pagingBy: 'connector'. */
  | { type: 'connector' };

/** A field in the sample: connector table alias or name, and the field's JSON name. */
export interface FieldRef {
  table: string;
  field: string;
}

/** One setting in the Pagination section of the REST connection dialog. */
export interface ConnectionSetting {
  /** The label as the connection dialog shows it. */
  label: string;
  value: string;
  hint?: string;
}

export interface RestOptions {
  connection: string;
  url: string;
  query?: [string, string][];
  headers?: [string, string][];
  /** POST body; the connection's method must be POST or it is ignored. */
  body?: string;
  /** Merge single-row nested object tables into their parent (default true). */
  flatten?: boolean;
  /** path: dotted names like links.self.href (default); connector: the connector's aliases. */
  naming?: 'path' | 'connector';
  /** Table aliases to leave out of the LOAD statements. */
  exclude?: string[];
  pagination?: Pagination;
  /**
   * Who fetches the pages. script (default): a DO … LOOP in the load script, with the connection's
   * pagination left at None. connector: one SELECT, and the connection's own pagination setting
   * fetches every page (returned as connectionSettings).
   */
  pagingBy?: 'script' | 'connector';
  /** Optional safety stop: end a paging loop after this many requests. Omit for no limit. */
  maxPages?: number;
}

export interface RestResult {
  script: string;
  warnings: Warning[];
  meta: RestMeta;
  /** Steps the user must do on the connection itself. */
  checklist: string[];
  /** When the connection pages: what to enter in its Pagination section. */
  connectionSettings?: ConnectionSetting[];
  /** Loaded fields whose name differs between the two naming options (dotted path vs connector alias). */
  namingDifferences: number;
}

/** An output table: an array (or the root) plus the single-row objects merged into it. */
interface Group {
  owner: RestTable;
  /** Owner first, then merged object tables, each with its object path from the owner. */
  members: { t: RestTable; path: string[] }[];
}

function groups(meta: RestMeta, flatten: boolean): Group[] {
  const out: Group[] = [];
  const visit = (t: RestTable, g: Group | null, path: string[]) => {
    const own = !g || !flatten || t.isArray;
    const group = own ? { owner: t, members: [{ t, path: [] }] } : g!;
    if (own) out.push(group);
    else group.members.push({ t, path });
    for (const c of t.children) visit(c, group, own ? [c.name] : [...path, c.name]);
  };
  visit(meta.root, null, []);
  return out;
}

/** Find the output name (connector alias or dotted path) for a field of a table. */
export function fieldOutputName(meta: RestMeta, opts: Pick<RestOptions, 'flatten' | 'naming'>, table: string, field: string): string {
  const gs = groups(meta, opts.flatten !== false);
  const names = outputNames(gs, opts.naming ?? 'path');
  for (const g of gs) for (const m of g.members) if (m.t.alias === table) for (const f of m.t.fields) if (f.name === field) return names.get(f)!;
  return field;
}

function outputNames(gs: Group[], naming: 'path' | 'connector'): Map<RestField, string> {
  const names = new Map<RestField, string>();
  for (const g of gs)
    for (const m of g.members)
      for (const f of m.t.fields) {
        if (naming === 'connector') names.set(f, f.alias);
        else if (f === m.t.valueField) names.set(f, [...m.path, m.t.name].join('.') || m.t.name);
        else names.set(f, [...m.path, f.name].join('.'));
      }
  if (naming === 'path') {
    // A name used in more than one output table would associate unrelated tables. The first array
    // table (usually the records) keeps it; the others are prefixed with their table alias.
    const order = [...gs.filter((g) => g.owner.isArray), ...gs.filter((g) => !g.owner.isArray)];
    const claimed = new Map<string, Group>();
    for (const g of order)
      for (const m of g.members)
        for (const f of m.t.fields) {
          const n = names.get(f)!;
          const owner = claimed.get(n);
          if (!owner) claimed.set(n, g);
          else if (owner !== g) names.set(f, `${g.owner.alias}.${n}`);
        }
  }
  return names;
}

function withConnection(opts: RestOptions, url: string, extraQuery: string): string {
  const parts = [`URL ${q(url)}`];
  for (const [k, v] of opts.query ?? []) parts.push(`QUERY ${q(k)} ${q(v)}`);
  for (const [k, v] of opts.headers ?? []) parts.push(`HTTPHEADER ${q(k)} ${q(v)}`);
  if (opts.body) parts.push(`BODY ${q(opts.body)}`);
  if (parts.length === 1 && !extraQuery) return `WITH CONNECTION (${parts[0]})`;
  return `WITH CONNECTION (\n\t${parts.join(',\n\t')}${extraQuery}\n)`;
}

export function generateRest(sample: Json, opts: RestOptions): RestResult {
  const warnings: Warning[] = [];
  const meta = restMetadata(sample);
  const flatten = opts.flatten !== false;
  const naming = opts.naming ?? 'path';
  const pg = opts.pagination ?? { type: 'none' };
  const byConnection = pg.type === 'connector' || (pg.type !== 'none' && opts.pagingBy === 'connector');
  const looping = pg.type !== 'none' && !byConnection;
  const exclude = new Set(opts.exclude ?? []);
  const gs = groups(meta, flatten);
  const names = outputNames(gs, naming);
  const other = outputNames(gs, naming === 'path' ? 'connector' : 'path');
  const namingDifferences = gs
    .filter((g) => !exclude.has(g.owner.alias))
    .flatMap((g) => g.members.flatMap((m) => m.t.fields))
    .filter((f) => names.get(f) !== other.get(f)).length;
  const M = 'RestConnectorMasterTable';
  const checklist = [
    `Data connection "${opts.connection}" is a REST connection with "Allow WITH CONNECTION" switched on.`,
    'Authentication, method, timeouts and pagination come from the connection; WITH CONNECTION can only change URL, QUERY, HTTPHEADER and BODY.',
  ];
  if (opts.body) checklist.push('BODY is only sent when the connection method is POST.');
  // From the connector: Retry codes only accepts 5xx; 429 and 503 are retried only with a Retry-After of 1-60 s.
  checklist.push(
    'For brief outages, tick "Retry failed requests" and set "Retry codes" to 502, 503, 504 (Qlik Cloud only). Retries wait 10 s, then 20 s, and so on.',
    'A 429 (rate limited) is retried only when the API sends a Retry-After header of 60 seconds or less. 429 cannot be added to Retry codes: the field only accepts 5xx codes.',
  );
  let connectionSettings: ConnectionSetting[] | undefined;
  if (byConnection) {
    const c = connectionPaging(meta, pg, opts, warnings);
    connectionSettings = c.settings;
    checklist.push(...c.checklist);
    opts = { ...opts, query: (opts.query ?? []).filter(([k]) => !c.reserved.includes(k)) };
  }
  if (looping) checklist.push('Leave the connection\'s pagination type as "None"; this script pages itself.');

  // Key values restart at 1 on every SELECT, so make them unique per page when looping.
  const key = (k: string) => (looping ? `'$(vPage)|' & ${ref(k)}` : ref(k));
  const keyAs = (k: string, as: string) => (looping || k !== as ? `${key(k)} AS ${ref(as)}` : ref(k));

  const out: string[] = [];
  const conn = `LIB CONNECT TO ${str(opts.connection)};`;
  const select = selectStatement(meta);
  const loads: string[] = [];
  const finals: string[] = [];

  for (const g of gs) {
    if (exclude.has(g.owner.alias)) continue;
    const dataFields = g.members.flatMap((m) => m.t.fields);
    // Keys other groups link to: owner PK plus PKs of merged objects that have array children.
    const linkKeys = g.members
      .filter((m) => m.t.pk && m.t.children.some((c) => gs.some((o) => o.owner === c && !exclude.has(c.alias))))
      .map((m) => m.t.pk!);
    if (!dataFields.length && !linkKeys.length) continue;
    if (!dataFields.length && flatten) continue;
    const final = g.owner.alias;
    const target = looping ? `__page_${final}` : final;
    finals.push(final);
    const ownerLines: string[] = [];
    for (const f of g.owner.fields) ownerLines.push(`${ref(f.alias)}${names.get(f) !== f.alias ? ` AS ${ref(names.get(f)!)}` : ''}`);
    const o = g.owner;
    const joinKeys = new Set(g.members.slice(1).map((m) => m.t.parent!.pk!));
    if (o.pk && (linkKeys.includes(o.pk) || joinKeys.has(o.pk))) ownerLines.push(keyAs(o.pk, o.pk));
    if (o.fk) ownerLines.push(keyAs(o.fk, o.parent!.pk!));
    // Page tables have the same fields as the final ones: without NOCONCATENATE page 2 would
    // silently auto-concatenate into the final table.
    loads.push(label(target), looping ? 'NOCONCATENATE LOAD' : 'LOAD');
    loads.push(...ownerLines.map((l, i) => `\t${l}${i < ownerLines.length - 1 ? ',' : ''}`));
    loads.push(`RESIDENT ${M}`, `WHERE NOT IsNull(${ref(o.fk ?? o.pk ?? o.fields[0].alias)});`, '');
    // Merge single-row objects (links, self, next ...) into the owner instead of separate tables.
    const joins: string[] = [];
    for (const m of g.members.slice(1)) {
      const lines = m.t.fields.map((f) => `${ref(f.alias)}${names.get(f) !== f.alias ? ` AS ${ref(names.get(f)!)}` : ''}`);
      if (m.t.pk && (linkKeys.includes(m.t.pk) || g.members.some((x) => x.t.parent === m.t))) lines.push(keyAs(m.t.pk, m.t.pk));
      lines.unshift(keyAs(m.t.fk!, m.t.parent!.pk!));
      joins.push(`LEFT JOIN (${ref(target)})`, 'LOAD');
      joins.push(...lines.map((l, i) => `\t${l}${i < lines.length - 1 ? ',' : ''}`));
      joins.push(`RESIDENT ${M}`, `WHERE NOT IsNull(${ref(m.t.fk!)});`, '');
    }
    const drop = [...joinKeys].filter((k) => !linkKeys.includes(k));
    if (drop.length) joins.push(`DROP FIELDS ${drop.map(ref).join(', ')} FROM ${ref(target)};`);
    // An empty page creates no page table, so the joins would fail.
    if (looping && joins.length)
      loads.push(`IF NOT IsNull(TableNumber(${str(target)})) THEN`, ...joins.map((l) => (l ? `\t${l}` : l)), 'END IF');
    else loads.push(...joins);
    loads.push('');
  }
  if (!finals.length) warnings.push({ level: 'error', message: 'No tables to load: every table is excluded or empty.' });

  if (!looping) {
    // Paging set on the connection is invisible in the script, so record what it must be.
    const note = connectionSettings?.length
      ? [`// Paged by the connection. Its Pagination section must be:`, ...connectionSettings.filter((c) => c.value).map((c) => `//   ${c.label}: ${c.value}`)]
      : byConnection
        ? ['// Paged by the connection: set its Pagination section to match this API.']
        : [];
    out.push(conn, '', ...note, `${M}:`, `${select}`, `${withConnection(opts, opts.url, '')};`, '', ...loads, `DROP TABLE ${M};`);
  } else {
    out.push(...pagingLoop(pg, opts, meta, conn, select, loads, finals, warnings));
  }
  return { script: out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n', warnings, meta, checklist, connectionSettings, namingDifferences };
}

/** The table holding a field, by connector alias or JSON name. */
function locate(meta: RestMeta, ref: FieldRef): { t: RestTable; f: RestField } | null {
  for (const t of meta.tables)
    if (t.alias === ref.table || t.name === ref.table)
      for (const f of t.fields) if (f !== t.valueField && (f.name === ref.field || f.alias === ref.field)) return { t, f };
  return null;
}

/**
 * The path the connection's pagination settings use for a field: JSON property names from the
 * root table down, separated by /, e.g. root/links/next/href. The first segment is the root
 * table ("root" with wrap on).
 */
export function connectorPath(meta: RestMeta, ref: FieldRef): string | null {
  const hit = locate(meta, ref);
  if (!hit) return null;
  const segs = [hit.f.name];
  for (let t: RestTable | undefined = hit.t; t; t = t.parent) segs.unshift(t.name);
  return segs.join('/');
}

/** A field every record is likely to have, to tell the connection that a page held data. */
function dataIndicator(meta: RestMeta, table: string): FieldRef | null {
  const t = meta.tables.find((x) => x.alias === table || x.name === table);
  if (!t) return null;
  const f = t.fields.find((x) => /^id$/i.test(x.name) && x !== t.valueField) ?? t.fields.find((x) => x !== t.valueField);
  return f ? { table: t.alias, field: f.name } : null;
}

/**
 * Settings for the connection's own pagination (Pagination section of the REST connection).
 * Mirrors the connector: Next URL follows an absolute http(s) link until it is empty or repeats;
 * Next token sends the token back as a parameter until it is empty; Offset and Next page step on
 * while a page has a value at the data indicator path, or until the total is reached.
 */
function connectionPaging(
  meta: RestMeta,
  pg: Pagination,
  opts: RestOptions,
  warnings: Warning[],
): { settings: ConnectionSetting[]; checklist: string[]; reserved: string[] } {
  const checklist = [
    `On connection "${opts.connection}", set the Pagination section as listed below. The connection then fetches every page for this one SELECT.`,
    'Every SELECT through this connection pages the same way. If other endpoints share it, give this API its own connection.',
    'Retries are counted per SELECT, so the few the service allows cover every page. A page that is still failing fails the whole SELECT, pages already fetched included.',
  ];
  const settings: ConnectionSetting[] = [];
  const reserved: string[] = [];
  const path = (r: FieldRef, what: string) => {
    const p = connectorPath(meta, r);
    if (!p) warnings.push({ level: 'error', message: `${what} field ${r.table}.${r.field} not found in the sample.` });
    return p ?? `root/${r.field}`;
  };
  const reserve = (param: string | undefined) => {
    if (!param) return;
    reserved.push(param);
    if ((opts.query ?? []).some(([k]) => k === param))
      warnings.push({
        level: 'warn',
        message: `QUERY "${param}" left out of WITH CONNECTION: the connection's pagination sets it, and the connector stops with an error when both do.`,
      });
  };
  const stop = (type: 'offset' | 'page', p: Extract<Pagination, { type: 'offset' | 'page' }>) => {
    const totalLabel = type === 'offset' ? "'Total records' path" : "'Total pages' path";
    if (p.total) {
      settings.push({ label: totalLabel, value: path(p.total, 'Total'), hint: type === 'offset' ? 'Stops once start + count reaches this number.' : 'Stops after this many pages.' });
      settings.push({ label: 'Data indicator path', value: '', hint: 'Leave empty when a total path is set.' });
    } else {
      const d = dataIndicator(meta, p.recordsTable);
      if (!d) warnings.push({ level: 'error', message: `Records table "${p.recordsTable}" not found in the sample.` });
      settings.push({ label: totalLabel, value: '', hint: 'Leave empty: paging stops at the first page with no records.' });
      settings.push({
        label: 'Data indicator path',
        value: d ? path(d, 'Data indicator') : `root/${p.recordsTable}/id`,
        hint: 'Any field every record has. Paging continues while a page returns it, so the last request returns an empty page.',
      });
    }
  };

  switch (pg.type) {
    case 'nexturl':
      settings.push({ label: 'Pagination type', value: 'Next URL' });
      settings.push({ label: "'Next url' path", value: path(pg, 'Next URL'), hint: 'The field does not need to be in the SELECT.' });
      checklist.push(
        'The next link must be an absolute http(s) URL. Paging stops when it is empty or the same as the last one.',
        'WITH CONNECTION QUERY values go on the first request only. If the next links leave them out, tick "Add missing query parameters to final request" on the connection.',
      );
      break;
    case 'token':
      reserve(pg.param);
      settings.push({ label: 'Pagination type', value: 'Next token' });
      settings.push({ label: "'Next token' parameter name", value: pg.param, hint: 'Sent as a query parameter; tick "Pass via header" to send it as a header instead.' });
      settings.push({ label: "'Next token' path", value: path(pg, 'Token'), hint: 'Paging stops when the token is empty.' });
      break;
    case 'offset':
      reserve(pg.offsetParam);
      reserve(pg.limitParam);
      settings.push({ label: 'Pagination type', value: 'Offset' });
      settings.push({ label: "'Start' parameter name", value: pg.offsetParam });
      settings.push({ label: "'Start' initial value", value: '0' });
      settings.push({ label: "'Count' parameter name", value: pg.limitParam });
      settings.push({ label: "'Count' initial value", value: String(pg.limit), hint: 'The page size; start goes up by this each page.' });
      stop('offset', pg);
      break;
    case 'page':
      reserve(pg.pageParam);
      reserve(pg.sizeParam);
      settings.push({ label: 'Pagination type', value: 'Next page' });
      settings.push({ label: "'Next page' parameter name", value: pg.pageParam });
      settings.push({ label: "'Next page' initial value", value: String(pg.start) });
      settings.push({ label: "'Page size' parameter name", value: pg.sizeParam ?? '', hint: pg.sizeParam ? undefined : 'Leave empty if the API has a fixed page size.' });
      settings.push({ label: "'Page size' value", value: pg.sizeParam ? String(pg.size) : '' });
      stop('page', pg);
      break;
    default:
      checklist.push('Choose the pagination style the API uses (Next URL, Next token, Offset or Next page) and set it on the connection.');
  }
  if (settings.length) checklist.push('There is no page limit: the connection keeps requesting until the API says there are no more pages.');
  return { settings, checklist, reserved };
}

/** Locate a field of a table in the master table: its alias and the table's FK/PK for the WHERE clause. */
function findField(meta: RestMeta, table: string, field: string): { alias: string; where: string } | null {
  for (const t of meta.tables)
    if (t.alias === table || t.name === table)
      for (const f of t.fields) if (f.name === field || f.alias === field) return { alias: f.alias, where: t.fk ?? t.pk ?? f.alias };
  return null;
}

function pagingLoop(
  pg: Exclude<Pagination, { type: 'none' } | { type: 'connector' }>,
  opts: RestOptions,
  meta: RestMeta,
  conn: string,
  select: string,
  loads: string[],
  finals: string[],
  warnings: Warning[],
): string[] {
  const M = 'RestConnectorMasterTable';
  const max = opts.maxPages && opts.maxPages > 0 ? Math.floor(opts.maxPages) : 0;
  const out: string[] = [conn, '', `LET vPage = 0;`, ...(max ? [`LET vMaxPages = ${max};`] : [])];
  let url = opts.url;
  let extra = '';
  let after: string[] = [];
  let until = '';
  const cleanup = ['vPage', ...(max ? ['vMaxPages'] : [])];
  const recordsTable = 'recordsTable' in pg ? pg.recordsTable : '';
  const recordsName = `__page_${recordsTable}`;

  switch (pg.type) {
    case 'nexturl': {
      const f = findField(meta, pg.table, pg.field);
      if (!f) warnings.push({ level: 'error', message: `Next URL field ${pg.table}.${pg.field} not found in the sample.` });
      // Query parameters go on the first URL only: next links already carry them.
      const qs = (opts.query ?? []).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      out.push(`LET vNextUrl = ${str(qs ? `${opts.url}${opts.url.includes('?') ? '&' : '?'}${qs}` : opts.url)};`);
      cleanup.push('vNextUrl', 'vLastUrl');
      url = '$(vNextUrl)';
      opts = { ...opts, query: [] };
      after = [
        `__next:`,
        `NOCONCATENATE LOAD ${ref(f?.alias ?? pg.field)} AS __next RESIDENT ${M} WHERE NOT IsNull(${ref(f?.where ?? pg.field)});`,
        `LET vLastUrl = vNextUrl;`,
        `LET vNextUrl = Peek('__next', 0, '__next');`,
        `IF NOT IsNull(TableNumber('__next')) THEN`,
        `\tDROP TABLE __next;`,
        `END IF`,
      ];
      // Stop when there is no next link, or the API hands back the same link again.
      until = `Len('$(vNextUrl)') > 0 AND '$(vNextUrl)' <> '$(vLastUrl)'`;
      break;
    }
    case 'token': {
      const f = findField(meta, pg.table, pg.field);
      if (!f) warnings.push({ level: 'error', message: `Token field ${pg.table}.${pg.field} not found in the sample.` });
      out.push(`LET vToken = '';`, `LET vTokenQuery = '';`);
      cleanup.push('vToken', 'vTokenQuery', 'vLastToken');
      extra = '$(vTokenQuery)';
      after = [
        `__next:`,
        `NOCONCATENATE LOAD ${ref(f?.alias ?? pg.field)} AS __next RESIDENT ${M} WHERE NOT IsNull(${ref(f?.where ?? pg.field)});`,
        `LET vLastToken = vToken;`,
        `LET vToken = Peek('__next', 0, '__next');`,
        `LET vTokenQuery = ', QUERY "${pg.param}" "' & vToken & '"';`,
        `IF NOT IsNull(TableNumber('__next')) THEN`,
        `\tDROP TABLE __next;`,
        `END IF`,
      ];
      until = `Len('$(vToken)') > 0 AND '$(vToken)' <> '$(vLastToken)'`;
      break;
    }
    case 'offset':
      out.push(`LET vOffset = 0;`, `LET vLimit = ${pg.limit};`);
      cleanup.push('vOffset', 'vLimit', 'vRows');
      extra = `,\n\tQUERY ${q(pg.offsetParam)} "$(vOffset)",\n\tQUERY ${q(pg.limitParam)} "$(vLimit)"`;
      after = [`LET vRows = Alt(NoOfRows('${recordsName}'), 0);`, `LET vOffset = vOffset + vLimit;`];
      until = `vRows >= vLimit`;
      break;
    case 'page':
      out.push(`LET vPageNo = ${pg.start};`, `LET vPageSize = ${pg.size};`);
      cleanup.push('vPageNo', 'vPageSize', 'vRows');
      extra = `,\n\tQUERY ${q(pg.pageParam)} "$(vPageNo)"${pg.sizeParam ? `,\n\tQUERY ${q(pg.sizeParam)} "$(vPageSize)"` : ''}`;
      after = [`LET vRows = Alt(NoOfRows('${recordsName}'), 0);`, `LET vPageNo = vPageNo + 1;`];
      until = `vRows >= vPageSize`;
      break;
  }
  if ((pg.type === 'offset' || pg.type === 'page') && !finals.includes(recordsTable))
    warnings.push({ level: 'error', message: `Records table "${recordsTable}" is not one of the loaded tables (${finals.join(', ')}).` });

  const indent = (ls: string[]) => ls.map((l) => (l ? `\t${l}` : l));
  out.push('', 'DO', `\tLET vPage = vPage + 1;`, `\tTRACE Fetching page $(vPage);`, '');
  out.push(...indent([`${M}:`, ...select.split('\n'), ...`${withConnection(opts, url, extra)};`.split('\n'), '']));
  out.push(...indent(loads));
  out.push(...indent(after), '');
  // Append each page's tables to the final ones. NoConcatenate: identical fields would otherwise auto-concatenate.
  // A page may lack a table (no rows), so every step is guarded.
  for (const f of finals) {
    const page = `__page_${f}`;
    out.push(
      ...indent([
        `IF NOT IsNull(TableNumber(${str(page)})) THEN`,
        `\tIF IsNull(TableNumber(${str(f)})) THEN`,
        `\t\t${label(f)}`,
        `\t\tNOCONCATENATE LOAD * RESIDENT ${ref(page)};`,
        `\tELSE`,
        `\t\tCONCATENATE (${ref(f)}) LOAD * RESIDENT ${ref(page)};`,
        `\tEND IF`,
        `\tDROP TABLE ${ref(page)};`,
        `END IF`,
      ]),
    );
  }
  out.push(...indent([`DROP TABLE ${M};`]));
  out.push(`LOOP WHILE ${until}${max ? ' AND vPage < vMaxPages' : ''};`, '');
  out.push(...cleanup.map((v) => `SET ${v} = ;`));
  return out;
}
