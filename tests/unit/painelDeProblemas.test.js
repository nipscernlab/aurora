// @vitest-environment happy-dom
/**
 * O painel de problemas: js/terminal/problems_panel.js.
 *
 * O marcador no editor resolve metade: mostra o erro DENTRO do arquivo. A
 * outra metade e saber que ele existe sem ter o arquivo aberto, e quantos ha
 * ao todo. Num projeto com uma duzia de arquivos Verilog, rolar o terminal
 * atras da primeira linha vermelha era o que restava.
 *
 * O CONTADOR NA BARRA e a parte que mais muda o dia, e por isso ele tem teste
 * proprio: responde "compilou?" sem abrir nada e sem rolar nada. E uma
 * pergunta que se faz dezenas de vezes por aula.
 *
 * Duas decisoes que os testes fixam, porque sao as que alguem mexeria por
 * engano achando que melhora:
 *
 *   - o botao NAO some quando esta zerado, so muda de cor e perde o numero.
 *     Botao que aparece e desaparece muda o lugar dos vizinhos e faz a pessoa
 *     procurar o que estava ali;
 *   - a lista NAO reordena por gravidade. A ordem e a da toolchain, e o
 *     primeiro erro costuma ser a causa dos outros. Poe-lo no alto vale mais
 *     do que por o mais grave.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { problemasNaLinha } from '../../js/terminal/error_locations.js';
// Sem sufixo de cache nos dois: o painel importa o deposito pelo caminho
// canonico, e um `?r=` aqui criaria uma SEGUNDA instancia. O teste escreveria
// numa e o painel leria a outra, passando a impressao de que nada funciona.
// Como o deposito e singleton, cada teste comeca chamando `limpar()`.
import { problemStore } from '../../js/terminal/problem_store.js';
import { initProblemsPanel, abrir } from '../../js/terminal/problems_panel.js';

const CMM = 'C:/proj/MeuProc/Software/proc.cmm';

let abertos;

function montarMonaco() {
  globalThis.monaco = {
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
      getModels: () => [],
      onDidCreateModel: () => {},
      setModelMarkers: () => {},
    },
  };
}

/** A marcacao minima que o painel espera encontrar no index.html. */
function montarDom() {
  document.body.innerHTML = `
    <button id="problems-panel" class="toolbar-button icon-only"><i class="ph"></i></button>
    <div id="problemsModal"><div id="problems-list"></div></div>
  `;
}

const registrar = (loja, texto) => loja.registrarLinha(texto, { cmmPadrao: CMM, problemasNaLinha });
const botao = () => document.getElementById('problems-panel');
const lista = () => document.getElementById('problems-list');

beforeEach(() => {
  abertos = [];
  montarMonaco();
  montarDom();
  problemStore.limpar();
  initProblemsPanel();
  globalThis.window.electronAPI = { readFile: async () => 'module x; endmodule' };
  globalThis.window.TabManager = {
    addTab: (caminho, _conteudo, opcoes) => abertos.push({ caminho, opcoes }),
  };
  globalThis.window.t = null;
});

describe('painel: o contador na barra', () => {
  it('nasce apagado e sem numero quando nao ha nada', async () => {
    /* montado no beforeEach */;

    expect(botao().classList.contains('tem-erro')).toBe(false);
    expect(botao().classList.contains('tem-aviso')).toBe(false);
    expect(botao().querySelector('.problems-count').hidden).toBe(true);
  });

  it('acende em erro e mostra o total', async () => {
    const loja = problemStore;

    registrar(loja, 'C:/proj/Hardware/top.v:5: error: um');
    registrar(loja, '%Warning-WIDTH: C:/proj/Sim/tb.v:9:14: outro');

    expect(botao().classList.contains('tem-erro')).toBe(true);
    expect(botao().querySelector('.problems-count').textContent).toBe('2');
  });

  it('so aviso acende amarelo, e nao vermelho', async () => {
    const loja = problemStore;

    registrar(loja, '%Warning-WIDTH: C:/proj/Sim/tb.v:9:14: so um aviso');

    expect(botao().classList.contains('tem-erro')).toBe(false);
    expect(botao().classList.contains('tem-aviso')).toBe(true);
  });

  it('NAO some da barra quando zera, so apaga', async () => {
    const loja = problemStore;
    registrar(loja, 'C:/proj/Hardware/top.v:5: error: um');

    loja.limpar();

    // O botao continua ali: sumir mudaria o lugar dos vizinhos.
    expect(document.getElementById('problems-panel')).toBeTruthy();
    expect(botao().classList.contains('tem-erro')).toBe(false);
    expect(botao().querySelector('.problems-count').hidden).toBe(true);
  });

  it('diz no tooltip quantos sao de cada tipo', async () => {
    const loja = problemStore;
    registrar(loja, 'C:/proj/Hardware/top.v:5: error: um');
    registrar(loja, '%Warning-WIDTH: C:/proj/Sim/tb.v:9:14: outro');

    // Um erro e um aviso. O rotulo evita plural de proposito ("Erros: 1"), que
    // e o que dispensa regra de plural em duas linguas para um tooltip.
    const dica = botao().getAttribute('data-tooltip');
    expect(dica).toMatch(/1/);
    expect(dica).not.toMatch(/1 erros|1 errors/i);
  });
});

describe('painel: a lista', () => {
  it('diz que passou quando nao ha nada', async () => {
    const painel = { abrir };
    painel.abrir();

    expect(lista().querySelector('.problems-empty')).toBeTruthy();
    expect(lista().querySelectorAll('.problems-row')).toHaveLength(0);
  });

  it('agrupa por arquivo e mostra linha, mensagem e ferramenta', async () => {
    const loja = problemStore;
    const painel = { abrir };
    registrar(loja, 'C:/proj/Hardware/top.v:5: error: Invalid module item.');
    registrar(loja, '%Error: C:/proj/Sim/tb.v:9:14: syntax error');
    painel.abrir();

    expect(lista().querySelectorAll('.problems-file')).toHaveLength(2);
    const linhas = lista().querySelectorAll('.problems-row');
    expect(linhas).toHaveLength(2);
    expect(linhas[0].querySelector('.problems-line').textContent).toBe('5');
    expect(linhas[0].querySelector('.problems-msg').textContent).toBe('Invalid module item.');
    expect(linhas[0].querySelector('.problems-tool').textContent).toBe('icarus');
    // Com coluna, mostra linha:coluna.
    expect(linhas[1].querySelector('.problems-line').textContent).toBe('9:14');
  });

  it('mostra o nome do arquivo, com o caminho inteiro no title', async () => {
    const loja = problemStore;
    const painel = { abrir };
    registrar(loja, 'C:/proj/Hardware/top.v:5: error: x');
    painel.abrir();

    const cab = lista().querySelector('.problems-file-path');
    expect(cab.textContent).toBe('top.v');
    expect(cab.getAttribute('title')).toBe('C:/proj/Hardware/top.v');
  });

  it('NAO reordena por gravidade: a ordem e a da toolchain', async () => {
    const loja = problemStore;
    const painel = { abrir };
    // O aviso vem primeiro na saida; ele fica primeiro na lista.
    registrar(loja, '%Warning-WIDTH: C:/proj/Sim/tb.v:2:1: primeiro, um aviso');
    registrar(loja, '%Error: C:/proj/Sim/tb.v:9:14: depois, um erro');
    painel.abrir();

    const linhas = lista().querySelectorAll('.problems-row');
    expect(linhas[0].classList.contains('aviso')).toBe(true);
    expect(linhas[1].classList.contains('erro')).toBe(true);
  });

  it('escapa o que veio da ferramenta, que le arquivo do usuario', async () => {
    const loja = problemStore;
    const painel = { abrir };
    registrar(loja, 'C:/proj/Hardware/top.v:5: error: <script>alert(1)</script>');
    painel.abrir();

    expect(lista().querySelector('script')).toBeNull();
    expect(lista().querySelector('.problems-msg').textContent).toContain('<script>');
  });
});

describe('painel: clicar leva ao lugar', () => {
  it('abre o arquivo na linha e na coluna do problema', async () => {
    const loja = problemStore;
    const painel = { abrir };
    registrar(loja, '%Error: C:/proj/Sim/tb.v:9:14: syntax error');
    painel.abrir();

    lista().querySelector('.problems-row').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(abertos).toHaveLength(1);
    expect(abertos[0].caminho).toBe('C:/proj/Sim/tb.v');
    expect(abertos[0].opcoes.revealPosition).toEqual({ line: 9, column: 14 });
  });

  it('sem coluna, abre na coluna 1', async () => {
    const loja = problemStore;
    const painel = { abrir };
    registrar(loja, 'C:/proj/Hardware/top.v:5: error: x');
    painel.abrir();

    lista().querySelector('.problems-row').click();
    await new Promise((r) => setTimeout(r, 0));

    expect(abertos[0].opcoes.revealPosition).toEqual({ line: 5, column: 1 });
  });

  it('a lista se redesenha enquanto o painel esta aberto', async () => {
    const loja = problemStore;
    const painel = { abrir };
    painel.abrir();
    expect(lista().querySelectorAll('.problems-row')).toHaveLength(0);

    registrar(loja, 'C:/proj/Hardware/top.v:5: error: chegou agora');

    expect(lista().querySelectorAll('.problems-row')).toHaveLength(1);
  });
});
