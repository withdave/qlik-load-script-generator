import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTabular } from '../src/core/detect';
import { generateInline } from '../src/core/inline/generate';
import { readXlsx, rowsToTsv, serialToIso } from '../src/core/parse/xlsx';

// Built by fixtures/tabular/build-workbook.py.
const bytes = () => readFileSync(new URL('../fixtures/tabular/workbook.xlsx', import.meta.url));

describe('readXlsx', () => {
  it('lists worksheets in workbook order, flagging hidden ones', async () => {
    const wb = await readXlsx(bytes());
    expect(wb.sheets).toEqual([
      { name: 'Products', hidden: false },
      { name: 'Regions & Codes', hidden: false },
      { name: 'Lookup', hidden: true },
    ]);
  });

  it('reads cell types the way Excel shows them', async () => {
    const wb = await readXlsx(bytes());
    expect(wb.rows('Products')).toEqual([
      ['SKU', 'Name', 'Price', 'Released', 'Updated', 'Active', 'Total'],
      ['007', 'Widget', '0.3', '2026-10-31', '2026-10-31 12:00:00', 'TRUE', '0.6'],
      ['A&B\n', 'Plug "3-pin"\nUK', '12', '', '18:00:00', 'FALSE', '#DIV/0!'],
      ['xy', '', '-0.0015', '', '', '', ''],
    ]);
  });

  it('trims to the used range, drops empty rows and handles prefixed XML', async () => {
    const wb = await readXlsx(bytes());
    expect(wb.rows(1)).toEqual([
      ['Code', 'Region'],
      ['N', 'North'],
      ['S', ''],
    ]);
    expect(wb.rows('lookup')).toEqual([
      ['k', 'v'],
      ['1', 'one'],
    ]);
  });

  it('names the sheets when the requested one is missing', async () => {
    const wb = await readXlsx(bytes());
    expect(() => wb.rows('Nope')).toThrow('Sheets: Products, Regions & Codes, Lookup');
  });

  it('rejects legacy .xls and non-workbooks with a clear message', async () => {
    await expect(readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).rejects.toThrow('Legacy .xls');
    await expect(readXlsx(new TextEncoder().encode('a,b\n1,2'))).rejects.toThrow('Not an Excel workbook');
  });

  it('converts serial dates, including the 1900 leap-year bug and the 1904 system', () => {
    expect(serialToIso(1, { date: true, time: false })).toBe('1900-01-01');
    expect(serialToIso(61, { date: true, time: false })).toBe('1900-03-01');
    expect(serialToIso(0, { date: true, time: false }, true)).toBe('1904-01-01');
    expect(serialToIso(0.5, { date: false, time: true })).toBe('12:00:00');
  });
});

describe('Excel sheet → INLINE', () => {
  it('round-trips a sheet through TSV text into the inline generator', async () => {
    const wb = await readXlsx(bytes());
    const rows = wb.rows('Products');
    const { table } = parseTabular(rowsToTsv(rows), { format: 'delimited', delimiter: '\t' });
    expect(table.columns).toEqual(rows[0]);
    expect(table.rows).toEqual(rows.slice(1));
    const r = generateInline(table, { tableName: 'Products' });
    expect(r.script).toContain("Text(Replace(SKU, '{#LF#}', Chr(10))) AS SKU");
    expect(r.script).toContain('007,Widget,0.3,2026-10-31,2026-10-31 12:00:00,TRUE,0.6');
  });
});
