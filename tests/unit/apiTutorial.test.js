// O tutorial guiado da API (js/ai/api_tutorial.js): a leitura do manual que o
// alimenta e o bloco que vai para o system prompt. O caminho sem manual ja e
// exercitado pelo conversasDoChat.test.js; aqui fica o manual de verdade.

import { describe, it, expect, vi } from 'vitest';
import { lerPaginasDoManual, montarBlocoTutorial, aberturaDoTutorial } from '../../js/ai/api_tutorial.js';

/** O manual falso, com a forma de main/ipc/docs: `{ ok, resultados }` e `{ ok, texto, titulo, caminho }`. */
function manual({ busca, paginas }) {
  return {
    docsBuscar: vi.fn(async (tema) => busca(tema)),
    docsLer: vi.fn(async (caminho) => paginas(caminho)),
  };
}

describe('lerPaginasDoManual', () => {
  it('le a primeira pagina ainda nao vista de cada tema, na ordem dos temas', async () => {
    const api = manual({
      busca: (tema) => ({ ok: true, resultados: [
        { caminho: 'comum.md', titulo: 'Comum' },
        { caminho: `${tema.split(' ')[0]}.md`, titulo: tema },
      ] }),
      paginas: (c) => ({ ok: true, texto: `texto de ${c}`, titulo: `T ${c}` }),
    });
    const r = await lerPaginasDoManual(api);
    expect(r.motivo).toBe('');
    expect(r.paginas.map((p) => p.caminho)).toEqual(['comum.md', 'projeto.md', 'compilacao.md', 'simulacao.md', 'PRISM.md']);
    expect(r.paginas[0]).toEqual({ titulo: 'T comum.md', caminho: 'comum.md', texto: 'texto de comum.md' });
    expect(api.docsBuscar).toHaveBeenCalledTimes(5);
    expect(api.docsBuscar.mock.calls[0]).toEqual(['Aurora Intelligence ferramentas permissoes', { limite: 2 }]);
    expect(api.docsLer.mock.calls[0]).toEqual(['comum.md', { limite: 12000 }]);
  });

  it('sem os dois canais, diz que a busca nao esta disponivel', async () => {
    expect(await lerPaginasDoManual(undefined)).toEqual({ paginas: [], motivo: 'a busca no manual nao esta disponivel nesta janela' });
    expect((await lerPaginasDoManual({ docsBuscar: vi.fn() })).motivo).toBe('a busca no manual nao esta disponivel nesta janela');
  });

  it('a busca que lanca ou recusa para tudo e diz o motivo, guardando o que ja leu', async () => {
    let n = 0;
    const lanca = manual({
      busca: () => { if (n++) throw new Error('indice corrompido'); return { ok: true, resultados: [{ caminho: 'a.md' }] }; },
      paginas: () => ({ ok: true, texto: 'A' }),
    });
    const r1 = await lerPaginasDoManual(lanca);
    expect(r1).toEqual({ paginas: [{ titulo: 'a.md', caminho: 'a.md', texto: 'A' }], motivo: 'busca no manual falhou: indice corrompido' });

    const semMensagem = manual({ busca: () => { throw 'cru'; }, paginas: () => null });
    expect((await lerPaginasDoManual(semMensagem)).motivo).toBe('busca no manual falhou: cru');

    const recusa = (r) => manual({ busca: () => r, paginas: () => null });
    expect((await lerPaginasDoManual(recusa({ ok: false, erro: 'sem manual' }))).motivo).toBe('sem manual');
    expect((await lerPaginasDoManual(recusa({ ok: false, error: 'no manual' }))).motivo).toBe('no manual');
    expect((await lerPaginasDoManual(recusa(null))).motivo).toBe('busca no manual respondeu sem dizer o erro');
  });

  it('tema sem resultado novo, leitura que falha ou vem vazia: pula para o proximo tema', async () => {
    const api = manual({
      busca: (tema) => {
        if (tema.startsWith('Aurora')) return { ok: true };                                  // sem resultados
        if (tema.startsWith('projeto')) return { ok: true, resultados: [null, { titulo: 'sem caminho' }] };
        if (tema.startsWith('compilacao')) return { ok: true, resultados: [{ caminho: 'lanca.md' }] };
        if (tema.startsWith('simulacao')) return { ok: true, resultados: [{ caminho: 'vazia.md' }] };
        return { ok: true, resultados: [{ caminho: 'boa.md', titulo: 'Boa' }] };
      },
      paginas: (c) => {
        if (c === 'lanca.md') throw new Error('io');
        if (c === 'vazia.md') return { ok: true, texto: '' };
        return { ok: true, texto: 'conteudo' };
      },
    });
    const r = await lerPaginasDoManual(api);
    // Sem titulo na pagina, fica o do resultado da busca.
    expect(r).toEqual({ paginas: [{ titulo: 'Boa', caminho: 'boa.md', texto: 'conteudo' }], motivo: '' });
  });

  it('corta cada pagina em 12000 caracteres; o caminho e o da pagina lida quando ela diz', async () => {
    let i = 0;
    const api = manual({
      busca: () => ({ ok: true, resultados: [{ caminho: `p${i++}.md` }] }),
      paginas: (c) => ({ ok: true, texto: 'x'.repeat(c === 'p0.md' ? 50000 : 13000), caminho: `lido/${c}` }),
    });
    const r = await lerPaginasDoManual(api);
    // O teto total (60000) nunca e alcancado: sao cinco temas de no maximo
    // 12000 cada, 60000 exatos, e o corte exige passar. O `break` so vale se
    // um tema novo entrar na lista.
    expect(r.paginas.map((p) => p.texto.length)).toEqual([12000, 12000, 12000, 12000, 12000]);
    expect(r.paginas[0].caminho).toBe('lido/p0.md');
  });
});

describe('montarBlocoTutorial', () => {
  it('com paginas, cada uma vai com titulo, caminho e texto, entre as marcas do modo', () => {
    const bloco = montarBlocoTutorial('pt', { paginas: [{ titulo: 'Projetos', caminho: 'p.md', texto: 'Criar um projeto.' }], motivo: '' });
    expect(bloco.startsWith('\n\n=== TUTORIAL MODE: THE AURORA API ===\n')).toBe(true);
    expect(bloco.endsWith('\n=== END OF TUTORIAL MODE ===\n')).toBe(true);
    expect(bloco).toContain('instrutora de um tutorial guiado');
    expect(bloco).toContain('AS FERRAMENTAS DA AULA');
    expect(bloco).toContain('--- PAGES FROM THE INSTALLED SAPHO MANUAL');
    expect(bloco).toContain('\n### Projetos (p.md)\nCriar um projeto.\n');
    expect(bloco).not.toContain('nao pode ser lido');
  });

  it('sem paginas, avisa o motivo; sem motivo, diz que e desconhecido', () => {
    expect(montarBlocoTutorial('pt', { paginas: [], motivo: 'sem rede' })).toContain('nao pode ser lido nesta maquina: sem rede.');
    expect(montarBlocoTutorial('pt', { paginas: [], motivo: '' })).toContain('motivo desconhecido');
    const en = montarBlocoTutorial('en', { paginas: [], motivo: '' });
    expect(en).toContain('instructor of a guided tutorial');
    expect(en).toContain('THE TOOLS OF THIS LESSON');
    expect(en).toContain('could not be read on this machine: unknown reason.');
  });
});

describe('aberturaDoTutorial', () => {
  it('a primeira mensagem em cada idioma', () => {
    expect(aberturaDoTutorial('pt')).toBe('Quero um tutorial guiado da API da AURORA. Comece.');
    expect(aberturaDoTutorial('en')).toBe('I want a guided tutorial of the AURORA API. Begin.');
  });
});
