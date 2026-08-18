// tests/e2e/network-warning.test.js
//
// O aviso de queda de internet, medido com o aplicativo de pé.
//
// Existe porque o aviso "não estava aparecendo" e não havia como saber onde
// falhava: o módulo pode nem ter sido carregado, o listener pode não ter sido
// registrado, ou o toast pode ser criado e não ficar visível. Cada uma dessas
// hipóteses é uma asserção separada aqui, de modo que a falha aponte o ponto.
//
// O evento `offline` é disparado à mão. Derrubar a rede de verdade dentro do
// teste seria mexer na máquina de quem roda, e é justamente o que o navegador
// já traduz para este evento.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _electron as electron } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function stripElectronNodeMode(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    out[k] = v;
  }
  return out;
}

async function waitForMainWindow(app, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      const url = w.url();
      if (url.endsWith('/index.html') || url.endsWith('\\index.html')) return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Main window (index.html) did not appear within timeout.');
}

/**
 * Estado limpo entre os casos.
 *
 * Nao basta remover o cartao do DOM: o modulo guarda uma trava para nao
 * empilhar avisos, e ela so solta quando a rede volta. Simular a volta e o
 * jeito honesto de zerar, e de quebra exercita esse caminho.
 */
const LIMPAR = () => {
  document.querySelectorAll('aurora-toast').forEach((t) => t.remove());
  window.dispatchEvent(new Event('online'));
};

describe('E2E — aviso de queda de internet', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;
  let userDataDir;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-net-'));
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });
    window = await waitForMainWindow(app);
    await window.waitForSelector('.main-container', { timeout: 20_000 });
    await window.waitForLoadState('load');
  }, 60_000);

  afterAll(async () => {
    try { await app?.close(); } catch (_) { /* já morreu */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('a queda de conexao mostra um aviso na tela', async () => {
    await window.evaluate(LIMPAR);
    await window.evaluate(() => window.dispatchEvent(new Event('offline')));

    await window.waitForFunction(
      () => document.querySelectorAll('aurora-toast').length > 0,
      null, { timeout: 5_000 },
    );

    const cartao = await window.evaluate(() => {
      const t = document.querySelector('aurora-toast');
      const r = t.getBoundingClientRect();
      return {
        tipo: t.type,
        titulo: t.heading,
        mensagem: String(t.message || ''),
        duracao: t.duration,
        visivel: r.width > 0 && r.height > 0,
      };
    });

    expect(cartao.visivel, 'o cartao precisa ocupar espaco na tela').toBe(true);
    expect(cartao.tipo).toBe('warning');
    expect(cartao.mensagem.toLowerCase()).toContain('internet');
    // Pegajoso: sai no clique do usuario, nao no tempo. Um aviso de rede que
    // some sozinho vira algo que se perde ao olhar para o lado.
    expect(cartao.duracao, 'o aviso nao pode fechar sozinho').toBe(0);
  }, 30_000);

  it('avisa de novo a cada queda, porque rede que oscila e outra informacao', async () => {
    await window.evaluate(LIMPAR);
    await window.evaluate(() => window.dispatchEvent(new Event('offline')));
    await window.waitForFunction(
      () => document.querySelectorAll('aurora-toast').length > 0, null, { timeout: 5_000 },
    );
    const n = await window.evaluate(() => document.querySelectorAll('aurora-toast').length);
    expect(n).toBeGreaterThan(0);
  }, 30_000);

  it('uma falha de rede relatada tambem avisa, que e o caso que o evento erra', async () => {
    // `navigator.onLine` so ve interface de rede: cabo ligado num roteador sem
    // uplink continua "online" e o evento `offline` nunca dispara. Este e o
    // caminho que cobre isso, e e por ele que a queda real e detectada.
    await window.evaluate(LIMPAR);
    const houve = await window.evaluate(async () => {
      // Sem internet de verdade no ambiente do teste, a confirmacao decide.
      // Forcamos o cenario mandando um erro que parece de rede e cortando o
      // fetch, que e exatamente o que uma queda produz.
      const fetchOriginal = window.fetch;
      window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
      try {
        await window.auroraReportarFalhaDeRede(
          new Error('getaddrinfo ENOTFOUND api.github.com'), 'teste');
        await new Promise((r) => setTimeout(r, 300));
        return document.querySelectorAll('aurora-toast').length;
      } finally {
        window.fetch = fetchOriginal;
      }
    });
    expect(houve, 'falha de rede confirmada tem que avisar').toBeGreaterThan(0);
  }, 30_000);

  it('erro que NAO e de rede nao vira aviso', async () => {
    // Um servico fora do ar nao e a internet caindo, e anunciar isso seria
    // mentir para o usuario.
    await window.evaluate(LIMPAR);
    const houve = await window.evaluate(async () => {
      await window.auroraReportarFalhaDeRede(new Error('HTTP 500 no servidor'), 'teste');
      await new Promise((r) => setTimeout(r, 300));
      return document.querySelectorAll('aurora-toast').length;
    });
    expect(houve).toBe(0);
  }, 30_000);

  it('desligado nas configuracoes, nao avisa', async () => {
    await window.evaluate(LIMPAR);
    const houve = await window.evaluate(async () => {
      const antes = localStorage.getItem('aurora-network-warning-enabled');
      localStorage.setItem('aurora-network-warning-enabled', '0');
      window.dispatchEvent(new Event('offline'));
      await new Promise((r) => setTimeout(r, 600));
      const n = document.querySelectorAll('aurora-toast').length;
      if (antes === null) localStorage.removeItem('aurora-network-warning-enabled');
      else localStorage.setItem('aurora-network-warning-enabled', antes);
      return n;
    });
    expect(houve, 'com o aviso desligado nao pode aparecer cartao').toBe(0);
  }, 30_000);
});
