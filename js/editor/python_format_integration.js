/**
 * python_format_integration.js: liga o black ao Monaco como provedor de
 * formatação de Python (main/format/python_format.js via window.pythonFormatAPI).
 *
 * Espelha o que clang_format_integration.js faz para C, C++ e C±, com uma
 * diferença de propósito: aqui a dependência pode faltar. O clang-format vem
 * empacotado e ou está lá ou o projeto está quebrado; o black mora no
 * interpretador do usuário. Quando falta, um provedor de formatação do Monaco
 * que devolve uma lista vazia não faz nada e não diz nada, e a varinha parece
 * um botão morto. Então avisamos, uma vez por sessão para não virar barulho.
 */

let initialized = false;
/** Já avisamos sobre uma dependência ausente? Evita repetir a cada clique. */
let jaAvisou = false;

function avisar(reason) {
  if (jaAvisou) return;
  jaAvisou = true;
  const msg = reason === 'no-black'
    ? 'Formatar Python precisa do black. Instale com: pip install black'
    : 'Nenhum interpretador Python utilizavel foi encontrado para formatar.';
  try { window.showNotification?.(msg, 'warning'); } catch (_) { /* ignore */ }
}

export function initPythonFormat() {
  if (initialized) return;
  if (typeof window === 'undefined' || !window.pythonFormatAPI) return;
  if (typeof monaco === 'undefined') return;
  initialized = true;

  // Best-effort, como no clang: uma falha de registro nunca pode derrubar o
  // boot do Monaco (isto roda dentro do callback do editor.main).
  try {
    monaco.languages.registerDocumentFormattingEditProvider('python', {
      async provideDocumentFormattingEdits(model) {
        const text = model.getValue();
        const r = await window.pythonFormatAPI.format(text);
        if (!r || !r.ok) {
          if (r && (r.reason === 'no-black' || r.reason === 'no-python')) avisar(r.reason);
          return [];
        }
        if (typeof r.text !== 'string' || r.text === text) return [];
        // Substituição do documento inteiro: o black devolve o buffer
        // formatado, não um diff.
        return [{ range: model.getFullModelRange(), text: r.text }];
      },
    });
  } catch (e) {
    initialized = false;
    console.warn('[python-format] integracao desativada:', e);
  }
}
