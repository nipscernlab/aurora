// medir-cabecalho-ia.js: o titulo do painel de IA cabe, ou quebra e some?
//
// POR QUE ISTO EXISTE. O cabecalho tem `height: 34px` FIXO. Um titulo que
// quebra em duas linhas nao empurra o cabecalho: ele transborda e a segunda
// linha e cortada. Na tela isso le como "Aurora / Intelligen", e nada no DOM
// acusa, porque quebrar nao e erro de layout, so fica feio.
//
// O que se mede, em varias larguras do painel:
//   linhas       quantas linhas o titulo ocupa (2 e o defeito);
//   transbordou  o titulo passa da altura util do cabecalho;
//   cortado      o titulo e mais largo do que a caixa dele (ellipsis em acao);
//   sobra        quantos pixels sobram entre o titulo e os botoes.
//
// O painel e construido por JavaScript, e este arnes nao sobe a AURORA inteira.
// Entao o cabecalho e injetado aqui com a MESMA marcacao de
// js/ui/ai_assistant_manager.js, contra o CSS de verdade que a pagina ja carrega.
// Se a marcacao de la mudar, a daqui tem de mudar junto, e o modo --conferir
// avisa quando as duas divergirem.
//
//   npx vite build
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/medir-cabecalho-ia.js
//
// O `env -u ELECTRON_RUN_AS_NODE` nao e enfeite: com essa variavel no ambiente
// o `npx electron` sobe como Node puro e `require('electron')` falha.

'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const PAGINA = path.resolve(__dirname, '..', 'dist', 'index.html');
const FONTE = path.resolve(__dirname, '..', 'js', 'ui', 'ai_assistant_manager.js');

// As larguras que interessam: o painel abre perto de 420 e a pessoa arrasta.
const LARGURAS = [560, 500, 460, 420, 380, 340, 300];

/** A marcacao do cabecalho, copiada de ai_assistant_manager.js. */
const CABECALHO = `
<div class="ai-assistant-container" id="sonda-painel">
  <div class="ai-assistant-header">
    <div class="ai-header-left">
      <span class="ai-assistant-mark"><img src="./assets/icons/ai_claude.svg" alt="" class="ai-provider-icon"></span>
      <h3 class="ai-assistant-title">Aurora Intelligence</h3>
    </div>
    <div class="ai-header-right">
      <button class="ai-hbtn"><i class="ph ph-clock-counter-clockwise"></i></button>
      <button class="ai-hbtn"><i class="ph ph-graduation-cap"></i></button>
      <button class="ai-hbtn"><i class="ph ph-pencil-simple-line"></i></button>
      <button class="ai-hbtn"><i class="ph ph-question"></i></button>
      <button class="ai-hbtn"><i class="ph ph-x"></i></button>
    </div>
  </div>
</div>`;

const MEDIR = (largura) => `(() => {
  let p = document.getElementById('sonda-painel');
  if (!p) {
    const alvo = document.querySelector('.main-container') || document.body;
    alvo.insertAdjacentHTML('beforeend', ${JSON.stringify(CABECALHO)});
    p = document.getElementById('sonda-painel');
  }
  // A transicao de largura do painel e de 240ms, e ela existe para a animacao
  // de abrir. Medir logo depois de atribuir a largura leria o painel a meio
  // caminho: foi o que fez a primeira versao desta sonda devolver o mesmo
  // numero em todas as larguras.
  p.style.transition = 'none';
  p.style.width = '${largura}px';
  p.style.position = 'fixed';
  p.style.right = '0';
  p.style.top = '0';
  void p.offsetWidth;

  const cab = p.querySelector('.ai-assistant-header');
  const tit = p.querySelector('.ai-assistant-title');
  const dir = p.querySelector('.ai-header-right');
  const cs = getComputedStyle(tit);
  const alturaDaLinha = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
  const rt = tit.getBoundingClientRect();
  const rd = dir.getBoundingClientRect();
  return {
    largura: ${largura},
    linhas: Math.max(1, Math.round(rt.height / alturaDaLinha)),
    transbordou: rt.height > cab.getBoundingClientRect().height + 0.5,
    cortado: tit.scrollWidth > tit.clientWidth + 1,
    sobra: Math.round(rd.left - rt.right),
    // Conferencia da propria sonda: se esta coluna nao acompanhar a largura
    // pedida, a medida nao vale e o resto da linha e ruido.
    painel: Math.round(p.getBoundingClientRect().width),
  };
})()`;

function conferirMarcacao() {
  const fonte = fs.readFileSync(FONTE, 'utf8');
  const faltando = ['ai-assistant-header', 'ai-header-left', 'ai-header-right', 'ai-assistant-title', 'ai-assistant-mark']
    .filter((c) => !fonte.includes(c));
  if (faltando.length) {
    console.log(`\n  AVISO: estas classes nao estao mais em ai_assistant_manager.js: ${faltando.join(', ')}`);
    console.log('  A marcacao deste arnes ficou velha; atualize-a antes de confiar no numero.\n');
  }
}

app.whenReady().then(async () => {
  conferirMarcacao();
  const win = new BrowserWindow({
    width: 1600, height: 900, show: false,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: false },
  });
  await win.loadFile(PAGINA);
  await new Promise((r) => setTimeout(r, 1200));

  console.log('largura  linhas  transbordou  cortado  sobra  painel');
  let quebrou = null;
  let truncou = null;
  for (const w of LARGURAS) {
    const m = await win.webContents.executeJavaScript(MEDIR(w));
    if (!quebrou && m.linhas > 1) quebrou = w;
    if (!truncou && m.cortado) truncou = w;
    console.log(
      String(m.largura).padStart(7),
      String(m.linhas).padStart(7),
      String(m.transbordou).padStart(12),
      String(m.cortado).padStart(8),
      String(m.sobra).padStart(6),
      String(m.painel).padStart(7),
    );
  }
  console.log('');
  console.log(`  primeira largura em que o titulo QUEBRA: ${quebrou || 'nenhuma'}`);
  console.log(`  primeira largura em que ele e CORTADO com reticencias: ${truncou || 'nenhuma'}`);
  console.log('  Quebrar e o defeito: o cabecalho tem altura fixa, entao a segunda');
  console.log('  linha nao aparece. Cortar com reticencias e o desfecho aceitavel.');
  app.quit();
}).catch((e) => { console.error(e); app.quit(); });

setTimeout(() => { console.error('a sonda travou'); process.exit(1); }, 90000);
