/**
 * A toolchain sobrevive a um caminho com acento e espaço?
 *
 * Por que este teste existe. As máquinas do laboratório de DLP rodam Windows em
 * português, onde a Área de Trabalho se chama exatamente assim, com acento, e o
 * nome de usuário de um aluno pode ser "João". O caminho do projeto vem de um
 * seletor de pasta, então nada impede `C:\Users\João\Área de Trabalho\Meu
 * Projeto`. O nome do PROCESSADOR é validado contra `^[A-Za-z0-9_-]+$` em
 * main/ipc/project.js, mas o caminho não é validado nem pode ser.
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(HERE, '..', '..');
const COMPONENTS = path.join(RAIZ, 'components');

const PROC = 'mediamovel';
const BIN = {
  cmmcomp: path.join(COMPONENTS, 'bin', 'cmmcomp.exe'),
  iverilog: path.join(COMPONENTS, 'Packages', 'msys', 'mingw64', 'bin', 'iverilog.exe'),
};
const faltando = Object.entries(BIN).filter(([, p]) => !fs.existsSync(p)).map(([n]) => n);

/** O nome de pasta que uma máquina brasileira produz sem ninguém pedir. */
const PASTA_ACENTUADA = path.join('Área de Trabalho', 'Meu Projeto');

describe.skipIf(faltando.length)('toolchain sob caminho com acento e espaço', () => {
  let base; let projectPath; let softwarePath; let tempPath;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-acento-'));
    projectPath = path.join(base, PASTA_ACENTUADA, PROC);
    softwarePath = path.join(projectPath, 'Software');
    tempPath = path.join(base, PASTA_ACENTUADA, 'Temp', PROC);
    fs.mkdirSync(softwarePath, { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'Hardware'), { recursive: true });
    fs.mkdirSync(tempPath, { recursive: true });
    fs.copyFileSync(
      path.join(HERE, 'fixtures', `${PROC}.cmm`),
      path.join(softwarePath, `${PROC}.cmm`),
    );
  });

  afterAll(() => {
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  it('o caminho de teste realmente carrega acento e espaço', () => {
    expect(projectPath).toContain('Área');
    expect(projectPath).toContain(' ');
  });

  it('cmmcomp compila um C± que mora sob caminho acentuado', () => {
    const saida = execFileSync(BIN.cmmcomp, [
      '-i', `${PROC}.cmm`,
      '-n', PROC,
      '-p', projectPath,
      '-m', path.join(COMPONENTS, 'Macros'),
      '-t', tempPath,
      '-pt',
    ], { cwd: softwarePath, encoding: 'utf8', timeout: 60000, windowsHide: true });

    const asm = path.join(softwarePath, `${PROC}.asm`);
    expect(fs.existsSync(asm)).toBe(true);
    expect(fs.readFileSync(asm, 'utf8').trim().length).toBeGreaterThan(0);
    expect(saida).toMatch(/instru/i);
  });

  it('iverilog elabora a partir de um diretório acentuado', () => {
    const hw = path.join(projectPath, 'Hardware');
    const v = path.join(hw, 'topo.v');
    fs.writeFileSync(v, [
      'module topo;',
      '  initial begin',
      '    $display("ok");',
      '  end',
      'endmodule',
    ].join('\n'), 'utf8');

    const saida = path.join(hw, 'topo.vvp');
    execFileSync(BIN.iverilog, ['-o', saida, v], {
      cwd: hw, encoding: 'utf8', timeout: 60000, windowsHide: true,
    });
    expect(fs.existsSync(saida)).toBe(true);
  });
});
