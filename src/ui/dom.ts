type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper: h('div.card#id', { onclick }, children). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K | `${K}.${string}`, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const [withId, ...rest] = tag.split('.');
  const parts = [withId, ...rest].map((p) => p.split('#'));
  const name = parts[0][0];
  const classes = parts.map((p) => p[0]).slice(1);
  const id = parts.flatMap((p) => p.slice(1))[0];
  const el = document.createElement(name as K);
  if (classes.length) el.className = classes.join(' ');
  if (id) el.id = id;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

// Inline SVG icons (24×24 stroke icons unless noted). Drawn locally: no icon fonts or network requests.
const ICONS = {
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9.5 9.5v10"/>',
  braces:
    '<path d="M8 4.5H7.5A2.5 2.5 0 0 0 5 7v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2.5 2.5 0 0 0 2.5 2.5H8M16 4.5h.5A2.5 2.5 0 0 1 19 7v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2.5 2.5 0 0 1-2.5 2.5H16"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 8.6 4.2 4.2 0 0 1 17.5 18.5z"/><path d="M10 14.5h4"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.75v.01"/>',
  warn: '<path d="M10.3 4.3 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.25v.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  file: '<path d="M13.5 3.5H7A2 2 0 0 0 5 5.5v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13.5 3.5V9H19M10 13l-2 2 2 2M14 13l2 2-2 2"/>',
  clipboard: '<rect x="8.5" y="3" width="7" height="4" rx="1"/><path d="M15.5 5H17a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1.5M9 12h6M9 16h4"/>',
  listCheck: '<path d="M4 6.5l1.5 1.5L8.5 5M4 12.5l1.5 1.5 3-3M4 18.5l1.5 1.5 3-3M12 7h8M12 13h8M12 19h8"/>',
  circleCheck: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.4 2.3 4.6-4.8"/>',
  external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
} as const;

export type IconName = keyof typeof ICONS | 'github';

const GITHUB =
  '<path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>';

/** A decorative inline SVG icon (hidden from assistive tech; label the control instead). */
export function icon(name: IconName, cls = ''): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML =
    name === 'github'
      ? `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${GITHUB}</svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  const svg = wrap.firstElementChild as SVGSVGElement;
  svg.setAttribute('class', `icon${cls ? ` ${cls}` : ''}`);
  return svg;
}

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${++uid}`;

export function field(labelText: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  const hintEl = hint ? h('span.hint', { id: nextId('hint') }, hint) : null;
  if (hintEl && !control.hasAttribute('aria-describedby')) control.setAttribute('aria-describedby', hintEl.id);
  return h('label.field', {}, h('span.field-label', {}, labelText), control, hintEl);
}

/** A checkbox drawn as a compact switch, with optional visible hint text. */
export function check(labelText: string, input: HTMLInputElement, hint?: string): HTMLLabelElement {
  input.type = 'checkbox';
  input.classList.add('switch');
  return h('label.check', {}, input, h('span.check-text', {}, h('span.check-label', {}, labelText), hint ? h('span.hint', {}, hint) : null));
}

export function select<T extends string>(options: [T, string][], value: T, onchange: (v: T) => void): HTMLSelectElement {
  const s = h('select', { onchange: () => onchange(s.value as T) }, ...options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = value;
  return s;
}

/** A titled group of options (fieldset + legend). */
export function group(title: string, ...children: (Child | Child[])[]): HTMLFieldSetElement {
  return h('fieldset.group', {}, h('legend', {}, title), ...children);
}

/** Pill buttons that load example inputs. */
export function exampleBar(examples: Record<string, string>, onPick: (name: string, text: string) => void): HTMLElement {
  return h(
    'div.examples',
    {},
    h('span.examples-label', {}, 'Try an example'),
    ...Object.entries(examples).map(([name, text]) => h('button.chip', { type: 'button', onclick: () => onPick(name, text) }, name)),
  );
}

/** Header row for a sub-section of the input panel (preview grid, table tree). */
export function sectionHead(title: string, note?: string): HTMLElement {
  return h('div.section-head', {}, h('h3', {}, title), note ? h('span.dim', {}, note) : null);
}

export function replace(el: Element, ...children: (Child | Child[])[]) {
  el.replaceChildren(...(children.flat().filter((c) => c !== null && c !== undefined && c !== false) as (Node | string)[]));
}
