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

import { alvoEhDoGitHub, HOSTS } from '../../main/ipc/github_forget.js';

describe('alvoEhDoGitHub', () => {
    it('reconhece as formas que o Git Credential Manager cria', () => {
        for (const alvo of [
            'git:https://github.com',
            'https://github.com',
            'github.com',
            'git:https://gist.github.com',
            'LegacyGeneric:target=git:https://github.com',
        ]) {
            expect(alvoEhDoGitHub(alvo), alvo).toBe(true);
        }
    });

    it('nao confunde maiuscula com minuscula', () => {
        expect(alvoEhDoGitHub('git:https://GitHub.com')).toBe(true);
    });

    it('NAO pega o que nao e do GitHub', () => {
        for (const alvo of [
            'git:https://gitlab.com',
            'gitlab.com',
            'git:https://bitbucket.org',
            'MicrosoftOffice16_Data:ADAL:x',
            'Domain:target=servidor.ufjf.br',
            'git:https://github.com.exemplo.net',   // sufixo forjado
            'notgithub.com',
            'meugithub.com',
        ]) {
            expect(alvoEhDoGitHub(alvo), alvo).toBe(false);
        }
    });

    it('nao quebra com entrada vazia ou invalida', () => {
        for (const alvo of ['', null, undefined, 0, {}]) {
            expect(alvoEhDoGitHub(alvo)).toBe(false);
        }
    });

    it('a lista de hosts e restrita, e nao um curinga', () => {
        expect(HOSTS.every((h) => h.endsWith('github.com'))).toBe(true);
    });
});
