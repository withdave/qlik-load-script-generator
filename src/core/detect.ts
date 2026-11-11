import { rectangular, type InputFormat, type Table } from './model';
import { parseDelimited, sniffDelimiter } from './parse/delimited';
import { looksLikeHtmlTable, parseHtmlTable } from './parse/html';
import { jsonToTable, parseNdjson, tryParseJson } from './parse/json';
import { looksLikeMarkdown, parseMarkdown } from './parse/markdown';

export interface Detected {
  format: InputFormat;
  delimiter?: string;
}

export function detectFormat(text: string): Detected {
  const t = text.trim();
  if (/^[\[{]/.test(t)) {
    if (tryParseJson(t).ok) return { format: 'json' };
    if (parseNdjson(t)) return { format: 'ndjson' };
  }
  if (looksLikeHtmlTable(t)) return { format: 'html' };
  if (looksLikeMarkdown(t)) return { format: 'markdown' };
  return { format: 'delimited', delimiter: sniffDelimiter(t) };
}

export interface ParseOptions {
  format?: InputFormat;
  delimiter?: string;
  /** First row holds column names (ignored for JSON). Default true. */
  header?: boolean;
}

/** Parse pasted text into a table, auto-detecting the format unless one is given. */
export function parseTabular(text: string, opts: ParseOptions = {}): { table: Table; detected: Detected } {
  const detected = opts.format ? { format: opts.format, delimiter: opts.delimiter } : detectFormat(text);
  const header = opts.header ?? true;
  let raw: string[][];
  switch (detected.format) {
    case 'json': {
      const r = tryParseJson(text.trim());
      if (!r.ok) throw new Error(`Invalid JSON: ${r.error}`);
      return { table: rectangular(jsonToTable(r.value)), detected };
    }
    case 'ndjson': {
      const recs = parseNdjson(text);
      if (!recs) throw new Error('Invalid NDJSON: every line must be a JSON object');
      return { table: rectangular(jsonToTable(recs)), detected };
    }
    case 'html':
      raw = parseHtmlTable(text);
      break;
    case 'markdown':
      raw = parseMarkdown(text);
      break;
    default: {
      const d = opts.delimiter ?? detected.delimiter ?? sniffDelimiter(text);
      detected.delimiter = d;
      raw = parseDelimited(text, d);
    }
  }
  if (!raw.length) return { table: { columns: [], rows: [] }, detected };
  const width = Math.max(...raw.map((r) => r.length));
  const columns = header ? raw[0].map((c) => c.trim()) : Array.from({ length: width }, (_, i) => `@${i + 1}`);
  while (columns.length < width) columns.push('');
  const rows = (header ? raw.slice(1) : raw) as (string | null)[][];
  return { table: rectangular({ columns, rows }), detected };
}
