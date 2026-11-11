import { pointerSegment } from '../qlik';
import { isMatrix, realKinds, type Shape } from './shape';

/** A scalar column of an engine table. */
export interface EngineField {
  /** Engine field name, e.g. `address.city`, `items.sku`, `tags.@1`. */
  name: string;
  /** Object keys from the row element to the value (empty for scalar-array items). */
  rel: string[];
}

/** One table the engine's JSON reader produces (one `table is` target). */
export interface EngineTable {
  /** Key path from the document root without array indexes, e.g. ['items', 'tags']. */
  path: string[];
  /** JSON pointer for `table is`, e.g. '/*\/items'. Empty string for the root table. */
  pointer: string;
  /** Object keys from the parent row to this array (for JsonGet chains). */
  rel: string[];
  /** Array nesting depth; the root table is 0. */
  depth: number;
  fields: EngineField[];
  /** `%Key_<path>` shared with the parent table (child tables only). */
  parentKey?: string;
  /** `%Key_` fields in this table that link to child tables. */
  childKeys: string[];
  kind: 'records' | 'scalars' | 'matrix' | 'empty';
  parent?: EngineTable;
  /** Members whose type varies between scalar and object/array. */
  mixed: string[];
}

export const keyName = (path: string[]) => `%Key_${path.join('.')}`;

/**
 * Derive the tables the engine's (json) reader creates for a document shape, using its naming:
 * nested objects → dotted names; arrays → `%Key_<path>` link + one table per array,
 * child field names prefixed with the full path; scalar elements in `<path>.@1`.
 */
export function engineTables(doc: Shape): EngineTable[] {
  const tables: EngineTable[] = [];
  const rootIsArray = realKinds(doc).includes('array') && !realKinds(doc).includes('object');
  const root: EngineTable = {
    path: [],
    pointer: '',
    rel: [],
    depth: 0,
    fields: [],
    childKeys: [],
    kind: 'records',
    mixed: [],
  };
  tables.push(root);

  if (rootIsArray) {
    if (isMatrix(doc)) {
      root.kind = 'matrix';
      root.pointer = '/*/';
      return tables;
    }
    const items = doc.items;
    if (!items || !realKinds(items).length) root.kind = 'empty';
    else if (!realKinds(items).includes('object')) root.fields.push({ name: '@1', rel: [] });
    else walkRow(items, root, [], '/*', [], tables);
  } else {
    walkRow(doc, root, [], '', [], tables);
  }
  return tables;
}

function walkRow(row: Shape, table: EngineTable, prefix: string[], rowPointer: string, objSegs: string[], tables: EngineTable[]) {
  for (const [key, child] of row.props ?? []) {
    const kinds = realKinds(child);
    const segs = [...objSegs, key];
    const name = [...prefix, ...segs].join('.');
    const scalar = !kinds.length || kinds.some((k) => k !== 'object' && k !== 'array');
    if (scalar) table.fields.push({ name, rel: segs });
    if (kinds.includes('object')) walkRow(child, table, prefix, rowPointer, segs, tables);
    if (kinds.includes('array')) {
      const path = [...table.path, ...segs];
      const key = keyName(path);
      table.fields.push({ name: key, rel: [] });
      table.childKeys.push(key);
      const pointer = `${rowPointer}/${segs.map(pointerSegment).join('/')}`;
      const t: EngineTable = {
        path,
        pointer,
        rel: segs,
        depth: table.depth + 1,
        fields: [{ name: key, rel: [] }],
        parentKey: key,
        childKeys: [],
        kind: 'records',
        parent: table,
        mixed: [],
      };
      tables.push(t);
      const items = child.items;
      const ik = items ? realKinds(items) : [];
      if (!ik.length) t.kind = 'empty';
      else if (isMatrix(child)) {
        t.kind = 'matrix';
        t.pointer = `${pointer}/*/`;
      } else {
        if (ik.some((k) => k !== 'object' && k !== 'array')) {
          t.fields.push({ name: `${path.join('.')}.@1`, rel: [] });
          if (!ik.includes('object')) t.kind = 'scalars';
        }
        if (ik.includes('object')) walkRow(items!, t, path, `${pointer}/*`, [], tables);
        if (ik.includes('object') && ik.some((k) => k !== 'object')) t.mixed.push(`${path.join('.')}[]`);
      }
    }
    if (scalar && (kinds.includes('object') || kinds.includes('array'))) table.mixed.push(name);
  }
}

export const tableLabel = (t: EngineTable, rootName: string) => (t.path.length ? `${rootName}.${t.path.join('.')}` : rootName);
