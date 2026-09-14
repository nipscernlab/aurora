// gerar-icone-sapho.js: monta assets/icons/sapho_aurora_icon.ico a partir das
// DUAS artes da marca.
//
// POR QUE DUAS ARTES. A marca do SAPHO tem 34 escamas em espiral de filotaxia.
// Em tamanho grande ela le como pele de reptil, que e o ponto; em 16 ou 24 px
// as escamas somem e sobra textura suja. Por isso o pacote traz tambem uma arte
// de 20 escamas, mais grossas, que sobrevive no tamanho pequeno.
//
// ONDE FICA A FRONTEIRA, e por que aqui e nao onde o README do pacote sugere.
// O README manda usar a reduzida so em 16 e 20 px. So que a BARRA DE TAREFAS do
// Windows nao pede 16: ela pede 24 px a 100% de escala e 32 px a 150%, que e o
// ajuste mais comum em telas de hoje. Deixar 24 e 32 com a arte cheia e deixar
// a barra de tarefas, que e onde a marca mais aparece, com a versao errada.
// Entao a reduzida vai ate 32 px, e a cheia assume de 40 para cima.
// Mover essa fronteira e mudar `ATE_REDUZIDA` abaixo.
//
// POR QUE UM SCRIPT, e nao uma linha de `magick`. O pacote entrega PNG pronto
// so para os tamanhos que o desenhista previu; 24 e 32 da arte reduzida nao
// existem como arquivo. Rasterizar aqui, pelo Chromium que o Electron ja traz,
// evita depender do ImageMagick estar instalado e vem do vetor, nao de uma
// reducao de bitmap.
//
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/gerar-icone-sapho.js
//
// O `env -u ELECTRON_RUN_AS_NODE` nao e enfeite: com essa variavel no ambiente
// o `npx electron` sobe como Node puro e `require('electron')` falha.

'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const ICONES = path.resolve(__dirname, '..', 'assets', 'icons');
const CHEIA = path.join(ICONES, 'sapho_aurora_icon.svg');
const REDUZIDA = path.join(ICONES, 'sapho_aurora_icon.small.svg');
const SAIDA = path.join(ICONES, 'sapho_aurora_icon.ico');

/** O maior tamanho que ainda usa a arte reduzida. */
const ATE_REDUZIDA = 32;

/** Os tamanhos que entram no .ico, do menor ao maior. */
const TAMANHOS = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

/**
 * Rasteriza um SVG num PNG do tamanho pedido, pelo Chromium.
 *
 * Desenha num canvas do tamanho exato, entao o resultado vem do VETOR e nao de
 * uma reducao de bitmap: em 16 px a diferenca entre as duas coisas e visivel.
 */
async function rasterizar(win, arquivoSvg, lado) {
  // O SVG vai como data URL, e nao como caminho `file://`. A pagina onde o
  // canvas vive tem origem opaca, e o Chromium recusa carregar uma imagem
  // `file://` dentro dela; mesmo carregando, uma imagem de outra origem
  // sujaria o canvas e o `toDataURL` jogaria SecurityError. Em data URL nao
  // ha origem para cruzar.
  const url = 'data:image/svg+xml;base64,' + fs.readFileSync(arquivoSvg).toString('base64');
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((ok, falhou) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = ${lado}; c.height = ${lado};
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, ${lado}, ${lado});
      ctx.drawImage(img, 0, 0, ${lado}, ${lado});
      ok(c.toDataURL('image/png'));
    };
    img.onerror = () => falhou(new Error('nao carregou ' + ${JSON.stringify(url)}));
    img.src = ${JSON.stringify(url)};
  })`);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/**
 * Monta o .ico.
 *
 * Entradas em PNG, que e o que o Windows le desde o Vista e o que o
 * electron-builder espera. O lado 0 no cabecalho quer dizer 256.
 */
function montarIco(entradas) {
  const cab = Buffer.alloc(6);
  cab.writeUInt16LE(0, 0);
  cab.writeUInt16LE(1, 2);
  cab.writeUInt16LE(entradas.length, 4);

  let desloc = 6 + 16 * entradas.length;
  const dir = [];
  const corpo = [];
  for (const { lado, png } of entradas) {
    const e = Buffer.alloc(16);
    e.writeUInt8(lado >= 256 ? 0 : lado, 0);
    e.writeUInt8(lado >= 256 ? 0 : lado, 1);
    e.writeUInt8(0, 2);            // paleta
    e.writeUInt8(0, 3);            // reservado
    e.writeUInt16LE(1, 4);         // planos
    e.writeUInt16LE(32, 6);        // bits por pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(desloc, 12);
    dir.push(e);
    corpo.push(png);
    desloc += png.length;
  }
  return Buffer.concat([cab, ...dir, ...corpo]);
}

app.whenReady().then(async () => {
  for (const p of [CHEIA, REDUZIDA]) {
    if (!fs.existsSync(p)) {
      console.error(`falta ${path.basename(p)} em assets/icons`);
      app.exit(1);
      return;
    }
  }

  const win = new BrowserWindow({
    width: 600, height: 400, show: false,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: false },
  });
  await win.loadURL('data:text/html,<body style="margin:0"></body>');

  const entradas = [];
  for (const lado of TAMANHOS) {
    const reduzida = lado <= ATE_REDUZIDA;
    const png = await rasterizar(win, reduzida ? REDUZIDA : CHEIA, lado);
    entradas.push({ lado, png });
    console.log(`  ${String(lado).padStart(3)} px  ${reduzida ? 'reduzida (20 escamas)' : 'marca (34 escamas)'}  ${String(png.length).padStart(7)} bytes`);
  }

  fs.writeFileSync(SAIDA, montarIco(entradas));
  console.log(`\n  ${path.relative(path.resolve(__dirname, '..'), SAIDA)}: ${entradas.length} tamanhos, ${fs.statSync(SAIDA).size} bytes`);
  console.log(`  a arte reduzida cobre ate ${ATE_REDUZIDA} px, que e o que a barra de tarefas pede`);
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });

setTimeout(() => { console.error('o gerador travou'); process.exit(1); }, 60000);
