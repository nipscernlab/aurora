/**
 * As decisões do GitLab, sem rede.
 *
 * A tradução entre as duas APIs é o trabalho de verdade, e é onde um erro
 * passa despercebido: um projeto `internal` do GitLab não é público, e tratá-lo
 * como público mostraria sem cadeado um repositório que só quem tem conta na
 * instância enxerga.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    nomeProjetoValido, normalizarHost, mapProject, fimDaPaginacao, erroDeCriacao, mapUser,
} = require('../../main/ipc/gitlab_api.js');

describe('nomeProjetoValido', () => {
    it('aceita o que o GitLab aceita', () => {
        for (const n of ['surfer', 'surfer-aurora', 'meu_projeto', 'v1.2', 'a']) {
            expect(nomeProjetoValido(n), n).toBe(true);
        }
    });

    it('recusa o que o servidor recusaria depois', () => {
        // Começar com pontuação, espaço, barra e os dois sufixos reservados.
        for (const n of ['-começo', '.oculto', 'com espaço', 'grupo/projeto', 'x/y', '']) {
            expect(nomeProjetoValido(n), n).toBe(false);
        }
        expect(nomeProjetoValido('projeto.git')).toBe(false);
        expect(nomeProjetoValido('Projeto.GIT')).toBe(false);
        expect(nomeProjetoValido('feed.atom')).toBe(false);
    });

    it('recusa o que nem é texto', () => {
        expect(nomeProjetoValido(null)).toBe(false);
        expect(nomeProjetoValido(42)).toBe(false);
    });
});

describe('normalizarHost', () => {
    it('vazio significa gitlab.com', () => {
        expect(normalizarHost('')).toEqual({ host: 'gitlab.com', base: 'https://gitlab.com' });
        expect(normalizarHost(undefined)).toEqual({ host: 'gitlab.com', base: 'https://gitlab.com' });
    });

    it('aceita o que se copia da barra do navegador', () => {
        const esperado = { host: 'gitlab.com', base: 'https://gitlab.com' };
        expect(normalizarHost('gitlab.com')).toEqual(esperado);
        expect(normalizarHost('https://gitlab.com')).toEqual(esperado);
        expect(normalizarHost('https://gitlab.com/')).toEqual(esperado);
        expect(normalizarHost('  https://gitlab.com/nips-cern  ')).toEqual(esperado);
    });

    it('aceita instância própria, com porta', () => {
        expect(normalizarHost('gitlab.exemplo.edu.br:8443'))
            .toEqual({ host: 'gitlab.exemplo.edu.br:8443', base: 'https://gitlab.exemplo.edu.br:8443' });
    });

    it('recusa http, porque token em texto puro numa rede de laboratório não', () => {
        expect(normalizarHost('http://gitlab.local')).toBe(null);
    });

    it('recusa o que não é host', () => {
        expect(normalizarHost('https://')).toBe(null);
        expect(normalizarHost('não é host')).toBe(null);
    });
});

describe('mapProject', () => {
    const projeto = {
        name: 'surfer',
        path_with_namespace: 'nips-cern/surfer',
        http_url_to_repo: 'https://gitlab.com/nips-cern/surfer.git',
        web_url: 'https://gitlab.com/nips-cern/surfer',
        visibility: 'public',
        description: 'fork do Surfer',
        last_activity_at: '2026-08-20T12:00:00Z',
        namespace: { full_path: 'nips-cern', kind: 'group' },
        forked_from_project: { id: 1 },
    };

    it('devolve a mesma forma do GitHub, para o painel não saber a origem', () => {
        expect(mapProject(projeto)).toEqual({
            name: 'surfer',
            fullName: 'nips-cern/surfer',
            cloneUrl: 'https://gitlab.com/nips-cern/surfer.git',
            htmlUrl: 'https://gitlab.com/nips-cern/surfer',
            private: false,
            description: 'fork do Surfer',
            updatedAt: '2026-08-20T12:00:00Z',
            owner: 'nips-cern',
            ownerType: 'Organization',
            fork: true,
            forge: 'gitlab',
        });
    });

    it('internal conta como privado, que é o lado seguro do erro', () => {
        expect(mapProject({ ...projeto, visibility: 'internal' }).private).toBe(true);
        expect(mapProject({ ...projeto, visibility: 'private' }).private).toBe(true);
    });

    it('namespace de usuário vira User, e grupo vira Organization', () => {
        expect(mapProject({ ...projeto, namespace: { full_path: 'chrys', kind: 'user' } }).ownerType).toBe('User');
    });

    it('projeto sem namespace não derruba a lista inteira', () => {
        const sem = mapProject({ ...projeto, namespace: undefined });
        expect(sem.owner).toBe(null);
        expect(sem.ownerType).toBe(null);
    });
});

describe('fimDaPaginacao', () => {
    it('página curta ou vazia termina; página cheia continua', () => {
        expect(fimDaPaginacao(new Array(100).fill(0), 100)).toBe(false);
        expect(fimDaPaginacao(new Array(37).fill(0), 100)).toBe(true);
        expect(fimDaPaginacao([], 100)).toBe(true);
        expect(fimDaPaginacao(null, 100)).toBe(true);
    });
});

describe('erroDeCriacao', () => {
    it('nome repetido diz qual nome', () => {
        expect(erroDeCriacao('name has already been taken', 'surfer')).toContain('"surfer"');
    });

    it('403 explica que o problema é o escopo do token, e não a permissão', () => {
        const m = erroDeCriacao('403 Forbidden', 'x');
        expect(m).toMatch(/escopo "api"/);
    });

    it('401 diz que o token foi recusado', () => {
        expect(erroDeCriacao('401 Unauthorized', 'x')).toMatch(/recusado/);
    });

    it('o que não se sabe traduzir passa inteiro', () => {
        expect(erroDeCriacao('limite de projetos atingido', 'x')).toBe('limite de projetos atingido');
    });
});

describe('mapUser', () => {
    it('username do GitLab vira login, que é como o painel fala', () => {
        expect(mapUser({ username: 'chrys', name: 'Chrysthofer', avatar_url: 'u', web_url: 'w' }, 'gitlab.com'))
            .toEqual({ login: 'chrys', name: 'Chrysthofer', avatarUrl: 'u', webUrl: 'w', host: 'gitlab.com' });
    });

    it('sem nome, o login serve de nome', () => {
        expect(mapUser({ username: 'chrys' }, 'gitlab.com').name).toBe('chrys');
    });
});
