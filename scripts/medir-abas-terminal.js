// medir-abas-terminal.js: a barra de abas do terminal ainda cabe, e onde ela
// desiste de caber?
//
// POR QUE ISTO EXISTE. A barra tem sete abas e treze botoes, e cada coisa nova
// que entra ali empurra as outras. O modo de falhar e traicoeiro: a aba tem
// `overflow: hidden`, entao um nome que nao cabe nao transborda, ele some pela
// direita. "Verilog" vira "Verilo" e nada no DOM acusa, porque quem corta e a
// propria aba e o `scrollWidth` do rotulo continua igual ao `clientWidth` dela.
// Foi assim que ninguem viu que havia uma faixa inteira de larguras em que as
// abas eram ilegiveis.
//
// PIOR: enquanto a lista de abas podia encolher (`min-width: 0`), o
// `scrollWidth` da barra NUNCA passava do `clientWidth`, em largura nenhuma. A
// deteccao de estouro do js/terminal/tab_orientation.js, que existe para virar
// a coluna quando a faixa nao cabe, era codigo morto: so o limiar fixo de
// LARGURA_VIRA_COLUNA chegava a disparar, e ele disparava tarde demais.
//
// O QUE ISTO MEDE, e as tres perguntas que respondem se a barra esta sa:
//
//   --corte    (padrao) em que largura do terminal um rotulo comeca a cortar,
//              e em que largura a barra passa a acusar estouro. Os dois numeros
//              tem de coincidir, ou quase: cortar ANTES de estourar e a falha.
//   --centro   o desvio da fileira de abas em relacao ao centro da barra, em
//              varias larguras.
//   --grupos   as tres familias (cadeia de compilacao, PRISM, Shell): quantas
//              abas em cada, o vao dentro contra o vao entre, e a ancora do
//              indicador deslizante, que TEM de ser a lista.
//   --coluna   a geometria da coluna, abaixo do limiar.
//   --tudo     as quatro.
//
// Nao captura tela: mede o DOM, entao `show: false` com `offscreen` basta e nao
// esbarra no problema de composicao de janela oculta.
//
// Ferramenta de manutencao, rodada a mao depois de mexer na barra:
//
//   npx vite build
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/medir-abas-terminal.js
//
// O `env -u ELECTRON_RUN_AS_NODE` nao e enfeite: com essa variavel no ambiente
// o `npx electron` sobe como Node puro e `require('electron')` falha dizendo
// que o modulo nao existe.

'use strict';

const path = require('path');
const { app, BrowserWindow } = require('electron');

const PAGINA = path.resolve(__dirname, '..', 'dist', 'index.html');

const modos = process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2));
const quer = (m) => modos.includes(m) || modos.includes('tudo') || (modos.length === 0 && m === 'corte');

/** Fixa a largura do TERMINAL, que e o que manda na barra, e nao a da janela. */
const largar = (w) => `
  const term = document.querySelector('.terminal-container');
  term.style.width = '${w}px'; term.style.maxWidth = '${w}px';
  void term.offsetWidth;`;

/**
 * Um rotulo cortado NAO se descobre perguntando ao rotulo. Quem tem
 * `overflow: hidden` e a aba, entao o span mantem a largura inteira e
 * transborda para fora dela sem que `scrollWidth` mude. O corte se ve
 * comparando a borda direita do rotulo com a borda direita util da aba.
 */
const CORTADAS = `
  const cortadas = [];
  for (const t of document.querySelectorAll('.terminal-tabs-list .tab')) {
    const lab = t.querySelector('.tab-label');
    // A aba do C+- esconde o rotulo de proposito: o glifo ja e o nome escrito.
    if (!lab || getComputedStyle(lab).display === 'none') continue;
    const rt = t.getBoundingClientRect();
    const limite = rt.right - parseFloat(getComputedStyle(t).paddingRight || 0);
    if (lab.getBoundingClientRect().right > limite + 0.5) cortadas.push(t.dataset.terminal);
  }`;

const corte = (w) => `(() => {${largar(w)}${CORTADAS}
  const barra = document.querySelector('.terminal-tabs');
  return {
    largura: ${w},
    estourou: barra.scrollWidth > barra.clientWidth + 1,
    cortadas: cortadas.join(',') || '-',
  };
})()`;

const centro = (w) => `(() => {${largar(w)}
  const barra = document.querySelector('.terminal-tabs');
  const grupos = [...document.querySelectorAll('.terminal-tabs-group')];
  const rb = barra.getBoundingClientRect();
  const pri = grupos[0].getBoundingClientRect();
  const ult = grupos[grupos.length - 1].getBoundingClientRect();
  return {
    largura: ${w},
    estourou: barra.scrollWidth > barra.clientWidth + 1,
    desvio: Math.round(((pri.left + ult.right) / 2) - (rb.left + rb.width / 2)),
  };
})()`;

const GRUPOS = `(() => {${largar(1400)}
  const lista = document.querySelector('.terminal-tabs-list');
  const grupos = [...document.querySelectorAll('.terminal-tabs-group')];
  const cadeia = [...grupos[0].querySelectorAll('.tab')];
  const vao = (a, b) => Math.round(b.getBoundingClientRect().left - a.getBoundingClientRect().right);
  const ativa = document.querySelector('.terminal-tabs-list .tab.active');
  return {
    abasPorGrupo: grupos.map((x) => x.querySelectorAll('.tab').length).join(' + '),
    vaoDentroDoGrupo: vao(cadeia[0], cadeia[1]) + 'px',
    vaoEntreGrupos: vao(grupos[0], grupos[1]) + 'px',
    divisoriaEntreGrupos: getComputedStyle(grupos[1]).borderLeftWidth,
    // O indicador deslizante mede offsetLeft contra o primeiro ancestral
    // POSICIONADO. Tem de ser a lista: se um grupo ganhar position:relative,
    // o indicador vai parar debaixo da aba errada (js/terminal/terminal.js).
    ancoraDoIndicador: ativa.offsetParent === lista ? 'lista (certo)' : 'ERRADO: ' + ativa.offsetParent.className,
  };
})()`;

const COLUNA = `(() => {
  document.querySelector('.terminal-container').classList.add('tabs-vertical');${largar(700)}
  const lista = document.querySelector('.terminal-tabs-list');
  const grupos = [...document.querySelectorAll('.terminal-tabs-group')];
  const abas = [...document.querySelectorAll('.terminal-tabs-list .tab')];
  const larguras = new Set(abas.map((t) => Math.round(t.getBoundingClientRect().width)));
  const cs = getComputedStyle(lista);
  return {
    empilhadas: abas.every((t, i) => i === 0 || t.getBoundingClientRect().top >= abas[i - 1].getBoundingClientRect().bottom - 1),
    larguraDasAbas: larguras.size === 1 ? [...larguras][0] + 'px (todas iguais)' : 'VARIAS: ' + [...larguras].join(','),
    divisoriaVirouHorizontal: getComputedStyle(grupos[1]).borderTopWidth,
    divisoriaVerticalSumiu: getComputedStyle(grupos[1]).borderLeftWidth === '0px',
    listaSemBordaLateral: cs.borderLeftWidth === '0px' && cs.borderRightWidth === '0px',
  };
})()`;

function tabela(titulo, linhas, colunas) {
  console.log(`\n== ${titulo} ==`);
  console.log(colunas.map((c) => c.rotulo.padStart(c.larg)).join('  '));
  for (const l of linhas) console.log(colunas.map((c) => String(l[c.campo]).padStart(c.larg)).join('  '));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1600, height: 900, show: false,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: false },
  });
  await win.loadFile(PAGINA);
  // O arnes nao sobe a AURORA inteira (nao ha projeto nem IPC), e e de
  // proposito: aqui se mede a BARRA, que e so layout. O tab_orientation nao
  // roda, entao a coluna e forcada pela classe no modo --coluna.
  await new Promise((r) => setTimeout(r, 1200));

  if (quer('corte')) {
    const linhas = [];
    let cortou = null;
    let estourou = null;
    for (let w = 1400; w >= 600; w -= 20) {
      const m = await win.webContents.executeJavaScript(corte(w));
      if (!cortou && m.cortadas !== '-') cortou = w;
      if (!estourou && m.estourou) estourou = w;
      linhas.push(m);
    }
    tabela('corte de rotulo contra estouro da barra', linhas, [
      { rotulo: 'largura', campo: 'largura', larg: 7 },
      { rotulo: 'estourou', campo: 'estourou', larg: 8 },
      { rotulo: 'rotulos cortados', campo: 'cortadas', larg: 30 },
    ]);
    console.log(`\n   primeiro corte de rotulo: ${cortou || 'nenhum'}`);
    console.log(`   primeiro estouro da barra: ${estourou || 'nenhum'}`);
    console.log('   SAO estes dois que tem de coincidir. Cortar antes de estourar quer dizer');
    console.log('   que a coluna chega tarde e ha uma faixa de larguras ilegivel.');
  }

  if (quer('centro')) {
    const linhas = [];
    for (const w of [1400, 1200, 1000, 940, 900, 880, 860]) {
      linhas.push(await win.webContents.executeJavaScript(centro(w)));
    }
    tabela('desvio da fileira em relacao ao centro da barra', linhas, [
      { rotulo: 'largura', campo: 'largura', larg: 7 },
      { rotulo: 'estourou', campo: 'estourou', larg: 8 },
      { rotulo: 'desvio', campo: 'desvio', larg: 7 },
    ]);
  }

  if (quer('grupos')) {
    const m = await win.webContents.executeJavaScript(GRUPOS);
    console.log('\n== as tres familias, em faixa ==');
    for (const [k, v] of Object.entries(m)) console.log(`   ${k}: ${v}`);
  }

  // Por ultimo: poe a classe tabs-vertical e nao tira mais.
  if (quer('coluna')) {
    const m = await win.webContents.executeJavaScript(COLUNA);
    console.log('\n== a coluna, abaixo do limiar ==');
    for (const [k, v] of Object.entries(m)) console.log(`   ${k}: ${v}`);
  }

  app.quit();
}).catch((e) => { console.error(e); app.quit(); });

setTimeout(() => { console.error('a sonda travou'); process.exit(1); }, 120000);
