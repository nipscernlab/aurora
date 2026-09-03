// tests/e2e/boot-console.test.js
//
// O que o console do renderer diz durante o boot, com o aplicativo de pe.
//
// Existe por causa de um aviso que ficou meses no boot sem ninguem saber a
// causa: "Duplicate definition of module vs/editor/editor.main". Era o KaTeX,
// um UMD que, executando DEPOIS do loader AMD do Monaco, via `define.amd` e se
// registrava como modulo anonimo em vez de criar `window.katex`; o loader
// atribuia esse define ao editor.main e acusava a duplicata. O efeito
// invisivel era pior que o aviso: `window.katex` nunca existia e o chat da IA
// caia sempre no subconjunto Unicode de matematica. Ler o HTML nao pegava isso;
// so o console de um boot real pega, e e o que este teste le.

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

describe('E2E — o console do boot', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;
  let userDataDir;
  /** Tudo que qualquer pagina do app escreveu no console, desde a criacao. */
  const console_ = [];
  const pageErrors = [];

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-console-'));
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });
    // Ouvir na CRIACAO de cada janela, e nao depois de acha-la: o aviso do
    // loader sai nos primeiros milissegundos do documento, antes de qualquer
    // seletor existir para esperar.
    const ouvir = (page) => {
      page.on('console', (m) => console_.push({ type: m.type(), text: m.text(), url: page.url() }));
      page.on('pageerror', (e) => pageErrors.push({ message: e.message, url: page.url() }));
    };
    app.windows().forEach(ouvir);
    app.on('window', ouvir);

    window = await waitForMainWindow(app);
    await window.waitForLoadState('load');
    // O editor pronto e o ponto em que o Monaco ja carregou o editor.main,
    // que e onde a duplicata aparecia.
    await window.waitForFunction(() => !!window.monaco && !!document.querySelector('.ai-assistant-container'), null, { timeout: 30_000 });
    // Um respiro para mensagens tardias do boot.
    await window.waitForTimeout(1500);
  }, 90_000);

  afterAll(async () => {
    try { await app?.close(); } catch (_) { /* ja morreu */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('o loader AMD do Monaco nao acusa modulo duplicado', () => {
    const duplicatas = console_.filter((m) => /Duplicate definition of module/i.test(m.text));
    expect(duplicatas, duplicatas.map((m) => m.text).join('\n')).toEqual([]);
  });

  it('o KaTeX virou global, e nao modulo AMD anonimo', async () => {
    const tipo = await window.evaluate(() => typeof window.katex?.renderToString);
    expect(tipo).toBe('function');
  });

  it('nenhum pageerror durante o boot', () => {
    expect(pageErrors, pageErrors.map((e) => `${e.url}: ${e.message}`).join('\n')).toEqual([]);
  });
});
