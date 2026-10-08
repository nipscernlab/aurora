// tests/e2e/toolbar-sem-sobreposicao.test.js
//
// Nenhum botao da barra de cima pinta por cima do vizinho, em nenhuma largura.
//
// O caso que originou o teste (08/10/2026): abaixo de 1280 px a regra de
// compactacao forcava todo botao com texto a 28 px, o do PRISM inclusive, que
// continuava com o logo de 32 px e a palavra. O conteudo centralizado
// transbordava para os dois lados e cobria a pena do Verilog: o botao estava
// la, habilitado, mas ninguem o via. Ler o CSS nao pegou; medir pega.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _electron as electron } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Cada largura cai numa faixa das regras de toolbar.css (1440, 1280, 1100,
// 980, 880), com passos de 40 px de 1440 a 1280, onde a barra numa linha
// esta mais justa; 1920 e um monitor comum sem escala.
const LARGURAS = [1920, 1600, 1480, 1440, 1400, 1360, 1320, 1290, 1270, 1200, 1120, 1050, 950, 860];

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
 * Mede, na pagina, cada controle visivel da barra: a caixa dele e a caixa do
 * que ele desenha. Devolve as invasoes: conteudo que sai do proprio botao, e
 * pares de botoes cujas caixas se cruzam.
 */
function medirBarra() {
  const barra = document.getElementById('custom-titlebar');
  const controles = [...barra.querySelectorAll('button, .simulator-switch, select')]
    .filter((e) => !e.closest('.simulator-switch') || e.matches('.simulator-switch'))
    .filter((e) => {
      const r = e.getBoundingClientRect();
      const c = globalThis.getComputedStyle(e);
      return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none';
    });
  const nome = (e) => e.id || e.getAttribute('data-tool') || e.className;
  const folga = 1;
  const transbordos = [];
  for (const e of controles) {
    const r = e.getBoundingClientRect();
    for (const filho of e.querySelectorAll('img, svg, span')) {
      const f = filho.getBoundingClientRect();
      if (f.width === 0 || globalThis.getComputedStyle(filho).display === 'none') continue;
      if (f.left < r.left - folga || f.right > r.right + folga) {
        transbordos.push(`${nome(e)}: ${filho.tagName.toLowerCase()} vai de ${Math.round(f.left)} a ${Math.round(f.right)}, o botao de ${Math.round(r.left)} a ${Math.round(r.right)}`);
      }
    }
  }
  const cruzamentos = [];
  for (let i = 0; i < controles.length; i++) {
    for (let j = i + 1; j < controles.length; j++) {
      const a = controles[i];
      const b = controles[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const dx = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const dy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (dx > folga && dy > folga) cruzamentos.push(`${nome(a)} x ${nome(b)}: ${Math.round(dx)} px`);
    }
  }
  return { largura: window.innerWidth, controles: controles.length, transbordos, cruzamentos };
}

describe('E2E: a barra de cima sem botao por cima de botao', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;
  let userDataDir;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-barra-'));
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });
    window = await waitForMainWindow(app);
    await window.waitForSelector('#vericomp', { timeout: 20_000 });
  }, 60_000);

  afterAll(async () => {
    try { await app?.close(); } catch (_) { /* ja morreu */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  for (const largura of LARGURAS) {
    it(`a ${largura} px nenhum botao invade outro`, async () => {
      // A largura vem do zoom, e nao de redimensionar a janela: a tela da CI
      // (e a de um notebook com escala) e menor que 1920 px, e o Windows nao
      // deixa a janela passar dela. As regras @media leem a largura em px de
      // CSS, que e a da janela dividida pelo zoom.
      await app.evaluate(({ BrowserWindow }, w) => {
        const janela = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().endsWith('index.html'));
        const wc = janela.webContents;
        const base = janela.getContentSize()[0];
        wc.setZoomFactor(base / w);
      }, largura);
      await window.waitForFunction((w) => Math.abs(window.innerWidth - w) <= 2, largura, { timeout: 5_000 });
      // Um quadro para o layout assentar depois do resize.
      await window.evaluate(() => new Promise((r) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(r))));

      const m = await window.evaluate(medirBarra);
      expect(m.controles, 'a barra nao tem controle visivel nenhum').toBeGreaterThan(10);
      expect(m.transbordos.join(' | '), `conteudo saindo do botao a ${largura} px`).toBe('');
      expect(m.cruzamentos.join(' | '), `botoes cruzados a ${largura} px`).toBe('');
    }, 30_000);
  }
});
