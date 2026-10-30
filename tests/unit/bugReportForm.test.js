// @vitest-environment happy-dom
//
// O painel de relato de problema (js/ui/bug_report_form.ts): abre com o
// rascunho salvo, so libera o envio com descricao, e cada saida (Esc, X,
// clique fora, Cancelar, e-mail, envio) devolve o que a pessoa escreveu. O
// rascunho so e apagado com o envio confirmado; sem canal, cai no e-mail.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronAPI = {
  bugReportDiagnostico: vi.fn(async () => ({ versao: '1.2.3', sistema: 'win32', log: 'a\nb' })),
  bugReportEnviar: vi.fn(async () => ({ ok: true })),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const showCardNotification = vi.fn();
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification }));
vi.mock('../../js/terminal/terminal_excerpt.js', () => ({ recorteEmTexto: () => 'erro no terminal' }));

const { abrirFormulario } = await import('../../js/ui/bug_report_form.ts');

const CHAVE = 'aurora-bugreport-rascunho';
const esperar = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const painel = () => document.querySelector('.bug-report-overlay');
const campo = (id) => painel().querySelector(`#${id}`);
const escrever = (id, texto) => {
  campo(id).value = texto;
  campo(id).dispatchEvent(new Event('input'));
};

beforeEach(() => {
  localStorage.clear();
  delete window.t;
  electronAPI.bugReportEnviar.mockReset().mockResolvedValue({ ok: true });
  electronAPI.bugReportDiagnostico.mockClear();
  showCardNotification.mockClear();
});
afterEach(() => {
  document.body.innerHTML = '';
});

/** Abre o painel e espera ele estar na tela. */
async function abrir(porEmail = vi.fn(async () => {})) {
  const fim = abrirFormulario(porEmail);
  await esperar();
  return { fim, porEmail };
}

describe('o painel', () => {
  it('abre com o rascunho salvo, e o envio so libera com descricao', async () => {
    localStorage.setItem(CHAVE, JSON.stringify({ oQueEsperava: 'compilar', email: 'a@b.c' }));
    const { fim } = await abrir();
    expect(campo('bug-esperava').value).toBe('compilar');
    expect(campo('bug-email').value).toBe('a@b.c');
    expect(campo('bug-o-que').value).toBe('');
    const enviar = painel().querySelector('[data-acao="enviar"]');
    expect(enviar.disabled).toBe(true);
    expect(painel().querySelector('pre').textContent).toContain('AURORA: 1.2.3');

    escrever('bug-o-que', 'travou');
    expect(enviar.disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem(CHAVE)).oQueAconteceu).toBe('travou');

    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'a' }));
    document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    await fim;
    expect(electronAPI.bugReportEnviar).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(CHAVE)).oQueAconteceu).toBe('travou');
  });

  it('o X, o Cancelar e o clique fora fecham sem enviar', async () => {
    for (const fechar of [
      () => painel().querySelector('.bug-report-x').click(),
      () => painel().querySelector('[data-acao="cancelar"]').click(),
      () => painel().click(),
    ]) {
      const { fim, porEmail } = await abrir();
      painel().querySelector('.bug-report').click();
      fechar();
      await fim;
      expect(porEmail).not.toHaveBeenCalled();
      document.body.innerHTML = '';
    }
    expect(electronAPI.bugReportEnviar).not.toHaveBeenCalled();
  });

  it('o texto com aspas fica inteiro no atributo, sem abrir outro (#276)', async () => {
    window.t = (k) => (k === 'bugReport.emailHint' ? 'Diga "oi" e x\' onclick="y"' : k === 'bugReport.close' ? 'Fe"char' : k);
    const { fim } = await abrir();
    expect(campo('bug-email').getAttribute('placeholder')).toBe('Diga "oi" e x\' onclick="y"');
    expect(campo('bug-email').getAttribute('onclick')).toBeNull();
    expect(painel().querySelector('.bug-report-x').getAttribute('aria-label')).toBe('Fe"char');
    painel().querySelector('.bug-report-x').click();
    await fim;
  });
});

describe('as saidas', () => {
  it('envio confirmado apaga o rascunho e agradece', async () => {
    const { fim } = await abrir();
    escrever('bug-o-que', 'travou');
    painel().querySelector('[data-acao="enviar"]').click();
    await fim;
    expect(electronAPI.bugReportEnviar).toHaveBeenCalledWith(expect.objectContaining({ oQueAconteceu: 'travou', terminal: 'erro no terminal' }));
    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(showCardNotification).toHaveBeenCalledWith(expect.any(String), 'success', 7000, expect.any(String));
  });

  it('o e-mail recebe o texto e o diagnostico, e o rascunho fica', async () => {
    const { fim, porEmail } = await abrir();
    escrever('bug-o-que', 'travou');
    painel().querySelector('[data-acao="email"]').click();
    await fim;
    expect(porEmail).toHaveBeenCalledWith(expect.objectContaining({ oQueAconteceu: 'travou' }), expect.objectContaining({ versao: '1.2.3' }));
    expect(localStorage.getItem(CHAVE)).not.toBeNull();
  });

  it('o envio que falha cai no e-mail, e o diagnostico que falha nao impede o relato', async () => {
    electronAPI.bugReportDiagnostico.mockRejectedValueOnce(new Error('sem main'));
    electronAPI.bugReportEnviar.mockRejectedValueOnce(new Error('rede'));
    const { fim, porEmail } = await abrir();
    expect(painel().querySelector('pre').textContent).toBe('(não foi possível reunir o diagnóstico)');
    escrever('bug-o-que', 'travou');
    painel().querySelector('[data-acao="enviar"]').click();
    await fim;
    expect(porEmail).toHaveBeenCalledWith(expect.objectContaining({ oQueAconteceu: 'travou' }), null);
    expect(showCardNotification.mock.calls[0][0]).toContain('rede');
    expect(localStorage.getItem(CHAVE)).not.toBeNull();
  });

  it('o limite de envios avisa quanto esperar e nao abre o e-mail', async () => {
    electronAPI.bugReportEnviar.mockResolvedValueOnce({ ok: false, erro: 'muitos-relatos', esperar: 90 });
    const { fim, porEmail } = await abrir();
    escrever('bug-o-que', 'travou');
    painel().querySelector('[data-acao="enviar"]').click();
    await fim;
    expect(porEmail).not.toHaveBeenCalled();
    expect(showCardNotification.mock.calls[0][0]).toContain('2 minutos');
  });
});
