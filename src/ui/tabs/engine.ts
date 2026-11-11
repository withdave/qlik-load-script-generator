import { generateEngine, type EngineOptions } from '../../core/json/engine';
import { tableLabel, type EngineTable } from '../../core/json/tables';
import { parseNdjson, tryParseJson, type Json } from '../../core/parse/json';
import { check, exampleBar as examplePicker, field, group, h, icon, replace, sectionHead, select } from '../dom';
import type { OutputPanel } from '../output';

export interface EngineState {
  text: string;
  source: 'file' | 'inline' | 'field';
  path: string;
  table: string;
  field: string;
  keyField: string;
  method: 'reader' | 'jsonget' | 'fromfield';
  sampleTable: boolean;
  mode: 'star' | 'explicit' | 'alltables';
  rootName: string;
  maxDepth: string;
  matrix: 'native' | 'jsonget';
  fieldDelimiter: string;
  exclude: string[];
}

export const engineDefaults: EngineState = {
  text: '',
  source: 'file',
  path: 'lib://DataFiles/data.json',
  table: 'Orders',
  field: 'payload',
  keyField: 'id',
  method: 'reader',
  sampleTable: true,
  mode: 'explicit',
  rootName: 'Data',
  maxDepth: '',
  matrix: 'native',
  fieldDelimiter: '.',
  exclude: [],
};

/** For a field source each row holds one document: NDJSON lines, or the elements of a top-level array. */
function samplesFor(text: string, perRow: boolean): Json[] {
  const r = tryParseJson(text.trim());
  if (r.ok) return perRow && Array.isArray(r.value) && r.value.length ? r.value : [r.value];
  const nd = parseNdjson(text);
  if (nd) return perRow ? nd : [nd];
  throw new Error(`Invalid JSON: ${r.error}`);
}

export function engineTab(state: EngineState, out: OutputPanel, changed: () => void, examples: Record<string, string>, rebuild: () => void) {
  const textarea = h('textarea.input', {
    spellcheck: false,
    placeholder: 'Paste a JSON sample (a whole document, or for a database column: one JSON value per line / a JSON array of values)…',
    oninput: () => ((state.text = textarea.value), (state.exclude = []), update()),
  });
  textarea.value = state.text;
  const set = <K extends keyof EngineState>(k: K) => (v: EngineState[K]) => ((state[k] = v), update());
  const text = (k: 'path' | 'table' | 'field' | 'keyField' | 'rootName' | 'maxDepth' | 'fieldDelimiter', placeholder = '') => {
    const i = h('input', { value: state[k], placeholder, oninput: () => set(k)(i.value) });
    return i;
  };
  const sampleCb = h('input', { checked: state.sampleTable, onchange: () => set('sampleTable')(sampleCb.checked) });

  const sourceOpts = h('div.source-opts', {});
  const tree = h('div.tree', {});
  const badge = h('span.badge', {});

  function renderSourceOpts() {
    if (state.source === 'file')
      replace(sourceOpts, h('div.row', {}, field('File or URL (lib://…)', text('path', 'lib://DataFiles/data.json'), 'Any folder or web-file connection.')));
    else if (state.source === 'inline') replace(sourceOpts, h('p.hint.note', {}, 'The sample is embedded in the script as a variable: handy for tests, keep it small.'));
    else
      replace(
        sourceOpts,
        h(
          'div.row',
          {},
          field('Source table', text('table')),
          field('JSON field', text('field')),
          field('Key field (optional)', text('keyField'), 'Carried to the expanded tables.'),
          field(
            'Method',
            select<EngineState['method']>(
              [
                ['reader', 'JSON reader, linked per row (recommended)'],
                ['jsonget', 'JsonGet preceding loads'],
                ['fromfield', 'Plain From_Field (distinct values)'],
              ],
              state.method,
              (v) => (set('method')(v), renderSourceOpts()),
            ),
          ),
        ),
        h('div.checks', {}, check('Add sample rows as an INLINE source table', sampleCb, 'Try the whole thing end to end')),
      );
  }

  function renderTree(tables: EngineTable[]) {
    const items = tables.map((t) => {
      const cbx = h('input', {
        type: 'checkbox',
        checked: !state.exclude.includes(t.pointer),
        disabled: !t.parent,
        onchange: () => {
          state.exclude = cbx.checked ? state.exclude.filter((p) => p !== t.pointer) : [...state.exclude, t.pointer];
          update();
        },
      });
      const kind = t.kind === 'scalars' ? 'values' : t.kind === 'matrix' ? 'matrix' : t.kind === 'empty' ? 'empty' : `${t.fields.length} field${t.fields.length === 1 ? '' : 's'}`;
      return h(
        'li',
        { style: `--depth:${t.depth}` },
        h(
          'label',
          { class: t.parent ? '' : 'root' },
          cbx,
          icon('table', 'tree-icon'),
          h('strong', {}, tableLabel(t, state.rootName || 'Data')),
          h('code', {}, t.pointer || '(root)'),
          h('span.pill', {}, kind),
        ),
      );
    });
    replace(tree, sectionHead('Tables', `${tables.length} found · untick to skip`), h('ul', {}, items));
  }

  const options = h(
    'div.options',
    {},
    group(
      'Source',
      h(
        'div.row',
        {},
        field(
          'Where is the JSON?',
          select<EngineState['source']>(
            [
              ['file', 'File or URL'],
              ['inline', 'Embedded sample (INLINE)'],
              ['field', 'Column in a loaded table (e.g. from a database)'],
            ],
            state.source,
            (v) => (set('source')(v), renderSourceOpts()),
          ),
        ),
      ),
      sourceOpts,
    ),
    group(
      'Script',
      h(
        'div.row',
        {},
        field('Root table name', text('rootName')),
        field(
          'Fields',
          select<EngineState['mode']>(
            [
              ['explicit', 'List fields, link by position (recommended)'],
              ['star', 'LOAD * (engine %Key_ content hashes)'],
              ['alltables', 'One load: (json, all tables)'],
            ],
            state.mode,
            set('mode'),
          ),
        ),
      ),
    ),
    h(
      'details.advanced',
      {},
      h('summary', {}, 'Advanced'),
      h(
        'div.row',
        {},
        field('Max nesting depth', text('maxDepth', 'all'), 'Arrays deeper than this are not loaded.'),
        field(
          '[][] matrix data',
          select<EngineState['matrix']>(
            [
              ['native', "table is '/*/', embedded labels"],
              ['jsonget', 'JsonGet (older engines)'],
            ],
            state.matrix,
            set('matrix'),
          ),
        ),
        field('Nested name delimiter', text('fieldDelimiter'), "Use ':' if keys contain dots."),
      ),
    ),
    tree,
  );

  const exampleBar = examplePicker(examples, (name, t) => {
    state.text = t;
    state.exclude = [];
    if (name.startsWith('DB')) {
      state.source = 'field';
      state.rootName = 'Order';
    } else if (state.source === 'field') state.source = 'inline';
    rebuild();
  });

  function update() {
    changed();
    if (!state.text.trim()) {
      replace(tree);
      badge.textContent = '';
      out.set('', []);
      return;
    }
    try {
      const samples = samplesFor(state.text, state.source === 'field');
      const source: EngineOptions['source'] =
        state.source === 'file'
          ? { kind: 'file', path: state.path }
          : state.source === 'inline'
            ? { kind: 'inline' }
            : { kind: 'field', table: state.table, field: state.field, keyField: state.keyField || undefined, method: state.method, sampleTable: state.sampleTable };
      const depth = parseInt(state.maxDepth, 10);
      const r = generateEngine(samples, {
        source,
        mode: state.mode,
        rootName: state.rootName || 'Data',
        exclude: state.exclude,
        maxDepth: Number.isFinite(depth) ? depth : undefined,
        matrix: state.matrix,
        fieldDelimiter: state.fieldDelimiter || '.',
      });
      badge.textContent = `${samples.length} document${samples.length === 1 ? '' : 's'} · ${r.tables.length} table${r.tables.length === 1 ? '' : 's'}`;
      renderTree(r.tables);
      out.set(r.script, r.warnings, { filename: `${state.rootName || 'json'}.qvs` });
    } catch (e) {
      replace(tree);
      badge.textContent = '';
      out.set('', [], { error: (e as Error).message });
    }
  }

  renderSourceOpts();
  textarea.setAttribute('aria-label', 'JSON sample');
  const el = h('div.panel', {}, h('div.input-head', {}, h('h2', {}, 'JSON sample'), badge), textarea, exampleBar, options);
  return { el, update };
}
