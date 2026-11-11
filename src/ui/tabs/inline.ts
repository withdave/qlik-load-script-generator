import { parseTabular } from '../../core/detect';
import { generateInline, looksLikeCode, type ColumnOptions, type Delimiter, type Enclosure } from '../../core/inline/generate';
import type { InputFormat, Table } from '../../core/model';
import { check, exampleBar as examplePicker, field, group, h, replace, sectionHead, select } from '../dom';
import type { OutputPanel } from '../output';

export interface InlineState {
  text: string;
  format: InputFormat | 'auto';
  inDelimiter: string;
  header: boolean;
  tableName: string;
  mapping: boolean;
  emptyAsNull: boolean;
  preserveWhitespace: boolean;
  delimiter: Delimiter | 'auto';
  enclosure: Enclosure | 'auto';
  columns: ColumnOptions[];
}

export const inlineDefaults: InlineState = {
  text: '',
  format: 'auto',
  inDelimiter: 'auto',
  header: true,
  tableName: 'MyTable',
  mapping: false,
  emptyAsNull: false,
  preserveWhitespace: false,
  delimiter: 'auto',
  enclosure: 'auto',
  columns: [],
};

const FORMAT_LABEL: Record<InputFormat, string> = {
  delimited: 'Delimited text',
  markdown: 'Markdown table',
  html: 'HTML table',
  json: 'JSON',
  ndjson: 'NDJSON',
};

export function inlineTab(state: InlineState, out: OutputPanel, changed: () => void, examples: Record<string, string>) {
  const textarea = h('textarea.input', {
    spellcheck: false,
    placeholder: 'Paste CSV, TSV (Excel / Google Sheets), a Markdown or HTML table, or a JSON array…',
    oninput: () => {
      state.text = textarea.value;
      state.columns = [];
      update();
    },
    onpaste: (e: Event) => {
      // Spreadsheets put a TSV on text/plain; web pages and Confluence often only have a usable HTML table.
      const cd = (e as ClipboardEvent).clipboardData;
      const html = cd?.getData('text/html') ?? '';
      const plain = cd?.getData('text/plain') ?? '';
      if (/<table[\s>]/i.test(html) && !/[\t,;|]/.test(plain)) {
        e.preventDefault();
        textarea.value = html;
        state.text = html;
        state.columns = [];
        update();
      }
    },
  });
  textarea.value = state.text;

  const detected = h('span.badge', {});
  const grid = h('div.grid-wrap', {});
  const bind = <K extends keyof InlineState>(k: K, resetColumns = false) => (v: InlineState[K]) => {
    state[k] = v;
    if (resetColumns) state.columns = [];
    update();
  };
  const cb = (k: 'header' | 'mapping' | 'emptyAsNull' | 'preserveWhitespace', reset = false) => {
    const i = h('input', { checked: state[k], onchange: () => bind(k, reset)(i.checked) });
    return i;
  };
  const tableName = h('input', { value: state.tableName, oninput: () => bind('tableName')(tableName.value) });

  const options = h(
    'div.options',
    {},
    group(
      'Input',
      h(
        'div.row',
        {},
        field(
          'Input format',
          select<InlineState['format']>(
            [['auto', 'Auto-detect'], ['delimited', 'Delimited text'], ['markdown', 'Markdown table'], ['html', 'HTML table'], ['json', 'JSON'], ['ndjson', 'NDJSON']],
            state.format,
            bind('format', true),
          ),
        ),
        field(
          'Input delimiter',
          select([['auto', 'Auto'], [',', 'Comma'], ['\t', 'Tab'], [';', 'Semicolon'], ['|', 'Pipe']], state.inDelimiter, bind('inDelimiter', true)),
        ),
      ),
      h('div.checks', {}, check('First row is the header', cb('header', true))),
    ),
    group(
      'Script',
      h('div.row', {}, field('Table name', tableName)),
      h(
        'div.checks',
        {},
        check('MAPPING LOAD', cb('mapping'), 'Two columns: lookup value, result'),
        check('Empty cells → null', cb('emptyAsNull')),
        check('Keep leading/trailing spaces', cb('preserveWhitespace'), 'Adds SET Verbatim = 1'),
      ),
    ),
    h(
      'details.advanced',
      {},
      h('summary', {}, 'Output format'),
      h(
        'div.row',
        {},
        field(
          'Delimiter in script',
          select([['auto', 'Auto (avoid clashes)'], [',', 'Comma'], ['\t', 'Tab'], [';', 'Semicolon'], ['|', 'Pipe']], state.delimiter, bind('delimiter')),
        ),
        field(
          'Enclosure',
          select([['auto', 'Auto (avoid clashes)'], ['[', '[ … ]'], ['`', '` … `'], ['"', '" … "'], ["'", "' … '"]], state.enclosure, bind('enclosure')),
        ),
      ),
    ),
  );

  const exampleBar = examplePicker(examples, (_, text) => ((textarea.value = state.text = text), (state.columns = []), update()));

  function renderGrid(table: Table) {
    const rows = table.rows.slice(0, 50);
    const head = table.columns.map((c, i) => {
      const opt = (state.columns[i] ??= {});
      const inc = h('input', {
        type: 'checkbox',
        checked: opt.include !== false,
        title: 'Include column',
        'aria-label': `Include column ${i + 1}`,
        onchange: () => ((opt.include = inc.checked), update()),
      });
      const nm = h('input.colname', {
        value: opt.name ?? c,
        'aria-label': `Name for column ${i + 1}`,
        onchange: () => ((opt.name = nm.value === c ? undefined : nm.value), update()),
      });
      const auto = looksLikeCode(table.rows.map((r) => r[i]));
      const txt = h('input', {
        type: 'checkbox',
        checked: opt.asText ?? auto,
        onchange: () => ((opt.asText = txt.checked), update()),
      });
      return h('th', { class: opt.include === false ? 'off' : '' }, h('div.colhead', {}, inc, nm), h('label.text-toggle', { title: 'Keep as text (preserves leading zeros)' }, txt, 'Text()'));
    });
    replace(
      grid,
      sectionHead('Preview', 'Rename, drop or keep columns as text'),
      h(
        'div.grid-scroll',
        {},
        h(
          'table.grid',
          {},
          h('thead', {}, h('tr', {}, head)),
          h(
            'tbody',
            {},
            rows.map((r) => h('tr', {}, r.map((v, i) => h('td', { class: state.columns[i]?.include === false ? 'off' : '' }, v === null ? h('span.null', {}, 'null') : v.replace(/\n/g, '↵'))))),
          ),
        ),
      ),
      table.rows.length > rows.length ? h('p.hint', {}, `Showing 50 of ${table.rows.length} rows.`) : null,
    );
  }

  function update() {
    changed();
    if (!state.text.trim()) {
      replace(grid);
      detected.textContent = '';
      out.set('', []);
      return;
    }
    try {
      const { table, detected: d } = parseTabular(state.text, {
        format: state.format === 'auto' ? undefined : state.format,
        delimiter: state.inDelimiter === 'auto' ? undefined : state.inDelimiter,
        header: state.header,
      });
      detected.textContent = `${FORMAT_LABEL[d.format]}${d.delimiter ? ` · ${d.delimiter === '\t' ? 'tab' : `"${d.delimiter}"`}` : ''} · ${table.columns.length} columns × ${table.rows.length} rows`;
      const r = generateInline(table, {
        tableName: state.tableName,
        columns: table.columns.map((_, i) => state.columns[i] ?? {}),
        mapping: state.mapping,
        emptyAsNull: state.emptyAsNull,
        preserveWhitespace: state.preserveWhitespace,
        delimiter: state.delimiter,
        enclosure: state.enclosure,
      });
      renderGrid(table);
      out.set(r.script, r.warnings, { filename: `${state.tableName || 'inline'}.qvs` });
    } catch (e) {
      replace(grid);
      detected.textContent = '';
      out.set('', [], { error: (e as Error).message });
    }
  }

  textarea.setAttribute('aria-label', 'Data to convert');
  const el = h('div.panel', {}, h('div.input-head', {}, h('h2', {}, 'Paste data'), detected), textarea, exampleBar, options, grid);
  return { el, update };
}
