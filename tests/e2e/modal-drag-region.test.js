// tests/e2e/modal-drag-region.test.js
//
// O "?" e o "x" das Configuracoes numa janela pequena, com o aplicativo de pe.
//
// O defeito que originou o teste: em 03/09/2026, numa janela de 1280x820 com
// zoom de 120% (area util de ~1067x683 px de CSS), nenhum dos dois botoes do
// cabecalho das Configuracoes respondia ao clique. Nao havia nada por cima
// deles: nessa largura a barra de ferramentas vira duas linhas (86 px) e ela e
// a regiao de arrasto da janela (-webkit-app-region: drag), que o sistema
// resolve ANTES de o clique chegar ao Chromium. O modal alto comeca perto do
// topo e o seu cabecalho caia dentro da faixa. z-index nao ajuda; so um
// recorte no-drag no painel do modal tira o cabecalho da regiao.
//
// O teste mede a geometria de verdade: junta os retangulos de tudo que e drag,
// subtrai os de tudo que e no-drag (que e como o Chromium monta a regiao de
// arrasto) e exige que o centro de cada botao do cabecalho fique fora dela.
// Um clique sintetico nao serviria: ele entra pelo CDP, direto no renderer, e
// nunca passa pelo teste de arrasto do sistema.

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
 * Para cada botao do cabecalho do modal aberto, se o centro dele cai na regiao
 * de arrasto efetiva (drag menos no-drag). Roda dentro da pagina.
 * @param {string} modalId
 */
const MEDIR = (modalId) => {
  const rect = (el) => el.getBoundingClientRect();
  const dentro = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  const todos = [];
  const coletar = (root) => {
    for (const el of root.querySelectorAll('*')) {
      todos.push(el);
      if (el.shadowRoot) coletar(el.shadowRoot);
    }
  };
  coletar(document);
  const visiveis = todos.filter((el) => { const r = rect(el); return r.width > 0 && r.height > 0; });
  const drags = visiveis.filter((el) => window.getComputedStyle(el).webkitAppRegion === 'drag').map(rect);
  const noDrags = visiveis.filter((el) => window.getComputedStyle(el).webkitAppRegion === 'no-drag').map(rect);
  const modal = document.getElementById(modalId);
  const raiz = modal.shadowRoot || modal;
  const botoes = [
    ...raiz.querySelectorAll('.header button'),
    ...modal.querySelectorAll('[slot="actions"] button, button[slot="actions"]'),
  ].filter((b) => rect(b).width > 0);
  return {
    barra: drags.map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) })),
    botoes: botoes.map((b) => {
      const r = rect(b);
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const emDrag = drags.some((d) => dentro(d, cx, cy));
      const emNoDrag = noDrags.some((d) => dentro(d, cx, cy));
      return { id: b.id || b.getAttribute('aria-label'), y: Math.round(cy), emDrag, emNoDrag, arrastavel: emDrag && !emNoDrag };
    }),
  };
};

describe('E2E — o cabecalho do modal fora da regiao de arrasto', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;
  let userDataDir;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-drag-'));
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });
    window = await waitForMainWindow(app);
    await window.waitForLoadState('load');
    await window.waitForFunction(() => !!window.monaco, null, { timeout: 30_000 });
    // A area util da captura do defeito: 1280x820 a 120%.
    await window.setViewportSize({ width: 1067, height: 683 });
    await window.waitForTimeout(600);
  }, 90_000);

  afterAll(async () => {
    try { await app?.close(); } catch (_) { /* ja morreu */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('nessa largura a barra de ferramentas ocupa duas linhas, que e o que cria o problema', async () => {
    const barra = await window.evaluate(() => {
      const t = document.querySelector('.toolbar');
      return t ? Math.round(t.getBoundingClientRect().height) : 0;
    });
    expect(barra, 'a barra devia ter dobrado; se nao dobrou, o teste nao exercita o caso').toBeGreaterThan(60);
  });

  it('o "?" e o "x" das Configuracoes ficam fora da regiao de arrasto', async () => {
    await window.click('#aurora-settings');
    await window.waitForFunction(() => document.getElementById('settings-modal')?.open === true, null, { timeout: 10_000 });
    await window.waitForTimeout(500);

    const r = await window.evaluate(MEDIR, 'settings-modal');
    expect(r.botoes.map((b) => b.id).sort()).toEqual(['close-modal-btn', 'settingsHelp']);
    for (const b of r.botoes) {
      // Sem o recorte, o cabecalho cai DENTRO da barra dobrada; e o caso do defeito.
      expect(b.emDrag, `${b.id} em y=${b.y} deveria estar sobre a barra (${JSON.stringify(r.barra)}); senao o teste nao prova nada`).toBe(true);
      expect(b.arrastavel, `${b.id} em y=${b.y} continua arrastavel: o clique vira arrasto da janela`).toBe(false);
    }
  }, 30_000);
});
