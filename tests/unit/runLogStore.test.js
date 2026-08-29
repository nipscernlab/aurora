import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
// O modulo do main puxa `electron` so pelo `ipcMain` do register(); as funcoes
// exercitadas aqui nao o tocam, e o vitest resolve o pacote sem subir Electron.
const loja = require('../../main/ipc/run_log.js');

// O registro mora DENTRO do projeto, em .aurora/execucoes, e nao no perfil do
// usuario: copiar o projeto leva o historico junto, apagar o projeto apaga o
// historico junto, que e o que qualquer um espera.

let projeto;
beforeEach(() => { projeto = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-runlog-')); });
afterEach(() => { fs.rmSync(projeto, { recursive: true, force: true }); });

const exec = (id, extra = {}) => ({
    formato: 1, id, pedido: 'wave', inicio: 1, fim: 2, ms: 1, ok: true,
    passos: [{ step: 'wave', ferramenta: 'iverilog.exe', args: [], code: 0, ms: 5 }],
    ...extra,
});

describe('gravar', () => {
    it('escreve um arquivo por execucao, dentro do projeto', async () => {
        const r = await loja.gravar(projeto, exec('2026-08-29T14-22-31-wave'));
        expect(r.ok).toBe(true);
        const alvo = path.join(projeto, '.aurora', 'execucoes', '2026-08-29T14-22-31-wave.json');
        expect(fs.existsSync(alvo)).toBe(true);
        expect(JSON.parse(fs.readFileSync(alvo, 'utf8')).pedido).toBe('wave');
    });

    it('recusa id que nao veio do gerador', async () => {
        // Sem isto, um id com `..` escreveria fora da pasta do projeto. O nome
        // do arquivo e montado aqui justamente para o renderer nao o escolher.
        for (const ruim of ['../fora', 'qualquer', '2026-08-29T14-22-31-wave/../x', '']) {
            expect((await loja.gravar(projeto, exec(ruim))).ok).toBe(false);
        }
        expect(fs.existsSync(path.join(projeto, '.aurora'))).toBe(false);
    });

    it('recusa caminho de projeto que nao e absoluto', async () => {
        expect((await loja.gravar('relativo/aqui', exec('2026-08-29T14-22-31-wave'))).ok).toBe(false);
    });

    it('poda as antigas e mantem as cinquenta mais novas', async () => {
        for (let i = 0; i < 53; i++) {
            const h = String(i % 24).padStart(2, '0');
            const d = String(1 + Math.floor(i / 24)).padStart(2, '0');
            await loja.gravar(projeto, exec(`2026-08-${d}T${h}-00-00-cmm`));
        }
        const restantes = fs.readdirSync(path.join(projeto, '.aurora', 'execucoes'));
        expect(restantes).toHaveLength(50);
        // As que sairam sao as mais antigas, e a ordem alfabetica do id e a
        // cronologica: e o que permite podar sem abrir arquivo nenhum.
        expect(restantes.sort()[0] > '2026-08-01T02-00-00-cmm.json').toBe(true);
    });
});

describe('listar e ler', () => {
    it('lista da mais recente para a mais antiga, so com o resumo', async () => {
        await loja.gravar(projeto, exec('2026-08-29T10-00-00-cmm', { pedido: 'cmm' }));
        await loja.gravar(projeto, exec('2026-08-29T11-00-00-wave', { pedido: 'wave', ok: false }));
        const r = await loja.listar(projeto);
        expect(r.execucoes.map((e) => e.pedido)).toEqual(['wave', 'cmm']);
        expect(r.execucoes[0]).toMatchObject({ ok: false, passos: 1 });
        // Resumo, e nao a execucao inteira: a lista abre rapido mesmo com 50.
        expect(r.execucoes[0].passos).toBe(1);
    });

    it('projeto sem historico devolve lista vazia, e nao erro', async () => {
        const r = await loja.listar(projeto);
        expect(r).toEqual({ ok: true, execucoes: [] });
    });

    it('um arquivo corrompido nao derruba a listagem', async () => {
        await loja.gravar(projeto, exec('2026-08-29T10-00-00-cmm'));
        fs.writeFileSync(path.join(projeto, '.aurora', 'execucoes', '2026-08-29T11-00-00-wave.json'), '{quebrado');
        const r = await loja.listar(projeto);
        expect(r.ok).toBe(true);
        expect(r.execucoes).toHaveLength(1);
    });

    it('ler devolve a execucao inteira, e recusa id invalido', async () => {
        await loja.gravar(projeto, exec('2026-08-29T10-00-00-cmm'));
        const r = await loja.ler(projeto, '2026-08-29T10-00-00-cmm');
        expect(r.ok).toBe(true);
        expect(r.execucao.passos[0].ferramenta).toBe('iverilog.exe');
        expect((await loja.ler(projeto, '../fora')).ok).toBe(false);
    });
});
