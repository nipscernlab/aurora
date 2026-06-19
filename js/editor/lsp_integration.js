// monaco is loaded globally via index.html (AMD vendor build).
/**
 * lsp_integration.js — wires the bundled verible-verilog-ls (main side,
 * exposed as window.lspAPI) into Monaco for Verilog/SystemVerilog buffers.
 *
 * What the user gets (O2, "completo"):
 *   - live diagnostics (lint + syntax) as squiggles + Problems markers,
 *   - document formatting (Format Document / Shift+Alt+F),
 *   - outline symbols (breadcrumbs + Outline view),
 *   - hover, and
 *   - go-to-definition / find-all-references.
 *
 * Everything is best-effort: if Verible isn't installed the IPC resolves
 * to null/empty and the editor behaves exactly as before (static Monaco
 * highlight, no diagnostics) — no errors surface to the user.
 *
 * Lifecycle is driven at the Monaco *model* level (mirroring
 * setupCMMLanguage in monaco_editor.js): every .v/.sv model that appears
 * is `didOpen`ed, its edits are debounced into `didChange`, and disposal
 * fires `didClose`. This decouples the LSP from editor/pane creation, so
 * split panes sharing one model only open the document once.
 */

const LSP_LANGS = ['verilog', 'systemverilog'];
const CHANGE_DEBOUNCE_MS = 350;
const DIAGNOSTICS_OWNER = 'verible';

let initialized = false;

export function initVerilogLSP() {
  if (initialized) return;
  if (typeof window === 'undefined' || !window.lspAPI) return;
  if (typeof monaco === 'undefined') return;
  initialized = true;

  // Best-effort: the LSP is a bonus on top of the editor. A failure here
  // (missing Monaco API, provider registration error) must NEVER bubble up
  // and break Monaco boot — initVerilogLSP() runs inside initMonaco's
  // editor.main callback right before it resolves.
  try {
    registerProviders();
    wireDiagnostics();
    wireModelLifecycle();
  } catch (e) {
    initialized = false;
    console.warn('[verible-lsp] integration disabled:', e);
  }
}

// ── coordinate / shape mapping (LSP 0-based ↔ Monaco 1-based) ──────────────────

function lspRangeToMonaco(r) {
  return new monaco.Range(
    r.start.line + 1, r.start.character + 1,
    r.end.line + 1, r.end.character + 1,
  );
}

function monacoPosToLsp(position) {
  return { line: position.lineNumber - 1, character: position.column - 1 };
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

// LSP SymbolKind (1..26) → monaco.languages.SymbolKind (different ordinals).
function lspSymbolKindToMonaco(kind) {
  const K = monaco.languages.SymbolKind;
  const map = {
    1: K.File, 2: K.Module, 3: K.Namespace, 4: K.Package, 5: K.Class,
    6: K.Method, 7: K.Property, 8: K.Field, 9: K.Constructor, 10: K.Enum,
    11: K.Interface, 12: K.Function, 13: K.Variable, 14: K.Constant, 15: K.String,
    16: K.Number, 17: K.Boolean, 18: K.Array, 19: K.Object, 20: K.Key,
    21: K.Null, 22: K.EnumMember, 23: K.Struct, 24: K.Event, 25: K.Operator,
    26: K.TypeParameter,
  };
  return map[kind] != null ? map[kind] : K.Variable;
}

function mapSymbol(s) {
  if (!s || !s.name) return null;
  // DocumentSymbol (hierarchical): has range + selectionRange (+ children).
  if (s.range && s.selectionRange) {
    return {
      name: s.name,
      detail: s.detail || '',
      kind: lspSymbolKindToMonaco(s.kind),
      tags: [],
      range: lspRangeToMonaco(s.range),
      selectionRange: lspRangeToMonaco(s.selectionRange),
      children: Array.isArray(s.children) ? s.children.map(mapSymbol).filter(Boolean) : [],
    };
  }
  // SymbolInformation (flat): has a location.
  if (s.location && s.location.range) {
    return {
      name: s.name,
      detail: '',
      kind: lspSymbolKindToMonaco(s.kind),
      tags: [],
      range: lspRangeToMonaco(s.location.range),
      selectionRange: lspRangeToMonaco(s.location.range),
      children: [],
    };
  }
  return null;
}

function hoverContentsToString(contents) {
  // contents: string | MarkedString | MarkedString[] | MarkupContent.
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === 'string' ? c : (c && c.value) || ''))
      .filter(Boolean)
      .join('\n\n');
  }
  return contents.value || '';
}

function locationsToMonaco(res) {
  if (!res) return [];
  const arr = Array.isArray(res) ? res : [res];
  return arr.map((loc) => {
    // Location { uri, range } or LocationLink { targetUri, targetRange }.
    const uri = loc.uri || loc.targetUri;
    const range = loc.range || loc.targetSelectionRange || loc.targetRange;
    if (!uri || !range) return null;
    try {
      return { uri: monaco.Uri.parse(uri), range: lspRangeToMonaco(range) };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// ── diagnostics (server → editor markers) ─────────────────────────────────────

// Match a server URI back to its Monaco model. Verible echoes the exact URI
// we sent, so an exact lookup almost always hits; the fsPath sweep is a
// case/encoding-robust fallback (Windows drive-letter casing, %-encoding).
function modelForUri(uriStr) {
  try {
    const uri = monaco.Uri.parse(uriStr);
    const direct = monaco.editor.getModel(uri);
    if (direct) return direct;
    const target = uri.fsPath.toLowerCase();
    for (const model of monaco.editor.getModels()) {
      if (model.uri.fsPath.toLowerCase() === target) return model;
    }
  } catch { /* unparseable URI */ }
  return null;
}

function wireDiagnostics() {
  window.lspAPI.onDiagnostics(({ uri, diagnostics }) => {
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
    && LSP_LANGS.includes(model.getLanguageId());
}

const attached = new WeakSet();

function attach(model) {
  if (!model || attached.has(model) || !isLspModel(model)) return;
  attached.add(model);

  const uri = model.uri.toString();
  window.lspAPI.didOpen(uri, model.getValue(), model.getLanguageId());

  let timer = null;
  const changeSub = model.onDidChangeContent(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (model.isDisposed && model.isDisposed()) return;
      window.lspAPI.didChange(model.uri.toString(), model.getValue());
    }, CHANGE_DEBOUNCE_MS);
  });

  const disposeSub = model.onWillDispose(() => {
    clearTimeout(timer);
    changeSub.dispose();
    disposeSub.dispose();
    window.lspAPI.didClose(uri);
  });
}

function wireModelLifecycle() {
  monaco.editor.getModels().forEach(attach);
  monaco.editor.onDidCreateModel(attach);
  // A buffer can be created as plaintext and only later flipped to verilog.
  monaco.editor.onDidChangeModelLanguage(({ model }) => attach(model));
}

// ── language feature providers (editor → server on demand) ────────────────────

function registerProviders() {
  for (const lang of LSP_LANGS) {
    monaco.languages.registerDocumentFormattingEditProvider(lang, {
      async provideDocumentFormattingEdits(model) {
        const edits = await window.lspAPI.format(model.uri.toString());
        if (!Array.isArray(edits)) return [];
        return edits.map((e) => ({ range: lspRangeToMonaco(e.range), text: e.newText }));
      },
    });

    monaco.languages.registerDocumentSymbolProvider(lang, {
      async provideDocumentSymbols(model) {
        const syms = await window.lspAPI.documentSymbols(model.uri.toString());
        if (!Array.isArray(syms)) return [];
        return syms.map(mapSymbol).filter(Boolean);
      },
    });

    monaco.languages.registerHoverProvider(lang, {
      async provideHover(model, position) {
        const hv = await window.lspAPI.hover(model.uri.toString(), monacoPosToLsp(position));
        if (!hv) return null;
        const value = hoverContentsToString(hv.contents);
        if (!value) return null;
        return { contents: [{ value }], range: hv.range ? lspRangeToMonaco(hv.range) : undefined };
      },
    });

    monaco.languages.registerDefinitionProvider(lang, {
      async provideDefinition(model, position) {
        const res = await window.lspAPI.definition(model.uri.toString(), monacoPosToLsp(position));
        return locationsToMonaco(res);
      },
    });

    monaco.languages.registerReferenceProvider(lang, {
      async provideReferences(model, position) {
        const res = await window.lspAPI.references(model.uri.toString(), monacoPosToLsp(position));
        return locationsToMonaco(res);
      },
    });
  }
}
