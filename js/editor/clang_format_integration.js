// monaco is loaded globally via index.html (AMD vendor build).
/**
 * clang_format_integration.js — registers a Monaco document-formatting
 * provider for C, C++ and CMM, backed by the bundled clang-format
 * (main/format/clang_format.js via window.clangFormatAPI).
 *
 * Shift+Alt+F already dispatches to the provider matching the focused
 * editor's language, so this is all the "detect the language and apply the
 * right formatter" wiring needs: Verilog/SystemVerilog go to Verible
 * (lsp_integration.js), and `c`/`cpp`/`cmm` go here. CMM is formatted with
 * C rules (handled on the main side via -assume-filename).
 *
 * Best-effort: if clang-format isn't installed the call resolves null and
 * the buffer is left untouched — no error surfaces to the user.
 */

const CLANG_LANGS = ['c', 'cpp', 'cmm'];

let initialized = false;

export function initClangFormat() {
  if (initialized) return;
  if (typeof window === 'undefined' || !window.clangFormatAPI) return;
  if (typeof monaco === 'undefined') return;
  initialized = true;

  // Best-effort: a registration failure must never break Monaco boot
  // (this runs inside initMonaco's editor.main callback).
  try {
    for (const lang of CLANG_LANGS) {
      monaco.languages.registerDocumentFormattingEditProvider(lang, {
        async provideDocumentFormattingEdits(model) {
          const text = model.getValue();
          const filePath = model.uri.scheme === 'file' ? model.uri.fsPath : '';
          const formatted = await window.clangFormatAPI.format(model.getLanguageId(), filePath, text);
          if (typeof formatted !== 'string' || formatted === text) return [];
          // Single full-document replace — clang-format returns the whole
          // formatted buffer, not a diff.
          return [{ range: model.getFullModelRange(), text: formatted }];
        },
      });
    }
  } catch (e) {
    initialized = false;
    console.warn('[clang-format] integration disabled:', e);
  }
}
