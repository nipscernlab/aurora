// @vitest-environment happy-dom
//
// Relatar um problema por e-mail (js/ui/bug_report): o botao abre o
// formulario, e a reserva por e-mail monta assunto e corpo com o diagnostico
// e abre o webmail escolhido.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const electronAPI = {
  getAppVersion: vi.fn(async () => '1.2.3'),
  openExternal: vi.fn(async () => {}),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
// O diagnostico que o main reune para o formulario (bugreport:diagnostico).
const DIAG = { versao: '1.2.3', sistema: 'win32 10.0 x64', electron: '30', chrome: '124', node: '20', log: 'linhas do log' };
const form = { porEmail: null };
vi.mock('../../js/ui/bug_report_form.js', () => ({
  abrirFormulario: vi.fn(async (porEmail) => { form.porEmail = porEmail; }),
}));
const dialogo = vi.fn(async () => 'gmail');
vi.mock('../../js/ui/dialog_manager.js', () => ({ showDialog: (o) => dialogo(o) }));
const TabManager = { getEditingFilePath: vi.fn(() => 'C:\\p\\top.v') };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager }));

let ProjectStore;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
// O searchParams ja decodifica; decodificar de novo quebraria no %APPDATA% do corpo.
const corpoDe = (url) => new URL(url).searchParams.get('body');
const assuntoDe = (url) => new URL(url).searchParams.get('su');
const ultimaUrl = () => electronAPI.openExternal.mock.calls.at(-1)[0];

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
  dialogo.mockResolvedValue('gmail');
  electronAPI.getAppVersion.mockResolvedValue('1.2.3');
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
  it('abre o Gmail com assunto, corpo e o diagnostico do main, sem o log', async () => {
    await form.porEmail({ oQueAconteceu: 'travou', oQueEsperava: 'compilar', comoReproduzir: '1. abrir' }, DIAG);
    const url = ultimaUrl();
    expect(url.startsWith('https://mail.google.com/mail/?view=cm&fs=1&to=contact%40nipscern.com')).toBe(true);
    expect(assuntoDe(url)).toBe('[AURORA 1.2.3] Relato de problema');
    const corpo = corpoDe(url);
    for (const trecho of [
      'travou', 'compilar', 'AURORA: 1.2.3', 'Sistema: win32 10.0 x64',
      'Electron: 30   Chromium: 124   Node: 20', 'Projeto aberto: C:\\p', 'Arquivo em foco: C:\\p\\top.v',
    ]) expect(corpo).toContain(trecho);
    expect(corpo).not.toContain('linhas do log');
  });

  it('sem versao do aplicativo, a do diagnostico do main vale', async () => {
    electronAPI.getAppVersion.mockResolvedValueOnce(undefined);
    await form.porEmail({}, DIAG);
    expect(corpoDe(ultimaUrl())).toContain('AURORA: 1.2.3');
  });

  it('o dialogo lista todos os provedores, o Gmail em destaque, e o cancelar', async () => {
    dialogo.mockResolvedValueOnce('cancel');
    await form.porEmail();
    const botoes = dialogo.mock.calls[0][0].buttons;
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
      dialogo.mockResolvedValueOnce(id);
      await form.porEmail();
      expect(ultimaUrl().startsWith(comeco)).toBe(true);
    }
  });

  it('sem texto, o corpo sai com os cabecalhos vazios para preencher; sem projeto nem arquivo, "nenhum"', async () => {
    ProjectStore.clearProject();
    TabManager.getEditingFilePath.mockReturnValueOnce('');
    await form.porEmail();
    const corpo = corpoDe(ultimaUrl());
    expect(corpo).toContain('COMO REPRODUZIR, PASSO A PASSO\n1. \n2. \n3. ');
    expect(corpo).toContain('Projeto aberto: nenhum');
    expect(corpo).toContain('Arquivo em foco: nenhum');
  });

  it('o recorte do terminal entra no corpo quando veio', async () => {
    await form.porEmail({ terminal: 'erro na linha 3' });
    expect(corpoDe(ultimaUrl())).toContain('TERMINAL (erros e o que estava em volta)\nerro na linha 3');
  });

  it('sem versao nem diagnostico do main: nao informado, e o sistema vem do navegador', async () => {
    electronAPI.getAppVersion.mockRejectedValueOnce(new Error('x'));
    TabManager.getEditingFilePath.mockImplementationOnce(() => { throw new Error('z'); });
    await form.porEmail();
    const url = ultimaUrl();
    expect(assuntoDe(url)).toBe('[AURORA ?] Relato de problema');
    const corpo = corpoDe(url);
    expect(corpo).toContain('AURORA: não informado');
    expect(corpo).toContain(`Sistema: ${navigator.userAgent}`);
    expect(corpo).toContain('Electron: não informado');
    expect(corpo).toContain('Arquivo em foco: nenhum');
  });

  it('abrir que falha avisa', async () => {
    electronAPI.openExternal.mockRejectedValueOnce(new Error('sem navegador'));
    await form.porEmail({}, DIAG);
    expect(window.showNotification).toHaveBeenCalledWith('Não foi possível abrir: sem navegador', 'error');
  });

  it('dialogo que nao responde, ou provedor desconhecido, nao abre nada', async () => {
    dialogo.mockResolvedValueOnce(undefined);
    await form.porEmail();
    dialogo.mockResolvedValueOnce('pombo');
    await form.porEmail();
    expect(electronAPI.openExternal).not.toHaveBeenCalled();
  });

  it('o titulo do dialogo vem traduzido', async () => {
    window.t = (k) => (k === 'bugReport.sendByEmail' ? 'Enviar por e-mail' : k);
    await form.porEmail();
    expect(dialogo.mock.calls[0][0].title).toBe('Enviar por e-mail');
  });
});
