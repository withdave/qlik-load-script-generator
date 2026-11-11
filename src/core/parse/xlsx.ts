// Minimal, dependency-free reader for Excel workbooks (.xlsx / .xlsm, Office Open XML).
// Unzips with the platform's DecompressionStream (browsers and Node 18+) and reads the XML with
// regular expressions, so it runs the same in the web app, the tests and the bundled CLI.
// Legacy binary .xls (BIFF) and .xlsb workbooks are not supported.

export interface XlsxSheet {
  name: string;
  hidden: boolean;
}

export interface Workbook {
  sheets: XlsxSheet[];
  /** Cell values of a sheet as text, from its first used row/column to its last. Empty rows are dropped. */
  rows(sheet: string | number): string[][];
}

/** True when the bytes start like a ZIP archive (every .xlsx is one). */
export const looksLikeZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

// ---------- ZIP ----------

async function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not an Excel workbook (.xlsx): the file is not a ZIP archive');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt workbook: bad ZIP central directory');
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    if (size === 0xffffffff || local === 0xffffffff) throw new Error('Workbook is too large (ZIP64 is not supported)');
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    let raw: Uint8Array;
    if (method === 0) raw = data;
    else if (method === 8) {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`Unsupported ZIP compression method ${method}`);
    out.set(name, utf8.decode(raw));
  }
  return out;
}

// ---------- XML helpers ----------

const unescapeXml = (s: string) =>
  s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/gi, (_, hex, dec, named) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[named.toLowerCase() as 'lt'],
  );

/** Excel escapes characters XML can't carry (e.g. a carriage return) as _xHHHH_; _x005F_ escapes a literal underscore. */
const unescapeOoxml = (s: string) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

function attrs(tag: string): Record<string, string> {
  const a: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const v = unescapeXml(m[2] ?? m[3]);
    a[m[1]] = v;
    const local = m[1].replace(/^[\w.-]+:/, '');
    a[local] ??= v;
  }
  return a;
}

/** Text of every <t> element (any namespace prefix), skipping phonetic <rPh> runs. */
function textOf(xml: string): string {
  const body = xml.replace(/<(\w+:)?rPh\b[\s\S]*?<\/\1?rPh>/g, '');
  let s = '';
  for (const m of body.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) s += m[1];
  return unescapeOoxml(unescapeXml(s));
}

const tags = (xml: string, name: string) => xml.matchAll(new RegExp(`<(?:\\w+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}>)`, 'g'));

function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function relationships(files: Map<string, string>, part: string): Map<string, string> {
  const dir = part.split('/').slice(0, -1).join('/');
  const relsPath = `${dir ? `${dir}/` : ''}_rels/${part.split('/').pop()}.rels`;
  const m = new Map<string, string>();
  for (const [, a] of tags(files.get(relsPath) ?? '', 'Relationship')) {
    const r = attrs(a);
    if (r.Id && r.Target) m.set(r.Id, r.TargetMode === 'External' ? r.Target : resolve(part, r.Target));
  }
  return m;
}

// ---------- Cell values ----------

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN_TIME_ONLY = new Set([18, 19, 20, 21, 45, 46, 47]);

interface DateFmt {
  date: boolean;
  time: boolean;
}

function classifyFormat(code: string): DateFmt | null {
  // Drop quoted literals, escaped characters, and [colour]/[$-locale] sections, but keep [h]/[mm]/[ss].
  const c = code
    .split(';')[0]
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, '');
  if (!/[dmyhs]/i.test(c) || /^general$/i.test(c.trim())) return null;
  const date = /[dy]/i.test(c) || (/m/i.test(c) && !/[hs]/i.test(c));
  const time = /[hs]/i.test(c);
  return { date, time };
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}

/** Excel serial date → ISO text Qlik recognises (YYYY-MM-DD, hh:mm:ss or both). */
export function serialToIso(serial: number, fmt: DateFmt, date1904 = false): string {
  let days = serial;
  if (!date1904 && days < 60) days += 1; // Excel's phantom 1900-02-29
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const t = new Date(epoch + Math.round(days * 86400) * 1000);
  const d = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  const tm = `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
  const showTime = fmt.time || !Number.isInteger(serial);
  if (!fmt.date && serial < 1) return tm;
  return showTime ? `${d} ${tm}` : d;
}

/** Excel stores binary doubles (0.1 + 0.2 = 0.30000000000000004); show them as Excel does, to 15 significant digits. */
function formatNumber(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n) || Number.isInteger(n)) return v;
  return String(Number(n.toPrecision(15)));
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

// ---------- Workbook ----------

/** Read an .xlsx/.xlsm workbook. Sheets are parsed lazily by `rows()`. */
export async function readXlsx(input: ArrayBuffer | Uint8Array): Promise<Workbook> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!looksLikeZip(bytes)) {
    const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    throw new Error(ole ? 'Legacy .xls workbooks are not supported. Save the file as .xlsx in Excel and try again.' : 'Not an Excel workbook (.xlsx)');
  }
  const files = await unzip(bytes, (n) => n.endsWith('.xml') || n.endsWith('.rels'));
  const wbPath =
    [...tags(files.get('_rels/.rels') ?? '', 'Relationship')]
      .map(([, a]) => attrs(a))
      .find((r) => /\/officeDocument$/.test(r.Type ?? ''))
      ?.Target?.replace(/^\//, '') ?? 'xl/workbook.xml';
  const wbXml = files.get(wbPath);
  if (!wbXml) {
    if ([...files.keys()].some((k) => k.endsWith('.bin'))) throw new Error('Binary .xlsb workbooks are not supported. Save the file as .xlsx and try again.');
    throw new Error('Not an Excel workbook: no workbook part found');
  }
  const wbRels = relationships(files, wbPath);
  const date1904 = [...tags(wbXml, 'workbookPr')].some(([, a]) => /^(1|true)$/i.test(attrs(a).date1904 ?? ''));

  const sheetParts: { sheet: XlsxSheet; path: string }[] = [];
  for (const [, a] of tags(wbXml, 'sheet')) {
    const s = attrs(a);
    const path = wbRels.get(s.id ?? '');
    if (!s.name || !path || !files.has(path)) continue; // chartsheets and dialog sheets have no cells
    if (!/<(?:\w+:)?worksheet\b/.test(files.get(path)!.slice(0, 2000))) continue;
    sheetParts.push({ sheet: { name: s.name, hidden: !!s.state && s.state !== 'visible' }, path });
  }
  if (!sheetParts.length) throw new Error('The workbook has no worksheets');

  const relTargets = [...wbRels.values()];
  const sstPath = relTargets.find((t) => /sharedStrings\.xml$/i.test(t));
  const shared = sstPath ? [...tags(files.get(sstPath) ?? '', 'si')].map(([, , inner]) => textOf(inner ?? '')) : [];

  // Style index → date/time kind, from cellXfs only (cellStyleXfs uses the same <xf> tag).
  const stylesXml = files.get(relTargets.find((t) => /styles\.xml$/i.test(t)) ?? '') ?? '';
  const customFmt = new Map<number, string>();
  for (const [, a] of tags(stylesXml, 'numFmt')) {
    const f = attrs(a);
    customFmt.set(Number(f.numFmtId), f.formatCode ?? '');
  }
  const xfs: (DateFmt | null)[] = [];
  const cellXfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(stylesXml)?.[1] ?? '';
  for (const [, a] of tags(cellXfs, 'xf')) {
    const id = Number(attrs(a).numFmtId ?? 0);
    const custom = customFmt.get(id);
    xfs.push(
      custom !== undefined ? classifyFormat(custom) : BUILTIN_DATE.has(id) ? { date: !BUILTIN_TIME_ONLY.has(id), time: BUILTIN_TIME_ONLY.has(id) || id === 22 } : null,
    );
  }

  function rows(which: string | number): string[][] {
    const part = typeof which === 'number' ? sheetParts[which] : sheetParts.find((p) => p.sheet.name === which) ?? sheetParts.find((p) => p.sheet.name.toLowerCase() === which.toLowerCase());
    if (!part) throw new Error(`No sheet named "${which}". Sheets: ${sheetParts.map((p) => p.sheet.name).join(', ')}`);
    const xml = files.get(part.path)!;
    const data = /<(?:\w+:)?sheetData\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?sheetData>)/.exec(xml)?.[1] ?? '';
    const grid: string[][] = [];
    let minCol = Infinity;
    let maxCol = -1;
    let nextRow = 0;
    for (const [, ra, rinner] of tags(data, 'row')) {
      const rAttr = attrs(ra).r;
      const ri = rAttr ? Number(rAttr) - 1 : nextRow;
      nextRow = ri + 1;
      const cells: string[] = [];
      let nextCol = 0;
      for (const [, ca, cinner = ''] of tags(rinner ?? '', 'c')) {
        const c = attrs(ca);
        const ci = c.r ? colIndex(c.r) : nextCol;
        nextCol = ci + 1;
        const v = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cinner)?.[1];
        let text: string;
        switch (c.t) {
          case 's':
            text = shared[Number(v)] ?? '';
            break;
          case 'inlineStr':
            text = textOf(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(cinner)?.[1] ?? '');
            break;
          case 'str':
          case 'e':
            text = v === undefined ? '' : unescapeOoxml(unescapeXml(v));
            break;
          case 'b':
            text = v === undefined ? '' : v === '1' ? 'TRUE' : 'FALSE';
            break;
          case 'd':
            text = v === undefined ? '' : unescapeXml(v).replace('T', ' ').replace(/(\.\d+)?Z?$/, '').replace(/ 00:00:00$/, '');
            break;
          default: {
            if (v === undefined || v === '') {
              text = '';
              break;
            }
            const fmt = xfs[Number(c.s ?? 0)];
            const n = Number(v);
            text = fmt && Number.isFinite(n) ? serialToIso(n, fmt, date1904) : formatNumber(v);
          }
        }
        if (text === '') continue;
        cells[ci] = text.replace(/\r\n?/g, '\n'); // same line breaks as pasted text
        minCol = Math.min(minCol, ci);
        maxCol = Math.max(maxCol, ci);
      }
      if (cells.length) grid[ri] = cells;
    }
    if (maxCol < 0) return [];
    return grid.filter(Boolean).map((r) => Array.from({ length: maxCol - minCol + 1 }, (_, i) => r[minCol + i] ?? ''));
  }

  return { sheets: sheetParts.map((p) => p.sheet), rows };
}

/**
 * Rows as tab-separated text the delimited parser reads back exactly: cells holding a tab,
 * line break or quote are quoted with quotes doubled.
 */
export function rowsToTsv(rows: string[][]): string {
  return rows.map((r) => r.map((v) => (/[\t\n\r"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join('\t')).join('\n');
}
