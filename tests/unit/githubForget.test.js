/**
 * Testes da regra que decide o que a limpeza pode apagar.
 *
 * É a única parte deste recurso que não dá para verificar depois: um alvo
 * apagado por engano não volta. Se o filtro pegar largo demais, a ferramenta
 * leva junto a credencial do Office, da rede da universidade e do que mais
 * estiver no Gerenciador de Credenciais, e uma limpeza que destrói o que não é
 * dela é pior do que não existir.
 *
 * Nada aqui toca o Gerenciador de verdade: o alvo do teste é o filtro.
 */

import { describe, it, expect } from 'vitest';

import { alvoEhDeForja, HOSTS, HOSTS_GITLAB } from '../../main/ipc/github_forget.js';

describe('alvoEhDeForja', () => {
    it('reconhece as formas que o Git Credential Manager cria', () => {
        for (const alvo of [
            'git:https://github.com',
            'https://github.com',
            'github.com',
            'git:https://gist.github.com',
            'LegacyGeneric:target=git:https://github.com',
        ]) {
            expect(alvoEhDeForja(alvo), alvo).toBe(true);
        }
    });

    it('nao confunde maiuscula com minuscula', () => {
        expect(alvoEhDeForja('git:https://GitHub.com')).toBe(true);
    });

    it('NAO pega o que nao e do GitHub', () => {
        for (const alvo of [
            'git:https://bitbucket.org',
            'MicrosoftOffice16_Data:ADAL:x',
            'Domain:target=servidor.ufjf.br',
            'git:https://github.com.exemplo.net',   // sufixo forjado
            'notgithub.com',
            'meugithub.com',
        ]) {
            expect(alvoEhDeForja(alvo), alvo).toBe(false);
        }
    });

    it('nao quebra com entrada vazia ou invalida', () => {
        for (const alvo of ['', null, undefined, 0, {}]) {
            expect(alvoEhDeForja(alvo)).toBe(false);
        }
    });

    it('desde 23/08/2026 pega tambem o GitLab, que virou forja conhecida', () => {
        for (const alvo of ['gitlab.com', 'git:https://gitlab.com', 'https://GitLab.com']) {
            expect(alvoEhDeForja(alvo), alvo).toBe(true);
        }
    });

    it('o sufixo forjado nao passa nem para o GitLab', () => {
        expect(alvoEhDeForja('git:https://gitlab.com.exemplo.net')).toBe(false);
        expect(alvoEhDeForja('meugitlab.com')).toBe(false);
    });

    it('a lista de hosts e restrita, e nao um curinga', () => {
        expect(HOSTS.every((h) => h.endsWith('github.com'))).toBe(true);
        expect(HOSTS_GITLAB).toEqual(['gitlab.com']);
    });
});
