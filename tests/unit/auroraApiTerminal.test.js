// @vitest-environment happy-dom
//
// O namespace terminal da AuroraAPI, pela API montada: listar os terminais,
// ler o texto deles, limpar e rodar um comando na shell TCMD. Escrito contra
// o aurora_api.js antes de o namespace sair para terminal_ns.ts. Erro sai como
// { ok: false, error: { message, code } } (api_core.ts).

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: {} }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: {} }));
vi.mock('../../js/editor/shared_models.js', () => ({ SharedModelRegistry: {} }));
vi.mock('../../js/processors/processor_config_panel.js', () => ({ processorConfigPanel: {} }));
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI: {} }));
const switchTerminal = vi.fn();
vi.mock('../../js/terminal/terminal.js', () => ({ switchTerminal }));

let API;

beforeAll(async () => {
  const { initAuroraAPI } = await import('../../js/api/aurora_api.js');
  API = initAuroraAPI();
});

/** Dois terminais: o tcmm visivel, com cartoes, e o tasm escondido, so texto. */
function doisTerminais() {
  document.body.innerHTML = `
    <div class="terminal-content" id="tcmm">
      <div class="message"> compilou </div><div class="terminal-card">2 avisos</div><div class="entry">  </div>
    </div>
    <div class="terminal-content hidden" id="tasm">  texto solto  </div>
    <div class="terminal-content"></div>`;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  delete window.globalTerminalManager;
  delete window.shellTerminal;
});

describe('terminal: ler', () => {
  it('list da os ids, e quem nao tem id fica de fora', async () => {
    doisTerminais();
    expect((await API.terminal.list()).data).toEqual(['tcmm', 'tasm']);
  });

  it('getText junta cartoes e mensagens linha a linha, ou usa o texto solto', async () => {
    doisTerminais();
    expect((await API.terminal.getText('tcmm')).data).toBe('compilou\n2 avisos');
    expect((await API.terminal.getText('tasm')).data).toBe('texto solto');
    // Sem id, o terminal visivel; o id tambem vale com o prefixo do wrapper.
    expect((await API.terminal.getText()).data).toBe('compilou\n2 avisos');
    document.body.insertAdjacentHTML('beforeend', '<div id="terminal-twave"><div class="terminal-line">onda</div></div>');
    expect((await API.terminal.getText('twave')).data).toBe('onda');
  });

  it('getText recusa o terminal que nao existe, e a falta de terminal visivel', async () => {
    expect((await API.terminal.getText('tnada')).error.message).toBe('terminal "tnada" not found');
    expect((await API.terminal.getText()).error.message).toBe('no visible terminal');
  });

  it('getAll da o texto de todos, por id', async () => {
    doisTerminais();
    expect((await API.terminal.getAll()).data).toEqual({ tcmm: 'compilou\n2 avisos', tasm: 'texto solto' });
  });
});

describe('terminal: limpar', () => {
  it('sem o gerenciador, ou sem terminal, recusa', async () => {
    expect((await API.terminal.clear('tcmm')).error.message).toBe('terminal manager not initialised');
    window.globalTerminalManager = {};
    expect((await API.terminal.clear()).error.message).toBe('no terminal to clear');
  });

  it('prefere clearTerminal, depois clearTerminalImmediate, depois esvazia o elemento', async () => {
    doisTerminais();
    window.globalTerminalManager = { clearTerminal: vi.fn(async () => {}), clearTerminalImmediate: vi.fn() };
    expect(await API.terminal.clear()).toEqual({ ok: true, data: { id: 'tcmm' } });
    expect(window.globalTerminalManager.clearTerminal).toHaveBeenCalledWith('tcmm');
    expect(window.globalTerminalManager.clearTerminalImmediate).not.toHaveBeenCalled();

    window.globalTerminalManager = { clearTerminalImmediate: vi.fn() };
    expect((await API.terminal.clear('tasm')).data).toEqual({ id: 'tasm' });
    expect(window.globalTerminalManager.clearTerminalImmediate).toHaveBeenCalledWith('tasm');

    window.globalTerminalManager = {};
    expect((await API.terminal.clear('tasm')).ok).toBe(true);
    expect(document.getElementById('tasm').innerHTML).toBe('');
    expect((await API.terminal.clear('tnada')).error.message).toBe('terminal "tnada" not found');
  });

  it('a excecao do gerenciador vira erro', async () => {
    window.globalTerminalManager = { clearTerminal: vi.fn(async () => { throw new Error('travou'); }) };
    expect((await API.terminal.clear('tcmm')).error.message).toBe('travou');
  });
});

describe('terminal: runInShell', () => {
  it('exige o comando e a shell TCMD', async () => {
    expect((await API.terminal.runInShell({ command: '  ' })).error.message).toBe('command is required');
    expect((await API.terminal.runInShell()).error.message).toBe('command is required');
    expect((await API.terminal.runInShell('dir')).error.message).toBe('TCMD shell unavailable');
  });

  it('mostra a aba TCMD, roda e devolve a saida; aceita o comando como texto', async () => {
    const runCommand = vi.fn(async (command, { execute }) => ({ ok: true, command, executed: execute, output: 'ok' }));
    window.shellTerminal = { runCommand };
    expect((await API.terminal.runInShell('dir')).data).toEqual({ command: 'dir', executed: true, complete: true, output: 'ok' });
    expect(switchTerminal).toHaveBeenCalledWith('terminal-tcmd');
    expect(runCommand).toHaveBeenCalledWith('dir', { execute: true });

    // execute:false so poe o comando na linha, e nao ha o que truncar.
    expect((await API.terminal.runInShell({ command: 'ls', execute: false })).data)
      .toEqual({ command: 'ls', executed: false, complete: true, output: 'ok' });
  });

  it('saida cortada vem marcada com a nota, para o modelo nao a tomar por completa', async () => {
    window.shellTerminal = { runCommand: vi.fn(async () => ({ ok: true, command: 'ping', executed: true, complete: false })) };
    const r = (await API.terminal.runInShell('ping')).data;
    expect(r).toMatchObject({ command: 'ping', executed: true, complete: false, output: '' });
    expect(r.note).toMatch(/^output truncated/);
  });

  it('a falha da shell e a excecao viram erro; a troca de aba que falha nao impede', async () => {
    switchTerminal.mockImplementation(() => { throw new Error('sem aba'); });
    window.shellTerminal = { runCommand: vi.fn(async () => ({ ok: false, error: 'negado' })) };
    expect((await API.terminal.runInShell('x')).error.message).toBe('shell command failed: negado');
    window.shellTerminal.runCommand = vi.fn(async () => { throw new Error('caiu'); });
    expect((await API.terminal.runInShell('x')).error.message).toBe('caiu');
    switchTerminal.mockReset();
  });
});
