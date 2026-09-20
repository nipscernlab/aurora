// tests/e2e/cpp-processor.test.js
//
// Um processador C++ compila de ponta a ponta dentro de um projeto AURORA,
// pela API, sem clique: e o E2E que a Fase 1 do C++ (TODO.md secao 7) pede.
//
// O projeto e o proc_cpp do yanc (C:\nipscern\yanc\Teste\proc_cpp, o mesmo
// que o Scripts/single_proc_cpp.bat compila), posto na estrutura que a
// AURORA espera: <proj>/proc_cpp/Software/proc_cpp.cpp e um .spf cuja
// entrada de processador e SO `{ name: 'proc_cpp' }`, sem campo de
// linguagem, de proposito: a linguagem tem de ser derivada do que existe em
// Software/ (processor_dispatch.ts), porque e assim que todo .spf de hoje e.
//
// O que se afirma e o que a compilacao deixa no disco: o pp.cpp do cpppp na
// Temp do projeto, o proc_cpp.asm (com esse nome, nao proc_cpp.cpp.asm), e
// o proc_cpp.v com os .mif que o asmcomp gera. Sem toolchain (o job de E2E
// do CI nao baixa o yanc) o arquivo inteiro se abstem.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENTS = path.join(REPO_ROOT, 'components');
const YANC_EXAMPLE = 'C:\\nipscern\\yanc\\Teste\\proc_cpp\\Software\\proc_cpp.cpp';

/** Tudo que o passo 'cpp' mais o asm precisam. Faltando qualquer um, abstem-se. */
const REQUIRED = ['cpppp.exe', 'cppcomp.exe', 'appcomp.exe', 'asmcomp.exe']
  .map((exe) => path.join(COMPONENTS, 'bin', exe));
const toolchainReady = REQUIRED.every((p) => fs.existsSync(p))
  && fs.existsSync(path.join(COMPONENTS, 'Header'))
  && fs.existsSync(path.join(COMPONENTS, 'HDL'));

/**
 * O programa: o proc_cpp do yanc quando ele esta na maquina, senao um
 * equivalente minimo com o mesmo cabecalho. Os dois passam pelo cpppp e
 * pelo cppcomp do mesmo jeito; o do yanc e o que o usuario pediu.
 */
function programaCpp() {
  if (fs.existsSync(YANC_EXAMPLE)) return fs.readFileSync(YANC_EXAMPLE, 'utf8');
  return [
    '#pragma yanc prname proc_cpp',
    '',
    'int   g_count = 7;',
    'float g_gain  = 2.5;',
    '',
    'void main(void)',
    '{',
    '    int   a = 3;',
    '    float b = 1.5;',
    '    int   sum  = a + g_count;',
    '    float prod = b * g_gain;',
    '    (void)sum; (void)prod;',
    '}',
    '',
  ].join('\n');
}

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

/** <root>/proc_cpp/{Software,Hardware,Simulation} + o .spf, so com o nome. */
function writeFixtureProject(rootDir) {
  const procDir = path.join(rootDir, 'proc_cpp');
  for (const sub of ['Software', 'Hardware', 'Simulation']) {
    fs.mkdirSync(path.join(procDir, sub), { recursive: true });
  }
  const sourcePath = path.join(procDir, 'Software', 'proc_cpp.cpp');
  fs.writeFileSync(sourcePath, programaCpp());

  // O .spf TEM de se chamar como a pasta: o handler create-processor-project
  // monta o caminho dele como <projectLocation>/<basename>.spf, e um nome
  // diferente faz a criacao de processador morrer com ENOENT.
  const spfPath = path.join(rootDir, `${path.basename(rootDir)}.spf`);
  fs.writeFileSync(spfPath, JSON.stringify({
    metadata: {
      projectName: path.basename(rootDir),
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      computerName: 'e2e-test',
      appVersion: '0.0.0-test',
      projectPath: rootDir,
    },
    structure: {
      basePath: rootDir,
      // Sem `language`, sem `sourceFile`: e o que todo .spf de hoje traz.
      processors: [{ name: 'proc_cpp', clk: 100, numClocks: 2000 }],
      folders: [],
      topLevelFile: '',
      testbenchFile: '',
      synthesizableFiles: [],
      testbenchFiles: [],
    },
  }, null, 2));

  return { spfPath, procDir, sourcePath };
}

describe.skipIf(!toolchainReady)('Aurora E2E — um processador C++ compila de ponta a ponta', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;
  let userDataDir;
  let projectDir;
  let fixture;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-ud-'));
    // realpath: o Windows pode dar a forma 8.3 (RUNNER~1) e as ferramentas
    // do yanc recebem o caminho como esta; ver tests/toolchain/pipeline.test.js.
    projectDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-cpp-')));
    fixture = writeFixtureProject(projectDir);

    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`, fixture.spfPath],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });
    window = await waitForMainWindow(app);
    window.on('console', (msg) => { console.log(`[renderer:${msg.type()}] ${msg.text()}`); });
    window.on('pageerror', (err) => { console.log(`[renderer:pageerror] ${err.message}`); });

    await window.waitForFunction(
      () => typeof window.monaco !== 'undefined' && !!document.getElementById('monaco-editor'),
      null, { timeout: 15_000 },
    );
    // Mesmo cinto e suspensorio do edit-flow: semeia o projeto no main e
    // forca a arvore, sem depender do IPC do argv chegar antes do listener.
    await window.evaluate(async (spfPath) => {
      const api = window.electronAPI;
      if (api?.openProject) {
        try { await api.openProject(spfPath); } catch (_e) { /* ja carregado */ }
      }
      await window.projectTreeManager?.refreshTree?.();
    }, fixture.spfPath);
    await window.waitForFunction(
      () => !!window.AuroraAPI?.compile?.compileStep && !!window.currentProjectPath,
      null, { timeout: 15_000 },
    );
  }, 90_000);

  afterAll(async () => {
    try { await app?.close(); } catch (_) { /* ja morreu */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('o passo cpp pela API produz o .asm e o .v do processador, sem nenhum .cmm', async () => {
    // Nada em foco no editor: o fluxo cai no fallback da IA, que acha o
    // unico processador do projeto e o fonte .cpp dele no disco.
    const resultado = await window.evaluate(
      () => window.AuroraAPI.compile.compileStep('cpp'),
    );
    expect(resultado).toEqual({ ok: true, data: { step: 'cpp' } });

    const software = path.join(fixture.procDir, 'Software');
    const hardware = path.join(fixture.procDir, 'Hardware');
    const temp = path.join(projectDir, '.aurora', 'Temp', 'proc_cpp');

    // O que o cpppp e o cppcomp deixaram na Temp do projeto.
    expect(fs.existsSync(path.join(temp, 'pp.cpp'))).toBe(true);
    expect(fs.existsSync(path.join(temp, 'cmm_log.txt'))).toBe(true);

    // O .asm com a base do fonte, e nao com a extensao dentro do nome.
    expect(fs.existsSync(path.join(software, 'proc_cpp.asm'))).toBe(true);
    expect(fs.existsSync(path.join(software, 'proc_cpp.cpp.asm'))).toBe(false);
    expect(fs.existsSync(path.join(software, 'proc_cpp.cmm'))).toBe(false);

    // Do appcomp em diante o pipeline e o de sempre: o .v e os .mif.
    expect(fs.existsSync(path.join(hardware, 'proc_cpp.v'))).toBe(true);
    expect(fs.existsSync(path.join(hardware, 'proc_cpp_inst.mif'))).toBe(true);
    expect(fs.existsSync(path.join(hardware, 'proc_cpp_data.mif'))).toBe(true);
    expect(fs.readFileSync(path.join(hardware, 'proc_cpp.v'), 'utf8')).toMatch(/module\s+proc_cpp\b/);
  }, 180_000);

  it('criar um processador C++ pela API escreve o .cpp com pragmas e grava a linguagem no .spf', async () => {
    const criado = await window.evaluate(() => window.AuroraAPI.project.createProcessor({
      processorName: 'proc_novo',
      language: 'cpp',
      inputPorts: 2,
      outputPorts: 3,
      // Os campos numericos do C+- vao junto de proposito: a API tem de
      // ignora-los no modo C++, e nao cravar pragma nenhum com eles.
      nBits: 23, nbMantissa: 16, nbExponent: 6, gain: 128,
      dataStackSize: 5, instructionStackSize: 5,
    }));
    expect(criado.ok, JSON.stringify(criado)).toBe(true);

    const fonte = path.join(projectDir, 'proc_novo', 'Software', 'proc_novo.cpp');
    expect(fs.existsSync(fonte)).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'proc_novo', 'Software', 'proc_novo.cmm'))).toBe(false);

    const texto = fs.readFileSync(fonte, 'utf8');
    expect(texto).toContain('#pragma yanc prname proc_novo');
    expect(texto).toContain('#pragma yanc nuioin 2');
    expect(texto).toContain('#pragma yanc nuioou 3');
    // largura, mantissa, expoente, ganho e pilhas NAO viram pragma
    expect(texto.match(/#pragma yanc/g)).toHaveLength(3);
    expect(texto).toContain('void main(void)');

    // A linguagem fica registrada no .spf, e e ela que desempata quando
    // houver um .cmm e um .cpp com o mesmo nome na pasta.
    const spf = JSON.parse(fs.readFileSync(fixture.spfPath, 'utf8'));
    const entrada = spf.structure.processors.find((p) => p.name === 'proc_novo');
    expect(entrada).toBeDefined();
    expect(entrada.language).toBe('cpp');

    // E o processador recem-criado compila, sem nada em foco no editor.
    const compilado = await window.evaluate(() => window.AuroraAPI.compile.compileStep('cpp'));
    expect(compilado.ok, JSON.stringify(compilado)).toBe(true);
  }, 180_000);

  it('criar em C+- continua escrevendo o .cmm e NAO grava linguagem no .spf', async () => {
    const criado = await window.evaluate(() => window.AuroraAPI.project.createProcessor({
      processorName: 'proc_cmm',
      inputPorts: 1, outputPorts: 1,
      nBits: 23, nbMantissa: 16, nbExponent: 6, gain: 128,
      dataStackSize: 5, instructionStackSize: 5,
    }));
    expect(criado.ok, JSON.stringify(criado)).toBe(true);

    const fonte = path.join(projectDir, 'proc_cmm', 'Software', 'proc_cmm.cmm');
    expect(fs.existsSync(fonte)).toBe(true);
    expect(fs.readFileSync(fonte, 'utf8')).toContain('#PRNAME proc_cmm');

    // A entrada de um processador C+- continua sendo o que sempre foi.
    const spf = JSON.parse(fs.readFileSync(fixture.spfPath, 'utf8'));
    const entrada = spf.structure.processors.find((p) => p.name === 'proc_cmm');
    expect(entrada).toBeDefined();
    expect('language' in entrada).toBe(false);
  }, 60_000);

  it('o terminal C+- diz que foi o front end C++, e a barra mostra o processador ativo pelo .cpp', async () => {
    const terminal = await window.evaluate(
      () => document.querySelector('#terminal-tcmm .terminal-body')?.textContent || '',
    );
    // O aviso de "so em ingles" e o de "compilacao C++" saem nas duas linguas
    // com "C++" no texto; a linha de comando do cppcomp so sai em verbose.
    expect(terminal).toMatch(/C\+\+/);
    expect(terminal).not.toMatch(/binary not on toolchain allowlist/);

    // Com o .cpp em foco, o processador ativo e o proc_cpp (active_processor.ts).
    await window.evaluate(async (sourcePath) => {
      const content = await window.electronAPI.readFile(sourcePath, { encoding: 'utf8' });
      await window.TabManager.addTab(sourcePath, content);
    }, fixture.sourcePath);
    await window.waitForFunction(
      () => (document.getElementById('activeProcessorStatus')?.textContent || '').includes('proc_cpp'),
      null, { timeout: 10_000 },
    );
    const botao = await window.evaluate(() => document.getElementById('cmmcomp')?.disabled);
    expect(botao).toBe(false);
  }, 30_000);
});
