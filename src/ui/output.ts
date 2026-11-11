import type { ConnectionSetting } from '../core/json/rest';
import type { Warning } from '../core/model';
import { h, icon, replace, type IconName } from './dom';
import { highlight } from './highlight';

export interface OutputPanel {
  el: HTMLElement;
  set(script: string, warnings: Warning[], opts?: { filename?: string; checklist?: string[]; settings?: ConnectionSetting[]; error?: string }): void;
}

const CALLOUT_ICON: Record<string, IconName> = { info: 'info', warn: 'warn', error: 'error' };

export function outputPanel(): OutputPanel {
  let current = '';
  let filename = 'load-script.qvs';
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  const code = h('code', {});
  const pre = h('pre.script', { tabIndex: 0, 'aria-label': 'Load script' }, code);
  const gutter = h('div.gutter', { 'aria-hidden': 'true' });
  const editor = h('div.editor-body', {}, gutter, pre);
  const empty = h('div.empty', {});
  const notes = h('div.notes', {});
  const status = h('span.sr-only', { role: 'status' });
  const fileLabel = h('span.filename', {}, filename);
  const meta = h('span.meta', {});

  const copyLabel = h('span', {}, 'Copy');
  const copyIcon = h('span.icon-slot', {}, icon('copy'));
  const copy = h(
    'button.btn.btn-primary.btn-sm',
    {
      type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(current);
          flash('Copied', 'Script copied to the clipboard');
        } catch {
          const r = document.createRange();
          r.selectNodeContents(code);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(r);
          flash('Selected', 'Script selected: press Ctrl or Cmd + C to copy');
        }
      },
    },
    copyIcon,
    copyLabel,
  );
  const download = h(
    'button.btn.btn-editor.btn-sm',
    {
      type: 'button',
      title: 'Download as a .qvs file',
      onclick: () => {
        const a = h('a', { href: URL.createObjectURL(new Blob([current], { type: 'text/plain' })), download: filename });
        a.click();
        URL.revokeObjectURL(a.href);
      },
    },
    icon('download'),
    h('span', {}, 'Download'),
  );

  const flash = (label: string, announce: string) => {
    clearTimeout(resetTimer);
    copy.classList.add('done');
    copyLabel.textContent = label;
    replace(copyIcon, icon('check'));
    status.textContent = announce;
    resetTimer = setTimeout(() => {
      copy.classList.remove('done');
      copyLabel.textContent = 'Copy';
      replace(copyIcon, icon('copy'));
      status.textContent = '';
    }, 1800);
  };

  const bar = h(
    'div.editor-bar',
    {},
    h('div.editor-title', {}, icon('file'), h('h2', {}, 'Load script'), fileLabel),
    h('div.editor-actions', {}, meta, copy, download),
  );
  const win = h('div.editor', {}, bar, editor, empty);
  const el = h('section.output', { 'aria-label': 'Generated script' }, win, notes, status);

  return {
    el,
    set(script, warnings, opts = {}) {
      current = script;
      filename = opts.filename ?? filename;
      fileLabel.textContent = filename;
      copy.disabled = download.disabled = !script;

      if (script) {
        const lines = script.endsWith('\n') ? script.split('\n').length - 1 : script.split('\n').length;
        meta.textContent = `${lines.toLocaleString()} line${lines === 1 ? '' : 's'} · ${script.length.toLocaleString()} chars`;
        code.innerHTML = highlight(script);
        gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
        gutter.style.setProperty('--gutter-ch', String(Math.max(2, String(lines).length)));
        editor.hidden = false;
        empty.hidden = true;
      } else {
        meta.textContent = '';
        code.textContent = '';
        gutter.textContent = '';
        editor.hidden = true;
        empty.hidden = false;
        replace(
          empty,
          h('span.empty-icon', {}, icon(opts.error ? 'warn' : 'clipboard')),
          h('p.empty-title', {}, opts.error ? 'No script yet' : 'Your load script will appear here'),
          h('p.empty-text', {}, opts.error ? 'Fix the problem shown below and the script updates as you type.' : 'Paste data on the left, or pick one of the examples to see how it works.'),
        );
      }

      const items: HTMLElement[] = [];
      if (opts.error) items.push(callout('error', opts.error));
      for (const w of warnings) items.push(callout(w.level, w.message));
      replace(
        notes,
        items.length ? h('ul.callouts', { 'aria-label': 'Notes about this script' }, items) : null,
        opts.settings?.length ? settingsBlock(opts.settings, status) : null,
        opts.checklist?.length
          ? h(
              'div.checklist',
              {},
              h('div.checklist-head', {}, icon('listCheck'), h('h3', {}, 'Connection checklist')),
              h('ul', {}, opts.checklist.map((c) => h('li', {}, icon('circleCheck'), h('span', {}, c)))),
            )
          : null,
      );
    },
  };
}

/** The values to enter in the connection's Pagination section, each with a copy button. */
function settingsBlock(settings: ConnectionSetting[], status: HTMLElement): HTMLElement {
  return h(
    'div.checklist.settings',
    {},
    h('div.checklist-head', {}, icon('sliders'), h('h3', {}, 'Connection pagination settings')),
    h('p.settings-intro', {}, 'Edit the data connection and fill in its Pagination section:'),
    h(
      'dl',
      {},
      settings.map((s) => {
        const copy = s.value
          ? h(
              'button.btn.btn-ghost.btn-icon.btn-xs',
              {
                type: 'button',
                title: 'Copy value',
                'aria-label': `Copy ${s.label} value`,
                onclick: async () => {
                  try {
                    await navigator.clipboard.writeText(s.value);
                    status.textContent = `Copied ${s.value}`;
                    replace(copy!, icon('check'));
                    setTimeout(() => replace(copy!, icon('copy')), 1500);
                  } catch {
                    status.textContent = 'Copy failed: select the value instead';
                  }
                },
              },
              icon('copy'),
            )
          : null;
        return h(
          'div.setting',
          {},
          h('dt', {}, s.label),
          h('dd', {}, h('span.setting-value', {}, s.value ? h('code', {}, s.value) : h('span.dim', {}, 'empty'), copy), s.hint ? h('span.hint', {}, s.hint) : null),
        );
      }),
    ),
  );
}

function callout(level: string, message: string): HTMLLIElement {
  return h(`li.callout.${level}`, {}, icon(CALLOUT_ICON[level] ?? 'info'), h('span', {}, message));
}
