// @vitest-environment happy-dom
/**
 * O erro do compilador chega mesmo ao painel de problemas?
 *
 * POR QUE ESTE ARQUIVO EXISTE. Ja havia teste do reconhecedor
 * (errorLocations.test.js) e do deposito (problemasDaToolchain.test.js), e os
 * dois passavam, enquanto o painel dizia "The last build reported nothing" em
 * toda compilacao. Os dois testes cobrem as pontas e ninguem cobria o FIO entre
 * elas: a linha de saida do compilador sai do terminal_module, passa pelo
 * reconhecedor e chega ao deposito. E o mesmo tipo de buraco dos botoes que
 * nasciam sem ouvinte: cada peca certa, e nada ligado.
 *
 * O caminho real tem duas entradas e elas nao sao a mesma:
 *   processStreamedLine   , uma linha por vez, e por onde vem a saida do
 *                           compilador enquanto ele roda;
 *   appendToTerminal      , as mensagens que a propria AURORA escreve.
 * Este arquivo exercita a primeira, que e a que carrega o erro.
 *
 * O que se afirma aqui e so isto: mandou a linha, o deposito tem o problema.
 * Nao se testa cor, cartao nem contador, que tem dono proprio.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// A ponte tem de existir ANTES dos imports, e nao no beforeEach.
//
// Importar o terminal_module arrasta o tab_manager, que se INICIALIZA AO
// CARREGAR e pede `onFileChanged` na ponte ali mesmo. Como import e icado para
// o topo, preparo escrito depois chega tarde e o arquivo inteiro falha antes do
// primeiro teste. `vi.hoisted` roda antes dos imports, que e o unico lugar onde
// este preparo serve.
//
// Nao se usa `vi.mock` de proposito: js/app/electron_api.js JA e um Proxy que
// resolve `window.electronAPI` na hora da chamada, entao trocar o global basta
// e o codigo exercitado continua sendo o de verdade.
vi.hoisted(() => {
  globalThis.window = globalThis.window || {};
  globalThis.window.electronAPI = new Proxy({}, { get: () => () => {} });
});

import { TerminalManager } from '../../js/terminal/terminal_module.js';
import { problemStore } from '../../js/terminal/problem_store.js';

const CMM = 'C:/proj/MeuProc/Software/proc.cmm';

function montarDOM() {
  document.body.innerHTML = `
    <div class="terminal-container">
      <div class="terminal-tabs"><div class="terminal-tabs-list"></div></div>
      ${['tcmm', 'tasm', 'tveri', 'twave', 'thtest', 'tprism', 'tcmd']
        .map((id) => `<div id="terminal-${id}"><div class="terminal-body"></div></div>`)
        .join('')}
    </div>`;
}

let tm;

beforeEach(() => {
  montarDOM();
  problemStore.limpar();
  // O `cmmPadrao` sai daqui: o yanc NAO diz o arquivo na mensagem, entao sem
  // isto o problema e descartado por nao ter a quem pertencer.
  window._latestCompilationModule = { lastCompiledCmmPath: CMM };
  tm = new TerminalManager();
  tm.verboseMode = true;
});

describe('a linha do compilador chega ao deposito', () => {
  it('yanc: erro sem arquivo na mensagem cai no .cmm que se mandou compilar', () => {
    tm.processStreamedLine('tcmm', 'Erro na linha 42: cade a funcao main');
    const lista = problemStore.listar();
    expect(lista, 'o painel de problemas so mostra o que esta no deposito').toHaveLength(1);
    expect(lista[0].arquivo).toBe(CMM);
    expect(lista[0].problemas[0].linha).toBe(42);
    expect(lista[0].problemas[0].ferramenta).toBe('yanc');
  });

  it('Icarus: o arquivo vem na propria mensagem', () => {
    tm.processStreamedLine('tveri', 'C:/proj/dirac.v:18: error: Unknown module type: foo');
    const lista = problemStore.listar();
    expect(lista).toHaveLength(1);
    expect(lista[0].arquivo).toBe('C:/proj/dirac.v');
    expect(lista[0].problemas[0].linha).toBe(18);
  });

  it('Verilator: linha e coluna', () => {
    tm.processStreamedLine('tveri', '%Error: C:/proj/Sim/tb.v:23:5: syntax error');
    const p = problemStore.listar()[0].problemas[0];
    expect(p.linha).toBe(23);
    expect(p.coluna).toBe(5);
  });

  it('conta erros e avisos separados, que e o que pinta o botao', () => {
    tm.processStreamedLine('tveri', 'C:/proj/a.v:1: error: primeiro');
    tm.processStreamedLine('tveri', 'C:/proj/a.v:2: warning: segundo');
    expect(problemStore.contagem()).toEqual({ erros: 1, avisos: 1 });
  });

  it('linha sem problema nenhum nao inventa entrada', () => {
    tm.processStreamedLine('tcmm', 'Compilando proc.cmm...');
    expect(problemStore.listar()).toEqual([]);
  });
});

describe('o modo silencioso nao pode engolir o erro', () => {
  it('com verbose DESLIGADO o erro continua chegando ao deposito', () => {
    // O verbose decide o que se VE no terminal. Se ele decidisse tambem o que
    // se REGISTRA, o painel de problemas ficaria vazio para quem trabalha com
    // o terminal limpo, que e o ajuste padrao.
    tm.verboseMode = false;
    tm.processStreamedLine('tcmm', 'Erro na linha 7: ponto e virgula');
    expect(problemStore.listar()).toHaveLength(1);
  });

  it('linha comum com verbose desligado continua sem registrar nada', () => {
    tm.verboseMode = false;
    tm.processStreamedLine('tcmm', 'Lendo diretivas do processador');
    expect(problemStore.listar()).toEqual([]);
  });
});

describe('as mensagens da propria AURORA', () => {
  it('appendToTerminal tambem registra, porque o wrapper repete o erro', () => {
    tm.appendToTerminal('tcmm', 'Erro na linha 3: tipo desconhecido', 'error');
    expect(problemStore.listar()).toHaveLength(1);
  });
});
