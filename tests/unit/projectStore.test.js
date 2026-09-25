// O ProjectStore (js/project/project_store): estado do projeto aberto, aviso a
// quem assina e o espelho em window que as leituras antigas ainda usam.

import { describe, expect, it, vi, beforeEach } from 'vitest';

let ProjectStore;

beforeEach(async () => {
  vi.resetModules();
  globalThis.window = {};
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
});

describe('ProjectStore', () => {
  it('comeca sem projeto e se expoe em window.ProjectStore', () => {
    expect(ProjectStore.getProjectPath()).toBeNull();
    expect(ProjectStore.getSpfPath()).toBeNull();
    expect(ProjectStore.hasProject()).toBe(false);
    expect(window.ProjectStore).toBe(ProjectStore);
  });

  it('setProject guarda, espelha em window e avisa quem assina', () => {
    const fn = vi.fn();
    ProjectStore.subscribe(fn);
    ProjectStore.setProject('C:/p/p.spf', 'C:/p');
    expect(ProjectStore.getProjectPath()).toBe('C:/p');
    expect(ProjectStore.getSpfPath()).toBe('C:/p/p.spf');
    expect(ProjectStore.hasProject()).toBe(true);
    expect(window.currentProjectPath).toBe('C:/p');
    expect(window.currentSpfPath).toBe('C:/p/p.spf');
    expect(fn).toHaveBeenCalledWith({ projectPath: 'C:/p', spfPath: 'C:/p/p.spf' });
  });

  it('setProject com os mesmos valores nao avisa de novo', () => {
    ProjectStore.setProject('a.spf', 'a');
    const fn = vi.fn();
    ProjectStore.subscribe(fn);
    ProjectStore.setProject('a.spf', 'a');
    expect(fn).not.toHaveBeenCalled();
  });

  it('valor vazio vira null', () => {
    ProjectStore.setProject('', '');
    expect(ProjectStore.getProjectPath()).toBeNull();
    expect(ProjectStore.getSpfPath()).toBeNull();
  });

  it('clearProject limpa, espelha e avisa; sem projeto nao avisa', () => {
    ProjectStore.setProject('a.spf', 'a');
    const fn = vi.fn();
    ProjectStore.subscribe(fn);
    ProjectStore.clearProject();
    expect(window.currentProjectPath).toBeNull();
    expect(window.currentSpfPath).toBeNull();
    expect(fn).toHaveBeenCalledWith({ projectPath: null, spfPath: null });
    ProjectStore.clearProject();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('o retorno do subscribe desassina', () => {
    const fn = vi.fn();
    const sair = ProjectStore.subscribe(fn);
    sair();
    ProjectStore.setProject('a.spf', 'a');
    expect(fn).not.toHaveBeenCalled();
  });

  it('um assinante que lanca nao impede os outros', () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const depois = vi.fn();
    ProjectStore.subscribe(() => { throw new Error('x'); });
    ProjectStore.subscribe(depois);
    ProjectStore.setProject('a.spf', 'a');
    expect(depois).toHaveBeenCalled();
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});
