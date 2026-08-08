// tests/e2e/ai-panel-layout.test.js
//
// Mede a geometria real dos painéis, com o aplicativo de pé.
//
// Este teste existe porque o bug do painel de IA cobrindo o terminal foi
// "consertado" duas vezes lendo CSS e continuou acontecendo. Ler regra de estilo
// diz o que deveria acontecer; só medir a caixa diz o que acontece. O invariante
// é simples e é o que o usuário enxerga: a borda esquerda do painel de IA nunca
// pode passar por cima da borda direita do terminal, e o editor nunca fica sem o
// espaço mínimo dele.
//
// Roda contra uma instância própria, com user-data-dir isolado, então não
// interfere com nenhuma AURORA aberta na máquina.

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

/** Retângulos dos três painéis, do jeito que o navegador os desenhou. */
const MEDIR = () => {
  const caixa = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
  };
  return {
    faixa: caixa('.main-container'),
    tree: caixa('.file-tree-container'),
    editorTerm: caixa('.editor-terminal-container'),
    terminal: caixa('.terminal-container'),
    ai: caixa('.ai-assistant-container'),
  };
};

describe('E2E — o painel de IA nunca cobre o terminal', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;
  let userDataDir;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-layout-'));
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });
    window = await waitForMainWindow(app);
    await window.waitForSelector('.main-container', { timeout: 20_000 });
    // Esperar o load importa: o renderer inicializa o painel no window.onload,
    // e mexer antes disso mede um estado que o usuario nunca ve.
    await window.waitForLoadState('load');
    await window.waitForFunction(
      () => !!document.querySelector('.ai-assistant-container'), null, { timeout: 20_000 },
    );
  }, 60_000);

  afterAll(async () => {
    try { await app?.close(); } catch (_) { /* já morreu */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('abre o painel e ele fica ao lado, nao por cima', async () => {
    // Abre pelo próprio gerenciador, sem clicar: é o mesmo caminho do botão.
    // A transição de largura é desligada antes: numa janela que o compositor
    // considera não visível, como a deste teste, o Chromium PAUSA a animação e
    // a largura congela perto de zero. Medir isso mediria o pausar do
    // compositor, não o layout. Aqui interessa a geometria, não a animação.
    await window.evaluate(() => {
      const c = document.querySelector('.ai-assistant-container');
      if (c) c.style.transition = 'none';
      window.aiAssistantManager?.toggle?.();
    });
    await window.waitForTimeout(200);

    const g = await window.evaluate(MEDIR);
    expect(g.ai, 'o painel de IA precisa existir depois do toggle').toBeTruthy();
    // Existe UM painel, e nao dois: initialize() ja rodou no window.onload e o
    // toggle nao pode criar outro. Dois paineis empilhados foi um bug real.
    const quantos = await window.evaluate(
      () => document.querySelectorAll('.ai-assistant-container').length,
    );
    expect(quantos, 'nao pode haver mais de um painel de IA').toBe(1);
    expect(g.ai.width, 'o painel devia abrir na largura util, nao num fiapo')
      .toBeGreaterThanOrEqual(320);

    // O invariante: nada pode invadir a faixa do vizinho.
    expect(g.ai.left).toBeGreaterThanOrEqual(g.editorTerm.right - 1);
    if (g.terminal) expect(g.ai.left).toBeGreaterThanOrEqual(g.terminal.right - 1);
  }, 30_000);

  it('forcar uma largura absurda nao espreme o editor a zero', async () => {
    // É exatamente o caso que quebrava: largura salva de uma janela maior,
    // ou um arrasto forçado até o fim.
    const g = await window.evaluate(() => {
      const m = window.aiAssistantManager;
      const c = document.querySelector('.ai-assistant-container');
      // Passa pelo mesmo caminho que o arrasto e a abertura usam.
      c.style.width = m._larguraPermitida(99999) + 'px';
      const caixa = (sel) => {
        const el = document.querySelector(sel);
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
      };
      return {
        editorTerm: caixa('.editor-terminal-container'),
        ai: caixa('.ai-assistant-container'),
        faixa: caixa('.main-container'),
      };
    });

    expect(g.editorTerm.width).toBeGreaterThanOrEqual(320);
    expect(g.ai.left).toBeGreaterThanOrEqual(g.editorTerm.right - 1);
    // E a soma continua cabendo na faixa.
    expect(g.ai.right).toBeLessThanOrEqual(g.faixa.right + 1);
  }, 30_000);
});
