/**
 * A toolchain sobrevive a um caminho com acento e espaço?
 *
 * Por que este teste existe. As máquinas do laboratório de DLP rodam Windows em
 * português, onde a Área de Trabalho se chama exatamente assim, com acento, e o
 * nome de usuário de um aluno pode ser "João". O caminho do projeto vem de um
 * seletor de pasta, então nada impede `C:\Users\João\Área de Trabalho\Meu
 * Projeto`. O nome do PROCESSADOR segue a regra do yanc (vira módulo Verilog,
 * js/compilation/pastas_do_processador.ts), mas o caminho não é validado nem
 * pode ser.
 *
 * Desde o yanc v7.1 o caminho passa por dois lugares que antes não passava: o
 * `srcdir` do prog_log.txt, que o asmcomp lê para achar os arquivos da pessoa,
 * e nenhum lugar do Verilog gerado, que nomeia tudo relativo à pasta de saída.
 * O yanc trabalha em UTF-8 em todos os sistemas, e a AURORA roda o iverilog e
 * o vvp com cwd na pasta de saída e nomes relativos, para nenhum caminho com
 * acento passar por eles. Este teste prova as duas coisas.
 *
 * O pipeline.test.js exercita a toolchain inteira e nunca sai do ASCII, então
 * esta é a lacuna que sobrava. Se um destes falhar, falha na primeira aula.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { buildCmmSpec } from '../../js/compilation/builders/cmm.js';
import { buildAsmSpec } from '../../js/compilation/builders/asm.js';
import { buildIverilogBuildSpec } from '../../js/compilation/builders/iverilog.js';
import { buildVvpRunSpec } from '../../js/compilation/builders/vvp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(HERE, '..', '..');
const COMPONENTS = path.join(RAIZ, 'components');
const MINGW_BIN = path.join(COMPONENTS, 'Packages', 'msys', 'mingw64', 'bin');

const PROC = 'mediamovel';
const BIN = {
  yanc: path.join(COMPONENTS, 'bin', 'yanc.exe'),
  cmmcomp: path.join(COMPONENTS, 'bin', 'cmmcomp.exe'),
  asmcomp: path.join(COMPONENTS, 'bin', 'asmcomp.exe'),
  iverilog: path.join(MINGW_BIN, 'iverilog.exe'),
  vvp: path.join(MINGW_BIN, 'vvp.exe'),
};
const faltando = Object.entries(BIN).filter(([, p]) => !fs.existsSync(p)).map(([n]) => n);

/** O nome de pasta que uma máquina brasileira produz sem ninguém pedir. */
const PASTA_ACENTUADA = path.join('Área de Trabalho', 'Meu Projeto');

// O Windows devolve caminho no formato curto 8.3 quando o nome do usuário é
// longo, e o os.tmpdir() do runner do CI faz exatamente isso:
// C:\Users\RUNNER~1\AppData\Local\Temp. Misturar o til com acento e espaço é
// pedir para alguma etapa da toolchain se perder, e o objetivo daqui é provar
// o acento, não descobrir de novo o caminho curto. Ver a nota no pipeline.test.js.
const TMP_ROOT = fs.realpathSync.native(os.tmpdir());

/** Roda uma CommandSpec como o main/compile/executor.js. */
function rodar(spec) {
  const env = { ...process.env };
  if (Array.isArray(spec.prependPath) && spec.prependPath.length) {
    env.PATH = `${spec.prependPath.join(path.delimiter)}${path.delimiter}${env.PATH}`;
  }
  return execFileSync(spec.binary, spec.args, {
    cwd: spec.cwd, env, encoding: 'utf8', timeout: 120000, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe.skipIf(faltando.length)('toolchain sob caminho com acento e espaço', () => {
  let base; let sourceDir; let outputDir;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(TMP_ROOT, 'aurora-acento-'));
    sourceDir = path.join(base, PASTA_ACENTUADA, PROC);
    outputDir = path.join(sourceDir, PROC);
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.copyFileSync(path.join(HERE, 'fixtures', `${PROC}.cmm`), path.join(sourceDir, `${PROC}.cmm`));
    fs.writeFileSync(path.join(sourceDir, 'input_0.txt'), '10\n20\n30\n40\n50\n');
  });

  afterAll(() => {
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  it('o caminho de teste realmente carrega acento e espaço', () => {
    expect(sourceDir).toContain('Área');
    expect(sourceDir).toContain(' ');
  });

  it('yanc -S compila um C± que mora sob caminho acentuado, e anota o caminho em UTF-8', () => {
    const saida = rodar(buildCmmSpec({
      yancPath: BIN.yanc, sourcePath: path.join(sourceDir, `${PROC}.cmm`),
      outputDir, sourceDir, processorName: PROC, lang: 'pt', showArrays: false,
    }));
    const asm = path.join(outputDir, `${PROC}.asm`);
    expect(fs.existsSync(asm)).toBe(true);
    expect(fs.readFileSync(asm, 'utf8').trim().length).toBeGreaterThan(0);
    expect(saida).toMatch(/instru/i);
    // O srcdir chega intacto: lido como UTF-8, o "Á" e o "Á" de verdade.
    const srcdir = /^srcdir (.*)$/m.exec(fs.readFileSync(path.join(outputDir, 'prog_log.txt'), 'utf8'))?.[1];
    expect(srcdir && path.resolve(srcdir)).toBe(path.resolve(sourceDir));
  });

  it('a montagem gera o Verilog sem nenhum caminho absoluto dentro', () => {
    rodar(buildAsmSpec({
      yancPath: BIN.yanc, asmFile: path.join(outputDir, `${PROC}.asm`), outputDir,
      freq: 100, clocks: 400, processorName: PROC, lang: 'pt',
    }));
    for (const f of [`${PROC}.v`, `${PROC}_tb.v`]) {
      const texto = fs.readFileSync(path.join(outputDir, f), 'utf8');
      expect(texto, f).not.toContain('Área');
      expect(texto, f).not.toMatch(/"[A-Za-z]:[\\/]/);
    }
  });

  it('iverilog e vvp rodam a partir da pasta de saida acentuada, com nomes relativos', () => {
    rodar(buildIverilogBuildSpec({
      iveriCompPath: BIN.iverilog,
      hdlPath: path.join(COMPONENTS, 'SAPHO'),
      simTopModule: `${PROC}_tb`,
      outputFile: `${PROC}_tb.vvp`,
      sourceFiles: [`${PROC}_tb.v`, `${PROC}.v`],
      cwd: outputDir,
    }));
    const out = rodar(buildVvpRunSpec({ vvpBin: BIN.vvp, vvpFile: `${PROC}_tb.vvp`, cwd: outputDir }));
    expect(out).toMatch(/\$finish/);
    // O programa leu ../input_0.txt, ao lado do fonte, e escreveu aqui.
    expect(fs.readFileSync(path.join(outputDir, 'output_0.txt'), 'utf8').trim().length).toBeGreaterThan(0);
  });
});
