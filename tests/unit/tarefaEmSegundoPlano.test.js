// @vitest-environment happy-dom
//
// Caracterizacao da tarefa em segundo plano do painel de IA: o aurora_api
// chama `runInBackground`, a compilacao corre solta, o turno atual termina, e
// quando ela acaba a assistente continua sozinha com o resultado. Escrito
// antes de a tarefa sair do ai_assistant_manager (TODO 13.3) e rodado no `.js`
// antigo.
//
// O que se observa e o que a pessoa e o modelo veem: o chip de estado na tela
// e o turno autonomo que chega ao `startChat` (texto, rotulo e operacao).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { addTab: vi.fn(), tabs: new Map() } }));
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: { readFile: vi.fn(async () => ''), fileExists: vi.fn(async () => false) },
}));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';
import { ProjectStore } from '../../js/project/project_store.js';

const AIAssistantManager = aiAssistantManager.constructor;

let api;
let painel;
let compile;

function makeAiAPI() {
  const a = {
    chamadas: [],
    emitir: null,
    listProviders: vi.fn(async () => ({ providers: [{ name: 'anthropic', model: 'x' }] })),
    getKeyStatus: vi.fn(async () => ({ configured: { anthropic: true } })),
    newConversationId: vi.fn(async () => ({ id: 'c-1' })),
    onChatEvent: vi.fn((cb) => { a.emitir = cb; return () => {}; }),
    startChat: vi.fn(async (p) => { a.chamadas.push(p); return { ok: true }; }),
    abortChat: vi.fn(async () => ({ ok: true })),
    saveConversation: vi.fn(async () => ({ ok: true })),
    listConversations: vi.fn(async () => ({ chats: [] })),
  };
  return a;
}

/** Um adiado: a compilacao que o teste termina quando quer. */
function adiado() {
  let resolve; let reject;
  const promessa = new Promise((r, j) => { resolve = r; reject = j; });
  return { promessa, resolve, reject };
}

async function assentar() { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); }

/** Painel com uma conversa aberta e o turno dela ja encerrado. */
async function painelComConversa() {
  document.body.innerHTML = '<div class="main-container"></div>';
  painel = new AIAssistantManager();
  painel.initialize();
  await painel.refreshProviders();
  painel.inputEl.value = 'compila em segundo plano';
  await painel.send();
  const sid = api.chamadas[0].sessionId;
  api.emitir({ sessionId: sid, type: 'text-delta', delta: 'Vou compilar.' });
  api.emitir({ sessionId: sid, type: 'finish' });
  return painel;
}

const chip = (id) => painel.messagesEl.querySelector(`.ai-bgtask[data-task-id="${id}"]`);
const ultimoTurno = () => api.chamadas.at(-1);
const textoDoTurno = () => ultimoTurno().messages.at(-1).content;

beforeEach(() => {
  api = makeAiAPI();
  window.aiAPI = api;
  compile = {
    tarefa: adiado(),
    compileAll: vi.fn(() => compile.tarefa.promessa),
    compileStep: vi.fn(() => compile.tarefa.promessa),
    runStatus: vi.fn(async () => ({ ok: true, data: { cancelled: false } })),
  };
  window.AuroraAPI = {
    compile,
    terminal: { getAll: vi.fn(async () => ({ ok: true, data: { tcmm: 'compilou' } })) },
    project: { listMemories: vi.fn(async () => ({ ok: true, data: { memories: [] } })) },
  };
  window.electronAPI = { componentesListar: vi.fn(async () => ({ componentes: [] })) };
  ProjectStore.setProject('C:/proj/proj.spf', 'C:/proj');
  localStorage.clear();
});

afterEach(() => {
  ProjectStore.clearProject();
  painel?._disarmStreamWatchdog?.();
  document.body.innerHTML = '';
});

describe('comecar', () => {
  it('devolve na hora, com o id da tarefa, e mostra o chip girando', async () => {
    await painelComConversa();
    const r = painel.runInBackground({ task: 'compile_all' });
    expect(r).toEqual({ ok: true, data: { taskId: expect.stringMatching(/^bg-[0-9a-z]+$/), status: 'started', task: 'compile all' } });
    expect(compile.compileAll).toHaveBeenCalledTimes(1);
    const el = chip(r.data.taskId);
    expect(el.className).toBe('ai-bgtask running');
    expect(el.querySelector('.ai-bgtask-icon').className).toBe('ph ai-bgtask-icon ph-circle-notch ai-tool-spin');
    expect(el.querySelector('.ai-bgtask-text').textContent).toBe('Running compile all in the background…');
  });

  it('compile_step passa o passo; sem passo, tarefa desconhecida ou sem a API, recusa com o motivo', async () => {
    await painelComConversa();
    expect(painel.runInBackground({ task: 'compile_step', step: 'cmm' }).data.task).toBe('compile cmm');
    expect(compile.compileStep).toHaveBeenCalledWith('cmm');
    expect(painel.runInBackground({ task: 'compile_step' })).toEqual({ ok: false, error: 'compile_step requires a step' });
    expect(painel.runInBackground({ task: 'apagar_tudo' })).toEqual({ ok: false, error: 'unknown background task: apagar_tudo' });
    expect(painel.runInBackground()).toEqual({ ok: false, error: 'unknown background task: undefined' });
    window.AuroraAPI = {};
    expect(painel.runInBackground({ task: 'compile_all' })).toEqual({ ok: false, error: 'AuroraAPI.compile unavailable' });
    window.AuroraAPI = undefined;
    expect(painel.runInBackground({ task: 'compile_all' })).toEqual({ ok: false, error: 'AuroraAPI.compile unavailable' });
  });
});

describe('quando a tarefa termina', () => {
  it('passou: o chip vira concluido e a assistente continua com a saida dos terminais', async () => {
    await painelComConversa();
    const { data } = painel.runInBackground({ task: 'compile_all', note: 'ver se o filtro compila' });
    compile.tarefa.resolve({ ok: true });
    await assentar();
    expect(chip(data.taskId).className).toBe('ai-bgtask done');
    expect(chip(data.taskId).querySelector('.ai-bgtask-icon').className).toBe('ph ai-bgtask-icon ph-check-circle');
    expect(chip(data.taskId).textContent).toBe('compile all finished');
    expect(textoDoTurno()).toBe(
      `[AUTONOMOUS BACKGROUND TASK] "compile all" (${data.taskId}) completed.\n\n`
      + 'Original intent: ver se o filtro compila\n\n'
      + 'Relevant terminal output (truncated):\n{"tcmm":"compilou"}\n\n'
      + 'Summarise the outcome for the user concisely, and decide whether any follow-up action is warranted.',
    );
    expect(ultimoTurno().operacao).toBe('posCompilacaoOk');
    expect(painel.messagesEl.querySelector('.ai-auto-note').textContent).toBe('Background task: compile all finished');
  });

  it('falhou: o chip vira falha, o motivo vai junto, e a operacao e a de falha', async () => {
    await painelComConversa();
    const { data } = painel.runInBackground({ task: 'compile_step', step: 'asm' });
    compile.tarefa.resolve({ ok: false, error: { message: 'erro na linha 3' } });
    await assentar();
    expect(chip(data.taskId).className).toBe('ai-bgtask failed');
    expect(chip(data.taskId).querySelector('.ai-bgtask-icon').className).toBe('ph ai-bgtask-icon ph-x-circle');
    expect(chip(data.taskId).textContent).toBe('compile asm failed');
    expect(textoDoTurno()).toContain(`"compile asm" (${data.taskId}) failed: erro na linha 3.`);
    expect(textoDoTurno()).not.toContain('Original intent');
    expect(ultimoTurno().operacao).toBe('posCompilacaoFalha');
  });

  it('falhou sem mensagem: o motivo sai do envelope; terminais que nao respondem viram "(none captured)"', async () => {
    await painelComConversa();
    window.AuroraAPI.terminal.getAll.mockRejectedValue(new Error('sem terminal'));
    painel.runInBackground({ task: 'compile_all' });
    compile.tarefa.resolve({ ok: false, erro: 'disco cheio' });
    await assentar();
    expect(textoDoTurno()).toMatch(/failed: .+\./);
    expect(textoDoTurno()).toContain('Relevant terminal output (truncated):\n(none captured)');

    // terminais que respondem sem dados tambem
    window.AuroraAPI.terminal.getAll.mockResolvedValue({ ok: false });
    compile.tarefa = adiado();
    api.emitir({ sessionId: ultimoTurno().sessionId, type: 'text-delta', delta: 'Resumo.' });
    api.emitir({ sessionId: ultimoTurno().sessionId, type: 'finish' });
    painel.runInBackground({ task: 'compile_all' });
    compile.tarefa.resolve(undefined);
    await assentar();
    expect(textoDoTurno()).toContain('completed.');
    expect(textoDoTurno()).toContain('(none captured)');
  });

  it('cancelada: nao e "terminou"; o chip diz cancelado e a assistente nao tenta de novo', async () => {
    await painelComConversa();
    compile.runStatus.mockResolvedValue({ ok: true, data: { cancelled: true } });
    const { data } = painel.runInBackground({ task: 'compile_all' });
    compile.tarefa.resolve({ ok: true });
    await assentar();
    expect(chip(data.taskId).className).toBe('ai-bgtask failed');
    expect(chip(data.taskId).textContent).toBe('compile all cancelled');
    expect(textoDoTurno()).toBe(
      `[AUTONOMOUS BACKGROUND TASK] "compile all" (${data.taskId}) was CANCELLED by the user `
      + 'before it finished. Nothing ran to completion, so there is no result to report. '
      + 'Do not retry on your own: acknowledge briefly and ask what they want to do next.',
    );
    expect(ultimoTurno().operacao).toBeUndefined();
    expect(window.AuroraAPI.terminal.getAll).not.toHaveBeenCalled();
  });

  it('a consulta do estado que falha conta como nao cancelada', async () => {
    await painelComConversa();
    compile.runStatus.mockRejectedValue(new Error('sem resposta'));
    const { data } = painel.runInBackground({ task: 'compile_all' });
    compile.tarefa.resolve({ ok: true });
    await assentar();
    expect(chip(data.taskId).textContent).toBe('compile all finished');
  });

  it('a compilacao que lanca: o chip diz erro e a assistente relata', async () => {
    await painelComConversa();
    const { data } = painel.runInBackground({ task: 'compile_all' });
    compile.tarefa.reject(new Error('processo morreu'));
    await assentar();
    expect(chip(data.taskId).className).toBe('ai-bgtask failed');
    expect(chip(data.taskId).textContent).toBe('compile all errored');
    expect(textoDoTurno()).toBe(`[AUTONOMOUS BACKGROUND TASK] "compile all" (${data.taskId}) threw: processo morreu. Report this to the user.`);
  });

  it('trocou de conversa no meio: o resultado nao entra na conversa nova', async () => {
    await painelComConversa();
    const turnos = api.chamadas.length;
    painel.runInBackground({ task: 'compile_all' });
    painel.currentChatId = 'outra';
    compile.tarefa.resolve({ ok: true });
    await assentar();
    expect(api.chamadas.length).toBe(turnos);

    compile.tarefa = adiado();
    painel.currentChatId = 'c-1';
    painel.runInBackground({ task: 'compile_all' });
    painel.currentChatId = 'outra';
    compile.tarefa.reject(new Error('x'));
    await assentar();
    expect(api.chamadas.length).toBe(turnos);
  });
});
