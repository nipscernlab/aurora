/**
 * ai_selection_widget.js — the "ask Aurora about this" star for Monaco.
 *
 * Attaches a floating sparkle button to a Monaco editor that appears whenever
 * the user has a non-empty selection (in ANY pane — main or split). Clicking it
 * opens a small menu of quick intents (Explain / Fix / Improve / Comment) plus
 * a free-form "Ask…". The chosen action is handed to
 * `window.AuroraAPI.ai.askAboutSelection(...)`, which opens the AI panel and
 * seeds the composer with the selected snippet (and, for a concrete intent,
 * sends it straight away).
 *
 * Both editor factories call `attachAiSelectionWidget(editor, { getFilePath })`
 * once per instance — see monaco_editor.js (main pane) and split_editor.js.
 */

const WIDGET_ID = 'aurora.ai.selectionStar';

// Quick-action menu. `send: true` fires the message immediately with a ready
// prompt; the free-form "Ask…" only seeds the composer so the user can type.
const MENU_ITEMS = [
  { intent: 'explain', label: 'Explain',       icon: 'ph ph-chat-circle-text', send: true },
  { intent: 'fix',     label: 'Find & fix bugs', icon: 'ph ph-bug',            send: true },
  { intent: 'improve', label: 'Improve',        icon: 'ph ph-magic-wand',      send: true },
  { intent: 'comment', label: 'Add comments',   icon: 'ph ph-note-pencil',     send: true },
  { intent: 'ask',     label: 'Ask…',           icon: 'ph ph-paper-plane-tilt', send: false },
];


/**
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} editor
 * @param {{ getFilePath?: () => string }} [opts]
 */
export function attachAiSelectionWidget(editor, opts = {}) {
  if (!editor || !window.monaco) return;
  // Editors are reused (idempotent createEditorInstance) — never double-attach.
  if (editor.__auroraAiStarAttached) return;
  editor.__auroraAiStarAttached = true;

  const getFilePath = typeof opts.getFilePath === 'function'
    ? opts.getFilePath
    : () => editor.getModel?.()?.uri?.fsPath || '';

  // ── the star button ───────────────────────────────────────────────────
  const node = document.createElement('div');
  node.className = 'ai-selection-star';
  node.title = 'Ask Aurora Intelligence about this selection';
  node.setAttribute('role', 'button');
  // A single Phosphor sparkle — centres cleanly in the button (the old custom
  // 3-star SVG sat off-centre because its glyphs weren't centred in the viewBox).
  node.innerHTML = '<i class="ph-fill ph-sparkle" aria-hidden="true"></i>';
  node.style.display = 'none';

  let currentSelection = null;
  let menuEl = null;

  const widget = {
    getId: () => WIDGET_ID,
    getDomNode: () => node,
    getPosition: () => {
      if (!currentSelection) return null;
      // Anchor at the selection's start so the star sits at the top-left of
      // the highlighted block; prefer ABOVE, fall back to BELOW near line 1.
      return {
        position: {
          lineNumber: currentSelection.startLineNumber,
          column: currentSelection.startColumn,
        },
        preference: [
          window.monaco.editor.ContentWidgetPositionPreference.ABOVE,
          window.monaco.editor.ContentWidgetPositionPreference.BELOW,
        ],
      };
    },
  };
  editor.addContentWidget(widget);

  const showFor = (sel) => {
    currentSelection = sel;
    node.style.display = 'flex';
    editor.layoutContentWidget(widget);
  };
  const hide = () => {
    if (!currentSelection && node.style.display === 'none') return;
    currentSelection = null;
    node.style.display = 'none';
    editor.layoutContentWidget(widget);
    closeMenu();
  };

  editor.onDidChangeCursorSelection((e) => {
    const sel = e.selection;
    if (sel && !sel.isEmpty()) showFor(sel);
    else hide();
  });

  // ── capture the live selection at click time ──────────────────────────
  function captureContext() {
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel || sel.isEmpty()) return null;
    const code = model.getValueInRange(sel);
    if (!code.trim()) return null;
    return {
      code,
      language: model.getLanguageId?.() || '',
      filePath: getFilePath() || '',
      lineStart: sel.startLineNumber,
      lineEnd: sel.endLineNumber,
    };
  }

  function dispatch(item) {
    const ctx = captureContext();
    closeMenu();
    if (!ctx) return;
    const api = window.AuroraAPI?.ai;
    if (api && typeof api.askAboutSelection === 'function') {
      api.askAboutSelection({
        ...ctx,
        intent: item.intent === 'ask' ? '' : item.intent,
        send: !!item.send,
      });
    }
  }

  // ── the quick-action menu ─────────────────────────────────────────────
  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('resize', closeMenu);
  }
  function onDocDown(ev) {
    if (!menuEl) return;
    if (menuEl.contains(ev.target) || node.contains(ev.target)) return;
    closeMenu();
  }

  function openMenu() {
    closeMenu();
    if (!captureContext()) return;
    menuEl = document.createElement('div');
    menuEl.className = 'ai-selection-menu';
    menuEl.innerHTML = MENU_ITEMS.map((it) => `
      <button class="ai-selection-menu-item" type="button" data-intent="${it.intent}">
        <i class="${it.icon}"></i><span>${it.label}</span>
      </button>
    `).join('');
    document.body.appendChild(menuEl);

    // Position just below-right of the star, flipping back on-screen if needed.
    const r = node.getBoundingClientRect();
    const mw = menuEl.offsetWidth || 180;
    const mh = menuEl.offsetHeight || 200;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
    menuEl.style.left = Math.max(8, left) + 'px';
    menuEl.style.top = Math.max(8, top) + 'px';

    menuEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-intent]');
      if (!btn) return;
      const item = MENU_ITEMS.find((m) => m.intent === btn.dataset.intent);
      if (item) dispatch(item);
    });
    // capture-phase so it beats the editor's own handlers
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('resize', closeMenu);
  }

  // Keep the editor from stealing the mousedown (which would collapse the
  // selection before we can read it).
  node.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  node.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuEl) closeMenu();
    else openMenu();
  });

  editor.onDidDispose?.(() => {
    closeMenu();
    try { editor.removeContentWidget(widget); } catch (_) { /* already gone */ }
  });
}
