const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.length >= 2 && lines[0].includes('|') && SEPARATOR.test(lines[1]);
}

/** Split a GFM table row on unescaped pipes outside inline code spans. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (c === '`') {
      inCode = !inCode;
      cell += c;
    } else if (c === '|' && !inCode) {
      cells.push(cell);
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/** Strip simple inline markdown that never belongs in data: `code`, **bold**, <br>. */
function clean(cell: string): string {
  return cell
    .replace(/^`([^`]*)`$/, '$1')
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/<br\s*\/?>/gi, '\n');
}

export function parseMarkdown(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out: string[][] = [];
  lines.forEach((line, i) => {
    if (i === 1 && SEPARATOR.test(line)) return;
    if (!line.includes('|')) return;
    out.push(splitRow(line).map(clean));
  });
  return out;
}
