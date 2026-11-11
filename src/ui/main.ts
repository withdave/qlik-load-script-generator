import nastyCsv from '../../fixtures/tabular/nasty.csv?raw';
import tableMd from '../../fixtures/tabular/table.md?raw';
import excelTsv from '../../fixtures/tabular/excel-clipboard.tsv?raw';
import nestedJson from '../../fixtures/json/nested.json?raw';
import matrixJson from '../../fixtures/json/matrix.json?raw';
import simpleJson from '../../fixtures/json/simple.json?raw';
import usersJson from '../../fixtures/json/qlik-cloud-users-page.json?raw';
import ordersJson from '../../fixtures/db-column/orders.json?raw';
import { REPO_URL, SKILL_URL } from './config';
import { h, icon, replace, type IconName } from './dom';
import { outputPanel } from './output';
import { decodeShare, encodeShare, loadState, saveState } from './state';
import { engineDefaults, engineTab, type EngineState } from './tabs/engine';
import { inlineDefaults, inlineTab, type InlineState } from './tabs/inline';
import { restDefaults, restTab, type RestState } from './tabs/rest';
import './styles.css';

type TabId = 'inline' | 'engine' | 'rest';
interface AppState {
  tab: TabId;
  inline: InlineState;
  engine: EngineState;
  rest: RestState;
}

const defaults: AppState = { tab: 'inline', inline: inlineDefaults, engine: engineDefaults, rest: restDefaults };

const TABS: { id: TabId; label: string; short: string; icon: IconName; blurb: string }[] = [
  { id: 'inline', label: 'Paste → INLINE', short: 'INLINE', icon: 'table', blurb: 'Turn a pasted table into a LOAD … INLINE statement with every escaping problem handled.' },
  { id: 'engine', label: 'JSON → Engine', short: 'Engine', icon: 'braces', blurb: 'Native (json) loads: files, URLs, embedded samples, or JSON stored in a database column.' },
  { id: 'rest', label: 'JSON → REST connector', short: 'REST', icon: 'cloud', blurb: 'The connector’s SELECT, tidy tables instead of one per nested object, and pagination that works.' },
];

const HELP_LINKS: [string, string][] = [
  ['Working with JSON', 'https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Scripting/working-with-JSON.htm'],
  ['REST connector', 'https://help.qlik.com/en-US/connectors/Subsystems/REST_connector_help/Content/Connectors_REST/Load-REST-data/Load-data.htm'],
  ['Inline loads', 'https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Scripting/inline-loads-qs.htm'],
];

/** The app's logo mark: braces feeding lines of script. */
function logo(): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML =
    '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="var(--logo-bg)"/><path d="M11 8.5c-1.9 0-2.6.9-2.6 2.6v2.3c0 1.3-.7 2.1-2 2.6 1.3.5 2 1.3 2 2.6v2.3c0 1.7.7 2.6 2.6 2.6" fill="none" stroke="var(--logo-fg)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 11.5h10M15 16h7M15 20.5h9" fill="none" stroke="var(--logo-fg)" stroke-width="2.2" stroke-linecap="round" opacity=".92"/></svg>';
  return wrap.firstElementChild as SVGSVGElement;
}

async function start() {
  let state: AppState = loadState(structuredClone(defaults));
  state = { ...structuredClone(defaults), ...state, inline: { ...inlineDefaults, ...state.inline }, engine: { ...engineDefaults, ...state.engine }, rest: { ...restDefaults, ...state.rest } };
  if (location.hash.length > 1) {
    const shared = await decodeShare<AppState>(location.hash.slice(1));
    if (shared) state = { ...state, ...shared };
    history.replaceState(null, '', location.pathname + location.search);
  }

  const out = outputPanel();
  const changed = () => saveState(state);
  const work = h('div.panel-host', {});
  const blurb = h('p.blurb', {});
  const tabButtons = TABS.map((t, i) =>
    h(
      'button.tab',
      {
        type: 'button',
        role: 'tab',
        id: `tab-${t.id}`,
        'aria-controls': 'workspace',
        onclick: () => show(t.id),
        onkeydown: (e: Event) => {
          const k = (e as KeyboardEvent).key;
          const to = k === 'ArrowRight' ? i + 1 : k === 'ArrowLeft' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? TABS.length - 1 : null;
          if (to === null) return;
          e.preventDefault();
          const next = TABS[(to + TABS.length) % TABS.length];
          show(next.id);
          tabButtons[TABS.indexOf(next)].focus();
        },
      },
      icon(t.icon),
      h('span.tab-label', {}, t.label),
      h('span.tab-short', { 'aria-hidden': 'true' }, t.short),
    ),
  );

  function mount(id: TabId) {
    const rebuild = () => mount(id);
    const tab =
      id === 'inline'
        ? inlineTab(state.inline, out, changed, { 'Tricky CSV': nastyCsv, 'Excel paste': excelTsv, Markdown: tableMd, 'JSON array': simpleJson })
        : id === 'engine'
          ? engineTab(state.engine, out, changed, { Nested: nestedJson, '[][] matrix': matrixJson, 'Qlik API page': usersJson, 'DB column (3 rows)': ordersJson }, rebuild)
          : restTab(state.rest, out, changed, { 'Qlik Cloud users page': usersJson, Nested: nestedJson }, rebuild);
    replace(work, tab.el);
    tab.update();
  }

  function show(id: TabId) {
    state.tab = id;
    tabButtons.forEach((b, i) => {
      const on = TABS[i].id === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    blurb.textContent = TABS.find((t) => t.id === id)!.blurb;
    work.setAttribute('aria-labelledby', `tab-${id}`);
    mount(id);
    changed();
  }

  // Links longer than this get cut off by some chat, email and ticketing tools.
  const SHARE_LINK_WARN_CHARS = 2000;
  const sharePop = h('div.share-pop', { role: 'dialog', 'aria-label': 'Share this setup', hidden: true });
  const closeShare = () => {
    sharePop.hidden = true;
    share.setAttribute('aria-expanded', 'false');
  };
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !sharePop.hidden && (closeShare(), share.focus()));
  document.addEventListener('click', (e) => !sharePop.hidden && !sharePop.contains(e.target as Node) && !share.contains(e.target as Node) && closeShare());

  const share = h(
    'button.btn.btn-ghost',
    {
      type: 'button',
      title: "Copy a link to this tab's current input and settings",
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      onclick: async () => {
        const tab = TABS.find((t) => t.id === state.tab)!;
        const url = `${location.origin}${location.pathname}#${await encodeShare({ tab: state.tab, [state.tab]: state[state.tab] })}`;
        let copied = true;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          copied = false;
        }
        const link = h('input.share-url', { type: 'text', readOnly: true, value: url, 'aria-label': 'Share link', onfocus: () => link.select() });
        const long = url.length > SHARE_LINK_WARN_CHARS;
        replace(
          sharePop,
          h('div.share-head', {}, icon(copied ? 'check' : 'link'), h('strong', {}, copied ? 'Link copied' : 'Copy this link'), h('button.btn.btn-ghost.btn-icon.btn-sm', { type: 'button', 'aria-label': 'Close', onclick: closeShare }, '×')),
          h(
            'p',
            {},
            `It reopens the ${tab.label} tab with your current input and settings. The data you pasted is inside the link, so anyone you send it to can read it. Nothing is uploaded.`,
          ),
          long
            ? h(
                'p.callout.warn',
                {},
                icon('warn'),
                h('span', {}, `This link is ${url.length.toLocaleString()} characters long. Links over about ${SHARE_LINK_WARN_CHARS.toLocaleString()} characters can be cut off by some chat, email and ticketing tools. For large data, share the file instead.`),
              )
            : null,
          link,
        );
        sharePop.hidden = false;
        share.setAttribute('aria-expanded', 'true');
        if (!copied) link.focus();
      },
    },
    icon('link'),
    h('span.btn-label', {}, 'Share setup'),
  );
  const reset = h(
    'button.btn.btn-ghost',
    {
      type: 'button',
      title: 'Clear this tab’s input and options',
      onclick: () => {
        state[state.tab] = structuredClone(defaults[state.tab]) as never;
        show(state.tab);
      },
    },
    icon('reset'),
    h('span.btn-label', {}, 'Reset tab'),
  );

  const extLink = (label: string, href: string) => h('a', { href, target: '_blank', rel: 'noopener' }, label, icon('external', 'icon-xs'));

  document.body.append(
    h(
      'div.app',
      {},
      h(
        'header.top',
        {},
        h(
          'div.brand',
          {},
          logo(),
          h('div.brand-text', {}, h('h1', {}, 'Qlik load script generator'), h('p.tagline', {}, 'Makes Qlik load script for pasted tables, JSON files and REST APIs.')),
        ),
        h('div.actions', {}, share, reset, sharePop),
      ),
      h(
        'div.nav-row',
        {},
        h('nav.tabs', { role: 'tablist', 'aria-label': 'Generator' }, tabButtons),
      ),
      blurb,
      h('main.workspace#workspace', {}, work, out.el),
      h(
        'footer.foot',
        {},
        h('p.foot-note', {}, h('span.privacy', {}, icon('lock'), 'Nothing you paste leaves this page.')),
        h(
          'nav.foot-links',
          { 'aria-label': 'Help and source' },
          h('span.foot-heading', {}, 'Qlik help:'),
          HELP_LINKS.map(([l, u]) => extLink(l, u)),
          h('span.divider', { 'aria-hidden': 'true' }),
          h('a.foot-repo', { href: REPO_URL, target: '_blank', rel: 'noopener' }, icon('github'), 'Source on GitHub'),
          h('a.foot-repo', { href: SKILL_URL, target: '_blank', rel: 'noopener', title: 'The same generator packaged as a Claude skill' }, icon('braces'), 'Use as a Claude skill'),
        ),
      ),
    ),
  );
  show(state.tab);
}

start();
