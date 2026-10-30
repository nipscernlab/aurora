/**
 * scripts/verify-toolchain-sentinels: o portao do release, que confere que o
 * toolchain inteiro esta em disco antes de empacotar. Caracterizacao escrita
 * antes da conversao para .mts (issue 81), sobre o .js de entao.
 *
 * O script le a sentinela de cada downloader e olha o disco de verdade, e o
 * CI de testes nao baixa o toolchain. Entao o caso nao depende do que esta
 * instalado: confere que os sete componentes aparecem, cada um como ok ou
 * MISSING, e que o codigo de saida bate com o que faltou.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** O script, na extensao que ele tiver (.js antes da conversao, .mts depois). */
function script() {
    const base = path.join(RAIZ, 'scripts', 'verify-toolchain-sentinels');
    return ['.mts', '.js'].map((e) => base + e).find((f) => fs.existsSync(f));
}

describe('verificar, no mesmo processo', () => {
    let pasta;
    afterEach(() => { if (pasta) fs.rmSync(pasta, { recursive: true, force: true }); });

    it('com os downloaders de verdade, os sete entram na tabela sem erro de carga', async () => {
        const { verificar } = await import('../../scripts/verify-toolchain-sentinels.mts');
        const { rows, missing } = verificar();
        expect(rows.length + missing.filter((m) => /cannot load|no longer exports/.test(m)).length).toBe(7);
        expect(missing.filter((m) => /cannot load|no longer exports/.test(m))).toEqual([]);
    });

    it('cada falha vira uma linha do que falta: nao carrega, nao exporta, nao esta no disco', async () => {
        const { verificar } = await import('../../scripts/verify-toolchain-sentinels.mts');
        pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-sentinelas-'));
        const presente = path.join(pasta, 'presente.exe');
        fs.writeFileSync(presente, 'x');
        fs.writeFileSync(path.join(pasta, 'ok.cts'), `module.exports = { S: ${JSON.stringify(presente)} };`);
        fs.writeFileSync(path.join(pasta, 'sem.js'), 'module.exports = {};');
        fs.writeFileSync(path.join(pasta, 'sumido.js'), `module.exports = { S: ${JSON.stringify(path.join(pasta, 'nao.exe'))} };`);
        const { rows, missing } = verificar([
            ['ok', 'ok.cts', 'S'], ['sem', 'sem.js', 'S'], ['quebrado', 'nao-existe.js', 'S'], ['sumido', 'sumido.js', 'S'],
        ], pasta);
        expect(rows.map((r) => r.trim().split(/\s+/)[0])).toEqual(['ok', 'MISSING']);
        expect(missing[0]).toBe('sem: sem.js no longer exports S');
        expect(missing[1]).toMatch(/^quebrado: cannot load nao-existe\.js — /);
        expect(missing[2]).toMatch(/^sumido: .*nao\.exe$/);
    });
});

describe('verify-toolchain-sentinels', () => {
    it('lista os sete componentes e sai com 1 so quando falta algum', () => {
        const r = spawnSync(process.execPath, [script()], { cwd: RAIZ, encoding: 'utf8' });
        const saida = `${r.stdout}\n${r.stderr}`;
        const nomes = ['toolchain (msys)', 'yanc', 'gtkwave', 'surfer', 'verible', 'clang-format', 'slang-server'];
        for (const n of nomes) {
            expect(saida).toMatch(new RegExp(`^\\s+(ok|MISSING)\\s+${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'm'));
        }
        // Nenhum downloader deixou de carregar ou de exportar a sentinela.
        expect(saida).not.toMatch(/cannot load|no longer exports/);
        const faltou = /^\s+MISSING\s/m.test(saida);
        expect(r.status).toBe(faltou ? 1 : 0);
        if (faltou) expect(saida).toContain('A release must not ship without the toolchain.');
        else expect(saida).toContain('All 7 toolchain components present.');
    });
});
