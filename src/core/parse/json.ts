import type { Table } from '../model';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function tryParseJson(text: string): { ok: true; value: Json } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as Json };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function parseNdjson(text: string): Json[] | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const out: Json[] = [];
  for (const l of lines) {
    const r = tryParseJson(l);
    if (!r.ok || typeof r.value !== 'object' || r.value === null) return null;
    out.push(r.value);
  }
  return out;
}

export const isObject = (v: Json): v is { [k: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);

function scalarText(v: Json): string | null {
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  return JSON.stringify(v);
}

function flatten(v: Json, prefix: string, out: Map<string, string | null>) {
  if (isObject(v)) {
    const keys = Object.keys(v);
    if (!keys.length && prefix) out.set(prefix, '{}');
    for (const k of keys) flatten(v[k], prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix || 'value', scalarText(v));
  }
}

/**
 * Flatten JSON records into one table for an INLINE load: nested objects become dotted names
 * (matching the engine's JSON reader), arrays are kept as JSON text.
 */
export function jsonToTable(value: Json): Table {
  let records: Json[];
  if (Array.isArray(value)) records = value;
  else if (isObject(value)) {
    // { "data": [ ... ] } — use the single array-of-records member if there is one.
    const arrays = Object.entries(value).filter(([, v]) => Array.isArray(v) && v.some(isObject));
    records = arrays.length === 1 ? (arrays[0][1] as Json[]) : [value];
  } else records = [value];

  if (records.length && records.every((r) => Array.isArray(r))) {
    // Matrix: first row is the header if it is all strings.
    const rows = records as Json[][];
    const header = rows[0].every((c) => typeof c === 'string') ? (rows[0] as string[]) : null;
    const body = header ? rows.slice(1) : rows;
    const width = Math.max(...rows.map((r) => r.length));
    return {
      columns: header ?? Array.from({ length: width }, (_, i) => `@${i + 1}`),
      rows: body.map((r) => Array.from({ length: width }, (_, i) => (i < r.length ? scalarText(r[i]) : null))),
    };
  }

  const columns: string[] = [];
  const seen = new Set<string>();
  const flat = records.map((r) => {
    const m = new Map<string, string | null>();
    flatten(r, '', m);
    for (const k of m.keys()) if (!seen.has(k)) (seen.add(k), columns.push(k));
    return m;
  });
  return { columns, rows: flat.map((m) => columns.map((c) => (m.has(c) ? m.get(c)! : null))) };
}
