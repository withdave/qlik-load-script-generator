/** A parsed rectangular table. `null` marks a missing cell (short row / JSON null). */
export interface Table {
  columns: string[];
  rows: (string | null)[][];
}

export type InputFormat = 'delimited' | 'markdown' | 'html' | 'json' | 'ndjson';

export interface Warning {
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** Pad/trim every row to the column count. */
export function rectangular(t: Table): Table {
  const w = t.columns.length;
  return {
    columns: t.columns,
    rows: t.rows.map((r) => (r.length === w ? r : [...r, ...Array(Math.max(0, w - r.length)).fill(null)].slice(0, w))),
  };
}
