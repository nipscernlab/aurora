/**
 * Todo download de componente confere o SHA-256 do que baixou.
 *
 * O MSYS (gcc, python, perl), o yanc e o GTKWave eram baixados com
 * EXPECTED_SHA256 = null, e lib/checksum.js so registrava o hash no log: quem
 * trocasse o arquivo de uma release entregaria outro binario a todo mundo que
 * instalasse depois (auditoria de 28/10/2026). Este teste reprova um script de
 * download que volte a nao pinar o hash, e prova que o checksum recusa.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = path.join(RAIZ, 'components', 'Scripts');
const { verifyChecksum } = createRequire(import.meta.url)('../../components/Scripts/lib/checksum.js');

const HEX = /^[0-9a-f]{64}$/;

/** Os scripts de download que conferem hash, com o fonte de cada um. */
const comChecksum = fs.readdirSync(SCRIPTS)
    .filter((n) => /^download-.*\.(c?js|cts)$/.test(n))
    .map((n) => ({ nome: n, fonte: fs.readFileSync(path.join(SCRIPTS, n), 'utf8') }))
    .filter((s) => s.fonte.includes('verifyChecksum('));

describe('todo download pina o sha256', () => {
    it('acha os scripts que conferem hash, inclusive os tres que nao pinavam', () => {
        const nomes = comChecksum.map((s) => s.nome);
        for (const n of ['download-toolchain.cts', 'download-yanc.cts', 'download-gtkwave-nipscern.cts']) {
            expect(nomes).toContain(n);
        }
    });

    it.each(comChecksum.map((s) => [s.nome, s.fonte]))('%s tem o hash pinado', (_nome, fonte) => {
        const unico = /const EXPECTED_SHA256\s*(?::[^=]+)?=\s*([^;]+);/.exec(fonte);
        if (unico) {
            expect(unico[1].trim()).toMatch(/^'[0-9a-f]{64}'$/);
            return;
        }
        // Os que baixam mais de um arquivo pinam um sha256 por artefato.
        const hashes = [...fonte.matchAll(/sha256:\s*'([^']*)'/g)].map((m) => m[1]);
        expect(hashes.length).toBeGreaterThan(0);
        for (const h of hashes) expect(h).toMatch(HEX);
        expect(fonte).not.toMatch(/sha256:\s*null/);
    });
});

describe('lib/checksum', () => {
    let dir;
    afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = null; });
    const arquivo = (conteudo) => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-sha-'));
        const p = path.join(dir, 'x.zip');
        fs.writeFileSync(p, conteudo);
        return p;
    };
    // sha256 de "abc"
    const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

    it('hash igual passa, sem diferenca de caixa', async () => {
        await expect(verifyChecksum(arquivo('abc'), ABC.toUpperCase(), () => {})).resolves.toBe(ABC);
    });

    it('hash diferente recusa extrair', async () => {
        await expect(verifyChecksum(arquivo('abd'), ABC, () => {})).rejects.toThrow('Checksum mismatch for x.zip');
    });
});
