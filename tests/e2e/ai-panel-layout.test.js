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

/**
 * O limiar sai do próprio `js/terminal/tab_orientation.js`, lido do fonte em vez
 * de copiado: importar o módulo aqui não dá, porque ele se instala sozinho no
 * `DOMContentLoaded` e este arquivo roda em Node. Copiar o número deixaria o
 * teste passar a medir um limiar que o produto não usa mais.
 */
const LIMIAR_COLUNA = (() => {
  const fonte = fs.readFileSync(path.join(REPO_ROOT, 'js', 'terminal', 'tab_orientation.js'), 'utf8');
  const m = fonte.match(/LARGURA_VIRA_COLUNA\s*=\s*(\d+)/);
  if (!m) throw new Error('nao achei LARGURA_VIRA_COLUNA em js/terminal/tab_orientation.js');
  return Number(m[1]);
})();

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

  // O caso "apertou muito" e coberto pelo teste da coluna, logo abaixo: abaixo
  // do limiar as abas empilham e o botao de excedente sai de cena de proposito.
  // O botao continua valendo na faixa intermediaria, larga o bastante para
  // ficar horizontal e com abas demais para caberem.

  it('terminal estreito empilha as abas numa coluna a direita', async () => {
    // O gatilho e a largura do TERMINAL, nao a da janela. Aqui ele e forcado
    // pelos dois lados: largo tem que ficar em faixa, estreito em coluna.
    const medir = () => window.evaluate(() => {
      const term = document.querySelector('.terminal-container');
      const lista = document.querySelector('.terminal-tabs-list');
      const abas = [...document.querySelectorAll('.terminal-tabs .tab')];
      const cs = window.getComputedStyle(document.querySelector('.terminal-tabs'));
      return {
        larguraTerminal: Math.round(term.getBoundingClientRect().width),
        coluna: term.classList.contains('tabs-vertical'),
        direcao: cs.flexDirection,
        // Em coluna as abas ficam empilhadas: mesma esquerda, alturas diferentes.
        empilhadas: abas.length > 1
          && Math.abs(abas[0].getBoundingClientRect().left - abas[1].getBoundingClientRect().left) < 2
          && abas[1].getBoundingClientRect().top > abas[0].getBoundingClientRect().top,
        listaVisivel: !!lista && lista.getBoundingClientRect().width > 0,
      };
    });

    // Largo: faixa horizontal. Os DOIS vizinhos saem do caminho, e não só o
    // painel de IA. A largura do terminal é o que sobra da janela depois da
    // árvore, do painel e dos trilhos, e o limiar é 780: numa tela de 900 px
    // úteis, com a árvore aberta o terminal chega a 615 e nunca passa, então o
    // teste media a tela da máquina em vez do comportamento. Falhou nas duas
    // pontas por isso, com 639 na máquina de quem escreve e 763 no runner do CI.
    await window.evaluate(() => {
      const c = document.querySelector('.ai-assistant-container');
      c.style.transition = 'none';
      c.style.width = '0px';
      const t = document.querySelector('.file-tree-container');
      if (t) {
        t.style.transition = 'none';
        if (t.clientWidth > 0) window.toggleSidebar();
      }
    });
    // Esperar a CLASSE sair, e não um tempo fixo: quem decide a orientação é um
    // ResizeObserver coalescido por quadro, então 250 ms era um chute que às
    // vezes media antes de o observador ter rodado.
    await window.waitForFunction(
      () => !document.querySelector('.terminal-container')?.classList.contains('tabs-vertical'),
      null, { timeout: 5_000 },
    );
    const largo = await medir();
    expect(
      largo.larguraTerminal,
      `com árvore e painel colapsados o terminal mede ${largo.larguraTerminal} px;`
      + ` abaixo de ${LIMIAR_COLUNA} não dá para exercitar a faixa horizontal`
      + ' (tela de trabalho estreita demais para este teste)',
    ).toBeGreaterThan(LIMIAR_COLUNA);
    expect(largo.coluna, 'terminal largo deve ficar em faixa').toBe(false);

    // Estreito: o painel de IA come a largura ate o terminal cair do limiar.
    await window.evaluate(() => {
      const c = document.querySelector('.ai-assistant-container');
      c.style.width = window.aiAssistantManager._larguraPermitida(99999) + 'px';
    });
    await window.waitForFunction(
      () => document.querySelector('.terminal-container')?.classList.contains('tabs-vertical'),
      null, { timeout: 5_000 },
    );
    const estreito = await medir();
    expect(estreito.larguraTerminal).toBeLessThan(LIMIAR_COLUNA);
    expect(estreito.coluna, 'terminal estreito deve virar coluna').toBe(true);
    expect(estreito.direcao, 'a barra tem que virar coluna de verdade').toBe('column');
    expect(estreito.empilhadas, 'as abas tem que ficar uma sobre a outra').toBe(true);

    // Devolve a árvore, porque os testes seguintes partem do estado montado e um
    // deles mede a faixa que ela ocupa.
    await window.evaluate(() => {
      const t = document.querySelector('.file-tree-container');
      if (t && t.clientWidth === 0) window.toggleSidebar();
    });
    await window.waitForTimeout(250);
  }, 40_000);

  it('painel colapsado volta com UM clique no trilho da borda', async () => {
    // O relato do usuario: colapsado por inteiro, nao consigo recuperar nem a
    // arvore nem o painel de IA. Medido em 08/08/2026, colapsado o divisor de
    // cada painel fica com 8 px (arvore) e 3 px (IA) agarraveis colados na
    // borda da janela, porque ele mora DENTRO do painel e os dois containers
    // tem `overflow: hidden` — e nenhum dos dois responde a clique, so a
    // arrasto. Os trilhos existem fora dos paineis e por isso sobrevivem ao
    // colapso, que e a propriedade que o divisor do terminal sempre teve.
    //
    // O segundo defeito era de estado: o arrasto colapsava mexendo so na
    // largura e no `is-collapsed`, e o `toggle()` lia a classe `open`, que o
    // arrasto nunca tirava. O primeiro clique no botao mandava fechar o que ja
    // estava fechado. Por isso o teste exige UM clique, e nao dois.
    const estado = () => window.evaluate(() => {
      // Duas medidas, porque as duas perguntas são diferentes. `clientWidth`
      // responde "está colapsado?", e tem que ser ele: o painel de IA tem borda
      // esquerda de 1 px, então fechado mede 1 na caixa de borda e nunca 0.
      // `offsetWidth` responde "abriu pelo menos o mínimo?", e tem que ser ele
      // porque PANE.MIN_AI é medida de caixa de borda — comparar o clientWidth
      // contra 320 reprovava por exatamente 1 px sempre que a janela fosse
      // estreita a ponto de o painel abrir colado no piso.
      const caixa = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return { largura: el.clientWidth, caixaBorda: el.offsetWidth, visivel: el.clientWidth > 0 };
      };
      return {
        tree: caixa('.file-tree-container'),
        ai: caixa('.ai-assistant-container'),
        railLeft: caixa('.edge-rail-left'),
        railRight: caixa('.edge-rail-right'),
        bodyClasses: document.body.className,
      };
    });

    // Deixa os dois paineis abertos e sem animacao.
    await window.evaluate(() => {
      for (const s of ['.file-tree-container', '.ai-assistant-container']) {
        const e = document.querySelector(s);
        if (e) e.style.transition = 'none';
      }
      const m = window.aiAssistantManager;
      if (document.querySelector('.ai-assistant-container').clientWidth === 0) m.toggle();
      if (document.querySelector('.file-tree-container').clientWidth === 0) window.toggleSidebar();
    });
    await window.waitForTimeout(400);
    const aberto = await estado();
    expect(aberto.tree.largura, 'a arvore precisa comecar aberta').toBeGreaterThan(0);
    expect(aberto.ai.largura, 'o painel precisa comecar aberto').toBeGreaterThan(0);
    expect(aberto.railLeft.visivel, 'trilho escondido com a arvore aberta').toBe(false);
    expect(aberto.railRight.visivel, 'trilho escondido com o painel aberto').toBe(false);

    // Colapsa os dois pelo MESMO caminho que o arrasto usa: a largura passada
    // pelo limite, que devolve 0 quando o arrasto forca alem do limiar.
    await window.evaluate(() => {
      window.aiAssistantManager._aplicarLargura(
        window.aiAssistantManager._larguraPermitida(-500));
      window.toggleSidebar();
    });
    await window.waitForTimeout(400);
    const fechado = await estado();
    expect(fechado.tree.largura, 'a arvore tinha que ter colapsado').toBe(0);
    expect(fechado.ai.largura, 'o painel tinha que ter colapsado').toBe(0);
    expect(fechado.railLeft.visivel, 'o trilho da esquerda tem que aparecer').toBe(true);
    expect(fechado.railRight.visivel, 'o trilho da direita tem que aparecer').toBe(true);

    // Um clique em cada trilho, e os dois voltam.
    await window.click('.edge-rail-left');
    await window.waitForTimeout(400);
    expect((await estado()).tree.largura, 'um clique tem que trazer a arvore')
      .toBeGreaterThan(0);

    await window.click('.edge-rail-right');
    await window.waitForTimeout(500);
    const volta = await estado();
    expect(volta.ai.caixaBorda, 'um clique tem que trazer o painel de IA')
      .toBeGreaterThanOrEqual(320);
    expect(volta.railLeft.visivel, 'o trilho some quando a arvore volta').toBe(false);
    expect(volta.railRight.visivel, 'o trilho some quando o painel volta').toBe(false);
  }, 60_000);

  it('com o divisor no maximo nao sobra vao acima do terminal', async () => {
    // Medido em 08/08/2026, com o aplicativo de pé: numa janela de 912 px o
    // arrasto pedia 795 px de altura e a caixa desenhava 730, porque o
    // `terminal.css` impunha um `max-height: 80vh` que o `resize.js` não
    // conhecia. A diferença virava faixa morta acima do terminal, e empurrar o
    // divisor não fechava, porque para o JS ele já estava no fim do curso.
    //
    // O invariante é o que o usuário enxerga: o que o arrasto pediu é o que a
    // caixa tem, e entre o divisor e o topo do terminal não sobra nada.
    await window.evaluate(() => {
      const t = document.querySelector('.terminal-container');
      if (t) t.style.transition = 'none';
      const c = document.querySelector('.ai-assistant-container');
      if (c) { c.style.transition = 'none'; c.style.width = '0px'; }
    });
    await window.waitForTimeout(250);

    const r = await window.evaluate(() => {
      const b = document.querySelector('.resizer-horizontal').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await window.mouse.move(r.x, r.y);
    await window.mouse.down();
    for (let y = r.y; y > 0; y -= 40) {
      await window.mouse.move(r.x, Math.max(0, y));
      await window.waitForTimeout(16);
    }
    await window.mouse.move(r.x, 0);
    await window.waitForTimeout(60);
    await window.mouse.up();
    await window.waitForTimeout(300);

    const g = await window.evaluate(() => {
      const t = document.querySelector('.terminal-container');
      const res = document.querySelector('.resizer-horizontal');
      const faixa = document.querySelector('.editor-terminal-container');
      const tr = t.getBoundingClientRect();
      const rr = res.getBoundingClientRect();
      const fr = faixa.getBoundingClientRect();
      return {
        pedido: parseFloat(t.style.height),
        desenhado: tr.height,
        topoTerminal: tr.top,
        baseDivisor: rr.bottom,
        baseTerminal: tr.bottom,
        baseFaixa: fr.bottom,
        alturaFaixa: fr.height,
      };
    });

    // O CSS não pode mais cortar o que o JS decidiu.
    expect(Math.abs(g.pedido - g.desenhado), 'a altura pedida tem que ser a desenhada')
      .toBeLessThanOrEqual(1);
    // E o terminal encosta no divisor em cima e no fim da faixa embaixo.
    expect(Math.abs(g.topoTerminal - g.baseDivisor)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.baseTerminal - g.baseFaixa)).toBeLessThanOrEqual(1);
    // O editor continua de pé: o terminal não pode tomar a faixa inteira.
    expect(g.alturaFaixa - g.desenhado).toBeGreaterThanOrEqual(100);
  }, 40_000);

  it('regiao rolavel que nao e controle nao pinta anel de foco', async () => {
    // O Chromium torna toda região rolável alcançável pelo teclado, mesmo sem
    // `tabindex`. Com um `:focus-visible` de seletor universal no CSS, o corpo
    // do terminal e as áreas de rolagem do chat e do editor ganhavam um anel de
    // 1 px em volta do painel inteiro; recortado pelo `overflow: hidden` do
    // painel, ele aparecia como um risco de acento colado na borda.
    const infratores = [];
    for (let i = 0; i < 60; i++) {
      await window.keyboard.press('Tab');
      const quem = await window.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = window.getComputedStyle(el);
        const pinta = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
        if (!pinta) return null;
        const eControle = /^(a|button|input|select|textarea)$/i.test(el.tagName)
          || el.hasAttribute('tabindex');
        if (eControle) return null;
        return `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`
          + ` [${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}]`;
      });
      if (quem) infratores.push(quem);
    }
    expect([...new Set(infratores)], 'so controle pode desenhar anel de foco').toEqual([]);
  }, 40_000);

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
