/**
 * links_do_terminal.ts: os links que o terminal poe na saida das ferramentas.
 *
 * Tres passos, na ordem em que acontecem:
 *   linhaComLinks  o texto da ferramenta vira HTML: `arquivo:linha` vira link,
 *                  a mensagem de componente ausente ganha "Abrir Componentes", e
 *                  o marcador `[[ajuda:chave]]` vira "Abrir o manual". A mesma
 *                  linha vai para o painel de problemas.
 *   ligarLinks     o clique em cada link, dentro de um bloco ja no DOM.
 *   irParaLinha    leva o editor ativo ate a linha e a coluna.
 *
 * Saiu do terminal_module.js (TODO 13.3), onde eram tres metodos da classe que
 * nao usavam nada dela. O reconhecimento em si, por ferramenta, e do
 * error_locations.ts.
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { comLinks, problemasNaLinha } from './error_locations.js';
import { problemStore } from './problem_store.js';
import { abrirAjudaDe, AJUDAS } from '../ui/help_link.js';

/** O .cmm que a AURORA mandou compilar por ultimo: o yanc diz a linha e nao o arquivo. */
function ultimoCmmCompilado(): string | null {
  return window.compilationManager?.lastCompiledCmmPath
    || window._latestCompilationModule?.lastCompiledCmmPath
    || null;
}

/** O texto traduzido, ou a reserva quando a chave nao subiu. */
function rotulo(chave: string, reserva: string): string {
  return (window.t && window.t(chave) !== chave) ? window.t(chave) : reserva;
}

export function linhaComLinks(text: string): string {

  // Ajuda contextual. Quem escreve a linha marca o capitulo com
  // `[[ajuda:chave]]` no fim, e a chave e resolvida na tabela unica de
  // js/ui/help_link.js. O marcador sai do texto AQUI, antes de qualquer
  // escape ou reconhecimento de link, entao ele nunca chega a tela.
  let chaveDeAjuda: string | null = null;
  text = String(text).replace(/\s*\[\[ajuda:([A-Za-z]+)\]\]\s*$/, (_, k: string) => {
    chaveDeAjuda = k;
    return '';
  });

  // O reconhecimento mora em js/terminal/error_locations.ts, POR
  // FERRAMENTA, porque cada uma imprime de um jeito e as diferencas nao
  // sao cosmeticas: o Icarus nao da coluna, o Verilator da e ainda mistura
  // as barras do caminho, o yanc nao diz o arquivo, e o cocotb usa o
  // formato do Python. Ali tambem estao as duas armadilhas do Windows, a
  // letra de unidade e o espaco no caminho, e os testes usam a saida real
  // das ferramentas.
  //
  // O texto que NAO e link passa a ser escapado aqui, o que antes nao
  // acontecia: a saida ia crua para o innerHTML, e ela vem de arquivo do
  // usuario, que pode ter qualquer coisa no nome.
  // A MESMA linha que vira link vira tambem marcador no editor. O
  // reconhecimento e um so (error_locations.ts); o que muda e o destino.
  // Sem isto o erro existia apenas como texto aqui: quem fechasse o
  // terminal o perdia de vista, e erro em arquivo nao aberto era
  // invisivel do comeco ao fim.
  try {
    problemStore.registrarLinha(text, { cmmPadrao: ultimoCmmCompilado(), problemasNaLinha });
  } catch (e) {
    // Marcador e ganho, nao requisito: se algo aqui falhar, a linha do
    // terminal tem de sair do mesmo jeito.
    console.warn('[problemas] nao consegui registrar a linha:', e);
  }

  let out = comLinks(text, {
    titulo: (loc) => (loc.arquivo
      ? `Abrir ${loc.arquivo}:${loc.linha}${loc.coluna ? ':' + loc.coluna : ''}`
      : `Abrir a linha ${loc.linha}`),
  });

  // Componente ausente: a mensagem sozinha manda a pessoa navegar ate
  // Configuracoes; um clique vale mais que a instrucao. O marcador cobre
  // as duas linguas e as duas formas da frase (a do portao de execucao e
  // a dos erros de toolchain).
  const FALTA_COMPONENTE =
    /não está instalad[ao] nesta máquina|not installed on this machine|Configurações, Componentes|Settings, Components/i;
  if (FALTA_COMPONENTE.test(text)) {
    out += ` <span class="componente-link" role="button" tabindex="0">${rotulo('terminal.openComponents', 'Abrir Componentes')}</span>`;
  }

  // O capitulo do manual, na mesma pilula do "Abrir Componentes": um
  // erro que a documentacao ja explica vale mais com um clique do que
  // com a instrucao de ir procurar.
  if (chaveDeAjuda && AJUDAS[chaveDeAjuda]) {
    out += ` <span class="manual-link" role="button" tabindex="0" data-ajuda="${chaveDeAjuda}">${rotulo('terminal.openManual', 'Abrir o manual')}</span>`;
  }
  return out;
}

/**
 * O caminho do arquivo que um link de linha abre.
 *
 *   - com data-file (`<arquivo>:<linha>:` do iverilog, yosys, gcc): o proprio,
 *     com o relativo resolvido contra a pasta do projeto;
 *   - sem data-file (`linha N` do yanc): o ultimo .cmm compilado, e na falta
 *     dele o `-i` da linha de comando do cmmcomp mais recente do terminal.
 */
async function arquivoDoLink(link: Element, scopeEl: Element): Promise<string | null> {
  const explicitFile = link.getAttribute('data-file');
  if (explicitFile) {
    // Absolute paths go through as-is; relative paths resolve against the
    // open project root.
    const root = window.currentProjectPath || '';
    const isAbs = /^[A-Za-z]:[\\/]/.test(explicitFile) || explicitFile.startsWith('\\\\');
    return isAbs ? explicitFile :
      (root ? `${root}\\${explicitFile.replace(/^[\\/]+/, '')}` : explicitFile);
  }

  // Aurora/yanc "linha N", cmmCompilation caches the .cmm it just ran
  // against. Works regardless of verbose mode because it doesn't touch the DOM.
  const lembrado = ultimoCmmCompilado();
  if (lembrado) return lembrado;

  const terminalContent = scopeEl.closest('.terminal-content');
  if (!terminalContent) return null;
  const logEntries = terminalContent.querySelectorAll('.log-entry');
  for (const entry of Array.from(logEntries).reverse()) {
    const entryText = entry.textContent || '';
    // cmmcomp.exe usa named flags do yanc v4:
    //   ... -i "<file.cmm>" -n "<name>" -p "<projectPath>" -m ... -t ...
    // Precisamos do -i (nome do .cmm) e -p (proc-dir, que e
    // <projectPath>/<processorName>) pra montar o caminho ate o Software/.
    if (/cmmcomp\.exe\b/.test(entryText)) {
      const iMatch = entryText.match(/-i\s+"([^"]+\.cmm)"/);
      const pMatch = entryText.match(/-p\s+"([^"]+)"/);
      if (iMatch && pMatch) return electronAPI.joinPath(pMatch[1], 'Software', iMatch[1]);
    }
  }
  return null;
}

/**
 * Liga os cliques dos links dentro de `scopeEl`: componente ausente abre as
 * Configuracoes, manual abre o capitulo, e o link de linha abre o arquivo e
 * chama `irPara` com a linha e a coluna.
 *
 * Vale para os dois caminhos de saida do terminal (cartao agrupado e entrada
 * avulsa). Quando o clique vivia so no cartao agrupado, a saida em ingles, que
 * caia na entrada avulsa, tinha link que nao fazia nada.
 */
export function ligarLinks(scopeEl: Element | null, irPara: (linha: number, coluna: number) => void): void {
  if (!scopeEl) return;
  // O link de componente ausente abre direto o painel de Componentes.
  scopeEl.querySelectorAll('.componente-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.auroraAbrirConfiguracoes?.('componentes');
    });
  });
  scopeEl.querySelectorAll('.manual-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      abrirAjudaDe(link.getAttribute('data-ajuda') as string);
    });
  });
  scopeEl.querySelectorAll('.line-link').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const lineNumber = parseInt(link.getAttribute('data-line') as string);
      // A coluna so existe onde a ferramenta a imprime (Verilator, slang,
      // gcc). Sem ela o cursor pousa no comeco da linha.
      const columnNumber = parseInt(link.getAttribute('data-col') as string) || 1;
      const explicitFile = link.getAttribute('data-file');
      console.log(`Clicked on line ${lineNumber}${explicitFile ? ` (file: ${explicitFile})` : ''}`);

      try {
        const filePath = await arquivoDoLink(link, scopeEl);
        if (!filePath) {
          console.log('Could not determine file path for line link');
          return;
        }

        const fileExists = await electronAPI.fileExists(filePath);
        if (!fileExists) {
          console.log(`File does not exist: ${filePath}`);
          return;
        }

        const isFileOpen = (TabManager.tabs as Map<string, unknown>).has(filePath);
        if (!isFileOpen) {
          const content = await electronAPI.readFile(filePath, { encoding: 'utf8' });
          TabManager.addTab(filePath, content);
        } else {
          TabManager.activateTab(filePath);
        }

        setTimeout(() => irPara(lineNumber, columnNumber), 100);
      } catch (error) {
        console.error('Error opening file and navigating to line:', error);
      }
    });
  });
}

/**
 * Leva o editor ativo ate a linha, e ate a coluna quando a ferramenta
 * disse qual e.
 *
 * A selecao continua sendo a LINHA inteira, mesmo com coluna: quem clicou
 * num erro quer ver o trecho, e destacar um caractere so deixa a origem do
 * erro tao dificil de achar quanto estava no terminal. A coluna vai para o
 * CURSOR, que e onde ela ajuda, porque e dali que a edicao comeca.
 */
export function irParaLinha(lineNumber: number, columnNumber = 1): void {
  const activeEditor = EditorManager.activeEditor;
  if (!activeEditor) {
    console.warn('No active editor found');
    return;
  }

  const model = activeEditor.getModel();
  if (!model) {
    console.warn('No model found in active editor');
    return;
  }

  const totalLines = model.getLineCount();
  const targetLine = Math.max(1, Math.min(lineNumber, totalLines));
  // A coluna vem de outra ferramenta e pode passar do fim da linha (uma
  // aba conta como um caractere para o compilador e como varios para o
  // editor); o Monaco reclama de posicao invalida em vez de corrigir.
  const maxColumn = model.getLineMaxColumn(targetLine);
  const targetColumn = Math.max(1, Math.min(columnNumber || 1, maxColumn));

  activeEditor.setPosition({ lineNumber: targetLine, column: targetColumn });
  activeEditor.revealLineInCenter(targetLine);
  activeEditor.focus();
  activeEditor.setSelection({
    startLineNumber: targetLine,
    startColumn: 1,
    endLineNumber: targetLine,
    endColumn: maxColumn,
  });
}
