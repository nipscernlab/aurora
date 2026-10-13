// tests/e2e/estrutura-antiga.test.js
//
// Um projeto da estrutura de pastas de antes do yanc v7.1 (Software/,
// Hardware/, Simulation/) abre na AURORA: ela pergunta se converte, e com o
// sim move os arquivos para os lugares novos, tira o #PRNAME do fonte, troca
// os caminhos do .spf e mostra o relatorio. Depois o processador compila.
//
// O que fica travado e o caminho inteiro no app de verdade: o dialogo aparece
// na abertura, antes da arvore; nada e apagado; e o projeto convertido compila
// com o yanc. Sem toolchain o caso da compilacao se abstem.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS = path.join(REPO_ROOT, 'components');
const toolchainReady = ['yanc.exe', 'cmmcomp.exe', 'asmcomp.exe']
  .every((exe) => fs.existsSync(path.join(COMPONENTS, 'bin', exe)));

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

const CMM = [
  '#PRNAME fir',
  '#NUBITS 16',
  '#NUIOIN 1',
  '#NUIOOU 1',
  '#NBMANT 10',
  '#NBEXPO 5',
  '',
  'void main()',
  '{',
  '    int x;',
  '    x = in(0);',
  '    out(0, x + 1);',
  '}',
  '',
].join('\n');

/** Um projeto como a AURORA de antes do yanc v7.1 deixava no disco. */
function projetoAntigo(raiz) {
  const proc = path.join(raiz, 'fir');
  const escrever = (rel, texto) => {
    const alvo = path.join(proc, ...rel.split('/'));
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, texto);
  };
  escrever('Software/fir.cmm', CMM);
  escrever('Software/fir.asm', 'asm velho');
  escrever('Hardware/fir.v', 'module fir; endmodule');
  escrever('Simulation/fir_tb.v', 'module fir_tb; endmodule');
  escrever('Simulation/input_0.txt', '1\n2\n3\n');

  const spfPath = path.join(raiz, `${path.basename(raiz)}.spf`);
  fs.writeFileSync(spfPath, JSON.stringify({
    metadata: {
      projectName: path.basename(raiz),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      computerName: 'e2e-test',
      appVersion: '0.0.0-test',
      projectPath: raiz,
    },
    structure: {
      basePath: raiz,
      processors: [{ name: 'fir', clk: 100, numClocks: 400, softwarePath: path.join(proc, 'Software') }],
      folders: [],
      topLevelFile: '',
      testbenchFile: path.join(proc, 'Simulation', 'fir_tb.v'),
      synthesizableFiles: [{ name: 'fir.v', path: path.join(proc, 'Hardware', 'fir.v'), isTopLevel: false }],
      testbenchFiles: [{ name: 'fir_tb.v', path: path.join(proc, 'Simulation', 'fir_tb.v'), isTopLevel: true }],
    },
  }, null, 2));
  return { spfPath, proc };
}

describe('Aurora E2E — o projeto da estrutura antiga e convertido na abertura', () => {
  let app;
  let window;
  let userDataDir;
  let projectDir;
  let fixture;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-ud-'));
    projectDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-antigo-')));
    fixture = projetoAntigo(projectDir);

    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, fixture.spfPath],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });
    window = await waitForMainWindow(app);
    window.on('pageerror', (err) => { console.log(`[renderer:pageerror] ${err.message}`); });
  }, 90_000);

  afterAll(async () => {
    try { await app?.close(); } catch (_) { /* ja morreu */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('pergunta, converte com o sim, e mostra o que moveu', async () => {
    // A pergunta aparece na abertura do projeto que veio pela linha de comando.
    const converter = window.locator('.confirm-modal .confirm-btn[data-action="converter"]');
    await converter.waitFor({ timeout: 30_000 });
    expect(await window.locator('.confirm-modal-message').textContent()).toContain('fir');
    await converter.click();

    // O relatorio, com o que foi movido.
    const ok = window.locator('.confirm-modal .confirm-btn[data-action="ok"]');
    await ok.waitFor({ timeout: 30_000 });
    const relatorio = await window.locator('.confirm-modal-message').textContent();
    expect(relatorio).toContain('fir/Software/fir.cmm');
    await ok.click();

    // O disco: o fonte e os dados em fir/, o gerado em fir/fir/, nada apagado.
    expect(fs.readFileSync(path.join(fixture.proc, 'fir.cmm'), 'utf8')).toBe(CMM.replace('#PRNAME fir\n', ''));
    expect(fs.existsSync(path.join(fixture.proc, 'input_0.txt'))).toBe(true);
    for (const f of ['fir.asm', 'fir.v', 'fir_tb.v']) {
      expect(fs.existsSync(path.join(fixture.proc, 'fir', f)), f).toBe(true);
    }
    for (const sub of ['Software', 'Hardware', 'Simulation']) {
      expect(fs.existsSync(path.join(fixture.proc, sub)), sub).toBe(false);
    }

    // O .spf aponta para os lugares novos e esqueceu os campos de pasta.
    const spf = JSON.parse(fs.readFileSync(fixture.spfPath, 'utf8')).structure;
    expect(JSON.stringify(spf)).not.toMatch(/Software|Hardware|Simulation/);
    expect(spf.processors[0]).toMatchObject({ name: 'fir', clk: 100, numClocks: 400 });
    expect(spf.processors[0]).not.toHaveProperty('softwarePath');
  }, 90_000);

  it.skipIf(!toolchainReady)('o processador convertido compila com o yanc', async () => {
    await window.waitForFunction(
      () => !!window.AuroraAPI?.compile?.compileStep && !!window.currentProjectPath,
      null, { timeout: 15_000 },
    );
    const fonte = path.join(fixture.proc, 'fir.cmm');
    await window.evaluate(async (f) => {
      const texto = await window.electronAPI.readFile(f, { encoding: 'utf8' });
      await window.TabManager.addTab(f, texto);
    }, fonte);
    const r = await window.evaluate(() => window.AuroraAPI.compile.compileStep('cmm'));
    expect(r.ok, JSON.stringify(r)).toBe(true);

    const log = path.join(fixture.proc, 'fir', 'prog_log.txt');
    const limite = Date.now() + 90_000;
    while (!fs.existsSync(log) && Date.now() < limite) {
      await new Promise((res) => setTimeout(res, 250));
    }
    expect(fs.existsSync(log)).toBe(true);
    const v = path.join(fixture.proc, 'fir', 'fir.v');
    while (!/DFILE/.test(fs.existsSync(v) ? fs.readFileSync(v, 'utf8') : '') && Date.now() < limite) {
      await new Promise((res) => setTimeout(res, 250));
    }
    expect(fs.readFileSync(v, 'utf8')).toMatch(/module\s+fir\b/);
  }, 120_000);
});
