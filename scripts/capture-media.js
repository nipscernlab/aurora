// capture-media.js: take the README's screenshots and GIFs from the real
// application.
//
// Maintainer tool, run by hand:
//
//   node scripts/capture-media.js                 hero.png (o padrao)
//   node scripts/capture-media.js split-editor    split-editor.gif
//   node scripts/capture-media.js compile         compile.gif
//   node scripts/capture-media.js prism           prism.gif
//   node scripts/capture-media.js tudo            todas as anteriores
//   node scripts/capture-media.js --help
//
// Nao esta em nenhum script do npm nem em workflow: abre uma janela de
// verdade, toma dezenas de segundos e, no caso do compile, roda a toolchain.
//
// waveform.gif NAO sai daqui, e nao e esquecimento: o GTKWave e o Surfer sao
// janelas externas, fora do alcance do Playwright, que so enxerga superficie
// de renderer do proprio Electron. Ou e gravacao de tela feita a mao, ou
// espera o Surfer embutido.
//
// O GIF sai de quadros PNG capturados em intervalo fixo e montados pelo
// ffmpeg, que NAO e dependencia do projeto. Sem ffmpeg no PATH, os quadros
// ficam no disco e o script imprime o comando que os transforma em GIF, em
// vez de estourar: quem esta atras de uma imagem para o README nao deveria
// descobrir uma dependencia nova por stack trace.
//
// Why a script instead of someone pressing PrtScn: the shots have to be
// retaken whenever the interface changes, and a hand-taken one carries
// whatever the maintainer's desktop looked like that day, window size,
// scaling, the projects they had open, their own file paths. This builds a
// throwaway project, opens it, and captures at a fixed size, so the same
// command produces the same framing on any machine.
//
// The window is resized past the monitor on purpose. The machine this was
// written on has a 900 px wide desktop, and Windows lets a restored window
// extend beyond the screen edge, so `setBounds` to 1600 really does give the
// renderer a 1600 px viewport that reflows the layout properly. Playwright
// screenshots the renderer surface rather than the desktop, so the part
// hanging off-screen is captured like any other.
//
// The DevTools `Emulation.setDeviceMetricsOverride` route was tried first and
// is wrong here: it resizes the surface without the app's layout following, so
// the capture came out as the 900 px interface on a 1600 px canvas, with the
// remainder black.
//
// The project it opens is a real SAPHO processor (the moving-average from the
// manual, the same fixture the toolchain test compiles), not lorem ipsum: a
// screenshot of an empty editor sells nothing, and inventing plausible-looking
// C± would put code in the README that no compiler ever accepted.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'media');
const FIXTURE_CMM = path.join(REPO_ROOT, 'tests', 'toolchain', 'fixtures', 'mediamovel.cmm');

const WIDTH = 1600;
const HEIGHT = 1000;

// O GIF entra no README, onde a coluna e estreita: 900 px de largura ja
// mostra o que interessa e evita um arquivo de dezenas de megabytes. Oito
// quadros por segundo bastam para interface (nao ha animacao continua a
// preservar) e cada quadro custa uma captura de tela do renderer.
const GIF_LARGURA = 900;
const GIF_FPS = 8;

const TOMADAS = {
  hero: 'hero.png, a foto do editor com arvore e terminal',
  'split-editor': 'split-editor.gif, abrir o segundo painel e levar um arquivo para ele',
  compile: 'compile.gif, uma compilacao C+- de verdade enchendo o terminal',
  prism: 'prism.gif, a sintese e o esquematico do PRISM',
};

// O top level e o testbench do projeto descartavel. Ficam aqui em cima, e
// nao embutidos no meio da funcao, porque sao Verilog de verdade: a
// elaboracao os le e reclama de qualquer porta inventada.
const TOP_LEVEL_V = "`timescale 1ns/1ps\n// Top level: liga o processador SAPHO aos pinos da placa.\n//\n// A interface do processador NAO e escolha deste arquivo: o yanc a gera a\n// partir do .cmm e da configuracao do .spf. Sao clk e rst, a porta de\n// entrada `in` e a de saida `out` com a largura da palavra, `req_in`\n// pedindo a proxima amostra e `out_en` marcando saida valida. Inventar\n// nome de porta aqui custa uma elaboracao que falha antes de qualquer\n// sintese, que foi o que aconteceu em 23/08/2026.\nmodule top_mediamovel (\n  input  wire               clk,\n  input  wire               rst,\n  input  wire signed [15:0] sample_in,\n  output wire signed [15:0] sample_out,\n  output wire               sample_req,\n  output wire               sample_valid\n);\n  mediamovel proc (\n    .clk    (clk),\n    .rst    (rst),\n    .in     (sample_in),\n    .out    (sample_out),\n    .req_in (sample_req),\n    .out_en (sample_valid)\n  );\nendmodule\n";

const TESTBENCH_V = "`timescale 1ns/1ps\nmodule tb_mediamovel;\n  reg                clk = 0;\n  reg                rst = 1;\n  reg  signed [15:0] sample_in = 0;\n  wire signed [15:0] sample_out;\n  wire               sample_req;\n  wire               sample_valid;\n\n  top_mediamovel dut (\n    .clk(clk), .rst(rst),\n    .sample_in(sample_in), .sample_out(sample_out),\n    .sample_req(sample_req), .sample_valid(sample_valid)\n  );\n\n  always #5 clk = ~clk;\n\n  initial begin\n    $dumpfile(\"tb_mediamovel.vcd\");\n    $dumpvars(0, tb_mediamovel);\n    #20 rst = 0;\n    repeat (16) begin\n      @(posedge clk) sample_in <= $random % 512;\n    end\n    #100 $finish;\n  end\nendmodule\n";

/** Electron refuses to start in Node-only mode; strip it if the shell has it. */
function cleanEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    out[k] = v;
  }
  // main/lifecycle.js holds a single-instance lock, so this would otherwise
  // fail whenever the maintainer has AURORA open, which, while working on
  // the interface, is always.
  out.SAPHO_SKIP_SINGLE_INSTANCE = '1';
  return out;
}

/**
 * A project AURORA recognises: a processor written in C±, the Verilog top
 * level that instantiates it, and a testbench. Paths inside the .spf are
 * absolute because the app uses them verbatim, so it is generated here rather
 * than committed.
 */
function writeProject(rootDir) {
  const softwareDir = path.join(rootDir, 'mediamovel', 'Software');
  const hardwareDir = path.join(rootDir, 'mediamovel', 'Hardware');
  const topDir = path.join(rootDir, 'TopLevel');
  const tbDir = path.join(rootDir, 'Testbench');
  for (const d of [softwareDir, hardwareDir, topDir, tbDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // The fixture opens with a long comment aimed at whoever debugs the
  // toolchain test. It is accurate but it is about the test, and left in it
  // fills the screenshot with prose instead of C±. Keep the code, which is the
  // manual's moving average, and give it a header that describes the program.
  const fixture = fs.readFileSync(FIXTURE_CMM, 'utf8');
  const body = fixture.replace(/^(?:\s*\/\/.*\n)+/, '');
  const cmmPath = path.join(softwareDir, 'mediamovel.cmm');
  fs.writeFileSync(cmmPath,
    '// Media movel de 4 amostras: le uma porta de entrada, soma as quatro\n'
    + '// ultimas leituras e escreve a media na porta de saida.\n\n'
    + body);

  const topPath = path.join(topDir, 'top_mediamovel.v');
  fs.writeFileSync(topPath, TOP_LEVEL_V);

  const tbPath = path.join(tbDir, 'tb_mediamovel.v');
  fs.writeFileSync(tbPath, TESTBENCH_V);

  const spfPath = path.join(rootDir, 'mediamovel.spf');
  fs.writeFileSync(spfPath, JSON.stringify({
    metadata: {
      projectName: 'mediamovel',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      computerName: 'capture-media',
      appVersion: require(path.join(REPO_ROOT, 'package.json')).version,
      projectPath: rootDir,
    },
    structure: {
      basePath: rootDir,
      processors: [
        {
          name: 'mediamovel',
          cmmFile: cmmPath,
          softwarePath: softwareDir,
          hardwarePath: hardwareDir,
        },
      ],
      folders: [],
      topLevelFile: topPath,
      testbenchFile: tbPath,
      synthesizableFiles: [
        { name: 'top_mediamovel.v', path: topPath, isTopLevel: true },
      ],
      testbenchFiles: [
        { name: 'tb_mediamovel.v', path: tbPath, isTopLevel: false },
      ],
    },
  }, null, 2));

  return { spfPath, cmmPath, topPath, tbPath };
}

/** O ffmpeg existe nesta maquina? Ele nao e dependencia do projeto. */
function temFfmpeg() {
  try {
    const r = require('child_process').spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch { return false; }
}

/**
 * Grava a janela enquanto `durante` acontece e monta um GIF.
 *
 * Os quadros saem de `page.screenshot()`, e nao de captura de video: o
 * Playwright grava video so ao criar o contexto, o que aqui significaria
 * relancar a aplicacao por tomada. Capturar quadro a quadro custa mais
 * por quadro e por isso a taxa e baixa, mas mostra exatamente a superficie
 * do renderer, sem barra de titulo nem area de trabalho de quem gravou.
 *
 * A gravacao para quando `durante` termina ou quando o teto de tempo
 * estoura, o que vier primeiro, para uma compilacao lenta nao virar um
 * arquivo de cem megabytes.
 */
async function gravarGif(page, nome, { segundos = 12, fps = GIF_FPS, largura = GIF_LARGURA } = {}, durante) {
  const quadrosDir = fs.mkdtempSync(path.join(os.tmpdir(), `aurora-gif-${nome}-`));
  const intervalo = Math.round(1000 / fps);
  const comeco = Date.now();
  const limite = comeco + segundos * 1000;
  let i = 0;
  let gravando = true;

  const laco = (async () => {
    while (gravando && Date.now() < limite) {
      const inicio = Date.now();
      try {
        await page.screenshot({ path: path.join(quadrosDir, `q-${String(++i).padStart(4, '0')}.png`) });
      } catch { break; } // janela fechou no meio: o que ja foi capturado vale
      const resto = intervalo - (Date.now() - inicio);
      if (resto > 0) await new Promise((r) => setTimeout(r, resto));
    }
  })();

  try {
    if (durante) await durante();
  } finally {
    gravando = false;
    await laco;
  }

  if (!i) { console.warn(`capture-media: nenhum quadro capturado para ${nome}.`); return null; }

  // A taxa PEDIDA nao e a taxa obtida: cada quadro custa uma captura de tela
  // da janela inteira, que numa maquina ocupada leva mais que o intervalo.
  // O GIF e montado na taxa MEDIDA, senao ele conta a historia mais rapido
  // do que ela aconteceu, e uma compilacao parece mais curta do que e.
  const duracaoReal = (Date.now() - comeco) / 1000;
  const taxaReal = Math.max(1, Math.min(30, i / Math.max(0.001, duracaoReal)));

  const saida = path.join(OUT_DIR, `${nome}.gif`);
  // Sem dithering e com paleta curta, por medida e nao por gosto. Numa
  // sequencia de 60 quadros de interface de verdade, o bayer deu 974 KB com
  // PSNR 40,3 dB e este ajuste deu 705 KB com 42,3 dB: menor E mais fiel,
  // porque o dithering gasta bytes espalhando ruido que afasta o pixel do
  // original. Faz sentido para foto, nao para interface, que e cor chapada
  // com texto em cima; 64 cores sobram para um tema escuro.
  const filtro = `scale=${largura}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none`;
  const args = ['-y', '-framerate', taxaReal.toFixed(2), '-i', path.join(quadrosDir, 'q-%04d.png'), '-vf', filtro, saida];

  if (!temFfmpeg()) {
    console.warn(`capture-media: ffmpeg nao esta no PATH, entao ${nome}.gif nao foi montado.`);
    console.warn(`  Os ${i} quadros ficaram em: ${quadrosDir}`);
    // O filtro carrega ';' e colchetes, que qualquer shell interpretaria, e o
    // caminho pode ter espaco: aspas em tudo que nao for flag simples.
    const citar = (a) => (/^[A-Za-z0-9._:/\\-]+$/.test(a) ? a : `"${a}"`);
    console.warn(`  Para montar depois:  ffmpeg ${args.map(citar).join(' ')}`);
    return null;
  }

  const r = require('child_process').spawnSync('ffmpeg', args, { stdio: 'pipe' });
  if (r.status !== 0) {
    console.error(`capture-media: ffmpeg falhou ao montar ${nome}.gif; os quadros ficaram em ${quadrosDir}`);
    console.error(String(r.stderr || '').split('\n').slice(-6).join('\n'));
    return null;
  }
  const kb = Math.round(fs.statSync(saida).size / 1024);
  // Conferir o que saiu, e nao supor: em 23/08/2026 um GIF anunciado com 114
  // quadros tinha 38 e corria tres vezes mais rapido que a gravacao, e o
  // script nao tinha como perceber porque so contava o que entrava.
  const dentro = conferirGif(saida);
  const resumo = dentro
    ? `${dentro.quadros} quadros, ${dentro.segundos.toFixed(1)} s, ${kb} KB`
    : `${i} quadros capturados, ${kb} KB`;
  console.log(`capture-media: ${nome}.gif escrito (${resumo})`);
  if (dentro && Math.abs(dentro.segundos - duracaoReal) > Math.max(2, duracaoReal * 0.25)) {
    console.warn(`capture-media: ${nome}.gif dura ${dentro.segundos.toFixed(1)} s, mas a gravacao levou ${duracaoReal.toFixed(1)} s.`);
  }
  // Os quadros so vao embora quando o GIF bate com a gravacao. Quando nao
  // bate, eles ficam: sem eles a investigacao vira teoria, e foi o que
  // aconteceu com o compile.gif que anunciava 114 quadros e tinha 38.
  const bate = dentro && dentro.quadros >= i * 0.9;
  if (dentro && !bate) {
    console.warn(`capture-media: o ffmpeg gravou ${dentro.quadros} dos ${i} quadros capturados.`);
    console.warn(`  Os quadros ficaram para exame em: ${quadrosDir}`);
  } else {
    fs.rmSync(quadrosDir, { recursive: true, force: true });
  }
  // Um GIF pesado no README custa a cada visita da pagina, e custa para
  // sempre no historico do repositorio. O aviso existe porque a primeira
  // gravacao do compile passou de 5 MB sem ninguem notar.
  if (kb > 2500) {
    console.warn(`capture-media: ${nome}.gif esta pesado para um README (${kb} KB).`);
    console.warn('  Encolha a tomada: menos segundos, menos quadros por segundo, ou menos largura.');
  }
  return saida;
}

/**
 * Quantos quadros e quantos segundos o GIF tem DE FATO. Usa o ffprobe, que
 * vem junto do ffmpeg; sem ele, devolve null e quem chama segue sem a
 * conferencia, que e informativa e nao pode derrubar a captura.
 */
function conferirGif(arquivo) {
  try {
    const r = require('child_process').spawnSync('ffprobe', [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames,duration',
      '-of', 'default=nw=1:nk=0', arquivo,
    ], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    const texto = String(r.stdout || '');
    const quadros = Number((texto.match(/nb_read_frames=(\d+)/) || [])[1]);
    const segundos = Number((texto.match(/duration=([\d.]+)/) || [])[1]);
    if (!Number.isFinite(quadros) || !Number.isFinite(segundos)) return null;
    return { quadros, segundos };
  } catch { return null; }
}

/** A janela do PRISM, que nasce depois da sintese, em processo de renderer proprio. */
async function esperarJanelaPrism(app, timeoutMs = 90_000) {
  const prazo = Date.now() + timeoutMs;
  while (Date.now() < prazo) {
    for (const w of app.windows()) {
      if (w.url().includes('prism.html')) return w;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/** Quais tomadas foram pedidas na linha de comando. */
function tomadasPedidas(argv) {
  const pedidos = argv.filter((a) => !a.startsWith('-'));
  if (!pedidos.length) return ['hero'];
  if (pedidos.includes('tudo')) return Object.keys(TOMADAS);
  const desconhecidas = pedidos.filter((x) => !TOMADAS[x]);
  if (desconhecidas.length) {
    console.error(`capture-media: tomada desconhecida: ${desconhecidas.join(', ')}`);
    console.error(`  disponiveis: ${Object.keys(TOMADAS).join(', ')}, tudo`);
    process.exit(2);
  }
  return pedidos;
}

function ajuda() {
  console.log('capture-media: fotos e GIFs do README, tirados da aplicacao de verdade.\n');
  console.log('  node scripts/capture-media.js [tomada...]\n');
  for (const [nome, oque] of Object.entries(TOMADAS)) console.log(`  ${nome.padEnd(14)} ${oque}`);
  console.log(`  ${'tudo'.padEnd(14)} todas as anteriores\n`);
  console.log('  Sem argumento, tira so o hero.png.');
  console.log('  waveform.gif nao sai daqui: GTKWave e Surfer sao janelas externas.');
  console.log('  O GIF precisa do ffmpeg no PATH; sem ele, os quadros ficam no disco.');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { ajuda(); return; }
  const tomadas = tomadasPedidas(argv);

  // playwright is a devDependency; require lazily so the failure message is
  // about the tool, not about a missing module at the top of the file.
  let electron;
  try {
    ({ _electron: electron } = require('playwright'));
  } catch {
    console.error('capture-media: playwright is not installed. Run `npm install` first.');
    process.exit(1);
  }

  if (!fs.existsSync(path.join(REPO_ROOT, 'dist', 'index.html'))) {
    console.error('capture-media: dist/index.html is missing. Run `npm run build:renderer` first.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-capture-'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-capture-prj-'));
  // The terminal prompt prints the project directory, so the leaf folder ends
  // up in the screenshot. Give it the project's name instead of the random
  // one mkdtemp produces.
  const projectDir = path.join(scratch, 'mediamovel');
  fs.mkdirSync(projectDir, { recursive: true });
  const project = writeProject(projectDir);

  console.log(`capture-media: tomadas pedidas: ${tomadas.join(', ')}`);
  console.log('capture-media: launching AURORA…');
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`, project.spfPath],
    cwd: REPO_ROOT,
    env: cleanEnv(),
    timeout: 60_000,
  });

  try {
    const page = await waitForMainWindow(app);
    await page.waitForFunction(
      () => typeof window.monaco !== 'undefined' && !!document.getElementById('monaco-editor'),
      null,
      { timeout: 30_000 },
    );

    // Same belt-and-braces load the e2e suite uses: the argv path races the
    // renderer's listener registration, and losing that race here means
    // screenshotting the welcome screen instead of a project.
    await page.evaluate(async (spf) => {
      try { await window.electronAPI?.openProject?.(spf); } catch { /* already loaded */ }
      await window.projectTreeManager?.refreshTree?.();
    }, project.spfPath);
    await page.waitForSelector('.file-item, .verilog-file-item', { timeout: 45_000 });

    await openInEditor(page, 'mediamovel.cmm');
    // The shot list asks for editor + tree + terminal, and the terminal starts
    // collapsed. Selecting a tab is what expands the panel.
    await page.click('.tab[data-terminal="tcmd"]').catch(() => {
      console.warn('capture-media: terminal tab not found; capturing without it.');
    });
    await page.waitForTimeout(1500);

    // Sizing happens LAST. AURORA maximises itself while it settles, and an
    // earlier setBounds was silently undone by that, the first capture came
    // out 900x1392, which is this monitor's work area, not the size asked for.
    await sizeWindow(app, WIDTH, HEIGHT);
    await page.waitForFunction((w) => window.innerWidth === w, WIDTH, { timeout: 10_000 });
    // Monaco and the terminal relayout from their own observers, so wait a
    // frame or two past the resize rather than screenshotting on the call.
    await page.waitForTimeout(2000);

    if (tomadas.includes('hero')) {
      const heroPath = path.join(OUT_DIR, 'hero.png');
      await page.screenshot({ path: heroPath });
      const kb = Math.round(fs.statSync(heroPath).size / 1024);
      console.log(`capture-media: hero.png written (${WIDTH}x${HEIGHT}, ${kb} KB)`);
    }

    if (tomadas.includes('split-editor')) {
      // O gesto que o GIF conta: dividir o editor e levar OUTRO arquivo para
      // o painel novo, que e o que mostra para que serve a divisao. Comeca
      // com um painel so, senao a primeira metade do filme e um editor ja
      // dividido e o gesto se perde.
      await gravarGif(page, 'split-editor', { segundos: 14 }, async () => {
        await page.waitForTimeout(1200);
        await page.click('#split-editor-float-btn').catch(() => {
          console.warn('capture-media: botao de dividir nao encontrado.');
        });
        await page.waitForTimeout(2500);
        await openInEditor(page, 'top_mediamovel.v');
        await page.waitForTimeout(4000);
      });
    }

    if (tomadas.includes('compile')) {
      // Compilacao de verdade, com a toolchain local. O teto de tempo existe
      // porque o GIF nao precisa da compilacao inteira: o que ele mostra e o
      // terminal recebendo saida, e um projeto grande encheria o arquivo.
      await openInEditor(page, 'mediamovel.cmm');
      await page.waitForTimeout(800);
      // Menos quadros, menos tempo e menos largura que as outras tomadas.
      // Aqui a tela inteira muda a cada linha nova, entao cada quadro custa
      // quase um quadro cheio: a 8 q/s por 30 s o arquivo passou de 5 MB. O
      // que o GIF precisa contar e "o terminal enche de saida", e doze
      // segundos a quatro quadros por segundo contam isso.
      await gravarGif(page, 'compile', { segundos: 12, fps: 4, largura: 800 }, async () => {
        await page.click('#cmmcomp').catch(() => {
          console.warn('capture-media: botao de compilar C+- nao encontrado.');
        });
        await page.waitForTimeout(11_000);
      });
    }

    if (tomadas.includes('prism')) {
      // Duas etapas: a sintese (Yosys) e a janela do PRISM, que e renderer
      // proprio. Grava-se a janela do PRISM, nao a principal, porque o
      // esquematico e o assunto.
      await page.click('#vericomp').catch(() => {
        console.warn('capture-media: botao de sintetizar nao encontrado.');
      });
      // A sintese com Yosys leva o tempo que leva, e o PRISM so abre depois
      // dela. Em vez de apostar num numero, insiste: clica, espera, repete.
      let prism = null;
      for (let tentativa = 0; tentativa < 4 && !prism; tentativa++) {
        await page.waitForTimeout(4000);
        await page.click('#prismcomp').catch(() => {});
        prism = await esperarJanelaPrism(app, 30_000);
      }
      if (!prism) {
        console.warn('capture-media: a janela do PRISM nao apareceu; prism.gif nao foi gravado.');
        console.warn('  Olhe o terminal TVERI da janela: a sintese pode ter falhado antes.');
      } else {
        await prism.waitForTimeout(6000); // desenho do esquematico
        await gravarGif(prism, 'prism', { segundos: 12 }, async () => {
          // Um passeio curto pelo esquematico: aproximar e arrastar, que e
          // o que o usuario faz e o que mostra que o desenho e interativo.
          await prism.mouse.move(700, 400);
          await prism.mouse.wheel(0, -300);
          await prism.waitForTimeout(1500);
          await prism.mouse.down();
          for (let dx = 0; dx < 240; dx += 20) {
            await prism.mouse.move(700 - dx, 400 + dx / 3);
            await prism.waitForTimeout(60);
          }
          await prism.mouse.up();
          await prism.waitForTimeout(3000);
        });
      }
    }
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Force the renderer viewport to an exact size, monitor be damned. */
async function sizeWindow(app, width, height) {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.getURL().includes('index.html'));
    // setBounds on a maximised window is ignored by Windows, and AURORA
    // maximises itself on startup, so this has to come first.
    if (w.isMaximized()) w.unmaximize();
    w.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
  }, { width, height });
}

async function waitForMainWindow(app, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      const url = w.url();
      if (url.endsWith('/index.html') || url.endsWith('\\index.html')) return w;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Main window (index.html) did not appear.');
}

/** Click a file in whichever tree is mounted, so the editor has content. */
async function openInEditor(page, fileName) {
  const item = page.locator('.file-item, .verilog-file-item').filter({ hasText: fileName }).first();
  try {
    await item.waitFor({ state: 'visible', timeout: 10_000 });
    await item.click();
  } catch {
    console.warn(`capture-media: could not open ${fileName} in the tree; capturing anyway.`);
  }
}

// Exportado para o arnes de verificacao exercitar a montagem do GIF sem abrir
// a aplicacao: e a unica parte que depende de ferramenta externa.
module.exports = { gravarGif, temFfmpeg, tomadasPedidas };

if (require.main === module) {
  main().catch((err) => {
    console.error(`capture-media: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  });
}
