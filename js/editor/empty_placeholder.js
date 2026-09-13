/**
 * empty_placeholder.js: a dica "// New Verilog file" num arquivo vazio.
 *
 * Vale para QUALQUER arquivo, nao so os de Verilog: a regra e "arquivo vazio
 * mostra a dica", sem lista de convidados. O que muda por linguagem e a forma,
 * porque a dica imita um comentario e o marcador precisa ser o da linguagem.
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

/**
 * A dica de cada linguagem: como se abre um comentario nela, como se fecha (se
 * precisar) e o nome que aparece no meio.
 *
 * O marcador tem de ser o da linguagem. A dica imita um comentario, e escrever
 * `//` num arquivo Python ensinaria a sintaxe errada de graca, justamente para
 * quem ainda esta aprendendo a linguagem. Onde nao ha comentario de linha, usa
 * o de bloco; onde nao ha comentario nenhum (JSON), a dica vai sem marcador,
 * porque um JSON com `//` nao e um JSON valido nem de mentira.
 */
const POR_LINGUAGEM = new Map([
  ['verilog', ['//', '', 'Verilog']],
  ['systemverilog', ['//', '', 'SystemVerilog']],
  ['cmm', ['//', '', 'C\u00b1']],
  ['c', ['//', '', 'C']],
  ['cpp', ['//', '', 'C++']],
  ['javascript', ['//', '', 'JavaScript']],
  ['typescript', ['//', '', 'TypeScript']],
  ['asm', [';', '', 'Assembly']],
  ['python', ['#', '', 'Python']],
  ['matlab', ['%', '', 'MATLAB']],
  ['css', ['/*', ' */', 'CSS']],
  ['html', ['<!--', ' -->', 'HTML']],
  ['markdown', ['<!--', ' -->', 'Markdown']],
  ['json', ['', '', 'JSON']],
  ['plaintext', ['', '', '']],
]);

/** A extensao vira linguagem do mesmo jeito que em EditorManager.getLanguageFromPath. */
const POR_EXTENSAO = new Map([
  ['v', 'verilog'], ['vh', 'verilog'],
  ['sv', 'systemverilog'], ['svh', 'systemverilog'],
  ['cmm', 'cmm'], ['asm', 'asm'],
  ['c', 'c'], ['h', 'c'],
  ['cpp', 'cpp'], ['cc', 'cpp'], ['cxx', 'cpp'], ['hpp', 'cpp'], ['hh', 'cpp'], ['hxx', 'cpp'],
  ['js', 'javascript'], ['jsx', 'javascript'],
  ['ts', 'typescript'], ['tsx', 'typescript'],
  ['py', 'python'], ['m', 'matlab'],
  ['css', 'css'], ['html', 'html'], ['md', 'markdown'],
  ['json', 'json'], ['spf', 'json'],
]);

/**
 * O texto da dica para um caminho.
 *
 * Todo arquivo tem dica, inclusive os de extensao desconhecida: a regra que o
 * Chrysthofer pediu e "arquivo vazio mostra a dica", sem lista de convidados.
 * O que muda por linguagem e a forma, nao a existencia.
 *
 * Pode receber a linguagem ja resolvida (o modelo do Monaco sabe melhor do que
 * a extensao, porque um documento sem titulo troca de linguagem enquanto a
 * pessoa escreve). Sem ela, cai na extensao.
 *
 * @param {string} filePath
 * @param {string} [languageId]
 * @returns {string}
 */
export function placeholderTextFor(filePath, languageId) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  const lang = languageId || POR_EXTENSAO.get(ext) || 'plaintext';
  const [abre, fecha, nome] = POR_LINGUAGEM.get(lang) || POR_LINGUAGEM.get('plaintext');
  const miolo = nome ? `New ${nome} file` : 'Empty file';
  return abre ? `${abre} ${miolo}${fecha}` : miolo;
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
  if (!editor || typeof editor.addContentWidget !== 'function') return;

  const node = document.createElement('div');
  node.className = 'aurora-empty-placeholder';

  // A linguagem do MODELO manda quando existe: um documento sem titulo comeca
  // como texto puro e vira C+- assim que a pessoa digita o gatilho, e a dica
  // tem de acompanhar em vez de ficar presa a extensao do nome provisorio.
  const escrever = () => {
    const model = editor.getModel();
    const lang = model && typeof model.getLanguageId === 'function' ? model.getLanguageId() : null;
    node.textContent = placeholderTextFor(filePath, lang);
  };
  escrever();

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
    if (deve) escrever();
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
