/**
 * RFC 4180-style parser: quoted fields may contain the delimiter, newlines and doubled quotes.
 * Returns raw rows (no header handling).
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const s = text.replace(/\r\n?/g, '\n');
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
      i++;
      continue;
    }
    if (c === delimiter) {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const CANDIDATES = ['\t', ',', ';', '|'];

/** Pick the delimiter that splits the first lines most consistently into >1 columns. */
export function sniffDelimiter(text: string): string {
  const sample = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim()).slice(0, 20).join('\n');
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const rows = parseDelimited(sample, d);
    if (!rows.length) continue;
    const counts = rows.map((r) => r.length);
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.filter((c) => c === first).length / counts.length;
    // Prefer tab (spreadsheet clipboard) on ties, then by column count.
    const score = consistent * 100 + Math.min(first, 50) + (d === '\t' ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}
