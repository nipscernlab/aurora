// @vitest-environment happy-dom
//
// Os dois botoes do topo da arvore (js/tree/file_tree_toggler): recolher ou
// abrir tudo, conforme a vista, e o backup do projeto aberto.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const electronAPI = { createBackup: vi.fn() };
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const showCardNotification = vi.fn();
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification }));
// O controlador de vistas e a vista de pastas: os mesmos falsos por import e
// por window, para o teste valer antes e depois de o toggler importar os dois.
const ctl = { vista: 'verilog', getActiveView: () => ctl.vista };
const pastas = { aberto: false, hasExpanded: vi.fn(() => pastas.aberto), collapseAll: vi.fn(), expandAll: vi.fn(async () => {}) };
vi.mock('../../js/tree/file_tree_view_controller.js', () => ({ fileTreeViewController: ctl }));
vi.mock('../../js/tree/standard_tree_render.js', () => ({ standardTreeRenderer: pastas }));

let ProjectStore;
const $ = (id) => document.getElementById(id);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

beforeAll(async () => {
  document.body.innerHTML = `
    <button id="toggle-file-tree"><i></i></button>
    <button id="backup-project"><i></i></button>
    <div id="file-tree">
      <div class="hierarchy-children expanded"></div><div class="hierarchy-children collapsed"></div>
      <span class="hierarchy-toggle expanded"></span>
    </div>`;
  window.fileTreeViewController = ctl;
  window.standardTreeRenderer = pastas;
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  await import('../../js/tree/file_tree_toggler.js');
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  ctl.vista = 'verilog';
  pastas.aberto = false;
  ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
});

afterEach(() => vi.useRealTimers());

describe('recolher ou abrir tudo', () => {
  it('o botao ganha o icone e o balao; o balao segue o idioma', () => {
    expect($('toggle-file-tree').querySelector('i').className).toBe('ph ph-minus-square');
    expect($('toggle-file-tree').dataset.tooltip).toBe('Collapse / expand all');
    window.t = (k) => (k === 'fileTree.toggleAll' ? 'Recolher / abrir' : k);
    window.dispatchEvent(new Event('aurora:locale-changed'));
    expect($('toggle-file-tree').dataset.tooltip).toBe('Recolher / abrir');
    delete window.t;
  });

  it('na hierarquia: com algo aberto recolhe tudo; com tudo fechado abre tudo', async () => {
    ctl.vista = 'hierarchy';
    $('toggle-file-tree').click();
    await flush();
    expect(document.querySelectorAll('.hierarchy-children.expanded')).toHaveLength(0);
    expect(document.querySelector('.hierarchy-toggle').classList.contains('expanded')).toBe(false);
    $('toggle-file-tree').click();
    await flush();
    expect(document.querySelectorAll('.hierarchy-children.expanded')).toHaveLength(2);
    const icone = $('toggle-file-tree').querySelector('i');
    expect(icone.style.opacity).toBe('0.7');
    vi.advanceTimersByTime(200);
    expect(icone.style.opacity).toBe('1');
  });

  it('nas pastas: fecha se ha pasta aberta, abre tudo se nao ha', async () => {
    ctl.vista = 'standard';
    pastas.aberto = true;
    $('toggle-file-tree').click();
    await flush();
    expect(pastas.collapseAll).toHaveBeenCalled();
    pastas.aberto = false;
    $('toggle-file-tree').click();
    await flush();
    expect(pastas.expandAll).toHaveBeenCalled();
  });

  it('na lista plana de arquivos nao ha o que recolher', async () => {
    $('toggle-file-tree').click();
    await flush();
    expect(pastas.collapseAll).not.toHaveBeenCalled();
    expect(pastas.expandAll).not.toHaveBeenCalled();
  });
});

describe('backup', () => {
  it('sem projeto aberto, recusa com aviso e nao chama o main', async () => {
    ProjectStore.clearProject();
    $('backup-project').click();
    await flush();
    expect(electronAPI.createBackup).not.toHaveBeenCalled();
    expect(showCardNotification).toHaveBeenCalledWith(expect.stringMatching(/No project is open/), 'error', 4000);
  });

  it('faz o backup do projeto aberto, trava o botao durante e avisa o resultado', async () => {
    electronAPI.createBackup.mockResolvedValue({ success: true, message: 'Backup created at: C:\\p\\Backup\\p.zip' });
    $('backup-project').click();
    expect($('backup-project').querySelector('i').classList.contains('backup-active')).toBe(true);
    expect($('backup-project').style.pointerEvents).toBe('none');
    await flush();
    expect(electronAPI.createBackup).toHaveBeenCalledWith('C:\\p');
    expect(showCardNotification).toHaveBeenLastCalledWith('Backup created at: C:\\p\\Backup\\p.zip', 'success', 6000);
    vi.advanceTimersByTime(600);
    expect($('backup-project').querySelector('i').classList.contains('backup-active')).toBe(false);
    expect($('backup-project').style.pointerEvents).toBe('auto');
  });

  it('a falha do main e o erro do canal viram aviso de erro', async () => {
    electronAPI.createBackup.mockResolvedValueOnce({ success: false, message: 'sem espaco' });
    $('backup-project').click();
    await flush();
    expect(showCardNotification).toHaveBeenLastCalledWith('sem espaco', 'error', 6000);
    electronAPI.createBackup.mockResolvedValueOnce({ success: false });
    $('backup-project').click();
    await flush();
    expect(showCardNotification).toHaveBeenLastCalledWith('Failed to create backup.', 'error', 6000);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    electronAPI.createBackup.mockRejectedValueOnce(new Error('ipc'));
    $('backup-project').click();
    await flush();
    expect(showCardNotification).toHaveBeenLastCalledWith(expect.stringMatching(/critical error/), 'error', 5000);
    erro.mockRestore();
  });

  it('o estilo da animacao entra uma vez so', () => {
    expect(document.querySelectorAll('#file-tree-controller-styles')).toHaveLength(1);
  });
});
