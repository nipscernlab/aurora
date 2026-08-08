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

  it('nada do terminal aparece dentro do painel', async () => {
    // A regra, na palavra do usuario: a borda direita do terminal fica COLADA
    // na borda esquerda do painel, nunca dentro dele. As abas eram o furo: a
    // lista nao encolhia, entao as ultimas eram cortadas exatamente naquela
    // borda, o que na tela e indistinguivel do painel estar por cima.
    const r = await window.evaluate(() => {
      const ai = document.querySelector('.ai-assistant-container');
      const term = document.querySelector('.terminal-container');
      const aiLeft = ai.getBoundingClientRect().left;
      const fora = [];
      const visitar = (el, prof) => {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.right > aiLeft + 1) {
          fora.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`
            + ` passa ${Math.round(b.right - aiLeft)}px`);
        }
        if (prof < 4) for (const f of el.children) visitar(f, prof + 1);
      };
      visitar(term, 0);
      return {
        colado: Math.round(term.getBoundingClientRect().right) === Math.round(aiLeft),
        fora,
      };
    });
    expect(r.colado, 'a borda do terminal tem que encostar na do painel').toBe(true);
    expect(r.fora, 'nada do terminal pode entrar na faixa do painel').toEqual([]);
  }, 30_000);

  it('apertando muito, as abas que sobram vao para a lista', async () => {
    // O limite seguinte do aperto: comprimir tem fim, e depois dele as abas
    // encavalavam os botoes de acao. Aqui o painel de IA e alargado ate o teto
    // e o esperado e ver o botao de excedente, nao abas em cima dos botoes.
    await window.evaluate(() => {
      const c = document.querySelector('.ai-assistant-container');
      c.style.transition = 'none';
      c.style.width = window.aiAssistantManager._larguraPermitida(99999) + 'px';
    });
    // Esperar pela CONDICAO, e nao por um tempo fixo: o ResizeObserver reage no
    // proximo quadro, mas prender o teste a um numero de milissegundos e o que
    // produz teste intermitente.
    await window.waitForFunction(() => {
      const b = document.querySelector('.terminal-tab-overflow-btn');
      return !!b && !b.classList.contains('hidden');
    }, null, { timeout: 5_000 });

    const r = await window.evaluate(() => {
      const btn = document.querySelector('.terminal-tab-overflow-btn');
      const abas = [...document.querySelectorAll('.terminal-tabs .tab')];
      const ativa = abas.find((t) => t.classList.contains('active'));
      const acoes = [...document.querySelectorAll('.terminal-tabs-actions')];
      const visiveis = abas.filter((t) => !t.classList.contains('tab-overflowed'));

      // Nenhuma aba visivel pode invadir a area das acoes.
      const invade = visiveis.some((t) => acoes.some((a) => {
        const rt = t.getBoundingClientRect();
        const ra = a.getBoundingClientRect();
        return rt.right > ra.left + 1 && rt.left < ra.right - 1;
      }));

      return {
        temBotao: !!btn && !btn.classList.contains('hidden'),
        escondidas: abas.length - visiveis.length,
        ativaVisivel: !!ativa && !ativa.classList.contains('tab-overflowed'),
        invade,
      };
    });

    expect(r.escondidas, 'com o painel no maximo alguma aba tem que sair').toBeGreaterThan(0);
    expect(r.temBotao, 'havendo aba oculta, o botao da lista aparece').toBe(true);
    expect(r.ativaVisivel, 'a aba ativa nunca pode ser escondida').toBe(true);
    expect(r.invade, 'nenhuma aba pode encavalar os botoes de acao').toBe(false);
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
