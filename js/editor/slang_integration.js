// monaco is loaded globally via index.html (AMD vendor build).
/**
 * slang_integration.js — wires the bundled slang-server (main/lsp/slang_lsp.js,
 * exposed as window.slangAPI) into Monaco for SystemVerilog/Verilog buffers.
 *
 * Per the chosen "meio-termo" split, slang contributes only its UNIQUE
 * value on top of Verible (O2):
 *   - SEMANTIC diagnostics (elaboration: undeclared ids, type/port
 *     mismatches, unused signals…) as markers under owner 'slang',
 *     coexisting with Verible's 'verible' markers; and
 *   - symbol COMPLETION (modules, ports, package/struct members, macros).
 * Hover, definition, references, outline and formatting stay with Verible.
 *
 * slang elaborates the whole project on every change, so it's TOGGLEABLE
 * (window.AuroraSlang.toggle(), wired to a command-palette entry). The
 * state persists in localStorage and is synced to main at boot. When off,
 * slang markers are cleared and no requests are sent. Best-effort: with no
 * binary / toggle off, everything no-ops and the editor is unaffected.
 */

const SLANG_LANGS = ['verilog', 'systemverilog'];
const CHANGE_DEBOUNCE_MS = 400; // elaboration is heavier than a lint
const DIAGNOSTICS_OWNER = 'slang';
const STORAGE_KEY = 'slangEnabled';
const TRIGGER_CHARS = ['`', '#', '.', '(', ':', '['];

let initialized = false;
let enabled = true;
/** Live LSP-language models currently open (for toggle re-sync + marker clears). */
const openModels = new Set();

export function initSlang() {
  if (initialized) return;
  if (typeof window === 'undefined' || !window.slangAPI) return;
  if (typeof monaco === 'undefined') return;
  initialized = true;

  try {
    enabled = readEnabled();
    // Sync the persisted toggle to main (main defaults to enabled).
    try { window.slangAPI.setEnabled(enabled); } catch { /* ignore */ }

    registerCompletion();
    wireDiagnostics();
    wireModelLifecycle();
    exposeToggle();
  } catch (e) {
    initialized = false;
    console.warn('[slang] integration disabled:', e);
  }
}

// ── toggle (persisted; command-palette entry calls window.AuroraSlang.toggle) ──

function readEnabled() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === 'true';
  } catch { return true; }
}

function setEnabled(on) {
  on = !!on;
  if (on === enabled) return enabled;
  enabled = on;
  try { window.localStorage.setItem(STORAGE_KEY, String(on)); } catch { /* ignore */ }
  try { window.slangAPI.setEnabled(on); } catch { /* ignore */ }

  if (!on) {
    // Clear every slang marker immediately (don't wait for the server kill).
    for (const model of openModels) {
      if (!model.isDisposed || !model.isDisposed()) {
        monaco.editor.setModelMarkers(model, DIAGNOSTICS_OWNER, []);
      }
    }
  } else {
    // Re-open all visible buffers so slang re-indexes + re-diagnoses.
    for (const model of openModels) {
      if (!model.isDisposed || !model.isDisposed()) {
        window.slangAPI.didOpen(model.uri.toString(), model.getValue(), model.getLanguageId());
      }
    }
  }
  return enabled;
}

function exposeToggle() {
  window.AuroraSlang = {
    isEnabled: () => enabled,
    setEnabled,
    toggle: () => {
      const now = setEnabled(!enabled);
      const msg = now
        ? 'slang: análise semântica de SystemVerilog ligada'
        : 'slang: análise semântica desligada';
      try { window.showNotification?.(msg, now ? 'success' : 'info', 3000, 'slang'); } catch { /* ignore */ }
      return now;
    },
  };
}

// ── coordinate / shape mapping (LSP 0-based ↔ Monaco 1-based) ──────────────────

function lspRangeToMonaco(r) {
  return new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
}

function lspSeverityToMonaco(sev) {
  switch (sev) {
    case 1: return monaco.MarkerSeverity.Error;
    case 2: return monaco.MarkerSeverity.Warning;
    case 3: return monaco.MarkerSeverity.Info;
    case 4: return monaco.MarkerSeverity.Hint;
    default: return monaco.MarkerSeverity.Info;
  }
}

function diagnosticToMarker(d) {
  return {
    severity: lspSeverityToMonaco(d.severity),
    message: d.message || '',
    startLineNumber: d.range.start.line + 1,
    startColumn: d.range.start.character + 1,
    endLineNumber: d.range.end.line + 1,
    endColumn: d.range.end.character + 1,
    source: d.source || DIAGNOSTICS_OWNER,
    code: d.code != null ? String(d.code) : undefined,
  };
}

function modelForUri(uriStr) {
  try {
    const uri = monaco.Uri.parse(uriStr);
    const direct = monaco.editor.getModel(uri);
    if (direct) return direct;
    const target = uri.fsPath.toLowerCase();
    for (const model of monaco.editor.getModels()) {
      if (model.uri.fsPath.toLowerCase() === target) return model;
    }
  } catch { /* unparseable */ }
  return null;
}

// ── diagnostics (server → markers) ────────────────────────────────────────────

function wireDiagnostics() {
  window.slangAPI.onDiagnostics(({ uri, diagnostics }) => {
    if (!enabled && (diagnostics || []).length) return; // ignore late pushes after disable
    const model = modelForUri(uri);
    if (!model || (model.isDisposed && model.isDisposed())) return;
    const markers = (diagnostics || []).map(diagnosticToMarker);
    monaco.editor.setModelMarkers(model, DIAGNOSTICS_OWNER, markers);
  });
}

// ── model lifecycle (editor → server open/change/close) ───────────────────────

function isLspModel(model) {
  return !!model
    && !(model.isDisposed && model.isDisposed())
    && model.uri.scheme === 'file'
    && SLANG_LANGS.includes(model.getLanguageId());
}

const attached = new WeakSet();

function attach(model) {
  if (!model || attached.has(model) || !isLspModel(model)) return;
  attached.add(model);
  openModels.add(model);

  const uri = model.uri.toString();
  if (enabled) window.slangAPI.didOpen(uri, model.getValue(), model.getLanguageId());

  let timer = null;
  const changeSub = model.onDidChangeContent(() => {
    if (!enabled) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (model.isDisposed && model.isDisposed()) return;
      window.slangAPI.didChange(model.uri.toString(), model.getValue());
    }, CHANGE_DEBOUNCE_MS);
  });

  const disposeSub = model.onWillDispose(() => {
    clearTimeout(timer);
    changeSub.dispose();
    disposeSub.dispose();
    openModels.delete(model);
    window.slangAPI.didClose(uri);
  });
}

function wireModelLifecycle() {
  monaco.editor.getModels().forEach(attach);
  monaco.editor.onDidCreateModel(attach);
  monaco.editor.onDidChangeModelLanguage(({ model }) => attach(model));
}

// ── completion (editor → server) ──────────────────────────────────────────────

// LSP CompletionItemKind (1..25) → monaco.languages.CompletionItemKind.
function lspCompletionKindToMonaco(kind) {
  const K = monaco.languages.CompletionItemKind;
  const map = {
    1: K.Text, 2: K.Method, 3: K.Function, 4: K.Constructor, 5: K.Field,
    6: K.Variable, 7: K.Class, 8: K.Interface, 9: K.Module, 10: K.Property,
    11: K.Unit, 12: K.Value, 13: K.Enum, 14: K.Keyword, 15: K.Snippet,
    16: K.Color, 17: K.File, 18: K.Reference, 19: K.Folder, 20: K.EnumMember,
    21: K.Constant, 22: K.Struct, 23: K.Event, 24: K.Operator, 25: K.TypeParameter,
  };
  return map[kind] != null ? map[kind] : K.Text;
}

function docToString(doc) {
  if (!doc) return undefined;
  if (typeof doc === 'string') return doc;
  return doc.value || undefined;
}

function registerCompletion() {
  for (const lang of SLANG_LANGS) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: TRIGGER_CHARS,
      async provideCompletionItems(model, position) {
        if (!enabled) return { suggestions: [] };
        const res = await window.slangAPI.completion(
          model.uri.toString(),
          { line: position.lineNumber - 1, character: position.column - 1 },
        );
        const items = Array.isArray(res) ? res : (res && Array.isArray(res.items) ? res.items : []);
        if (!items.length) return { suggestions: [] };

        const word = model.getWordUntilPosition(position);
        const defaultRange = new monaco.Range(
          position.lineNumber, word.startColumn, position.lineNumber, word.endColumn,
        );

        const suggestions = items.map((it) => {
          const edit = it.textEdit;
          const range = edit && edit.range ? lspRangeToMonaco(edit.range) : defaultRange;
          const insertText = (edit && (edit.newText !== undefined)) ? edit.newText
            : (it.insertText !== undefined ? it.insertText : it.label);
          return {
            label: it.label,
            kind: lspCompletionKindToMonaco(it.kind),
            insertText,
            range,
            detail: it.detail || undefined,
            documentation: docToString(it.documentation),
            sortText: it.sortText || undefined,
            filterText: it.filterText || undefined,
            preselect: it.preselect || undefined,
          };
        });
        return { suggestions, incomplete: !!(res && res.isIncomplete) };
      },
    });
  }
}
