import type { Table, Warning } from '../model';
import { field, label, SECTION_SOFT_LIMIT, tableName, uniqueNames } from '../qlik';

export type Delimiter = ',' | '\t' | ';' | '|';
export type Enclosure = '[' | '`' | '"' | "'";

export interface ColumnOptions {
  /** Output field name (defaults to the header). */
  name?: string;
  include?: boolean;
  /** Wrap in Text() so codes like 007 keep their leading zeros. Defaults to auto-detect. */
  asText?: boolean;
}

export interface InlineOptions {
  tableName?: string;
  columns?: ColumnOptions[];
  /** MAPPING LOAD (needs exactly two included columns). */
  mapping?: boolean;
  /** Turn empty cells into real nulls. */
  emptyAsNull?: boolean;
  /** SET Verbatim=1 so leading/trailing spaces survive. */
  preserveWhitespace?: boolean;
  delimiter?: Delimiter | 'auto';
  enclosure?: Enclosure | 'auto';
}

export interface InlineResult {
  script: string;
  warnings: Warning[];
  delimiter: Delimiter;
  enclosure: Enclosure;
  /** Per included column: final name and whether Text() was applied. */
  fields: { name: string; asText: boolean; tokens: { token: string; text: string }[] }[];
}

const CLOSE: Record<Enclosure, string> = { '[': ']', '`': '`', '"': '"', "'": "'" };
const DELIMITERS: Delimiter[] = [',', '\t', ';', '|'];
const ENCLOSURES: Enclosure[] = ['[', '`', '"', "'"];

/** Values that would lose their leading zeros or precision if read as numbers. */
export function looksLikeCode(values: (string | null)[]): boolean {
  return values.some((v) => v != null && (/^[+-]?0\d/.test(v.trim()) || /^\d{16,}$/.test(v.trim())));
}

interface Sub {
  find: string;
  token: string;
  /** Script expression that produces the original text. */
  restore: string;
}

function makeToken(name: string, haystack: string): string {
  let t = `{#${name}#}`;
  for (let n = 2; haystack.includes(t); n++) t = `{#${name}${n}#}`;
  return t;
}

const hasBoundaryQuote = (v: string) => /^\s*["']|["']\s*$/.test(v);

/** Generate a `LOAD ... INLINE` statement that round-trips the table's text exactly. */
export function generateInline(table: Table, opts: InlineOptions = {}): InlineResult {
  const warnings: Warning[] = [];
  const colOpts = table.columns.map((_, i) => opts.columns?.[i] ?? {});
  const included = table.columns.map((_, i) => colOpts[i].include !== false);
  const idx = table.columns.map((_, i) => i).filter((i) => included[i]);
  const requested = idx.map((i) => colOpts[i].name ?? table.columns[i]);
  const names = uniqueNames(requested);
  names.forEach((n, k) => {
    if (n !== requested[k].trim())
      warnings.push({ level: 'info', message: `Column ${k + 1} renamed to "${n}" (blank or duplicate name).` });
  });
  const rows = table.rows.map((r) => idx.map((i) => r[i] ?? ''));
  const all = [...names, ...rows.flat()].join('\n');

  // Delimiter: the first candidate that never appears in the data, else tokenise commas.
  const delimiter: Delimiter =
    opts.delimiter && opts.delimiter !== 'auto'
      ? opts.delimiter
      : (DELIMITERS.find((d) => !all.includes(d)) ?? ',');
  // Enclosure: the first whose closing character never appears, else tokenise `]`.
  const enclosure: Enclosure =
    opts.enclosure && opts.enclosure !== 'auto'
      ? opts.enclosure
      : (ENCLOSURES.find((e) => !all.includes(CLOSE[e])) ?? '[');
  const close = CLOSE[enclosure];

  const subs: Sub[] = [
    { find: '\r\n', token: makeToken('CRLF', all), restore: 'Chr(13)&Chr(10)' },
    { find: '\n', token: makeToken('LF', all), restore: 'Chr(10)' },
    { find: '\r', token: makeToken('CR', all), restore: 'Chr(13)' },
    // Dollar-sign expansion runs before the statement is parsed, even inside INLINE data.
    { find: '$(', token: makeToken('DOLLAR', all), restore: "Chr(36)&'('" },
    { find: delimiter, token: makeToken('DELIM', all), restore: delimiter === '\t' ? 'Chr(9)' : `'${delimiter}'` },
    { find: close, token: makeToken('CLOSE', all), restore: close === "'" ? 'Chr(39)' : `'${close}'` },
    { find: '"', token: makeToken('DQ', all), restore: 'Chr(34)' },
    { find: "'", token: makeToken('SQ', all), restore: 'Chr(39)' },
  ];
  const quoteSubs = new Set(['"', "'"]);

  /** Replace troublesome substrings with tokens; returns the subs that were used. */
  const encode = (v: string, used: Set<Sub>): string => {
    const quotes = hasBoundaryQuote(v);
    let out = v;
    for (const s of subs) {
      if (quoteSubs.has(s.find) && !quotes && s.find !== close) continue;
      if (out.includes(s.find)) {
        out = out.split(s.find).join(s.token);
        used.add(s);
      }
    }
    return out;
  };

  // Header names that need tokens can't be restored, so switch to positional @n fields.
  const headerUnsafe = names.some((n) => encode(n, new Set()) !== n);
  const usedByCol = idx.map(() => new Set<Sub>());
  const dataLines = rows.map((r) => r.map((v, k) => encode(v, usedByCol[k])).join(delimiter));

  const auto = idx.map((i) => looksLikeCode(table.rows.map((r) => r[i])));
  const asText = idx.map((i, k) => colOpts[i].asText ?? auto[k]);
  auto.forEach((a, k) => {
    if (a && colOpts[idx[k]].asText === undefined)
      warnings.push({ level: 'info', message: `"${names[k]}" looks like a code (leading zeros), loaded with Text().` });
  });

  if (!opts.preserveWhitespace && rows.some((r) => r.some((v) => v !== v.replace(/^ +| +$/g, ''))))
    warnings.push({
      level: 'warn',
      message: 'Some values have leading/trailing spaces; Qlik strips these unless "Preserve whitespace" (SET Verbatim=1) is on.',
    });
  if (names.length === 1 && rows.some((r) => r[0] === ''))
    warnings.push({ level: 'warn', message: 'Single-column table with empty values: blank lines may be skipped by the loader.' });

  const fields = names.map((name, k) => {
    const src = headerUnsafe ? `@${k + 1}` : field(name);
    let expr = src;
    for (const s of usedByCol[k]) expr = `Replace(${expr}, '${s.token}', ${s.restore})`;
    if (asText[k]) expr = `Text(${expr})`;
    if (opts.emptyAsNull) expr = `If(Len(${expr}) = 0, Null(), ${expr})`;
    return { name, expr, plain: expr === src && !headerUnsafe, asText: asText[k], tokens: [...usedByCol[k]].map((s) => ({ token: s.token, text: s.find })) };
  });

  if (opts.mapping && names.length !== 2)
    warnings.push({ level: 'error', message: `A MAPPING LOAD needs exactly 2 columns; ${names.length} are included.` });

  const spec: string[] = [];
  if (delimiter !== ',') spec.push(`delimiter is '${delimiter === '\t' ? '\\t' : delimiter}'`);
  if (headerUnsafe) spec.push('no labels');

  const open = enclosure;
  const lines: string[] = [];
  if (opts.preserveWhitespace) lines.push('SET Verbatim = 1;', '');
  lines.push(label(tableName(opts.tableName ?? '', 'InlineTable')));
  const prefix = opts.mapping ? 'MAPPING LOAD' : 'LOAD';
  if (fields.every((f) => f.plain)) {
    lines.push(`${prefix} * INLINE ${open}`);
  } else {
    lines.push(prefix);
    fields.forEach((f, k) => {
      const as = f.expr === field(f.name) ? f.expr : `${f.expr} AS ${field(f.name)}`;
      lines.push(`    ${as}${k < fields.length - 1 ? ',' : ''}`);
    });
    lines.push(`INLINE ${open}`);
  }
  if (!headerUnsafe) lines.push(names.join(delimiter));
  lines.push(...dataLines);
  lines.push(`${close}${spec.length ? ` (${spec.join(', ')})` : ''};`);
  if (opts.preserveWhitespace) lines.push('', 'SET Verbatim = 0;');
  const script = lines.join('\n') + '\n';

  if (fields.some((f) => f.tokens.length))
    warnings.push({
      level: 'info',
      message: 'Some characters (line breaks, $(, quotes or the closing bracket) are written as {#…#} tokens and restored with Replace().',
    });
  if (script.length > SECTION_SOFT_LIMIT)
    warnings.push({
      level: 'warn',
      message: `Script is ${script.length.toLocaleString()} characters; Qlik recommends under 50,000 per section. Consider uploading a file.`,
    });

  return { script, warnings, delimiter, enclosure, fields: fields.map(({ name, asText, tokens }) => ({ name, asText, tokens })) };
}
