import { generateRest, restMetadata, type Pagination, type RestMeta, type RestOptions } from '../../core/json/rest';
import { tryParseJson } from '../../core/parse/json';
import { check, exampleBar as examplePicker, field, group, h, icon, replace, sectionHead, select } from '../dom';
import type { OutputPanel } from '../output';

type PagingType = Exclude<Pagination['type'], 'connector'>;
type PagingBy = 'script' | 'connector';

export interface RestState {
  text: string;
  connection: string;
  url: string;
  query: string;
  headers: string;
  body: string;
  flatten: boolean;
  naming: 'path' | 'connector';
  exclude: string[];
  paging: PagingType;
  /** Who fetches the pages: a loop in the script, or the connection's own pagination. */
  pagingBy: PagingBy;
  nextField: string;
  /** connector.field holding the total (records or pages); empty: stop at an empty page. */
  totalField: string;
  tokenParam: string;
  offsetParam: string;
  limitParam: string;
  limit: string;
  pageParam: string;
  sizeParam: string;
  start: string;
  recordsTable: string;
  maxPages: string;
}

export const restDefaults: RestState = {
  text: '',
  connection: 'MySpace:REST connection',
  url: 'https://api.example.com/v1/items',
  query: '',
  headers: '',
  body: '',
  flatten: true,
  naming: 'path',
  exclude: [],
  paging: 'none',
  pagingBy: 'script',
  nextField: '',
  totalField: '',
  tokenParam: 'pageToken',
  offsetParam: 'offset',
  limitParam: 'limit',
  limit: '100',
  pageParam: 'page',
  sizeParam: 'pageSize',
  start: '1',
  recordsTable: '',
  maxPages: '',
};

const pairs = (text: string, sep: RegExp): [string, string][] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(sep);
      return m ? [l.slice(0, m.index).trim(), l.slice(m.index! + m[0].length).trim()] : [l, ''];
    });

/** Fields outside the record arrays that could hold a total, best guess first. */
function totalCandidates(meta: RestMeta): string[] {
  const all = meta.tables.filter((t) => !t.isArray).flatMap((t) => t.fields.map((f) => `${t.alias}.${f.name}`));
  const score = (s: string) => (/total/i.test(s) ? 0 : /count|pages/i.test(s) ? 1 : 9);
  return [...all].sort((a, b) => score(a) - score(b));
}

const BY_HINT: Record<PagingBy, string> = {
  script:
    'A loop in the script requests each page. Works with one shared connection whose pagination stays at None, and keeps keys unique across pages.',
  connector:
    'One SELECT; the connection’s own pagination fetches every page. A simpler script, but the setting lives on the connection, so every endpoint that uses it must page the same way.',
};

/** Fields that look like a next link / cursor, best guess first. */
function nextCandidates(meta: RestMeta): string[] {
  const all = meta.tables.flatMap((t) => t.fields.filter((f) => f !== t.valueField).map((f) => `${t.alias}.${f.name}`));
  const score = (s: string) => (/^next\.href$/i.test(s) ? 0 : /next/i.test(s) ? 1 : /cursor|token|continuation/i.test(s) ? 2 : 9);
  return [...all].sort((a, b) => score(a) - score(b));
}

export function restTab(state: RestState, out: OutputPanel, changed: () => void, examples: Record<string, string>, rebuild: () => void) {
  // Older saved state and share links used a 'connector' paging type.
  if ((state.paging as string) === 'connector') Object.assign(state, { paging: 'nexturl', pagingBy: 'connector' });
  state.pagingBy ??= 'script';
  state.totalField ??= '';
  // 1000 was the old default page cap; the cap is now optional and off by default.
  if (state.maxPages === '1000') state.maxPages = '';
  const textarea = h('textarea.input', {
    spellcheck: false,
    placeholder: 'Paste a sample response from the API (one page is enough)…',
    oninput: () => ((state.text = textarea.value), (state.exclude = []), (state.nextField = ''), (state.recordsTable = ''), (state.totalField = ''), update()),
  });
  textarea.value = state.text;
  const set = <K extends keyof RestState>(k: K) => (v: RestState[K]) => ((state[k] = v), update());
  type TextKey = Exclude<{ [K in keyof RestState]: RestState[K] extends string ? K : never }[keyof RestState], 'paging' | 'naming'>;
  const text = (k: TextKey, placeholder = '') => {
    const i = h('input', { value: state[k], placeholder, oninput: () => set(k)(i.value as never) });
    return i;
  };
  const area = (k: 'query' | 'headers' | 'body', placeholder: string) => {
    const i = h('textarea.small', { value: state[k], placeholder, spellcheck: false, oninput: () => set(k)(i.value) });
    return i;
  };
  const flatten = h('input', { checked: state.flatten, onchange: () => set('flatten')(flatten.checked) });
  const paging = h('div.paging', {});
  const byHost = h('div.paging-by', {});
  const tables = h('div.tree', {});
  const badge = h('span.badge', {});
  const namingNote = h('p.hint', {});

  function renderPaging(meta: RestMeta | null) {
    const tableOpts: [string, string][] = (meta?.tables ?? []).filter((t) => t.isArray).map((t) => [t.alias, t.alias]);
    if (!state.recordsTable && tableOpts.length) state.recordsTable = tableOpts.find(([a]) => a === 'data')?.[0] ?? tableOpts[0][0];
    const records = field('Records table', select(tableOpts.length ? tableOpts : [['', '—']], state.recordsTable, set('recordsTable')), 'Stop when it returns fewer rows than a full page.');
    const cands = meta ? nextCandidates(meta) : [];
    if (!state.nextField && cands.length) state.nextField = cands[0];
    const nextSel = field('Field holding the next link / token', select(cands.length ? cands.map((c) => [c, c] as [string, string]) : [['', '—']], state.nextField, set('nextField')));
    const totals = meta ? totalCandidates(meta) : [];
    const totalSel = field(
      state.paging === 'page' ? 'Total pages field' : 'Total records field',
      select<string>([['', 'None: stop at an empty page'], ...totals.map((c) => [c, c] as [string, string])], state.totalField, set('totalField')),
    );
    const max = field('Max requests', text('maxPages', 'No limit'), 'Optional safety stop.');
    const conn = state.pagingBy === 'connector';
    const rows: Record<PagingType, (HTMLElement | null)[]> = {
      none: [h('p.hint.note', {}, 'One request. Remember most APIs return only the first page (often 100 items).')],
      nexturl: [nextSel, conn ? null : max],
      token: [nextSel, field(conn ? "'Next token' parameter name" : 'Send token as query parameter', text('tokenParam')), conn ? null : max],
      offset: [
        field('Offset parameter', text('offsetParam')),
        field('Limit parameter', text('limitParam')),
        field('Page size', text('limit')),
        conn ? field('Records table', select(tableOpts.length ? tableOpts : [['', '—']], state.recordsTable, set('recordsTable')), 'Its first field (or id) tells the connection a page had data.') : records,
        conn ? totalSel : max,
      ],
      page: [
        field('Page parameter', text('pageParam')),
        field('Page size parameter', text('sizeParam', 'optional')),
        field('Page size', text('limit')),
        field('First page', text('start')),
        conn ? field('Records table', select(tableOpts.length ? tableOpts : [['', '—']], state.recordsTable, set('recordsTable')), 'Its first field (or id) tells the connection a page had data.') : records,
        conn ? totalSel : max,
      ],
    };
    if (state.paging === 'none') replace(byHost);
    else
      replace(
        byHost,
        h(
          'div.segmented',
          { role: 'radiogroup', 'aria-label': 'Pages fetched by' },
          h('span.segmented-label', {}, 'Pages fetched by'),
          ...(
            [
              ['script', 'Script loop'],
              ['connector', 'The connection'],
            ] as [PagingBy, string][]
          ).map(([v, l]) =>
            h(
              'button.seg',
              { type: 'button', role: 'radio', 'aria-checked': String(state.pagingBy === v), onclick: () => ((state.pagingBy = v), update()) },
              l,
            ),
          ),
        ),
        h('p.hint', {}, BY_HINT[state.pagingBy]),
      );
    replace(paging, h('div.row', {}, rows[state.paging]));
  }

  function renderTables(meta: RestMeta) {
    const items = meta.tables
      .filter((t) => t.isArray || t === meta.root || !state.flatten)
      .map((t) => {
        const depth = (() => {
          let d = 0;
          for (let p = t.parent; p; p = p.parent) d++;
          return d;
        })();
        const cbx = h('input', {
          type: 'checkbox',
          checked: !state.exclude.includes(t.alias),
          onchange: () => ((state.exclude = cbx.checked ? state.exclude.filter((a) => a !== t.alias) : [...state.exclude, t.alias]), update()),
        });
        const merged = state.flatten ? meta.tables.filter((c) => !c.isArray && c.parent && ownerOf(c) === t).map((c) => c.alias) : [];
        return h(
          'li',
          { style: `--depth:${depth}` },
          h(
            'label',
            {},
            cbx,
            icon('table', 'tree-icon'),
            h('strong', {}, t.alias),
            merged.length ? h('span.dim', {}, `+ merged ${merged.join(', ')}`) : null,
            h('span.pill', {}, `${t.fields.length} field${t.fields.length === 1 ? '' : 's'}`),
          ),
        );
      });
    replace(tables, sectionHead('Tables', `${items.length} to load · untick to skip`), h('ul', {}, items));
  }
  const ownerOf = (t: RestMeta['tables'][number]) => {
    let p = t.parent;
    while (p && !p.isArray && p.parent) p = p.parent;
    return p;
  };

  const options = h(
    'div.options',
    {},
    group(
      '2. Request the script makes',
      h('p.hint.group-intro', {}, 'Written into LIB CONNECT and WITH CONNECTION, and run when the app reloads in Qlik. Nothing is called from this page.'),
      h('div.row', {}, field('Data connection', text('connection'), 'Space:Name, or Name in your personal space'), field('URL', text('url'))),
      h(
        'div.row',
        {},
        field('Query parameters', area('query', 'limit=100\nstatus=active')),
        field('HTTP headers', area('headers', 'Authorization: Bearer $(vToken)\nAccept: application/json')),
        field('POST body', area('body', 'Only sent when the connection method is POST')),
      ),
    ),
    group(
      'Script',
      h(
        'div.row',
        {},
        field(
          'Field names in the app',
          select<RestState['naming']>(
            [
              ['path', 'JSON paths (links.self.href, assignedGroups.id)'],
              ['connector', 'Connector names (href_u0, id_u0)'],
            ],
            state.naming,
            set('naming'),
          ),
        ),
      ),
      namingNote,
      h('div.checks', {}, check('Merge nested objects into their parent table', flatten, 'Avoids one single-row table per nested object')),
    ),
    group(
      'Pagination',
      h(
        'div.row',
        {},
        field(
          'Style',
          select<PagingType>(
            [
              ['none', 'None (single request)'],
              ['nexturl', 'Next URL in the response'],
              ['token', 'Next token / cursor'],
              ['offset', 'Offset + limit'],
              ['page', 'Page number'],
            ],
            state.paging,
            set('paging'),
          ),
        ),
      ),
      byHost,
      paging,
    ),
    tables,
  );

  const exampleBar = examplePicker(examples, (name, t) => {
    state.text = t;
    state.exclude = [];
    state.nextField = '';
    state.recordsTable = '';
    state.totalField = '';
    if (name.includes('Qlik')) {
      state.url = 'https://your-tenant.eu.qlikcloud.com/api/v1/users';
      state.query = 'limit=100';
      state.paging = 'nexturl';
      state.connection = 'monitoring_apps_REST';
    }
    rebuild();
  });

  function update() {
    changed();
    if (!state.text.trim()) {
      replace(tables);
      renderPaging(null);
      badge.textContent = '';
      out.set('', []);
      return;
    }
    const parsed = tryParseJson(state.text.trim());
    if (!parsed.ok) {
      replace(tables);
      renderPaging(null);
      out.set('', [], { error: `Invalid JSON: ${parsed.error}` });
      return;
    }
    try {
      const meta = restMetadata(parsed.value);
      renderPaging(meta);
      renderTables(meta);
      badge.textContent = `${meta.tables.length} connector tables · root "${meta.root.name}" (wrap ${meta.wrap ? 'on' : 'off'})`;
      const [nt, ...nf] = state.nextField.split('.');
      const [tt, ...tf] = state.totalField.split('.');
      const total = state.totalField ? { table: tt, field: tf.join('.') } : undefined;
      const n = (s: string, d: number) => (Number.isFinite(parseInt(s, 10)) ? parseInt(s, 10) : d);
      const pagination: Pagination =
        state.paging === 'nexturl'
          ? { type: 'nexturl', table: nt, field: nf.join('.') }
          : state.paging === 'token'
            ? { type: 'token', table: nt, field: nf.join('.'), param: state.tokenParam }
            : state.paging === 'offset'
              ? { type: 'offset', offsetParam: state.offsetParam, limitParam: state.limitParam, limit: n(state.limit, 100), recordsTable: state.recordsTable, total }
              : state.paging === 'page'
                ? { type: 'page', pageParam: state.pageParam, sizeParam: state.sizeParam || undefined, size: n(state.limit, 100), start: n(state.start, 1), recordsTable: state.recordsTable, total }
                : { type: 'none' };
      const opts: RestOptions = {
        connection: state.connection,
        url: state.url,
        query: pairs(state.query, /=/),
        headers: pairs(state.headers, /:/),
        body: state.body || undefined,
        flatten: state.flatten,
        naming: state.naming,
        exclude: state.exclude,
        pagination,
        pagingBy: state.pagingBy,
        maxPages: n(state.maxPages, 0) || undefined,
      };
      const r = generateRest(parsed.value, opts);
      namingNote.textContent =
        'Renames fields in the LOAD statements after the SELECT; the SELECT always uses the connector’s names. ' +
        (r.namingDifferences
          ? `${r.namingDifferences} field${r.namingDifferences === 1 ? '' : 's'} in this sample ${r.namingDifferences === 1 ? 'differs' : 'differ'} between the two.`
          : 'This sample has no nested or repeated names, so both give the same script.');
      out.set(r.script, r.warnings, { filename: 'rest-load.qvs', checklist: r.checklist, settings: r.connectionSettings });
    } catch (e) {
      replace(tables);
      out.set('', [], { error: (e as Error).message });
    }
  }

  textarea.setAttribute('aria-label', 'Sample API response');
  const el = h(
    'div.panel',
    {},
    h('div.input-head', {}, h('h2', {}, '1. Sample response'), badge),
    h(
      'p.hint.input-intro',
      {},
      'One page of what the API returns, copied from a browser, curl or the API docs. It decides the tables and field names. The page can’t call the API itself (no server, no credentials), so the request goes in section 2.',
    ),
    textarea,
    exampleBar,
    options,
  );
  return { el, update };
}
