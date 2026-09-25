// @vitest-environment happy-dom
//
// Relatar um problema por e-mail (js/ui/bug_report): o botao abre o
// formulario, e a reserva por e-mail monta assunto e corpo com o diagnostico
// e abre o webmail escolhido.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const electronAPI = {
  getAppVersion: vi.fn(async () => '1.2.3'),
  getSystemInfo: vi.fn(async () => ({ platform: 'win32', release: '10.0', arch: 'x64', electron: '30', chrome: '124', node: '20' })),
  openExternal: vi.fn(async () => {}),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const form = { porEmail: null };
vi.mock('../../js/ui/bug_report_form.js', () => ({
  abrirFormulario: vi.fn(async (porEmail) => { form.porEmail = porEmail; }),
  diagnosticoEmTexto: vi.fn(() => 'DIAG COMPLETO'),
}));
const TabManager = { getEditingFilePath: vi.fn(() => 'C:\\p\\top.v') };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));

let ProjectStore;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
// O searchParams ja decodifica; decodificar de novo quebraria no %APPDATA% do corpo.
const corpoDe = (url) => new URL(url).searchParams.get('body');

beforeAll(async () => {
  document.body.innerHTML = '<button id="bug-report-btn"></button>';
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  await import('../../js/ui/bug_report.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  document.getElementById('bug-report-btn').click();
  await flush();
});

beforeEach(() => {
  vi.clearAllMocks();
  window.TabManager = TabManager;
  window.AuroraUI = { dialog: vi.fn(async () => 'gmail') };
  window.showNotification = vi.fn();
  delete window.t;
  ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
});

describe('o botao', () => {
  it('abre o formulario, com o e-mail como reserva', () => {
    expect(typeof form.porEmail).toBe('function');
    expect(window.auroraBugReport).toBeTypeOf('function');
  });
});

describe('enviar por e-mail', () => {
  it('abre o Gmail com assunto, corpo e diagnostico codificados', async () => {
    await form.porEmail({ oQueAconteceu: 'travou', oQueEsperava: 'compilar', comoReproduzir: '1. abrir' });
    const url = electronAPI.openExternal.mock.calls[0][0];
    expect(url.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=contact%40nipscern.com')).toBe(true);
    const corpo = corpoDe(url);
    expect(new URL(url).searchParams.get('su')).toBe('[AURORA 1.2.3] Relato de problema');
    expect(corpo).toContain('travou');
    expect(corpo).toContain('compilar');
    expect(corpo).toContain('AURORA: 1.2.3');
    expect(corpo).toContain('Sistema: win32 10.0 x64');
    expect(corpo).toContain('Electron: 30   Chromium: 124   Node: 20');
    expect(corpo).toContain('Projeto aberto: C:\\p');
    expect(corpo).toContain('Arquivo em foco: C:\\p\\top.v');
  });

  it('o dialogo lista todos os provedores, o Gmail em destaque, e o cancelar', async () => {
    window.AuroraUI.dialog.mockResolvedValueOnce('cancel');
    await form.porEmail();
    const botoes = window.AuroraUI.dialog.mock.calls[0][0].buttons;
    expect(botoes.map((b) => b.action)).toEqual([
      'gmail', 'outlook', 'proton', 'yandex', 'icloud', 'zoho', 'gmx', 'aol', 'mailru', 'tutanota', 'hey', 'mailto', 'cancel',
    ]);
    expect(botoes[0].type).toBe('save');
    expect(botoes[0].iconHtml).toContain('mail_gmail.svg');
    expect(electronAPI.openExternal).not.toHaveBeenCalled();
  });

  it('cada provedor monta a sua URL; o cliente instalado usa mailto', async () => {
    for (const [id, comeco] of [
      ['outlook', 'https://outlook.live.com/'], ['proton', 'https://mail.proton.me/'],
      ['yandex', 'https://mail.yandex.com/'], ['icloud', 'https://www.icloud.com/'],
      ['zoho', 'https://mail.zoho.com/'], ['gmx', 'https://www.gmx.com/'], ['aol', 'https://mail.aol.com/'],
      ['mailru', 'https://e.mail.ru/'], ['tutanota', 'https://app.tuta.com/'], ['hey', 'https://app.hey.com/'],
      ['mailto', 'mailto:contact%40nipscern.com?subject='],
    ]) {
      window.AuroraUI.dialog.mockResolvedValueOnce(id);
      await form.porEmail();
      expect(electronAPI.openExternal.mock.calls.at(-1)[0].startsWith(comeco)).toBe(true);
    }
  });

  it('sem texto, o corpo sai com os cabecalhos vazios para preencher; sem projeto nem arquivo, "nenhum"', async () => {
    ProjectStore.clearProject();
    TabManager.getEditingFilePath.mockReturnValueOnce('');
    await form.porEmail();
    const corpo = corpoDe(electronAPI.openExternal.mock.calls[0][0]);
    expect(corpo).toContain('COMO REPRODUZIR, PASSO A PASSO\n1. \n2. \n3. ');
    expect(corpo).toContain('Projeto aberto: nenhum');
    expect(corpo).toContain('Arquivo em foco: nenhum');
  });

  it('o recorte do terminal entra no corpo quando veio', async () => {
    await form.porEmail({ terminal: 'erro na linha 3' });
    expect(corpoDe(electronAPI.openExternal.mock.calls[0][0])).toContain('TERMINAL (erros e o que estava em volta)\nerro na linha 3');
  });

  it('sem versao nem sistema, o que falta sai como nao informado, e o sistema vem do navegador', async () => {
    electronAPI.getAppVersion.mockRejectedValueOnce(new Error('x'));
    electronAPI.getSystemInfo.mockRejectedValueOnce(new Error('y'));
    TabManager.getEditingFilePath.mockImplementationOnce(() => { throw new Error('z'); });
    await form.porEmail();
    const url = electronAPI.openExternal.mock.calls[0][0];
    expect(new URL(url).searchParams.get('su')).toBe('[AURORA ?] Relato de problema');
    const corpo = corpoDe(url);
    expect(corpo).toContain('AURORA: não informado');
    expect(corpo).toContain(`Sistema: ${navigator.userAgent}`);
    expect(corpo).toContain('Arquivo em foco: nenhum');
    electronAPI.getSystemInfo.mockResolvedValueOnce(null);
    await form.porEmail();
  });

  it('com o diagnostico do main, ele e montado; abrir que falha avisa', async () => {
    const { diagnosticoEmTexto } = await import('../../js/ui/bug_report_form.js');
    electronAPI.openExternal.mockRejectedValueOnce(new Error('sem navegador'));
    await form.porEmail({}, { versao: '1.2.3' });
    expect(diagnosticoEmTexto).toHaveBeenCalledWith({ versao: '1.2.3' });
    expect(window.showNotification).toHaveBeenCalledWith('Não foi possível abrir: sem navegador', 'error');
  });

  it('dialogo que nao responde, ou provedor desconhecido, nao abre nada', async () => {
    window.AuroraUI.dialog.mockResolvedValueOnce(undefined);
    await form.porEmail();
    window.AuroraUI.dialog.mockResolvedValueOnce('pombo');
    await form.porEmail();
    delete window.AuroraUI;
    await form.porEmail();
    expect(electronAPI.openExternal).not.toHaveBeenCalled();
  });

  it('o titulo do dialogo vem traduzido', async () => {
    window.t = (k) => (k === 'bugReport.sendByEmail' ? 'Enviar por e-mail' : k);
    await form.porEmail();
    expect(window.AuroraUI.dialog.mock.calls[0][0].title).toBe('Enviar por e-mail');
  });
});
