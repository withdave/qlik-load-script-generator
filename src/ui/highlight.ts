// Lightweight Qlik script highlighter: comments, strings, [names], keywords, numbers, $(expansions).

const KEYWORDS = new Set(
  `load select sql from resident inline autogenerate where while group by order as distinct mapping noconcatenate concatenate join left right inner outer keep drop table tables field fields store into let set if then else elseif end for next each to step do loop exit script sub call trace lib connect with connection json wrap on off pk fk arrayvaluealias from_field and or not is null`.split(
    ' ',
  ),
);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CLOSE: Record<string, string> = { '[': ']', '`': '`', '"': '"', "'": "'" };

/** Highlight a script, leaving INLINE data blocks as plain text (// and ' are data there). */
export function highlight(script: string): string {
  let out = '';
  let pos = 0;
  for (const m of script.matchAll(/\bINLINE\s*([\[`"'])\n/gi)) {
    const start = m.index! + m[0].length;
    const end = script.indexOf(`\n${CLOSE[m[1]]}`, start);
    if (end < 0) break;
    out += highlightCode(script.slice(pos, start)) + `<span class="t-data">${esc(script.slice(start, end + 1))}</span>`;
    pos = end + 1;
  }
  return out + highlightCode(script.slice(pos));
}

function highlightCode(script: string): string {
  const re = /(\/\/[^\n]*)|('(?:[^']|'')*')|("(?:[^"]|"")*")|(\[(?:[^\]\n]|\]\])*\])|(\$\([^)\n]*\))|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_#]*)/g;
  let out = '';
  let last = 0;
  for (const m of script.matchAll(re)) {
    out += esc(script.slice(last, m.index));
    const [t, comment, sq, dq, br, dollar, num, word] = m;
    if (comment) out += `<span class="t-com">${esc(t)}</span>`;
    else if (sq || dq) out += `<span class="t-str">${esc(t)}</span>`;
    else if (br) out += `<span class="t-name">${esc(t)}</span>`;
    else if (dollar) out += `<span class="t-var">${esc(t)}</span>`;
    else if (num) out += `<span class="t-num">${esc(t)}</span>`;
    else if (word && KEYWORDS.has(word.toLowerCase())) out += `<span class="t-kw">${esc(t)}</span>`;
    else if (word && /^[A-Z][A-Za-z0-9#]*$/.test(word) && script[m.index! + t.length] === '(') out += `<span class="t-fn">${esc(t)}</span>`;
    else out += esc(t);
    last = m.index! + t.length;
  }
  return out + esc(script.slice(last));
}
