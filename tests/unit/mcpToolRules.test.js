/**
 * O bloco de regras que os motores de IA leem (main/ai/mcp_tool_rules.ts) e
 * as duas listas de onde ele tira os nomes (js/compilation/api_steps.ts).
 *
 * O defeito que estes casos fecham: o bloco existia quatro vezes, copiado a
 * mao nos quatro motores, e as quatro copias erravam junto em tres coisas.
 * Dizia-se que `compile_all` abre o PRISM, ofereciam-se cinco passos onde a
 * API aceita oito, e cinco terminais onde ha sete.
 *
 * O que se trava aqui nao e a prosa, que pode e deve mudar. E o acordo entre
 * o texto e o codigo: todo passo que a API aceita aparece no bloco, todo
 * terminal que existe aparece no bloco, e o que se diz do `compile_all` nao
 * volta a inventar um passo PRISM.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    IDS_DE_TERMINAL,
    PASSOS_DA_API,
    TERMINAIS,
    ehPassoDaApi,
} from '../../js/compilation/api_steps.ts';
import {
    PROSA_CLAUDE,
    PROSA_CODEX,
    REGRAS_CLAUDE,
    REGRAS_CODEX,
    regrasDasFerramentas,
} from '../../main/ai/mcp_tool_rules.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOTORES = ['claude_agent', 'claude_code', 'codex_agent', 'codex_cli'];

describe('PASSOS_DA_API', () => {
    it('sao os oito que o compileStep aceita', () => {
        expect([...PASSOS_DA_API]).toEqual([
            'cmm', 'cpp', 'asm', 'verilog', 'wave', 'prism',
            'verilator-proc', 'verilator-fast',
        ]);
    });

    it('os tres que a prosa antiga esquecia estao entre eles', () => {
        for (const p of ['asm', 'verilator-proc', 'verilator-fast']) {
            expect(ehPassoDaApi(p), p).toBe(true);
        }
    });

    it('recusa o que nao e passo, inclusive entrada torta', () => {
        for (const x of ['cmmcomp', '', null, undefined, 0, {}]) {
            expect(ehPassoDaApi(x)).toBe(false);
        }
    });
});

describe('TERMINAIS', () => {
    it('sao os sete que a AURORA tem, e nao os cinco que se dizia', () => {
        expect([...IDS_DE_TERMINAL]).toEqual(
            ['tcmm', 'tasm', 'tveri', 'twave', 'thtest', 'tprism', 'tcmd']);
    });

    it('o thtest esta la: e o terminal que o proprio tools.js manda ler', () => {
        expect(IDS_DE_TERMINAL).toContain('thtest');
    });

    it('cada um explica o que cai nele', () => {
        for (const id of IDS_DE_TERMINAL) {
            expect(String(TERMINAIS[id]).length, id).toBeGreaterThan(10);
        }
    });
});

describe('o bloco de regras concorda com o codigo', () => {
    for (const [nome, bloco] of [['Claude', REGRAS_CLAUDE], ['Codex', REGRAS_CODEX]]) {
        it(`${nome}: oferece todos os oito passos`, () => {
            for (const passo of PASSOS_DA_API) {
                expect(bloco, passo).toContain(`"${passo}"`);
            }
        });

        it(`${nome}: oferece todos os sete terminais`, () => {
            for (const id of IDS_DE_TERMINAL) {
                expect(bloco, id).toContain(`"${id}"`);
            }
        });

        it(`${nome}: nao volta a dizer que o compile_all abre o PRISM`, () => {
            // O runProjectPipeline pre-compila os processadores e chama o
            // runGtkWave. Nao ha passo PRISM ali dentro.
            const linha = bloco.split('\n').find((l) => l.includes('compile_all'));
            expect(linha).toBeDefined();
            expect(linha).not.toMatch(/PRISM/);
        });

        it(`${nome}: manda usar a pergunta da AURORA em vez de adivinhar`, () => {
            expect(bloco).toContain('mcp__aurora__ask_user_question');
        });
    }

    it('os dois blocos so diferem na prosa dos motores', () => {
        const soCatalogo = (prosa) => regrasDasFerramentas({
            ...prosa, semShell: [], perguntar: [], fecho: [],
        }).join('\n');
        expect(soCatalogo(PROSA_CLAUDE)).toBe(soCatalogo(PROSA_CODEX));
    });
});

describe('nenhum motor guarda a copia dele', () => {
    for (const motor of MOTORES) {
        it(`${motor}.js nao redeclara o bloco`, () => {
            const fonte = fs.readFileSync(path.join(RAIZ, 'main', 'ai', `${motor}.js`), 'utf8');
            // A copia era um literal de array com o catalogo dentro.
            expect(fonte).not.toMatch(/MCP_TOOL_RULES\s*=\s*\[/);
            expect(fonte).toMatch(/require\('\.\/mcp_tool_rules'\)/);
        });

        it(`${motor}.js faz o require ANTES de usar o bloco`, () => {
            // Foi exatamente isto que quebrou a primeira versao deste commit:
            // o require entrou abaixo do uso num dos quatro, e o aplicativo
            // inteiro morria no boot com "Cannot access 'REGRAS_CLAUDE'
            // before initialization". Um teste que so procura o require no
            // arquivo nao ve isso; a ordem e que importa.
            const linhas = fs.readFileSync(
                path.join(RAIZ, 'main', 'ai', `${motor}.js`), 'utf8').split('\n');
            const ondeRequire = linhas.findIndex((l) => l.includes("require('./mcp_tool_rules')"));
            const ondeUso = linhas.findIndex((l) => /MCP_TOOL_RULES\s*=\s*REGRAS_/.test(l));
            expect(ondeRequire).toBeGreaterThanOrEqual(0);
            expect(ondeUso).toBeGreaterThanOrEqual(0);
            expect(ondeRequire, `require na linha ${ondeRequire + 1}, uso na ${ondeUso + 1}`)
                .toBeLessThan(ondeUso);
        });
    }
});
