/**
 * A pagina do manual virando documento citavel: main/ai/citacoes.js.
 *
 * O que se trava aqui e a FORMA exata que o provedor da Anthropic espera, e as
 * tres decisoes que nao se deduzem lendo o codigo:
 *
 *   - `data: { type: 'text', text }` com `mediaType: 'text/plain'` e o unico
 *     caminho que @ai-sdk/anthropic converte em bloco `document` com
 *     `citations: { enabled: true }`. Qualquer outra forma passa como anexo
 *     comum, sem erro nenhum, e a citacao simplesmente nunca vem;
 *   - a mensagem de documentos e TIRADA e reposta a cada passo. O AI SDK diz
 *     que a troca de mensagens do prepareStep carrega para os passos
 *     seguintes, entao sem tirar, a mesma pagina seria reenviada uma vez por
 *     passo, paga inteira em todos;
 *   - as paginas de tabela (diretivas, biblioteca) NAO entram: corte por frase
 *     em tabela da lixo, e essas perguntas ja tem ferramenta estruturada.
 *
 * Nenhuma das tres da erro quando quebra. A conta e o sintoma.
 */

import { describe, it, expect } from 'vitest';

// Pelo import, e nao por require nativo: assim o teste exercita o fonte do
// modulo, e a cobertura cai nele e nao no .js que o build gera ao lado.
const c = await import('../../main/ai/citacoes.js');

const PAGINA = { caminho: 'referencia/tipos.html', titulo: 'Tipos do C±', texto: 'O tipo complexo e nativo.' };
const okRead = (d) => ({ ok: true, data: d });

describe('o que vira pagina citavel', () => {
  it('aceita o resultado de read_manual_page', () => {
    const p = c.paginaDoResultado('read_manual_page', okRead({
      path: 'inicio/o-que-e.html', title: 'O que e o SAPHO', text: 'texto', truncated: false,
    }));
    expect(p).toEqual({ caminho: 'inicio/o-que-e.html', titulo: 'O que e o SAPHO', texto: 'texto' });
  });

  it('ignora qualquer outra ferramenta', () => {
    // Compilar e inspecionar onda nao tem documento a citar. Anexar um so
    // para ter citacao seria encenacao, e custaria entrada em todo passo.
    expect(c.paginaDoResultado('compile_all', okRead({ text: 'saiu tudo certo' }))).toBeNull();
    expect(c.paginaDoResultado('read_file', okRead({ path: 'a.cmm', text: 'x' }))).toBeNull();
  });

  it('ignora a leitura que falhou ou veio vazia', () => {
    expect(c.paginaDoResultado('read_manual_page', { ok: false, error: 'nao achei' })).toBeNull();
    expect(c.paginaDoResultado('read_manual_page', okRead({ path: 'a.html', text: '   ' }))).toBeNull();
  });

  it('as paginas de tabela ficam de fora, de proposito', () => {
    for (const caminho of c.PAGINAS_DE_TABELA) {
      expect(c.paginaDoResultado('read_manual_page', okRead({ path: caminho, text: 'conteudo' })), caminho).toBeNull();
    }
  });
});

describe('a colecao do turno', () => {
  it('nao repete a mesma pagina', () => {
    const col = [];
    expect(c.guardar(col, PAGINA)).toBe(true);
    expect(c.guardar(col, { ...PAGINA })).toBe(false);
    expect(col).toHaveLength(1);
  });

  it('para no teto de paginas', () => {
    const col = [];
    for (let i = 0; i < c.MAX_PAGINAS + 3; i++) {
      c.guardar(col, { caminho: `p${i}.html`, titulo: `p${i}`, texto: 'x' });
    }
    expect(col).toHaveLength(c.MAX_PAGINAS);
  });

  it('para no teto de caracteres, que e o que protege a pagina gigante', () => {
    // A maior pagina do manual tem 10.693 caracteres. Duas dessas mais uma
    // media ja passam de metade do teto; o teto existe para uma nao arrastar
    // as irmas grandes junto.
    const col = [];
    const grande = 'x'.repeat(Math.floor(c.MAX_CHARS * 0.6));
    expect(c.guardar(col, { caminho: 'a.html', titulo: 'a', texto: grande })).toBe(true);
    expect(c.guardar(col, { caminho: 'b.html', titulo: 'b', texto: grande })).toBe(false);
    expect(col).toHaveLength(1);
  });
});

describe('a forma que o provedor exige', () => {
  const msg = c.mensagemDeDocumentos([PAGINA]);

  it('e mensagem de USUARIO, porque so ali cabe citacao', () => {
    expect(msg.role).toBe('user');
  });

  it('o documento vai como file/text-plain com o texto embutido', () => {
    const doc = msg.content[0];
    expect(doc.type).toBe('file');
    expect(doc.mediaType).toBe('text/plain');
    expect(doc.data).toEqual({ type: 'text', text: PAGINA.texto });
  });

  it('citations ligado, titulo e caminho no lugar certo', () => {
    const a = msg.content[0].providerOptions.anthropic;
    expect(a.citations).toEqual({ enabled: true });
    expect(a.title).toBe(PAGINA.titulo);
    // `filename` e o que a citacao devolve de volta, e e por ele que a
    // interface abre o manual na pagina certa.
    expect(msg.content[0].filename).toBe(PAGINA.caminho);
  });

  it('NAO leva marca de cache, e isso e decisao', () => {
    // O porque esta no fim de main/ai/prompt_cache.js: cachear obrigaria a
    // tirar o contexto variavel de dentro do system, por 1.500 tokens.
    expect(msg.content[0].providerOptions.anthropic.cacheControl).toBeUndefined();
  });

  it('sem pagina nenhuma, nao monta mensagem', () => {
    expect(c.mensagemDeDocumentos([])).toBeNull();
    expect(c.mensagemDeDocumentos(null)).toBeNull();
  });
});

describe('anexar sem duplicar entre passos', () => {
  const base = [{ role: 'user', content: 'como declaro um complexo?' }];

  it('acrescenta no fim', () => {
    const r = c.comDocumentos(base, [PAGINA]);
    expect(r).toHaveLength(2);
    expect(c.ehMensagemDeDocumentos(r[1])).toBe(true);
  });

  it('anexar duas vezes nao empilha duas', () => {
    // Este e o teste que importa: sem ele, cada passo do turno reenviaria a
    // pagina inteira de novo, e a conta cresceria com o numero de passos.
    const um = c.comDocumentos(base, [PAGINA]);
    const dois = c.comDocumentos(um, [PAGINA]);
    expect(dois).toHaveLength(2);
    expect(dois.filter(c.ehMensagemDeDocumentos)).toHaveLength(1);
  });

  it('sem paginas, devolve a mesma lista', () => {
    expect(c.comDocumentos(base, [])).toBe(base);
  });

  it('uma mensagem de usuario comum nao e confundida com a nossa', () => {
    expect(c.ehMensagemDeDocumentos(base[0])).toBe(false);
    expect(c.ehMensagemDeDocumentos({ role: 'assistant', content: [] })).toBe(false);
  });
});

describe('a citacao que volta', () => {
  const fonte = {
    type: 'source',
    sourceType: 'document',
    id: 'src-1',
    title: 'Tipos do C±',
    filename: 'referencia/tipos.html',
    providerMetadata: { anthropic: { citedText: 'O tipo complexo e nativo.', startCharIndex: 10, endCharIndex: 35 } },
  };

  it('traz o trecho, a pagina e os indices', () => {
    expect(c.citacaoDaFonte(fonte)).toEqual({
      id: 'src-1',
      pagina: 'referencia/tipos.html',
      titulo: 'Tipos do C±',
      trecho: 'O tipo complexo e nativo.',
      inicio: 10,
      fim: 35,
    });
  });

  it('ignora fonte de url, que e de busca na web e nao do manual', () => {
    expect(c.citacaoDaFonte({ ...fonte, sourceType: 'url' })).toBeNull();
  });

  it('sem trecho nao ha o que mostrar', () => {
    expect(c.citacaoDaFonte({ ...fonte, providerMetadata: { anthropic: { citedText: '  ' } } })).toBeNull();
    expect(c.citacaoDaFonte({ ...fonte, providerMetadata: {} })).toBeNull();
    expect(c.citacaoDaFonte(null)).toBeNull();
  });

  it('indice ausente vira null, e nao zero', () => {
    // Zero e uma posicao valida no texto. Confundir "nao sei" com "comeco da
    // pagina" mandaria quem clicasse para o lugar errado.
    const r = c.citacaoDaFonte({ ...fonte, providerMetadata: { anthropic: { citedText: 'x' } } });
    expect(r.inicio).toBeNull();
    expect(r.fim).toBeNull();
  });
});
