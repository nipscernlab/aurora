import { describe, it, expect } from 'vitest';
import { motivoDe } from '../../js/app/api_reply.js';

// A regra: nenhuma resposta de API vira um "Falhou." seco na tela. Quando o
// motivo vem, ele aparece; quando nao vem, a mensagem diz que a API respondeu
// sem motivo e mostra o que chegou, que e a unica pista para consertar.

describe('motivoDe', () => {
    it('usa o motivo em qualquer das formas que as APIs da casa devolvem', () => {
        expect(motivoDe({ ok: false, error: 'disco cheio' }, 'Instalar')).toBe('Instalar: disco cheio');
        expect(motivoDe({ ok: false, erro: 'sem rede' }, 'Consultar')).toBe('Consultar: sem rede');
        expect(motivoDe({ ok: false, error: { message: 'HTTP 404', code: 'E404' } }, 'Ler')).toBe('Ler: HTTP 404');
        expect(motivoDe('texto solto', 'Abrir')).toBe('Abrir: texto solto');
    });

    it('sem motivo, diz que a API respondeu sem dizer o erro e mostra a resposta', () => {
        const m = motivoDe({ ok: false }, 'Instalar');
        expect(m.startsWith('Instalar: ')).toBe(true);
        expect(m).toContain('sem dizer o erro');
        expect(m).toContain('{"ok":false}');
    });

    it('resposta nula ou ausente tambem vira mensagem completa', () => {
        expect(motivoDe(undefined, 'Salvar')).toContain('undefined');
        expect(motivoDe(null, 'Salvar')).toContain('null');
    });

    it('sem operacao, devolve so o motivo', () => {
        expect(motivoDe({ error: 'x' }, '')).toBe('x');
    });

    it('nao deixa uma resposta gigante virar uma parede na tela', () => {
        const grande = { ok: false, dados: 'a'.repeat(5000) };
        expect(motivoDe(grande, 'Ler').length).toBeLessThan(260);
    });
});
