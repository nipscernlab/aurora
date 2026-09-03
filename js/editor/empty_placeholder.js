/**
 * empty_placeholder.js: a dica "// New Verilog file" num arquivo vazio.
 *
 * Ate 03/09/2026 a arvore criava o .v novo com esse texto DENTRO do arquivo.
 * Parecia dica e era conteudo: a pessoa tinha de apagar a linha antes de
 * escrever, e quem nao apagava levava um comentario de fabrica para o
 * projeto. Agora o arquivo nasce vazio e a dica e um widget do Monaco, com a
 * regra que o Chrysthofer descreveu: fica enquanto o arquivo esta vazio;
 * some quando a pessoa clica (ou tecla) para editar; volta ao clicar fora,
 * se continuar vazio; e some de vez enquanto houver qualquer texto, voltando
 * se o texto for todo apagado. Em uma frase: aparece se, e so se, vazio e
 * sem gesto de edicao em curso.
 *
 * "Gesto", e nao "foco": a aba nova abre com o editor JA focado por programa,
 * e esconder no foco apagava a dica antes de alguem a ver. So o clique dentro
 * do editor e a tecla contam como querer editar; o desfoque zera o gesto.
 *
 * E um content widget, nao conteudo do modelo: `getValue()` continua vazio,
 * nada fica sujo, nada entra no desfazer, e o salvar grava o que a pessoa
 * escreveu, e so isso.
 */

/** A dica por extensao. So Verilog por ora; a lista existe para crescer. */
const DICAS = [
  [/\.(v|sv|vh|svh)$/i, '// New Verilog file'],
];

/**
 * O texto da dica para um caminho, ou null quando a extensao nao tem dica.
 * @param {string} filePath
 * @returns {string|null}
 */
export function placeholderTextFor(filePath) {
  const p = String(filePath || '');
  for (const [re, texto] of DICAS) if (re.test(p)) return texto;
  return null;
}

/**
 * Liga a dica a um editor do Monaco que mostra `filePath`.
 *
 * O widget so existe enquanto deve aparecer: adicionar e remover e mais
 * barato e mais previsivel do que esconder por CSS, e o Monaco recalcula a
 * posicao sozinho a cada layout. A decisao roda em foco, desfoque, edicao e
 * troca de modelo, que sao os quatro momentos em que a resposta muda.
 *
 * @param {import('monaco-editor').editor.IStandaloneCodeEditor} editor
 * @param {string} filePath
 */
export function installEmptyPlaceholder(editor, filePath) {
  const texto = placeholderTextFor(filePath);
  if (!texto || !editor || typeof editor.addContentWidget !== 'function') return;

  const node = document.createElement('div');
  node.className = 'aurora-empty-placeholder';
  node.textContent = texto;

  const widget = {
    getId: () => 'aurora.emptyPlaceholder',
    getDomNode: () => node,
    getPosition: () => ({
      position: { lineNumber: 1, column: 1 },
      preference: [window.monaco.editor.ContentWidgetPositionPreference.EXACT],
    }),
  };

  let mostrado = false;
  let editando = false;
  const decidir = () => {
    const model = editor.getModel();
    const vazio = !!model && model.getValueLength() === 0;
    const deve = vazio && !editando;
    if (deve === mostrado) return;
    if (deve) editor.addContentWidget(widget);
    else editor.removeContentWidget(widget);
    mostrado = deve;
  };
  const gesto = () => { editando = true; decidir(); };

  editor.onMouseDown(gesto);
  editor.onKeyDown(gesto);
  editor.onDidBlurEditorText(() => { editando = false; decidir(); });
  editor.onDidChangeModelContent(decidir);
  editor.onDidChangeModel(() => { editando = false; decidir(); });
  editor.onDidDispose(() => { mostrado = false; });
  decidir();
}
