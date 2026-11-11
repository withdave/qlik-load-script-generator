// Regex-based <table> reader so it runs in Node tests and the browser alike.
// Good enough for clipboard HTML from Excel, Sheets, Confluence and web pages.

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', deg: '°', euro: '€', pound: '£', copy: '©',
  ndash: '–', mdash: '—', hellip: '…', auml: 'ä', ouml: 'ö', uuml: 'ü', aring: 'å', Auml: 'Ä', Ouml: 'Ö',
  Uuml: 'Ü', Aring: 'Å', eacute: 'é', egrave: 'è', aacute: 'á', szlig: 'ß', oslash: 'ø', aelig: 'æ',
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function looksLikeHtmlTable(text: string): boolean {
  return /<table[\s>]/i.test(text) && /<t[dh][\s>]/i.test(text);
}

export function parseHtmlTable(text: string): string[][] {
  const table = text.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? text;
  const rows: string[][] = [];
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells: string[] = [];
    for (const m of tr.matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      const inner = m[3]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div)>/gi, '\n')
        .replace(/<[^>]+>/g, '');
      const value = decode(inner).replace(/[ \t\r]*\n[ \t\r]*/g, '\n').replace(/[ \t]+/g, ' ').trim();
      const span = Number(m[2].match(/colspan\s*=\s*"?(\d+)/i)?.[1] ?? 1);
      cells.push(value, ...Array(Math.max(0, span - 1)).fill(''));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}
