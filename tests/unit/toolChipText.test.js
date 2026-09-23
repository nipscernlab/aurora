/**
 * O texto de um chip de ferramenta do painel de IA (js/ai/tool_chip_text.ts).
 *
 * Os quatro estavam dentro do js/ui/ai_assistant_manager.js, uma classe de
 * 4119 linhas com 128 metodos. Nao tocam em DOM, mas enterrados la so davam
 * para exercitar subindo o painel inteiro, entao nunca tiveram teste proprio.
 */

import { describe, expect, it } from 'vitest';

import {
    formatArgsForTitle,
    formatToolTooltip,
    prettyToolName,
    summariseResult,
} from '../../js/ai/tool_chip_text.ts';

describe('prettyToolName', () => {
    it('troca o sublinhado por espaco, que e o nome que a pessoa le', () => {
        expect(prettyToolName('get_terminal_output')).toBe('get terminal output');
    });

    it('cai em "tool" quando nao vem nome', () => {
        for (const x of [null, undefined, '']) expect(prettyToolName(x)).toBe('tool');
    });
});

describe('formatArgsForTitle', () => {
    it('devolve o JSON indentado', () => {
        expect(formatArgsForTitle({ step: 'cpp' })).toBe('{\n  "step": "cpp"\n}');
    });

    it('objeto vazio vira `{}`, e nao texto vazio', () => {
        // Diferente do previewArgs do tool_permission.js, e de proposito: aqui
        // o chip esta descrevendo uma chamada que aconteceu sem argumento.
        expect(formatArgsForTitle({})).toBe('{}');
    });

    it('corta no limite e marca o corte', () => {
        const grande = formatArgsForTitle({ x: 'a'.repeat(2000) });
        expect(grande).toHaveLength(801);
        expect(grande.endsWith('…')).toBe(true);
    });

    it('o que nao serializa vira texto vazio, e nao um estouro', () => {
        const ciclo = {};
        ciclo.eu = ciclo;
        expect(formatArgsForTitle(ciclo)).toBe('');
    });
});

describe('summariseResult', () => {
    it('nulo continua nulo, e valor simples passa direto', () => {
        expect(summariseResult(null)).toBeNull();
        expect(summariseResult(undefined)).toBeNull();
        expect(summariseResult(42)).toBe(42);
        expect(summariseResult(true)).toBe(true);
    });

    it('texto longo e cortado no limite', () => {
        expect(summariseResult('a'.repeat(5000))).toHaveLength(4000);
    });

    it('conhece a forma da AuroraAPI, { ok, data }', () => {
        expect(summariseResult({ ok: true, data: { step: 'cpp' } }))
            .toEqual({ ok: true, data: { step: 'cpp' } });
    });

    it('conhece a forma do Claude Code, { ok, content }', () => {
        expect(summariseResult({ ok: false, content: 'saida' }))
            .toEqual({ ok: false, content: 'saida' });
    });

    it('o erro entra como texto, cortado', () => {
        expect(summariseResult({ ok: false, error: 'x'.repeat(900) }).error)
            .toHaveLength(800);
    });

    it('campo que nao e do contrato nao entra no resumo', () => {
        expect(summariseResult({ ok: true, segredo: 'nao' })).toEqual({ ok: true });
    });

    it('DEFEITO CONHECIDO: data grande vira "[unserialisable]" em vez de truncado', () => {
        // O corte e feito no TEXTO do JSON e o pedaco e reparseado, o que
        // quase sempre falha, porque JSON cortado no meio e JSON invalido.
        // Este caso trava o que acontece HOJE; consertar muda o que fica
        // gravado nas conversas e por isso ficou fora desta extracao. Ver a
        // nota no cabecalho de summariseResult.
        const lista = Array.from({ length: 2000 }, (_, i) => i);
        expect(JSON.stringify(lista).length).toBeGreaterThan(4000);
        const grande = { ok: true, data: { lista } };
        expect(summariseResult(grande).data).toBe('[unserialisable]');
    });
});

describe('formatToolTooltip', () => {
    it('mostra argumentos e resultado, uma linha cada', () => {
        const t = formatToolTooltip({ step: 'cpp' }, 'compilou');
        expect(t.split('\n')[0]).toBe('args: {');
        expect(t).toContain('result: compilou');
    });

    it('sem argumento e sem resultado, nao inventa linha', () => {
        expect(formatToolTooltip({}, null)).toBe('');
        expect(formatToolTooltip(null, undefined)).toBe('');
    });

    it('so o resultado, quando nao ha argumento', () => {
        expect(formatToolTooltip({}, 'saida')).toBe('result: saida');
    });

    it('resultado em objeto sai serializado e cortado', () => {
        const linha = formatToolTooltip({}, { ok: true, content: 'z'.repeat(3000) });
        expect(linha.startsWith('result: {')).toBe(true);
        expect(linha.endsWith('…')).toBe(true);
    });
});
