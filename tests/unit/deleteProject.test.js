// @vitest-environment happy-dom
//
// Excluir o projeto aberto (js/project/delete_project): confirmar com a
// contagem, fechar pelo fluxo do botao de fechar, mandar a pasta para a
// Lixeira, tirar dos recentes.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const electronAPI = { trashProject: vi.fn(async () => ({ success: true })) };
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const showDialog = vi.fn(async () => 'trash');
vi.mock('../../js/ui/dialog_manager.js', () => ({ showDialog }));
const showCardNotification = vi.fn();
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification }));
const fecharProjetoAberto = vi.fn(async () => true);
vi.mock('../../js/project/close_project.js', () => ({ fecharProjetoAberto }));

let m;
let ProjectStore;

beforeAll(async () => {
  document.body.innerHTML = '<button id="delete-project"></button>';
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  m = await import('../../js/project/delete_project.js');
});

beforeEach(() => {
  vi.clearAllMocks();
  showDialog.mockResolvedValue('trash');
  electronAPI.trashProject.mockResolvedValue({ success: true });
  fecharProjetoAberto.mockResolvedValue(true);
  window.recentProjectsManager = { removeProject: vi.fn() };
  ProjectStore.setProject('C:\\p\\<Proj>\\p.spf', 'C:\\p\\<Proj>');
});

describe('excluirProjetoAberto', () => {
  it('confirma com contagem, fecha, manda para a Lixeira e tira dos recentes', async () => {
    expect(await m.excluirProjetoAberto()).toBe(true);
    const dialogo = showDialog.mock.calls[0][0];
    expect(dialogo.buttons[1]).toMatchObject({ action: 'trash', type: 'danger', countdown: m.SEGUNDOS_DE_ESPERA });
    expect(fecharProjetoAberto).toHaveBeenCalled();
    expect(electronAPI.trashProject).toHaveBeenCalledWith('C:\\p\\<Proj>\\p.spf');
    expect(window.recentProjectsManager.removeProject).toHaveBeenCalledWith('C:\\p\\<Proj>\\p.spf');
    expect(showCardNotification).toHaveBeenLastCalledWith(expect.any(String), 'success', 6000);
  });

  it('o caminho vai escapado para o dialogo e para o aviso', async () => {
    window.t = (k, p) => (p?.path !== undefined ? `${k}|${p.path}` : k);
    await m.excluirProjetoAberto();
    expect(showDialog.mock.calls[0][0].message).toBe('dialog.deleteProject.message|C:\\p\\&lt;Proj&gt;');
    expect(showCardNotification.mock.calls.at(-1)[0]).toBe('notification.project.trashed|C:\\p\\&lt;Proj&gt;');
    delete window.t;
  });

  it('sem projeto aberto, so avisa', async () => {
    ProjectStore.clearProject();
    expect(await m.excluirProjetoAberto()).toBe(false);
    expect(showDialog).not.toHaveBeenCalled();
    expect(showCardNotification).toHaveBeenCalledWith('notification.project.noneToDelete', 'info', 3000);
  });

  it('desistir no dialogo nao fecha nem apaga', async () => {
    showDialog.mockResolvedValueOnce('cancel');
    expect(await m.excluirProjetoAberto()).toBe(false);
    expect(fecharProjetoAberto).not.toHaveBeenCalled();
  });

  it('se nao conseguiu fechar, nao manda para a Lixeira', async () => {
    fecharProjetoAberto.mockResolvedValueOnce(false);
    expect(await m.excluirProjetoAberto()).toBe(false);
    expect(electronAPI.trashProject).not.toHaveBeenCalled();
    expect(showCardNotification).toHaveBeenLastCalledWith(expect.any(String), 'error', 6000);
  });

  it('a Lixeira que recusa, ou nenhuma resposta, vira aviso de erro', async () => {
    electronAPI.trashProject.mockResolvedValueOnce({ success: false, message: 'em uso' });
    expect(await m.excluirProjetoAberto()).toBe(false);
    expect(showCardNotification).toHaveBeenLastCalledWith(expect.any(String), 'error', 8000);
    electronAPI.trashProject.mockResolvedValueOnce(null);
    expect(await m.excluirProjetoAberto()).toBe(false);
  });

  it('sem a lista de recentes, termina do mesmo jeito', async () => {
    window.recentProjectsManager = { removeProject: () => { throw new Error('x'); } };
    expect(await m.excluirProjetoAberto()).toBe(true);
    delete window.recentProjectsManager;
    expect(await m.excluirProjetoAberto()).toBe(true);
  });
});

describe('o botao', () => {
  it('liga uma vez so, e o clique roda o fluxo; erro vai ao console', async () => {
    m.ligarExcluirProjeto();
    document.getElementById('delete-project').click();
    await Promise.resolve(); await Promise.resolve();
    expect(showDialog).toHaveBeenCalledTimes(1);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    showDialog.mockRejectedValueOnce(new Error('sem dialogo'));
    document.getElementById('delete-project').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it('sem o botao na pagina, nada', () => {
    document.body.innerHTML = '';
    expect(() => m.ligarExcluirProjeto()).not.toThrow();
  });
});
