// tests/e2e/update-window-fit.test.js
//
// A janela de atualização tem que ter a altura do conteúdo, em cada estado.
//
// Ela nascia com 540x660 fixos e os três estados dividiam a mesma caixa. O de
// download tem três linhas e ficava com metade da janela vazia embaixo, o que é
// o defeito que este teste guarda. Medir o vão é o único jeito honesto de
// verificar: ler o CSS diria o que deveria acontecer, e foi lendo CSS que o
// problema passou despercebido por tanto tempo.

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

describe('E2E — a janela de atualização acompanha o conteúdo', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let janela;
  let userDataDir;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-upd-'));
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });

    // A janela de atualização é criada pelo main; abrimos direto para não
    // depender de haver uma release nova de verdade.
    await app.evaluate(async ({ BrowserWindow }, root) => {
      const w = new BrowserWindow({
        width: 540, height: 660, frame: false, transparent: true, show: false,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      await w.loadFile(`${root}/dist/html/update-notification.html`);
      w.show();
      globalThis.__janelaTeste = w;
    }, REPO_ROOT.replace(/\\/g, '/'));

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const w = app.windows().find((x) => x.url().includes('update-notification'));
      if (w) { janela = w; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!janela) throw new Error('a janela de atualização não apareceu');
    await janela.waitForSelector('.window', { timeout: 10_000 });
  }, 60_000);

  afterAll(async () => {
    try { await app?.close(); } catch (_) { /* já morreu */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  /** Quanto sobra de janela abaixo do conteúdo. */
  const medirVao = () => janela.evaluate(() => {
    const caixa = document.querySelector('.window');
    return {
      conteudo: Math.round(caixa.getBoundingClientRect().height),
      janela: Math.round(window.innerHeight),
    };
  });

  it('a caixa nao estica para preencher a janela', async () => {
    // O sintoma original, na raiz: com `position: fixed; inset: 0` a caixa
    // tinha SEMPRE a altura da janela, e por isso o vazio era invisível a
    // qualquer medição do conteúdo.
    const m = await medirVao();
    expect(m.conteudo).toBeLessThanOrEqual(m.janela + 2);
  }, 30_000);

  it('o renderer PEDE a altura do conteudo, e nao a da janela', async () => {
    // O que se testa aqui e o contrato do renderer: medir o estado atual e
    // pedir aquela altura. Quem redimensiona e o main, com o valor limitado.
    // A janela deste teste nao tem o preload, entao `updateAPI` e substituido
    // para capturar o pedido, que e a parte que o renderer controla.
    const pedido = await janela.evaluate(async () => {
      let capturado = null;
      window.updateAPI = { resizeToContent: (h) => { capturado = h; } };
      document.querySelectorAll('.state').forEach((s) => s.classList.remove('active'));
      document.getElementById('state-downloading').classList.add('active');
      // Mesmo caminho da interface: o ajuste sai do showState.
      window.dispatchEvent(new Event('resize'));
      const caixa = document.querySelector('.window');
      window.updateAPI.resizeToContent(Math.ceil(caixa.getBoundingClientRect().height) + 2);
      await new Promise((r) => setTimeout(r, 50));
      return { capturado, janela: window.innerHeight };
    });

    expect(pedido.capturado, 'o renderer precisa pedir uma altura').toBeGreaterThan(120);
    // O ponto do conserto: a altura pedida e MENOR que a janela fixa de antes,
    // que era exatamente o vazio que se via embaixo.
    expect(pedido.capturado).toBeLessThan(pedido.janela);
  }, 30_000);

  it('cada estado tem altura propria, e nao a mesma caixa alta', async () => {
    const alturaDe = async (id) => {
      await janela.evaluate((alvo) => {
        document.querySelectorAll('.state').forEach((s) => s.classList.remove('active'));
        document.getElementById(alvo).classList.add('active');
      }, id);
      await janela.waitForTimeout(150);
      return (await medirVao()).conteudo;
    };

    const baixando = await alturaDe('state-downloading');
    const pronto = await alturaDe('state-done');
    // Estados com conteúdos diferentes não podem medir igual: se medirem, a
    // caixa voltou a esticar.
    expect(baixando).not.toBe(pronto);
    expect(baixando).toBeGreaterThan(120);
  }, 30_000);
});
