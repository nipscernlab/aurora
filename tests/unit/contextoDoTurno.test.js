// O que o painel de IA le a cada turno para o bloco de contexto do projeto
// (js/ai/contexto_do_turno.ts): caminho, .spf, memorias e componentes
// ausentes. Nada disto pode travar um turno, entao o que falha vem vazio.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { lerContextoDoTurno } from '../../js/ai/contexto_do_turno.ts';
import { ProjectStore } from '../../js/project/project_store.js';

beforeEach(() => {
  globalThis.window = globalThis.window || {};
  window.ProjectStore = ProjectStore;
  window.AuroraAPI = { project: { listMemories: vi.fn(async () => ({ ok: true, data: { memories: [{ id: 'm1' }] } })) } };
  window.electronAPI = { componentesListar: vi.fn(async () => ({ componentes: [{ nome: 'verilator', instalado: false }] })) };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  ProjectStore.clearProject();
  vi.restoreAllMocks();
});

describe('contexto do turno', () => {
  it('le o projeto aberto, as memorias e os componentes', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    expect(await lerContextoDoTurno()).toEqual({
      projectPath: 'C:/p',
      spfPath: 'C:/p/p.spf',
      memories: [{ id: 'm1' }],
      componentes: [{ nome: 'verilator', instalado: false }],
    });
  });

  it('o projeto vem do ProjectStore, nao de uma global sobrescrita', async () => {
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    window.currentProjectPath = 'D:/outra-janela';
    window.ProjectStore = { getSpfPath: () => 'D:/outra-janela/x.spf' };
    expect(await lerContextoDoTurno()).toMatchObject({ projectPath: 'C:/p', spfPath: 'C:/p/p.spf' });
  });

  it('sem projeto, sem API ou com resposta vazia, vem vazio', async () => {
    window.AuroraAPI.project.listMemories.mockResolvedValueOnce({ ok: false });
    window.electronAPI.componentesListar.mockResolvedValueOnce(null);
    expect(await lerContextoDoTurno()).toEqual({ projectPath: null, spfPath: null, memories: [], componentes: [] });
    window.AuroraAPI.project.listMemories.mockResolvedValueOnce({ ok: true, data: {} });
    window.electronAPI.componentesListar.mockResolvedValueOnce({});
    expect(await lerContextoDoTurno()).toMatchObject({ spfPath: null, memories: [], componentes: [] });
    delete window.AuroraAPI;
    delete window.electronAPI;
    expect(await lerContextoDoTurno()).toMatchObject({ memories: [], componentes: [] });
  });

  it('memoria ou componente que falha avisa no console e o turno segue', async () => {
    window.AuroraAPI.project.listMemories.mockRejectedValueOnce(new Error('disco'));
    window.electronAPI.componentesListar.mockRejectedValueOnce(new Error('ipc'));
    expect(await lerContextoDoTurno()).toMatchObject({ memories: [], componentes: [] });
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
