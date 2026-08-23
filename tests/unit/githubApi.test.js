import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  nomeRepoValido, mapRepo, fimDaPaginacao, erroDeCriacao,
  intervaloInicialMs, decidirPolling,
} = require('../../main/ipc/github_api.js');

// As decisoes do painel de git contra a API do GitHub (main/ipc/github_api.js).
// Estavam presas dentro de github_auth.js, misturadas com https e safeStorage, e
// a mais intricada delas vivia dentro de um laco com sleep, inalcancavel por
// teste sem servidor falso e sem esperar minutos.

describe('nomeRepoValido', () => {
  it('aceita o que o GitHub aceita', () => {
    for (const n of ['aurora', 'aurora-ide', 'aurora_ide', 'aurora.ide', 'SAPHO2026']) {
      expect(nomeRepoValido(n), n).toBe(true);
    }
  });

  it('recusa o que viraria caminho ou consulta na URL da API', () => {
    for (const n of ['a/b', 'a b', '../x', 'a?b', 'a#b', 'á', '']) {
      expect(nomeRepoValido(n), JSON.stringify(n)).toBe(false);
    }
  });

  it('recusa o que nem sequer e texto', () => {
    expect(nomeRepoValido(undefined)).toBe(false);
    expect(nomeRepoValido(null)).toBe(false);
    expect(nomeRepoValido(42)).toBe(false);
  });
});

describe('mapRepo', () => {
  const cru = {
    name: 'aurora', full_name: 'nipscernlab/aurora',
    clone_url: 'https://github.com/nipscernlab/aurora.git',
    html_url: 'https://github.com/nipscernlab/aurora',
    private: false, description: 'AURORA IDE', updated_at: '2026-08-09T02:43:14Z',
    owner: { login: 'nipscernlab', type: 'Organization' }, fork: false,
  };

  it('leva os campos que o painel usa', () => {
    expect(mapRepo(cru)).toEqual({
      name: 'aurora', fullName: 'nipscernlab/aurora',
      cloneUrl: 'https://github.com/nipscernlab/aurora.git',
      htmlUrl: 'https://github.com/nipscernlab/aurora',
      private: false, description: 'AURORA IDE', updatedAt: '2026-08-09T02:43:14Z',
      owner: 'nipscernlab', ownerType: 'Organization', fork: false,
      // Desde 23/08/2026 o painel lista GitHub e GitLab juntos, e a linha
      // precisa dizer de onde veio.
      forge: 'github',
    });
  });

  it('sobrevive a repositorio sem dono no corpo da resposta', () => {
    // Acontece com token de escopo estreito. Um acesso direto a r.owner.login
    // derrubaria a listagem inteira por causa de uma linha.
    const semDono = mapRepo({ ...cru, owner: undefined });
    expect(semDono.owner).toBeNull();
    expect(semDono.ownerType).toBeNull();
  });

  it('troca descricao nula por texto vazio, que e o que o painel desenha', () => {
    expect(mapRepo({ ...cru, description: null }).description).toBe('');
  });

  it('normaliza fork para booleano', () => {
    expect(mapRepo({ ...cru, fork: undefined }).fork).toBe(false);
    expect(mapRepo({ ...cru, fork: 1 }).fork).toBe(true);
  });
});

describe('fimDaPaginacao', () => {
  it('para na pagina curta, que e a ultima', () => {
    expect(fimDaPaginacao(new Array(37), 100)).toBe(true);
  });

  it('continua na pagina cheia', () => {
    expect(fimDaPaginacao(new Array(100), 100)).toBe(false);
  });

  it('para na pagina vazia, o caso do total multiplo exato', () => {
    // Quem tem exatamente 100 repositorios recebe a segunda pagina vazia; sem
    // esta parada o laco gastaria as cinco paginas do teto sempre.
    expect(fimDaPaginacao([], 100)).toBe(true);
  });

  it('para quando a resposta nem sequer e lista', () => {
    expect(fimDaPaginacao(null, 100)).toBe(true);
    expect(fimDaPaginacao({ message: 'Bad credentials' }, 100)).toBe(true);
  });
});

describe('erroDeCriacao', () => {
  it('diz que o problema e o TIPO do token, que a mensagem crua nao diz', () => {
    const m = erroDeCriacao('Resource not accessible by personal access token', 'x');
    expect(m).toMatch(/CLÁSSICO/);
    expect(m).toMatch(/escopo "repo"/);
  });

  it('cobre as tres formas em que a recusa por escopo chega', () => {
    for (const cru of ['Resource not accessible', 'Forbidden', 'GitHub API 403: ...']) {
      expect(erroDeCriacao(cru, 'x'), cru).toMatch(/CLÁSSICO/);
    }
  });

  it('diz QUAL nome ja existe, que a mensagem crua tambem nao diz', () => {
    expect(erroDeCriacao('name already exists on this account', 'aurora'))
      .toBe('Já existe um repositório "aurora" na sua conta.');
  });

  it('repassa intacto o que nao sabe traduzir', () => {
    expect(erroDeCriacao('GitHub API 500: upstream boom', 'x')).toBe('GitHub API 500: upstream boom');
  });

  it('nao explode com mensagem ausente', () => {
    expect(erroDeCriacao(undefined, 'x')).toBe('');
  });
});

describe('intervaloInicialMs', () => {
  it('respeita o intervalo que o GitHub pediu, com um segundo de folga', () => {
    // Bater no limite custa uma rodada inteira de espera; um segundo a menos
    // nao encurta nada perceptivel para quem esta digitando o codigo.
    expect(intervaloInicialMs({ interval: 5 })).toBe(6000);
    expect(intervaloInicialMs({ interval: 10 })).toBe(11000);
  });

  it('cai no padrao quando a resposta nao traz intervalo', () => {
    expect(intervaloInicialMs({})).toBe(6000);
    expect(intervaloInicialMs(null)).toBe(6000);
    expect(intervaloInicialMs({ interval: 0 })).toBe(6000);
    expect(intervaloInicialMs({ interval: 'cinco' })).toBe(6000);
  });
});

describe('decidirPolling', () => {
  it('conclui quando o token chega', () => {
    expect(decidirPolling({ access_token: 'gho_x' })).toEqual({ acao: 'pronto', token: 'gho_x' });
  });

  it('espera enquanto o usuario ainda esta autorizando', () => {
    // Tratar isto como falha abortaria o fluxo com o usuario no meio da
    // digitacao do codigo, que e o estado NORMAL das primeiras rodadas.
    expect(decidirPolling({ error: 'authorization_pending' })).toEqual({ acao: 'esperar' });
  });

  it('desacelera quando o GitHub manda, e pelo tanto que ele manda', () => {
    // Continuar no mesmo ritmo faz o GitHub cortar.
    expect(decidirPolling({ error: 'slow_down', interval: 7 }))
      .toEqual({ acao: 'desacelerar', acrescimoMs: 7000 });
  });

  it('desacelera pelo padrao quando o slow_down vem sem intervalo', () => {
    expect(decidirPolling({ error: 'slow_down' })).toEqual({ acao: 'desacelerar', acrescimoMs: 5000 });
  });

  it('falha com frase propria nos dois desfechos definitivos', () => {
    expect(decidirPolling({ error: 'expired_token' }))
      .toEqual({ acao: 'falhar', mensagem: 'The code expired — please try again.' });
    expect(decidirPolling({ error: 'access_denied' }))
      .toEqual({ acao: 'falhar', mensagem: 'Authorization was denied.' });
  });

  it('falha em vez de girar quando o erro e desconhecido', () => {
    // Tratar desconhecido como "continuar" deixaria o laco rodando ate o prazo
    // acabar sem nunca dizer por que.
    expect(decidirPolling({ error: 'unsupported_grant_type', error_description: 'nope' }))
      .toEqual({ acao: 'falhar', mensagem: 'nope' });
    expect(decidirPolling({ error: 'weird' })).toEqual({ acao: 'falhar', mensagem: 'weird' });
    expect(decidirPolling({})).toEqual({ acao: 'falhar', mensagem: 'OAuth failed.' });
    expect(decidirPolling(null)).toEqual({ acao: 'falhar', mensagem: 'OAuth failed.' });
  });
});
