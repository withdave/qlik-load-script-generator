#!/usr/bin/env node
// Bundled from src/cli.ts by `npm run build:skill`. Do not edit by hand.

// src/cli.ts
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

// src/core/model.ts
function rectangular(t) {
  const w = t.columns.length;
  return {
    columns: t.columns,
    rows: t.rows.map((r) => r.length === w ? r : [...r, ...Array(Math.max(0, w - r.length)).fill(null)].slice(0, w))
  };
}

// src/core/parse/delimited.ts
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const s = text.replace(/\r\n?/g, "\n");
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
    if (c === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
      i++;
      continue;
    }
    if (c === delimiter) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}
var CANDIDATES = ["	", ",", ";", "|"];
function sniffDelimiter(text) {
  const sample = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim()).slice(0, 20).join("\n");
  let best = ",";
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const rows = parseDelimited(sample, d);
    if (!rows.length) continue;
    const counts = rows.map((r) => r.length);
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const score = consistent * 100 + Math.min(first, 50) + (d === "	" ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

// src/core/parse/html.ts
var ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\xA0",
  deg: "\xB0",
  euro: "\u20AC",
  pound: "\xA3",
  copy: "\xA9",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  auml: "\xE4",
  ouml: "\xF6",
  uuml: "\xFC",
  aring: "\xE5",
  Auml: "\xC4",
  Ouml: "\xD6",
  Uuml: "\xDC",
  Aring: "\xC5",
  eacute: "\xE9",
  egrave: "\xE8",
  aacute: "\xE1",
  szlig: "\xDF",
  oslash: "\xF8",
  aelig: "\xE6"
};
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}
function looksLikeHtmlTable(text) {
  return /<table[\s>]/i.test(text) && /<t[dh][\s>]/i.test(text);
}
function parseHtmlTable(text) {
  const table = text.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? text;
  const rows = [];
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [];
    for (const m of tr.matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      const inner = m[3].replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div)>/gi, "\n").replace(/<[^>]+>/g, "");
      const value = decode(inner).replace(/[ \t\r]*\n[ \t\r]*/g, "\n").replace(/[ \t]+/g, " ").trim();
      const span = Number(m[2].match(/colspan\s*=\s*"?(\d+)/i)?.[1] ?? 1);
      cells.push(value, ...Array(Math.max(0, span - 1)).fill(""));
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// src/core/parse/json.ts
function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
function parseNdjson(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const out = [];
  for (const l of lines) {
    const r = tryParseJson(l);
    if (!r.ok || typeof r.value !== "object" || r.value === null) return null;
    out.push(r.value);
  }
  return out;
}
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function scalarText(v) {
  if (v === null) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" || typeof v === "string") return String(v);
  return JSON.stringify(v);
}
function flatten(v, prefix, out) {
  if (isObject(v)) {
    const keys = Object.keys(v);
    if (!keys.length && prefix) out.set(prefix, "{}");
    for (const k of keys) flatten(v[k], prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix || "value", scalarText(v));
  }
}
function jsonToTable(value) {
  let records;
  if (Array.isArray(value)) records = value;
  else if (isObject(value)) {
    const arrays = Object.entries(value).filter(([, v]) => Array.isArray(v) && v.some(isObject));
    records = arrays.length === 1 ? arrays[0][1] : [value];
  } else records = [value];
  if (records.length && records.every((r) => Array.isArray(r))) {
    const rows = records;
    const header = rows[0].every((c) => typeof c === "string") ? rows[0] : null;
    const body = header ? rows.slice(1) : rows;
    const width = Math.max(...rows.map((r) => r.length));
    return {
      columns: header ?? Array.from({ length: width }, (_, i) => `@${i + 1}`),
      rows: body.map((r) => Array.from({ length: width }, (_, i) => i < r.length ? scalarText(r[i]) : null))
    };
  }
  const columns = [];
  const seen = /* @__PURE__ */ new Set();
  const flat = records.map((r) => {
    const m = /* @__PURE__ */ new Map();
    flatten(r, "", m);
    for (const k of m.keys()) if (!seen.has(k)) seen.add(k), columns.push(k);
    return m;
  });
  return { columns, rows: flat.map((m) => columns.map((c) => m.has(c) ? m.get(c) : null)) };
}

// src/core/parse/markdown.ts
var SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
function looksLikeMarkdown(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.length >= 2 && lines[0].includes("|") && SEPARATOR.test(lines[1]);
}
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cell = "";
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (c === "`") {
      inCode = !inCode;
      cell += c;
    } else if (c === "|" && !inCode) {
      cells.push(cell);
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}
function clean(cell) {
  return cell.replace(/^`([^`]*)`$/, "$1").replace(/^\*\*(.*)\*\*$/, "$1").replace(/<br\s*\/?>/gi, "\n");
}
function parseMarkdown(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out = [];
  lines.forEach((line, i) => {
    if (i === 1 && SEPARATOR.test(line)) return;
    if (!line.includes("|")) return;
    out.push(splitRow(line).map(clean));
  });
  return out;
}

// src/core/detect.ts
function detectFormat(text) {
  const t = text.trim();
  if (/^[\[{]/.test(t)) {
    if (tryParseJson(t).ok) return { format: "json" };
    if (parseNdjson(t)) return { format: "ndjson" };
  }
  if (looksLikeHtmlTable(t)) return { format: "html" };
  if (looksLikeMarkdown(t)) return { format: "markdown" };
  return { format: "delimited", delimiter: sniffDelimiter(t) };
}
function parseTabular(text, opts = {}) {
  const detected = opts.format ? { format: opts.format, delimiter: opts.delimiter } : detectFormat(text);
  const header = opts.header ?? true;
  let raw;
  switch (detected.format) {
    case "json": {
      const r = tryParseJson(text.trim());
      if (!r.ok) throw new Error(`Invalid JSON: ${r.error}`);
      return { table: rectangular(jsonToTable(r.value)), detected };
    }
    case "ndjson": {
      const recs = parseNdjson(text);
      if (!recs) throw new Error("Invalid NDJSON: every line must be a JSON object");
      return { table: rectangular(jsonToTable(recs)), detected };
    }
    case "html":
      raw = parseHtmlTable(text);
      break;
    case "markdown":
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
  while (columns.length < width) columns.push("");
  const rows = header ? raw.slice(1) : raw;
  return { table: rectangular({ columns, rows }), detected };
}

// src/core/qlik.ts
function ref(name) {
  return `[${name.replace(/]/g, "]]")}]`;
}
var RESERVED = new Set(
  "and as by distinct from group having inline is join keep like load mapping not or order resident select sql table to where with xor".split(" ")
);
function field(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name.toLowerCase()) ? name : ref(name);
}
function label(name) {
  return `${ref(name)}:`;
}
function str(s) {
  return `'${s.replace(/'/g, "''").split("$(").join(`' & Chr(36) & '(`)}'`;
}
function pointerSegment(key) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
function tableName(s, fallback = "Table") {
  const t = s.trim().replace(/[\[\]"'`;]/g, "").replace(/\s+/g, "_");
  return t || fallback;
}
function uniqueNames(names, fallback = "Field") {
  const used = /* @__PURE__ */ new Set();
  return names.map((raw, i) => {
    const base = raw.trim() || `${fallback}${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    return name;
  });
}
var SECTION_SOFT_LIMIT = 5e4;
var JSON_FIELD_LIMIT = 5e3;
var JSON_TABLE_LIMIT = 1e3;

// src/core/inline/generate.ts
var CLOSE = { "[": "]", "`": "`", '"': '"', "'": "'" };
var DELIMITERS = [",", "	", ";", "|"];
var ENCLOSURES = ["[", "`", '"', "'"];
function looksLikeCode(values) {
  return values.some((v) => v != null && (/^[+-]?0\d/.test(v.trim()) || /^\d{16,}$/.test(v.trim())));
}
function makeToken(name, haystack) {
  let t = `{#${name}#}`;
  for (let n = 2; haystack.includes(t); n++) t = `{#${name}${n}#}`;
  return t;
}
var hasBoundaryQuote = (v) => /^\s*["']|["']\s*$/.test(v);
function generateInline(table, opts = {}) {
  const warnings = [];
  const colOpts = table.columns.map((_, i) => opts.columns?.[i] ?? {});
  const included = table.columns.map((_, i) => colOpts[i].include !== false);
  const idx = table.columns.map((_, i) => i).filter((i) => included[i]);
  const requested = idx.map((i) => colOpts[i].name ?? table.columns[i]);
  const names = uniqueNames(requested);
  names.forEach((n, k) => {
    if (n !== requested[k].trim())
      warnings.push({ level: "info", message: `Column ${k + 1} renamed to "${n}" (blank or duplicate name).` });
  });
  const rows = table.rows.map((r) => idx.map((i) => r[i] ?? ""));
  const all = [...names, ...rows.flat()].join("\n");
  const delimiter = opts.delimiter && opts.delimiter !== "auto" ? opts.delimiter : DELIMITERS.find((d) => !all.includes(d)) ?? ",";
  const enclosure = opts.enclosure && opts.enclosure !== "auto" ? opts.enclosure : ENCLOSURES.find((e) => !all.includes(CLOSE[e])) ?? "[";
  const close = CLOSE[enclosure];
  const subs = [
    { find: "\r\n", token: makeToken("CRLF", all), restore: "Chr(13)&Chr(10)" },
    { find: "\n", token: makeToken("LF", all), restore: "Chr(10)" },
    { find: "\r", token: makeToken("CR", all), restore: "Chr(13)" },
    // Dollar-sign expansion runs before the statement is parsed, even inside INLINE data.
    { find: "$(", token: makeToken("DOLLAR", all), restore: "Chr(36)&'('" },
    { find: delimiter, token: makeToken("DELIM", all), restore: delimiter === "	" ? "Chr(9)" : `'${delimiter}'` },
    { find: close, token: makeToken("CLOSE", all), restore: close === "'" ? "Chr(39)" : `'${close}'` },
    { find: '"', token: makeToken("DQ", all), restore: "Chr(34)" },
    { find: "'", token: makeToken("SQ", all), restore: "Chr(39)" }
  ];
  const quoteSubs = /* @__PURE__ */ new Set(['"', "'"]);
  const encode = (v, used) => {
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
  const headerUnsafe = names.some((n) => encode(n, /* @__PURE__ */ new Set()) !== n);
  const usedByCol = idx.map(() => /* @__PURE__ */ new Set());
  const dataLines = rows.map((r) => r.map((v, k) => encode(v, usedByCol[k])).join(delimiter));
  const auto = idx.map((i) => looksLikeCode(table.rows.map((r) => r[i])));
  const asText = idx.map((i, k) => colOpts[i].asText ?? auto[k]);
  auto.forEach((a, k) => {
    if (a && colOpts[idx[k]].asText === void 0)
      warnings.push({ level: "info", message: `"${names[k]}" looks like a code (leading zeros), loaded with Text().` });
  });
  if (!opts.preserveWhitespace && rows.some((r) => r.some((v) => v !== v.replace(/^ +| +$/g, ""))))
    warnings.push({
      level: "warn",
      message: 'Some values have leading/trailing spaces; Qlik strips these unless "Preserve whitespace" (SET Verbatim=1) is on.'
    });
  if (names.length === 1 && rows.some((r) => r[0] === ""))
    warnings.push({ level: "warn", message: "Single-column table with empty values: blank lines may be skipped by the loader." });
  const fields = names.map((name, k) => {
    const src = headerUnsafe ? `@${k + 1}` : field(name);
    let expr = src;
    for (const s of usedByCol[k]) expr = `Replace(${expr}, '${s.token}', ${s.restore})`;
    if (asText[k]) expr = `Text(${expr})`;
    if (opts.emptyAsNull) expr = `If(Len(${expr}) = 0, Null(), ${expr})`;
    return { name, expr, plain: expr === src && !headerUnsafe, asText: asText[k], tokens: [...usedByCol[k]].map((s) => ({ token: s.token, text: s.find })) };
  });
  if (opts.mapping && names.length !== 2)
    warnings.push({ level: "error", message: `A MAPPING LOAD needs exactly 2 columns; ${names.length} are included.` });
  const spec = [];
  if (delimiter !== ",") spec.push(`delimiter is '${delimiter === "	" ? "\\t" : delimiter}'`);
  if (headerUnsafe) spec.push("no labels");
  const open = enclosure;
  const lines = [];
  if (opts.preserveWhitespace) lines.push("SET Verbatim = 1;", "");
  lines.push(label(tableName(opts.tableName ?? "", "InlineTable")));
  const prefix = opts.mapping ? "MAPPING LOAD" : "LOAD";
  if (fields.every((f) => f.plain)) {
    lines.push(`${prefix} * INLINE ${open}`);
  } else {
    lines.push(prefix);
    fields.forEach((f, k) => {
      const as = f.expr === field(f.name) ? f.expr : `${f.expr} AS ${field(f.name)}`;
      lines.push(`    ${as}${k < fields.length - 1 ? "," : ""}`);
    });
    lines.push(`INLINE ${open}`);
  }
  if (!headerUnsafe) lines.push(names.join(delimiter));
  lines.push(...dataLines);
  lines.push(`${close}${spec.length ? ` (${spec.join(", ")})` : ""};`);
  if (opts.preserveWhitespace) lines.push("", "SET Verbatim = 0;");
  const script = lines.join("\n") + "\n";
  if (fields.some((f) => f.tokens.length))
    warnings.push({
      level: "info",
      message: "Some characters (line breaks, $(, quotes or the closing bracket) are written as {#\u2026#} tokens and restored with Replace()."
    });
  if (script.length > SECTION_SOFT_LIMIT)
    warnings.push({
      level: "warn",
      message: `Script is ${script.length.toLocaleString()} characters; Qlik recommends under 50,000 per section. Consider uploading a file.`
    });
  return { script, warnings, delimiter, enclosure, fields: fields.map(({ name, asText: asText2, tokens }) => ({ name, asText: asText2, tokens })) };
}

// src/core/json/shape.ts
function kindOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v === "object" ? "object" : typeof v;
}
function empty() {
  return { kinds: /* @__PURE__ */ new Set(), count: 0 };
}
function addSample(shape, v) {
  shape.count++;
  const k = kindOf(v);
  shape.kinds.add(k);
  if (k === "object") {
    shape.props ??= /* @__PURE__ */ new Map();
    for (const [key, child] of Object.entries(v)) {
      if (!shape.props.has(key)) shape.props.set(key, empty());
      addSample(shape.props.get(key), child);
    }
  } else if (k === "array") {
    const arr = v;
    shape.maxLen = Math.max(shape.maxLen ?? 0, arr.length);
    shape.items ??= empty();
    for (const el of arr) addSample(shape.items, el);
  } else if (k === "string" && /^\s*[\[{]/.test(v)) {
    try {
      const inner = JSON.parse(v);
      if (typeof inner === "object" && inner !== null) shape.jsonInString = true;
    } catch {
    }
  }
  return shape;
}
function shapeOf(...samples) {
  const s = empty();
  for (const v of samples) addSample(s, v);
  return s;
}
function realKinds(s) {
  return [...s.kinds].filter((k) => k !== "null");
}
function isMatrix(s) {
  return !!s.items && realKinds(s.items).length > 0 && realKinds(s.items).every((k) => k === "array");
}
function matrixHeader(v) {
  if (!Array.isArray(v) || !Array.isArray(v[0])) return null;
  const first = v[0];
  return first.length && first.every((c) => typeof c === "string") ? first : null;
}

// src/core/json/tables.ts
var keyName = (path) => `%Key_${path.join(".")}`;
function engineTables(doc) {
  const tables = [];
  const rootIsArray = realKinds(doc).includes("array") && !realKinds(doc).includes("object");
  const root = {
    path: [],
    pointer: "",
    rel: [],
    depth: 0,
    fields: [],
    childKeys: [],
    kind: "records",
    mixed: []
  };
  tables.push(root);
  if (rootIsArray) {
    if (isMatrix(doc)) {
      root.kind = "matrix";
      root.pointer = "/*/";
      return tables;
    }
    const items = doc.items;
    if (!items || !realKinds(items).length) root.kind = "empty";
    else if (!realKinds(items).includes("object")) root.fields.push({ name: "@1", rel: [] });
    else walkRow(items, root, [], "/*", [], tables);
  } else {
    walkRow(doc, root, [], "", [], tables);
  }
  return tables;
}
function walkRow(row, table, prefix, rowPointer, objSegs, tables) {
  for (const [key, child] of row.props ?? []) {
    const kinds = realKinds(child);
    const segs = [...objSegs, key];
    const name = [...prefix, ...segs].join(".");
    const scalar = !kinds.length || kinds.some((k) => k !== "object" && k !== "array");
    if (scalar) table.fields.push({ name, rel: segs });
    if (kinds.includes("object")) walkRow(child, table, prefix, rowPointer, segs, tables);
    if (kinds.includes("array")) {
      const path = [...table.path, ...segs];
      const key2 = keyName(path);
      table.fields.push({ name: key2, rel: [] });
      table.childKeys.push(key2);
      const pointer = `${rowPointer}/${segs.map(pointerSegment).join("/")}`;
      const t = {
        path,
        pointer,
        rel: segs,
        depth: table.depth + 1,
        fields: [{ name: key2, rel: [] }],
        parentKey: key2,
        childKeys: [],
        kind: "records",
        parent: table,
        mixed: []
      };
      tables.push(t);
      const items = child.items;
      const ik = items ? realKinds(items) : [];
      if (!ik.length) t.kind = "empty";
      else if (isMatrix(child)) {
        t.kind = "matrix";
        t.pointer = `${pointer}/*/`;
      } else {
        if (ik.some((k) => k !== "object" && k !== "array")) {
          t.fields.push({ name: `${path.join(".")}.@1`, rel: [] });
          if (!ik.includes("object")) t.kind = "scalars";
        }
        if (ik.includes("object")) walkRow(items, t, path, `${pointer}/*`, [], tables);
        if (ik.includes("object") && ik.some((k) => k !== "object")) t.mixed.push(`${path.join(".")}[]`);
      }
    }
    if (scalar && (kinds.includes("object") || kinds.includes("array"))) table.mixed.push(name);
  }
}
var tableLabel = (t, rootName) => t.path.length ? `${rootName}.${t.path.join(".")}` : rootName;

// src/core/json/engine.ts
function scriptSafeJson(v) {
  return JSON.stringify(v).replace(/'/g, "\\u0027").replace(/\$/g, "\\u0024").replace(/`/g, "\\u0060");
}
function tableIs(pointer) {
  return pointer.includes("'") && !pointer.includes("]") ? `table is [${pointer}]` : `table is '${pointer}'`;
}
function generateEngine(samples, opts) {
  const warnings = [];
  const src = opts.source;
  const rootName = opts.rootName || (src.kind === "field" ? src.field : "Data");
  const mode = opts.mode ?? "explicit";
  const out = [];
  const method = src.kind === "field" ? src.method ?? "reader" : void 0;
  const docArray = samples.length > 0 && samples.every((s) => Array.isArray(s));
  const docs = method === "reader" ? samples.map((d) => docArray ? { __rowid: 1, [rootName]: d } : { ...d, __rowid: 1 }) : samples;
  const shape = shapeOf(...docs);
  const all = engineTables(shape);
  const exclude = new Set(opts.exclude ?? []);
  const keep = (t) => !exclude.has(t.pointer) && (opts.maxDepth === void 0 || t.depth <= opts.maxDepth) && (!t.parent || keep(t.parent));
  const tables = all.filter(keep);
  const skipped = all.filter((t) => !keep(t));
  lint(shape, all, warnings);
  if (mode !== "explicit" && tables.filter((t) => t.kind !== "empty").length > 1)
    warnings.push({
      level: "warn",
      message: "The engine's %Key_ fields are hashes of the array content: records whose arrays are identical share one key, so their child rows link to all of them and sums double. 'List every field' rebuilds the keys from %Path instead."
    });
  if (skipped.length)
    warnings.push({
      level: "info",
      message: `Not loading ${skipped.length} nested table(s): ${skipped.map((t) => t.path.join(".")).join(", ")}. Their %Key_ fields stay in the parent table.`
    });
  if (opts.fieldDelimiter && opts.fieldDelimiter !== ".") out.push(`SET FieldNameDelimiter = ${str(opts.fieldDelimiter)};`, "");
  if (src.kind === "field") {
    if (src.sampleTable) out.push(...sampleTable(samples, src), "");
    if (method === "jsonget") out.push(...jsonGetLoads(tables, src, rootName, samples, opts));
    else out.push(...fromFieldLoads(tables, src, rootName, method, mode, opts, docArray, samples));
  } else {
    let from;
    if (src.kind === "file") from = `FROM ${ref(src.path)}`;
    else {
      const json2 = scriptSafeJson(samples[0]);
      out.push(`LET vJson = '${json2}';`, "");
      from = `INLINE '$(vJson)'`;
    }
    out.push(...readerLoads(tables, from, rootName, mode, opts, samples[0], { rootArray: Array.isArray(samples[0]), multiDoc: false }));
    if (src.kind === "inline") out.push("", "SET vJson = ;");
  }
  const script = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  if (script.length > SECTION_SOFT_LIMIT)
    warnings.push({
      level: "warn",
      message: `Script is ${script.length.toLocaleString()} characters (Qlik recommends under 50,000 per section). Upload the JSON as a file and use FROM [lib://...] instead.`
    });
  return { script, warnings, tables: all, shape };
}
function lint(shape, tables, warnings) {
  const fieldCount = tables.reduce((n, t) => n + t.fields.length, 0);
  if (fieldCount > JSON_FIELD_LIMIT || tables.length > JSON_TABLE_LIMIT)
    warnings.push({
      level: "warn",
      message: `This JSON yields ${fieldCount} fields / ${tables.length} tables; the engine stops at ${JSON_FIELD_LIMIT} / ${JSON_TABLE_LIMIT} per load. Add SET FieldNumberLimit / TableNumberLimit or exclude tables.`
    });
  for (const t of tables) {
    for (const m of t.mixed)
      warnings.push({
        level: "warn",
        message: `"${m}" is sometimes a value and sometimes an object/array; you will get both ${m} and its %Key_ field.`
      });
    if (t.kind === "empty") warnings.push({ level: "info", message: `Array "${t.path.join(".")}" is empty in the sample, so its fields are unknown.` });
  }
  const walk = (s, path) => {
    if (s.jsonInString)
      warnings.push({
        level: "warn",
        message: `"${path}" holds JSON as a string (double-encoded). The reader loads it as text; expand it with a second From_Field / JsonGet load.`
      });
    for (const [k, c] of s.props ?? []) {
      if (k.includes("."))
        warnings.push({ level: "warn", message: `Key "${k}" contains "." which the engine also uses for nesting; consider SET FieldNameDelimiter = ':'.` });
      walk(c, path ? `${path}.${k}` : k);
    }
    if (s.items) walk(s.items, path);
  };
  walk(shape, "");
}
function readerLoads(tables, from, rootName, mode, opts, sample, ctx) {
  const out = [];
  if (mode === "alltables") {
    out.push("// One load creates every table; names follow the JSON paths.", `LOAD * ${from} (json, all tables);`);
    return out;
  }
  const pre = ctx.multiDoc ? `FileName() & '|' & ` : "";
  const childKey = `${pre}Left([%Path], Index([%Path], '/', -1) - 1)`;
  const parentKey = (t, c) => {
    const rel = str("/" + c.rel.join("/"));
    return !t.parent && !ctx.rootArray ? `${pre}${rel}` : `${pre}[%Path] & ${rel}`;
  };
  for (const t of tables) {
    if (t.kind === "empty") continue;
    const specs = ["json"];
    if (t.kind === "matrix") {
      if (opts.matrix === "jsonget" && sample !== void 0 && !t.parent) {
        out.push(...matrixJsonGet(t, from, rootName, sample));
        continue;
      }
      specs.push(tableIs(t.pointer));
      if (!t.parent && sample !== void 0 && matrixHeader(sample)) specs.push("embedded labels");
      out.push(`// [][] matrix: supported on current Qlik Cloud. On older engines, choose the JsonGet matrix option.`);
    } else if (t.pointer) specs.push(tableIs(t.pointer));
    out.push(label(tableLabel(t, rootName)));
    if (mode === "explicit" && t.kind !== "matrix") {
      const lines = t.fields.map((f) => {
        if (f.name === t.parentKey) return `${childKey} AS ${field(f.name)}`;
        const child = tables.find((c) => c.parent === t && c.parentKey === f.name);
        return child ? `${parentKey(t, child)} AS ${field(f.name)}` : field(f.name);
      });
      out.push("LOAD");
      lines.forEach((l, i) => out.push(`    ${l}${i < lines.length - 1 ? "," : ""}`));
      out.push(`${from} (${specs.join(", ")});`, "");
    } else out.push(`LOAD * ${from} (${specs.join(", ")});`, "");
  }
  return out;
}
function matrixJsonGet(t, from, rootName, sample) {
  const header = matrixHeader(sample);
  const width = Math.max(...sample.map((r) => r.length));
  const names = header ?? Array.from({ length: width }, (_, i) => `Col${i + 1}`);
  const out = [label(tableLabel(t, rootName)), "LOAD"];
  names.forEach((n, i) => out.push(`    JsonGet(__row, '/${i}') AS ${field(n)}${i < names.length - 1 ? "," : ""}`));
  if (header) out.push("WHERE RecNo() > 1;");
  else out[out.length - 1] += ";";
  out.push(`LOAD JsonGet(__doc, '/*') AS __row;`);
  out.push(`LOAD @1:n AS __doc ${from} (fix, utf8, no labels, record is 1000000 lines);`, "");
  return out;
}
function sampleTable(samples, src) {
  const key = src.keyField || "id";
  const r = generateInline(
    { columns: [key, src.field], rows: samples.map((s, i) => [String(i + 1), JSON.stringify(s)]) },
    { tableName: src.table, columns: [{ asText: false }, { asText: false }] }
  );
  return ["// Sample rows standing in for a database table with a JSON column.", ...r.script.trimEnd().split("\n")];
}
function fromFieldLoads(tables, src, rootName, method, mode, opts, docArray, samples) {
  const out = [];
  const s = ref(src.table);
  const f = ref(src.field);
  if (method === "fromfield") {
    out.push(
      "// From_Field reads each DISTINCT value once: identical documents collapse and",
      "// rows do not link back to the source table unless the JSON carries its own id."
    );
    out.push(...readerLoads(tables, `From_Field(${s}, ${f})`, rootName, mode, opts, samples[0], { rootArray: docArray, multiDoc: true }));
    return out;
  }
  const tagged = `${src.table}_json`;
  const tag = docArray ? `'{"__rowid":' & RecNo() & ',${JSON.stringify(rootName).replace(/'/g, "''")}:' & ${f} & '}'` : `JsonSet(${f}, '/__rowid', RecNo())`;
  out.push(
    "// Tag every JSON document with its source row (__rowid), then let the JSON reader",
    "// expand it. The expanded tables link back through __rowid.",
    label(tagged),
    "LOAD"
  );
  if (src.keyField) out.push(`    ${field(src.keyField)},`);
  out.push(`    RecNo() AS __rowid,`, `    ${tag} AS __json`, `RESIDENT ${s}`, `WHERE IsJson(${f});`, "");
  out.push(...readerLoads(tables, `From_Field(${ref(tagged)}, __json)`, rootName, mode, opts, void 0, { rootArray: false, multiDoc: true }));
  out.push(`DROP FIELD __json FROM ${ref(tagged)};`);
  return out;
}
function jsonGetLoads(tables, src, rootName, samples, opts) {
  const out = [];
  const f = ref(src.field);
  const rootKey = src.keyField ? field(src.keyField) : "__rowid";
  const rootKeyExpr = src.keyField ? field(src.keyField) : "RecNo()";
  const docArray = samples.every((s) => Array.isArray(s));
  const ptr = (segs) => "/" + segs.map(pointerSegment).join("/");
  const linkName = (t) => t.parent && t.parent.depth === 0 && !docArray ? rootKey : field(t.parentKey);
  const bottom = `LOAD ${rootKeyExpr} AS __k0, ${f} AS __j0 RESIDENT ${ref(src.table)} WHERE IsJson(${f});`;
  if (opts.matrix !== "native" && tables[0]?.kind === "matrix") {
    out.push(...matrixJsonGet(tables[0], `RESIDENT ${ref(src.table)}`, rootName, samples[0]).slice(0, -2));
    out.push(`LOAD ${f} AS __doc RESIDENT ${ref(src.table)} WHERE IsJson(${f});`, "");
    return out;
  }
  for (const t of tables) {
    if (t.kind === "empty" || t.kind === "matrix") continue;
    const chain = [];
    for (let a = t; a; a = a.parent) chain.unshift(a);
    const d = t.depth + (docArray ? 1 : 0);
    const relOf = (s) => docArray ? s === 1 ? "" : ptr(chain[s - 1].rel) : ptr(chain[s].rel);
    const j = d === 0 ? f : `__j${d}`;
    const top = [];
    if (d === 0) top.push(rootKeyExpr === rootKey ? rootKey : `${rootKeyExpr} AS ${rootKey}`);
    else top.push(`__k${d - 1} AS ${linkName(t)}`);
    if (d > 0) for (const c of t.childKeys) top.push(`Hash128(__k${d - 1}, ${j}) AS ${field(c)}`);
    for (const fl of t.fields) {
      if (fl.name.startsWith("%Key_")) continue;
      const name = fl.name.endsWith("@1") ? fl.name.replace(/\.?@1$/, "") || rootName : fl.name;
      top.push(fl.rel.length ? `JsonGet(${j}, '${ptr(fl.rel)}') AS ${field(name)}` : `${j} AS ${field(name)}`);
    }
    out.push(label(tableLabel(t, rootName)), "LOAD");
    top.forEach((x, i) => out.push(`    ${x}${i < top.length - 1 ? "," : ""}`));
    if (d === 0) {
      out.push(`RESIDENT ${ref(src.table)}`, `WHERE IsJson(${f});`, "");
      continue;
    }
    out.push(`WHERE NOT IsNull(${j});`);
    for (let s = d; s >= 1; s--) {
      const k = s === 1 ? "__k0" : `Hash128(__k${s - 2}, __j${s - 1}) AS __k${s - 1}`;
      out.push(`LOAD ${k}, JsonGet(__j${s - 1}, '${relOf(s)}/*') AS __j${s};`);
    }
    out.push(bottom, "");
  }
  return out;
}

// src/core/json/rest.ts
var mkTable = (name, isArray) => ({
  name,
  alias: name,
  isArray,
  simpleItems: false,
  fields: [],
  children: []
});
function addTable(parent, name, isArray) {
  let t = parent.children.find((c) => c.name === name);
  if (!t) {
    t = mkTable(name, isArray);
    parent.children.push(t);
  }
  return t;
}
function addField(t, name) {
  if (!t.fields.some((f) => f.name === name)) t.fields.push({ name, alias: name });
}
function parseObject(o2, t) {
  for (const [k, v] of Object.entries(o2)) {
    if (Array.isArray(v)) parseArray(v, addTable(t, k, true));
    else if (isObject(v)) parseObject(v, addTable(t, k, false));
    else addField(t, k);
  }
}
function parseArray(a, t) {
  for (const el of a) {
    if (Array.isArray(el)) parseArray(el, addTable(t, t.name, true));
    else if (isObject(el)) parseObject(el, t);
    else t.simpleItems = true;
  }
}
var preorder = (t) => [t, ...t.children.flatMap(preorder)];
var escapeName = (s) => (s.trim() ? s : "unknown" + "_".repeat(s.length)).replace(/[\[\]"]/g, "_");
function uniqueIn(name, used) {
  if (!used.has(name)) return name;
  for (let n = 0; ; n++) if (!used.has(`${name}_u${n}`)) return `${name}_u${n}`;
}
function restMetadata(doc) {
  const wrapper = mkTable("root", false);
  if (Array.isArray(doc)) parseArray(doc, addTable(wrapper, "root", true));
  else if (isObject(doc)) parseObject(doc, wrapper);
  else throw new Error("The REST connector needs a JSON object or array as the response");
  let root;
  let wrap;
  if (wrapper.children.length > 1 || wrapper.fields.length) {
    root = wrapper;
    wrap = true;
  } else if (wrapper.children.length === 1) {
    root = wrapper.children[0];
    wrap = Array.isArray(doc);
  } else throw new Error("The response has no fields");
  const tables = preorder(root);
  for (const t of tables) {
    if (t.isArray && !t.fields.length && !t.children.length) t.simpleItems = true;
    if (t.simpleItems) {
      const used = new Set(t.fields.map((f) => f.name));
      let name = "@Value";
      for (let n = 0; used.has(name); n++) name = `@Value_val${n}`;
      t.valueField = { name, alias: name };
      t.fields.push(t.valueField);
    }
  }
  const tUsed = /* @__PURE__ */ new Set();
  for (const t of tables) tUsed.add(t.alias = uniqueIn(escapeName(t.name), tUsed));
  const fUsed = /* @__PURE__ */ new Set();
  for (const t of tables) for (const f of t.fields) fUsed.add(f.alias = uniqueIn(escapeName(f.name), fUsed));
  for (const t of tables) for (const c of t.children) c.parent = t;
  for (const t of tables) {
    const e = escapeName(t.name);
    if (t.parent) fUsed.add(t.fk = uniqueIn(`__FK_${e}`, fUsed));
    if (t.children.length) fUsed.add(t.pk = uniqueIn(`__KEY_${e}`, fUsed));
  }
  return { root, wrap, tables };
}
var q = (s) => `"${s.replace(/"/g, '""')}"`;
function selectStatement(meta) {
  const lines = [];
  const emit = (t, depth) => {
    const ind = "	".repeat(depth + 1);
    const items = [];
    for (const f of t.fields) items.push(`${ind}${q(f.name)}${f.alias !== f.name ? ` AS ${q(f.alias)}` : ""}`);
    if (t.fk) items.push(`${ind}${q(t.fk)}`);
    if (t.pk) items.push(`${ind}${q(t.pk)}`);
    const nested = t.children;
    return { items, nested, ind };
  };
  const write = (t, depth, prefix) => {
    const { items, nested, ind } = emit(t, depth);
    lines.push(`${prefix}SELECT `);
    const all = items.length + nested.length;
    let i = 0;
    for (const it of items) lines.push(`${it}${++i < all ? "," : ""}`);
    for (const c of nested) {
      write(c, depth + 1, `${ind}(`);
      lines[lines.length - 1] += `)${++i < all ? "," : ""}`;
    }
    const from = t === meta.root ? `FROM JSON (wrap ${meta.wrap ? "on" : "off"}) ` : "FROM ";
    let tail = `${"	".repeat(depth)}${from}${q(t.name)}`;
    if (t.pk) tail += ` PK ${q(t.pk)}`;
    if (t.fk) tail += ` FK ${q(t.fk)}`;
    if (t.valueField) tail += ` ArrayValueAlias ${q(t.valueField.alias)}`;
    lines.push(tail);
  };
  write(meta.root, 0, "SQL ");
  return lines.join("\n");
}
function groups(meta, flatten2) {
  const out = [];
  const visit = (t, g, path) => {
    const own = !g || !flatten2 || t.isArray;
    const group = own ? { owner: t, members: [{ t, path: [] }] } : g;
    if (own) out.push(group);
    else group.members.push({ t, path });
    for (const c of t.children) visit(c, group, own ? [c.name] : [...path, c.name]);
  };
  visit(meta.root, null, []);
  return out;
}
function outputNames(gs, naming) {
  const names = /* @__PURE__ */ new Map();
  for (const g of gs)
    for (const m of g.members)
      for (const f of m.t.fields) {
        if (naming === "connector") names.set(f, f.alias);
        else if (f === m.t.valueField) names.set(f, [...m.path, m.t.name].join(".") || m.t.name);
        else names.set(f, [...m.path, f.name].join("."));
      }
  if (naming === "path") {
    const order = [...gs.filter((g) => g.owner.isArray), ...gs.filter((g) => !g.owner.isArray)];
    const claimed = /* @__PURE__ */ new Map();
    for (const g of order)
      for (const m of g.members)
        for (const f of m.t.fields) {
          const n = names.get(f);
          const owner = claimed.get(n);
          if (!owner) claimed.set(n, g);
          else if (owner !== g) names.set(f, `${g.owner.alias}.${n}`);
        }
  }
  return names;
}
function withConnection(opts, url, extraQuery) {
  const parts = [`URL ${q(url)}`];
  for (const [k, v] of opts.query ?? []) parts.push(`QUERY ${q(k)} ${q(v)}`);
  for (const [k, v] of opts.headers ?? []) parts.push(`HTTPHEADER ${q(k)} ${q(v)}`);
  if (opts.body) parts.push(`BODY ${q(opts.body)}`);
  if (parts.length === 1 && !extraQuery) return `WITH CONNECTION (${parts[0]})`;
  return `WITH CONNECTION (
	${parts.join(",\n	")}${extraQuery}
)`;
}
function generateRest(sample, opts) {
  const warnings = [];
  const meta = restMetadata(sample);
  const flatten2 = opts.flatten !== false;
  const naming = opts.naming ?? "path";
  const pg = opts.pagination ?? { type: "none" };
  const byConnection = pg.type === "connector" || pg.type !== "none" && opts.pagingBy === "connector";
  const looping = pg.type !== "none" && !byConnection;
  const exclude = new Set(opts.exclude ?? []);
  const gs = groups(meta, flatten2);
  const names = outputNames(gs, naming);
  const other = outputNames(gs, naming === "path" ? "connector" : "path");
  const namingDifferences = gs.filter((g) => !exclude.has(g.owner.alias)).flatMap((g) => g.members.flatMap((m) => m.t.fields)).filter((f) => names.get(f) !== other.get(f)).length;
  const M = "RestConnectorMasterTable";
  const checklist = [
    `Data connection "${opts.connection}" is a REST connection with "Allow WITH CONNECTION" switched on.`,
    "Authentication, method, timeouts and pagination come from the connection; WITH CONNECTION can only change URL, QUERY, HTTPHEADER and BODY."
  ];
  if (opts.body) checklist.push("BODY is only sent when the connection method is POST.");
  checklist.push(
    'For brief outages, tick "Retry failed requests" and set "Retry codes" to 502, 503, 504 (Qlik Cloud only). Retries wait 10 s, then 20 s, and so on.',
    "A 429 (rate limited) is retried only when the API sends a Retry-After header of 60 seconds or less. 429 cannot be added to Retry codes: the field only accepts 5xx codes."
  );
  let connectionSettings;
  if (byConnection) {
    const c = connectionPaging(meta, pg, opts, warnings);
    connectionSettings = c.settings;
    checklist.push(...c.checklist);
    opts = { ...opts, query: (opts.query ?? []).filter(([k]) => !c.reserved.includes(k)) };
  }
  if (looping) checklist.push(`Leave the connection's pagination type as "None"; this script pages itself.`);
  const key = (k) => looping ? `'$(vPage)|' & ${ref(k)}` : ref(k);
  const keyAs = (k, as) => looping || k !== as ? `${key(k)} AS ${ref(as)}` : ref(k);
  const out = [];
  const conn = `LIB CONNECT TO ${str(opts.connection)};`;
  const select = selectStatement(meta);
  const loads = [];
  const finals = [];
  for (const g of gs) {
    if (exclude.has(g.owner.alias)) continue;
    const dataFields = g.members.flatMap((m) => m.t.fields);
    const linkKeys = g.members.filter((m) => m.t.pk && m.t.children.some((c) => gs.some((o3) => o3.owner === c && !exclude.has(c.alias)))).map((m) => m.t.pk);
    if (!dataFields.length && !linkKeys.length) continue;
    if (!dataFields.length && flatten2) continue;
    const final = g.owner.alias;
    const target = looping ? `__page_${final}` : final;
    finals.push(final);
    const ownerLines = [];
    for (const f of g.owner.fields) ownerLines.push(`${ref(f.alias)}${names.get(f) !== f.alias ? ` AS ${ref(names.get(f))}` : ""}`);
    const o2 = g.owner;
    const joinKeys = new Set(g.members.slice(1).map((m) => m.t.parent.pk));
    if (o2.pk && (linkKeys.includes(o2.pk) || joinKeys.has(o2.pk))) ownerLines.push(keyAs(o2.pk, o2.pk));
    if (o2.fk) ownerLines.push(keyAs(o2.fk, o2.parent.pk));
    loads.push(label(target), looping ? "NOCONCATENATE LOAD" : "LOAD");
    loads.push(...ownerLines.map((l, i) => `	${l}${i < ownerLines.length - 1 ? "," : ""}`));
    loads.push(`RESIDENT ${M}`, `WHERE NOT IsNull(${ref(o2.fk ?? o2.pk ?? o2.fields[0].alias)});`, "");
    const joins = [];
    for (const m of g.members.slice(1)) {
      const lines = m.t.fields.map((f) => `${ref(f.alias)}${names.get(f) !== f.alias ? ` AS ${ref(names.get(f))}` : ""}`);
      if (m.t.pk && (linkKeys.includes(m.t.pk) || g.members.some((x) => x.t.parent === m.t))) lines.push(keyAs(m.t.pk, m.t.pk));
      lines.unshift(keyAs(m.t.fk, m.t.parent.pk));
      joins.push(`LEFT JOIN (${ref(target)})`, "LOAD");
      joins.push(...lines.map((l, i) => `	${l}${i < lines.length - 1 ? "," : ""}`));
      joins.push(`RESIDENT ${M}`, `WHERE NOT IsNull(${ref(m.t.fk)});`, "");
    }
    const drop = [...joinKeys].filter((k) => !linkKeys.includes(k));
    if (drop.length) joins.push(`DROP FIELDS ${drop.map(ref).join(", ")} FROM ${ref(target)};`);
    if (looping && joins.length)
      loads.push(`IF NOT IsNull(TableNumber(${str(target)})) THEN`, ...joins.map((l) => l ? `	${l}` : l), "END IF");
    else loads.push(...joins);
    loads.push("");
  }
  if (!finals.length) warnings.push({ level: "error", message: "No tables to load: every table is excluded or empty." });
  if (!looping) {
    const note = connectionSettings?.length ? [`// Paged by the connection. Its Pagination section must be:`, ...connectionSettings.filter((c) => c.value).map((c) => `//   ${c.label}: ${c.value}`)] : byConnection ? ["// Paged by the connection: set its Pagination section to match this API."] : [];
    out.push(conn, "", ...note, `${M}:`, `${select}`, `${withConnection(opts, opts.url, "")};`, "", ...loads, `DROP TABLE ${M};`);
  } else {
    out.push(...pagingLoop(pg, opts, meta, conn, select, loads, finals, warnings));
  }
  return { script: out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n", warnings, meta, checklist, connectionSettings, namingDifferences };
}
function locate(meta, ref2) {
  for (const t of meta.tables)
    if (t.alias === ref2.table || t.name === ref2.table) {
      for (const f of t.fields) if (f !== t.valueField && (f.name === ref2.field || f.alias === ref2.field)) return { t, f };
    }
  return null;
}
function connectorPath(meta, ref2) {
  const hit = locate(meta, ref2);
  if (!hit) return null;
  const segs = [hit.f.name];
  for (let t = hit.t; t; t = t.parent) segs.unshift(t.name);
  return segs.join("/");
}
function dataIndicator(meta, table) {
  const t = meta.tables.find((x) => x.alias === table || x.name === table);
  if (!t) return null;
  const f = t.fields.find((x) => /^id$/i.test(x.name) && x !== t.valueField) ?? t.fields.find((x) => x !== t.valueField);
  return f ? { table: t.alias, field: f.name } : null;
}
function connectionPaging(meta, pg, opts, warnings) {
  const checklist = [
    `On connection "${opts.connection}", set the Pagination section as listed below. The connection then fetches every page for this one SELECT.`,
    "Every SELECT through this connection pages the same way. If other endpoints share it, give this API its own connection.",
    "Retries are counted per SELECT, so the few the service allows cover every page. A page that is still failing fails the whole SELECT, pages already fetched included."
  ];
  const settings = [];
  const reserved = [];
  const path = (r, what) => {
    const p = connectorPath(meta, r);
    if (!p) warnings.push({ level: "error", message: `${what} field ${r.table}.${r.field} not found in the sample.` });
    return p ?? `root/${r.field}`;
  };
  const reserve = (param) => {
    if (!param) return;
    reserved.push(param);
    if ((opts.query ?? []).some(([k]) => k === param))
      warnings.push({
        level: "warn",
        message: `QUERY "${param}" left out of WITH CONNECTION: the connection's pagination sets it, and the connector stops with an error when both do.`
      });
  };
  const stop = (type, p) => {
    const totalLabel = type === "offset" ? "'Total records' path" : "'Total pages' path";
    if (p.total) {
      settings.push({ label: totalLabel, value: path(p.total, "Total"), hint: type === "offset" ? "Stops once start + count reaches this number." : "Stops after this many pages." });
      settings.push({ label: "Data indicator path", value: "", hint: "Leave empty when a total path is set." });
    } else {
      const d = dataIndicator(meta, p.recordsTable);
      if (!d) warnings.push({ level: "error", message: `Records table "${p.recordsTable}" not found in the sample.` });
      settings.push({ label: totalLabel, value: "", hint: "Leave empty: paging stops at the first page with no records." });
      settings.push({
        label: "Data indicator path",
        value: d ? path(d, "Data indicator") : `root/${p.recordsTable}/id`,
        hint: "Any field every record has. Paging continues while a page returns it, so the last request returns an empty page."
      });
    }
  };
  switch (pg.type) {
    case "nexturl":
      settings.push({ label: "Pagination type", value: "Next URL" });
      settings.push({ label: "'Next url' path", value: path(pg, "Next URL"), hint: "The field does not need to be in the SELECT." });
      checklist.push(
        "The next link must be an absolute http(s) URL. Paging stops when it is empty or the same as the last one.",
        'WITH CONNECTION QUERY values go on the first request only. If the next links leave them out, tick "Add missing query parameters to final request" on the connection.'
      );
      break;
    case "token":
      reserve(pg.param);
      settings.push({ label: "Pagination type", value: "Next token" });
      settings.push({ label: "'Next token' parameter name", value: pg.param, hint: 'Sent as a query parameter; tick "Pass via header" to send it as a header instead.' });
      settings.push({ label: "'Next token' path", value: path(pg, "Token"), hint: "Paging stops when the token is empty." });
      break;
    case "offset":
      reserve(pg.offsetParam);
      reserve(pg.limitParam);
      settings.push({ label: "Pagination type", value: "Offset" });
      settings.push({ label: "'Start' parameter name", value: pg.offsetParam });
      settings.push({ label: "'Start' initial value", value: "0" });
      settings.push({ label: "'Count' parameter name", value: pg.limitParam });
      settings.push({ label: "'Count' initial value", value: String(pg.limit), hint: "The page size; start goes up by this each page." });
      stop("offset", pg);
      break;
    case "page":
      reserve(pg.pageParam);
      reserve(pg.sizeParam);
      settings.push({ label: "Pagination type", value: "Next page" });
      settings.push({ label: "'Next page' parameter name", value: pg.pageParam });
      settings.push({ label: "'Next page' initial value", value: String(pg.start) });
      settings.push({ label: "'Page size' parameter name", value: pg.sizeParam ?? "", hint: pg.sizeParam ? void 0 : "Leave empty if the API has a fixed page size." });
      settings.push({ label: "'Page size' value", value: pg.sizeParam ? String(pg.size) : "" });
      stop("page", pg);
      break;
    default:
      checklist.push("Choose the pagination style the API uses (Next URL, Next token, Offset or Next page) and set it on the connection.");
  }
  if (settings.length) checklist.push("There is no page limit: the connection keeps requesting until the API says there are no more pages.");
  return { settings, checklist, reserved };
}
function findField(meta, table, field2) {
  for (const t of meta.tables)
    if (t.alias === table || t.name === table) {
      for (const f of t.fields) if (f.name === field2 || f.alias === field2) return { alias: f.alias, where: t.fk ?? t.pk ?? f.alias };
    }
  return null;
}
function pagingLoop(pg, opts, meta, conn, select, loads, finals, warnings) {
  const M = "RestConnectorMasterTable";
  const max = opts.maxPages && opts.maxPages > 0 ? Math.floor(opts.maxPages) : 0;
  const out = [conn, "", `LET vPage = 0;`, ...max ? [`LET vMaxPages = ${max};`] : []];
  let url = opts.url;
  let extra = "";
  let after = [];
  let until = "";
  const cleanup = ["vPage", ...max ? ["vMaxPages"] : []];
  const recordsTable = "recordsTable" in pg ? pg.recordsTable : "";
  const recordsName = `__page_${recordsTable}`;
  switch (pg.type) {
    case "nexturl": {
      const f = findField(meta, pg.table, pg.field);
      if (!f) warnings.push({ level: "error", message: `Next URL field ${pg.table}.${pg.field} not found in the sample.` });
      const qs = (opts.query ?? []).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
      out.push(`LET vNextUrl = ${str(qs ? `${opts.url}${opts.url.includes("?") ? "&" : "?"}${qs}` : opts.url)};`);
      cleanup.push("vNextUrl", "vLastUrl");
      url = "$(vNextUrl)";
      opts = { ...opts, query: [] };
      after = [
        `__next:`,
        `NOCONCATENATE LOAD ${ref(f?.alias ?? pg.field)} AS __next RESIDENT ${M} WHERE NOT IsNull(${ref(f?.where ?? pg.field)});`,
        `LET vLastUrl = vNextUrl;`,
        `LET vNextUrl = Peek('__next', 0, '__next');`,
        `IF NOT IsNull(TableNumber('__next')) THEN`,
        `	DROP TABLE __next;`,
        `END IF`
      ];
      until = `Len('$(vNextUrl)') > 0 AND '$(vNextUrl)' <> '$(vLastUrl)'`;
      break;
    }
    case "token": {
      const f = findField(meta, pg.table, pg.field);
      if (!f) warnings.push({ level: "error", message: `Token field ${pg.table}.${pg.field} not found in the sample.` });
      out.push(`LET vToken = '';`, `LET vTokenQuery = '';`);
      cleanup.push("vToken", "vTokenQuery", "vLastToken");
      extra = "$(vTokenQuery)";
      after = [
        `__next:`,
        `NOCONCATENATE LOAD ${ref(f?.alias ?? pg.field)} AS __next RESIDENT ${M} WHERE NOT IsNull(${ref(f?.where ?? pg.field)});`,
        `LET vLastToken = vToken;`,
        `LET vToken = Peek('__next', 0, '__next');`,
        `LET vTokenQuery = ', QUERY "${pg.param}" "' & vToken & '"';`,
        `IF NOT IsNull(TableNumber('__next')) THEN`,
        `	DROP TABLE __next;`,
        `END IF`
      ];
      until = `Len('$(vToken)') > 0 AND '$(vToken)' <> '$(vLastToken)'`;
      break;
    }
    case "offset":
      out.push(`LET vOffset = 0;`, `LET vLimit = ${pg.limit};`);
      cleanup.push("vOffset", "vLimit", "vRows");
      extra = `,
	QUERY ${q(pg.offsetParam)} "$(vOffset)",
	QUERY ${q(pg.limitParam)} "$(vLimit)"`;
      after = [`LET vRows = Alt(NoOfRows('${recordsName}'), 0);`, `LET vOffset = vOffset + vLimit;`];
      until = `vRows >= vLimit`;
      break;
    case "page":
      out.push(`LET vPageNo = ${pg.start};`, `LET vPageSize = ${pg.size};`);
      cleanup.push("vPageNo", "vPageSize", "vRows");
      extra = `,
	QUERY ${q(pg.pageParam)} "$(vPageNo)"${pg.sizeParam ? `,
	QUERY ${q(pg.sizeParam)} "$(vPageSize)"` : ""}`;
      after = [`LET vRows = Alt(NoOfRows('${recordsName}'), 0);`, `LET vPageNo = vPageNo + 1;`];
      until = `vRows >= vPageSize`;
      break;
  }
  if ((pg.type === "offset" || pg.type === "page") && !finals.includes(recordsTable))
    warnings.push({ level: "error", message: `Records table "${recordsTable}" is not one of the loaded tables (${finals.join(", ")}).` });
  const indent = (ls) => ls.map((l) => l ? `	${l}` : l);
  out.push("", "DO", `	LET vPage = vPage + 1;`, `	TRACE Fetching page $(vPage);`, "");
  out.push(...indent([`${M}:`, ...select.split("\n"), ...`${withConnection(opts, url, extra)};`.split("\n"), ""]));
  out.push(...indent(loads));
  out.push(...indent(after), "");
  for (const f of finals) {
    const page = `__page_${f}`;
    out.push(
      ...indent([
        `IF NOT IsNull(TableNumber(${str(page)})) THEN`,
        `	IF IsNull(TableNumber(${str(f)})) THEN`,
        `		${label(f)}`,
        `		NOCONCATENATE LOAD * RESIDENT ${ref(page)};`,
        `	ELSE`,
        `		CONCATENATE (${ref(f)}) LOAD * RESIDENT ${ref(page)};`,
        `	END IF`,
        `	DROP TABLE ${ref(page)};`,
        `END IF`
      ])
    );
  }
  out.push(...indent([`DROP TABLE ${M};`]));
  out.push(`LOOP WHILE ${until}${max ? " AND vPage < vMaxPages" : ""};`, "");
  out.push(...cleanup.map((v) => `SET ${v} = ;`));
  return out;
}

// src/cli.ts
var [cmd, ...rest] = process.argv.slice(2);
var { values: o, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    table: { type: "string" },
    format: { type: "string" },
    mapping: { type: "boolean" },
    null: { type: "boolean" },
    verbatim: { type: "boolean" },
    source: { type: "string" },
    path: { type: "string" },
    field: { type: "string" },
    key: { type: "string" },
    method: { type: "string" },
    sample: { type: "boolean" },
    mode: { type: "string" },
    root: { type: "string" },
    matrix: { type: "string" },
    "max-depth": { type: "string" },
    exclude: { type: "string", multiple: true },
    connection: { type: "string" },
    url: { type: "string" },
    query: { type: "string", multiple: true },
    header: { type: "string", multiple: true },
    body: { type: "string" },
    "no-flatten": { type: "boolean" },
    naming: { type: "string" },
    paging: { type: "string" },
    "paging-by": { type: "string" },
    total: { type: "string" },
    next: { type: "string" },
    "token-param": { type: "string" },
    "offset-param": { type: "string" },
    "limit-param": { type: "string" },
    limit: { type: "string" },
    "page-param": { type: "string" },
    "size-param": { type: "string" },
    start: { type: "string" },
    records: { type: "string" },
    "max-pages": { type: "string" }
  }
});
var input = () => readFileSync(positionals[0] && positionals[0] !== "-" ? positionals[0] : 0, "utf8");
var num = (s, d) => s && Number.isFinite(Number(s)) ? Number(s) : d;
var report = (warnings, checklist = [], settings = []) => {
  for (const w of warnings) process.stderr.write(`// ${w.level.toUpperCase()}: ${w.message}
`);
  for (const c of checklist) process.stderr.write(`// CHECK: ${c}
`);
  for (const s of settings) process.stderr.write(`// CONNECTION: ${s.label} = ${s.value || "(empty)"}${s.hint ? `  (${s.hint})` : ""}
`);
};
function json(text, perRow) {
  const r = tryParseJson(text.trim());
  if (r.ok) return perRow && Array.isArray(r.value) && r.value.length ? r.value : [r.value];
  const nd = parseNdjson(text);
  if (nd) return perRow ? nd : [nd];
  throw new Error(`Invalid JSON: ${r.error}`);
}
try {
  switch (cmd) {
    case "inline": {
      const { table } = parseTabular(input(), o.format && o.format !== "auto" ? { format: o.format } : {});
      const r = generateInline(table, { tableName: o.table, mapping: o.mapping, emptyAsNull: o.null, preserveWhitespace: o.verbatim });
      process.stdout.write(r.script);
      report(r.warnings);
      break;
    }
    case "engine": {
      const kind = o.source ?? (o.path ? "file" : o.field ? "field" : "inline");
      const source = kind === "file" ? { kind: "file", path: o.path ?? "lib://DataFiles/data.json" } : kind === "field" ? {
        kind: "field",
        table: o.table ?? "Source",
        field: o.field ?? "json",
        keyField: o.key,
        method: o.method ?? "reader",
        sampleTable: o.sample
      } : { kind: "inline" };
      const r = generateEngine(json(input(), kind === "field"), {
        source,
        mode: o.mode ?? "explicit",
        rootName: o.root,
        matrix: o.matrix ?? "native",
        maxDepth: o["max-depth"] ? num(o["max-depth"], 99) : void 0,
        exclude: o.exclude
      });
      process.stdout.write(r.script);
      report(r.warnings);
      break;
    }
    case "rest": {
      const fieldRef = (p) => {
        const segs = p.split(".");
        return { table: segs.length > 1 ? segs[segs.length - 2] : "root", field: segs[segs.length - 1] };
      };
      const { table, field: nextField } = fieldRef(o.next ?? "next.href");
      const f = [nextField];
      const total = o.total ? fieldRef(o.total) : void 0;
      let type = o.paging ?? "none";
      let pagingBy = o["paging-by"] ?? "script";
      if (type === "connector") [type, pagingBy] = ["nexturl", "connector"];
      const pagination = type === "nexturl" ? { type, table, field: f.join(".") } : type === "token" ? { type, table, field: f.join("."), param: o["token-param"] ?? "pageToken" } : type === "offset" ? { type, offsetParam: o["offset-param"] ?? "offset", limitParam: o["limit-param"] ?? "limit", limit: num(o.limit, 100), recordsTable: o.records ?? "data", total } : type === "page" ? { type, pageParam: o["page-param"] ?? "page", sizeParam: o["size-param"], size: num(o.limit, 100), start: num(o.start, 1), recordsTable: o.records ?? "data", total } : { type: "none" };
      const split = (s, sep) => {
        const i = s.indexOf(sep);
        return i < 0 ? [s.trim(), ""] : [s.slice(0, i).trim(), s.slice(i + 1).trim()];
      };
      const r = generateRest(json(input(), false)[0], {
        connection: o.connection ?? "REST connection",
        url: o.url ?? "https://api.example.com/items",
        query: (o.query ?? []).map((q2) => split(q2, "=")),
        headers: (o.header ?? []).map((q2) => split(q2, ":")),
        body: o.body,
        flatten: !o["no-flatten"],
        naming: o.naming ?? "path",
        exclude: o.exclude,
        pagination,
        pagingBy,
        maxPages: o["max-pages"] ? num(o["max-pages"], 0) : void 0
      });
      process.stdout.write(r.script);
      report(r.warnings, r.checklist, r.connectionSettings);
      break;
    }
    case "inspect": {
      const doc = json(input(), false)[0];
      process.stdout.write("// Engine (json) tables\n");
      for (const t of engineTables(shapeOf(doc)))
        process.stdout.write(`//   ${tableLabel(t, o.root ?? "Data")}  table is '${t.pointer}'  [${t.kind}]  ${t.fields.map((x) => x.name).join(", ")}
`);
      const m = restMetadata(doc);
      process.stdout.write(`// REST connector tables (root "${m.root.name}", wrap ${m.wrap ? "on" : "off"})
`);
      for (const t of m.tables)
        process.stdout.write(
          `//   ${t.alias}${t.isArray ? "[]" : "{}"}  ${t.fields.map((x) => x.alias === x.name ? x.name : `${x.name} AS ${x.alias}`).join(", ")}${t.pk ? `  PK ${t.pk}` : ""}${t.fk ? `  FK ${t.fk}` : ""}
`
        );
      break;
    }
    default:
      process.stderr.write("Usage: qlik-gen <inline|engine|rest|inspect> [file|-] [options]. See the header of src/cli.ts or SKILL.md.\n");
      process.exit(2);
  }
} catch (e) {
  process.stderr.write(`Error: ${e.message}
`);
  process.exit(1);
}
