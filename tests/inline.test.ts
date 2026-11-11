import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTabular } from '../src/core/detect';
import { generateInline, type InlineResult } from '../src/core/inline/generate';
import { str } from '../src/core/qlik';

const fx = (name: string) => readFileSync(new URL(`../fixtures/tabular/${name}`, import.meta.url), 'utf8');

/**
 * Minimal model of how the engine reads an INLINE block (standard quoting, trimmed blanks),
 * followed by the generator's Replace() token restoration. Used to check round-trips.
 */
function simulate(r: InlineResult): string[][] {
  const close = { '[': ']', '`': '`', '"': '"', "'": "'" }[r.enclosure];
  const start = r.script.indexOf(`INLINE ${r.enclosure}\n`) + `INLINE ${r.enclosure}\n`.length;
  const end = r.script.lastIndexOf(`\n${close}`);
  const body = r.script.slice(start, end);
  expect(body.includes(close)).toBe(false);
  expect(body.includes('$(')).toBe(false);
  const lines = body.split('\n');
  const noLabels = r.script.includes('no labels');
  const data = noLabels ? lines : lines.slice(1);
  return data.map((l) =>
    l.split(r.delimiter).map((raw, k) => {
      let v = raw.trim();
      if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
      for (const t of r.fields[k].tokens) v = v.split(t.token).join(t.text);
      return v;
    }),
  );
}

describe('parseTabular', () => {
  it('detects CSV with quoted newlines and commas', () => {
    const { table, detected } = parseTabular(fx('nasty.csv'));
    expect(detected).toEqual({ format: 'delimited', delimiter: ',' });
    expect(table.columns).toEqual(['id', 'label', 'note', 'code']);
    expect(table.rows[1][2]).toBe('multi\nline');
    expect(table.rows[2][2]).toBe('O\'Brien said "hi"');
    expect(table.rows[3][1]).toBe('"quoted"');
  });
  it('detects Excel clipboard as tab separated', () => {
    const { table, detected } = parseTabular(fx('excel-clipboard.tsv'));
    expect(detected.delimiter).toBe('\t');
    expect(table.rows[0]).toEqual(['Widget', '1,234.50', '2026-10-31']);
  });
  it('parses markdown tables with escaped pipes', () => {
    const { table, detected } = parseTabular(fx('table.md'));
    expect(detected.format).toBe('markdown');
    expect(table.rows).toEqual([
      ['Pipe | fitting', '12.50', 'code'],
      ['Bold', '3', 'uses [brackets]'],
    ]);
  });
  it('parses HTML tables with entities', () => {
    const { table } = parseTabular(fx('table.html'));
    expect(table.columns).toEqual(['City', 'Temp °C']);
    expect(table.rows[1]).toEqual(['Malmö', '-3']);
  });
  it('flattens JSON records with dotted names', () => {
    const { table } = parseTabular('[{"a":1,"b":{"c":"x"},"d":[1,2]},{"a":2,"e":null}]');
    expect(table.columns).toEqual(['a', 'b.c', 'd', 'e']);
    expect(table.rows).toEqual([
      ['1', 'x', '[1,2]', null],
      ['2', null, null, null],
    ]);
  });
});

describe('generateInline', () => {
  it('emits LOAD * for clean data', () => {
    const r = generateInline(parseTabular(fx('simple.csv')).table, { tableName: 'Countries' });
    expect(r.script).toBe(
      '[Countries]:\nLOAD * INLINE [\nCountry,Code,Population\nSweden,SE,10550000\nUnited Kingdom,GB,67000000\n];\n',
    );
  });

  it('round-trips nasty values', () => {
    const { table } = parseTabular(fx('nasty.csv'));
    const r = generateInline(table);
    expect(simulate(r)).toEqual(table.rows.map((row) => row.map((v) => v ?? '')));
    expect(r.script).toContain('Text(code) AS code');
    expect(r.script).toContain("Chr(36)&'('");
  });

  it('switches delimiter and enclosure to avoid collisions', () => {
    const r = generateInline({ columns: ['a', 'b'], rows: [['x,y', 'arr[0]']] });
    expect(r.delimiter).toBe('\t');
    expect(r.enclosure).toBe('`');
    expect(r.script).toContain("(delimiter is '\\t')");
    expect(simulate(r)).toEqual([['x,y', 'arr[0]']]);
  });

  it('uses positional fields when headers are unsafe', () => {
    const r = generateInline({ columns: ['Price $(x)', 'b'], rows: [['1', '2']] });
    expect(r.script).toContain('no labels');
    expect(r.script).toContain('@1 AS [Price $(x)]');
  });

  it('dedupes and fills blank headers', () => {
    const r = generateInline(parseTabular(fx('dup-headers.csv')).table);
    expect(r.fields.map((f) => f.name)).toEqual(['Name', 'Name_2', 'Field3', 'Value']);
  });

  it('builds a mapping load', () => {
    const r = generateInline({ columns: ['k', 'v'], rows: [['a', '1']] }, { mapping: true, tableName: 'map1' });
    expect(r.script).toContain('[map1]:\nMAPPING LOAD * INLINE [');
    expect(r.warnings.some((w) => w.level === 'error')).toBe(false);
  });

  it('applies rename, exclude, null and Verbatim options', () => {
    const r = generateInline(
      { columns: ['a', 'b', 'c'], rows: [[' x ', '', 'z']] },
      { columns: [{ name: 'A' }, {}, { include: false }], emptyAsNull: true, preserveWhitespace: true },
    );
    expect(r.script).toContain('SET Verbatim = 1;');
    expect(r.script).toContain('If(Len(A) = 0, Null(), A) AS A');
    expect(r.script).not.toMatch(/\bz\b/);
  });
});

describe('str', () => {
  it('escapes quotes and dollar expansion', () => {
    expect(str("it's $(x)")).toBe("'it''s ' & Chr(36) & '(x)'");
  });
});

describe('share links', () => {
  it('round-trips state through the compressed hash', async () => {
    const { decodeShare, encodeShare } = await import('../src/ui/state');
    const state = { tab: 'rest', rest: { text: 'x'.repeat(100_000) + '€ "quotes" $(x)' } };
    expect(await decodeShare(await encodeShare(state))).toEqual(state);
  });
});
