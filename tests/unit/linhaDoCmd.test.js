// O .cmd do claude e do codex globais roda pelo cmd.exe, e os argumentos
// (caminhos do projeto, sobretudo) nao podem ser lidos por ele: um `&` no
// caminho virava outro comando. O ultimo teste roda um .cmd de
// verdade numa pasta com os caracteres que o cmd.exe interpreta.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { escaparArgumento, viaCmd } from '../../main/ai/linha_do_cmd.ts';

describe('escaparArgumento', () => {
  it('sempre entre aspas, com os especiais escapados duas vezes', () => {
    expect(escaparArgumento('abc')).toBe('^^^"abc^^^"');
    expect(escaparArgumento('C:\\R&D')).toBe('^^^"C:\\R^^^&D^^^"');
  });

  it('aspas e barras invertidas seguem a regra do argv', () => {
    expect(escaparArgumento('a"b')).toBe('^^^"a\\^^^"b^^^"');
    expect(escaparArgumento('C:\\x\\')).toBe('^^^"C:\\x\\\\^^^"');
  });

  it('recusa quebra de linha', () => {
    expect(() => escaparArgumento('a\nb')).toThrow(/quebra de linha/);
  });
});

describe('viaCmd', () => {
  it('monta a linha inteira para o spawn repassar sem mexer', () => {
    const r = viaCmd('C:\\Program Files\\npm\\claude.cmd', ['--x', 'y']);
    expect(r.cmd).toBe('cmd.exe');
    expect(r.windowsVerbatimArguments).toBe(true);
    expect(r.args).toEqual(['/d', '/s', '/c', '"C:\\Program^ Files\\npm\\claude.cmd ^^^"--x^^^" ^^^"y^^^""']);
  });
});

describe.runIf(process.platform === 'win32')('um .cmd de verdade', () => {
  it('cada argumento chega ao programa como saiu do vetor', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-cmd-'));
    const pasta = path.join(base, 'R&D (x) %PATH% 100% a^b;c,d!e');
    fs.mkdirSync(pasta);
    try {
      fs.writeFileSync(path.join(pasta, 'eco.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
      // O mesmo repasse do atalho do npm: o programa e o %* .
      fs.writeFileSync(path.join(pasta, 'eco.cmd'), `@"${process.execPath}" "%~dp0eco.js" %*\r\n`);
      const args = [
        pasta, 'a & echo INJETADO', '%PATH%', 'x"y', 'C:\\fim\\', '', 'mcp.url="http://h"',
        '<>|^', 'com espaco', '!x!',
      ];
      const r = viaCmd(path.join(pasta, 'eco.cmd'), args);
      const saida = execFileSync(r.cmd, r.args, { windowsVerbatimArguments: true, encoding: 'utf8', windowsHide: true });
      expect(JSON.parse(saida)).toEqual(args);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
