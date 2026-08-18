// capture-media.js: take the README's screenshots from the real application.
//
// Maintainer tool, run by hand: `node scripts/capture-media.js`. It is not
// wired into any npm script or workflow, because it launches a GUI and takes
// tens of seconds.
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
  fs.writeFileSync(topPath,
    '`timescale 1ns/1ps\n'
    + '// Top level: wires the SAPHO processor to the board pins.\n'
    + 'module top_mediamovel (\n'
    + '  input  wire        clk,\n'
    + '  input  wire        rst,\n'
    + '  input  wire [15:0] sample_in,\n'
    + '  output wire [15:0] sample_out\n'
    + ');\n'
    + '  mediamovel proc (\n'
    + '    .clk        (clk),\n'
    + '    .rst        (rst),\n'
    + '    .io_in      (sample_in),\n'
    + '    .io_out     (sample_out)\n'
    + '  );\n'
    + 'endmodule\n');

  const tbPath = path.join(tbDir, 'tb_mediamovel.v');
  fs.writeFileSync(tbPath,
    '`timescale 1ns/1ps\n'
    + 'module tb_mediamovel;\n'
    + '  reg         clk = 0;\n'
    + '  reg         rst = 1;\n'
    + '  reg  [15:0] sample_in = 0;\n'
    + '  wire [15:0] sample_out;\n'
    + '\n'
    + '  top_mediamovel dut (\n'
    + '    .clk(clk), .rst(rst),\n'
    + '    .sample_in(sample_in), .sample_out(sample_out)\n'
    + '  );\n'
    + '\n'
    + '  always #5 clk = ~clk;\n'
    + '\n'
    + '  initial begin\n'
    + '    $dumpfile("tb_mediamovel.vcd");\n'
    + '    $dumpvars(0, tb_mediamovel);\n'
    + '    #20 rst = 0;\n'
    + '    repeat (16) begin\n'
    + '      @(posedge clk) sample_in <= $random % 512;\n'
    + '    end\n'
    + '    #100 $finish;\n'
    + '  end\n'
    + 'endmodule\n');

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

async function main() {
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

    const heroPath = path.join(OUT_DIR, 'hero.png');
    await page.screenshot({ path: heroPath });
    const kb = Math.round(fs.statSync(heroPath).size / 1024);
    console.log(`capture-media: hero.png written (${WIDTH}x${HEIGHT}, ${kb} KB)`);
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

main().catch((err) => {
  console.error(`capture-media: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
