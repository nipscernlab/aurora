import { describe, it, expect } from 'vitest';
import { selosDe } from '../../js/ui/components_panel.js';

/**
 * A regra dos selos do painel de Componentes: um selo só existe se disser o que
 * o resto do cartão não diz.
 *
 * Isto é testado por unidade e não por captura de tela porque os estados que a
 * regra separa quase nunca aparecem juntos numa máquina só: numa máquina com
 * tudo instalado, a interface fica idêntica esteja a regra certa ou errada, e
 * foi exatamente essa a dificuldade ao conferir a mudança na AURORA rodando.
 */
describe('selosDe', () => {
  it('essencial ganha selo, porque o cartão dele não tem botão nenhum', () => {
    expect(selosDe({ essencial: true, instalado: true })).toEqual(['essencial']);
  });

  it('essencial vence a urgência: o selo dele explica a ausência do botão', () => {
    expect(selosDe({ essencial: true, instalado: false, requerParaCompilar: true }))
      .toEqual(['essencial']);
  });

  it('ausente e necessário para compilar é o único caso de urgência', () => {
    expect(selosDe({ instalado: false, requerParaCompilar: true })).toEqual(['urgente']);
  });

  it('instalado não ganha selo: o botão Remover já diz que está instalado', () => {
    expect(selosDe({ instalado: true })).toEqual([]);
    expect(selosDe({ instalado: true, requerParaCompilar: true })).toEqual([]);
  });

  it('ausente e opcional não ganha selo: o botão Baixar e o "download de" já dizem', () => {
    expect(selosDe({ instalado: false, requerParaCompilar: false })).toEqual([]);
  });

  it('desatualizado não ganha selo: o botão Atualizar já diz', () => {
    expect(selosDe({ instalado: true, estado: 'desatualizado' })).toEqual([]);
    // Mesmo sendo necessário para compilar: quem está desatualizado TEM o
    // componente e compila, então não há urgência a anunciar.
    expect(selosDe({ instalado: false, estado: 'desatualizado', requerParaCompilar: true }))
      .toEqual([]);
  });

  it('nunca devolve mais de um selo, que é o que o grid do cartão comporta', () => {
    const casos = [
      { essencial: true, instalado: true },
      { essencial: true, instalado: false, requerParaCompilar: true },
      { instalado: false, requerParaCompilar: true },
      { instalado: true, estado: 'desatualizado', requerParaCompilar: true },
      { instalado: false },
    ];
    for (const c of casos) expect(selosDe(c).length).toBeLessThanOrEqual(1);
  });

  it('entrada vazia não quebra', () => {
    expect(selosDe(null)).toEqual([]);
    expect(selosDe(undefined)).toEqual([]);
    expect(selosDe({})).toEqual([]);
  });
});

import { selecionavel, resumoDaFila } from '../../js/ui/components_panel.js';

describe('selecionavel: quem pode entrar na fila de download', () => {
  it('é exatamente quem tem botão Baixar ou Atualizar', () => {
    expect(selecionavel({ instalado: false })).toBe(true);                       // Baixar
    expect(selecionavel({ instalado: true, estado: 'desatualizado' })).toBe(true); // Atualizar
  });

  it('instalado e em dia não entra: não há o que baixar', () => {
    expect(selecionavel({ instalado: true, estado: 'ok' })).toBe(false);
  });

  it('essencial em dia não entra, porque o cartão dele não tem botão nenhum', () => {
    expect(selecionavel({ essencial: true, instalado: true, estado: 'ok' })).toBe(false);
    // Mesmo num estado incoerente (essencial sem estar instalado) continua fora,
    // porque o cartão segue sem botão e uma caixa marcável não faria nada.
    expect(selecionavel({ essencial: true, instalado: false })).toBe(false);
  });

  it('essencial DESATUALIZADO entra: atualizar é a única coisa que se faz com ele', () => {
    expect(selecionavel({ essencial: true, instalado: true, estado: 'desatualizado' })).toBe(true);
  });

  it('entrada vazia não quebra', () => {
    expect(selecionavel(null)).toBe(false);
    expect(selecionavel(undefined)).toBe(false);
  });

  /**
   * Um objeto sem campo nenhum monta um cartão COM botão Baixar (nem essencial
   * nem instalado), então ele tem de ser selecionável. Escrito como teste
   * porque o instinto é o contrário — "sem dados, não deixa marcar" — e essa
   * defensividade quebraria a única invariante que importa aqui: caixa de
   * seleção e botão têm de aparecer e sumir juntos. Uma caixa sem botão não faz
   * nada quando marcada, e um botão sem caixa fica de fora do lote.
   */
  it('acompanha o cartão mesmo num registro sem campos', () => {
    expect(selecionavel({})).toBe(true);
  });
});

describe('resumoDaFila', () => {
  it('tudo certo', () => {
    expect(resumoDaFila([{ nome: 'A', ok: true }, { nome: 'B', ok: true }]))
      .toEqual({ tudoBem: true, instalados: 2, total: 2, falharam: [] });
  });

  it('nomeia quem falhou, que é o que a pessoa precisa para repetir', () => {
    const r = resumoDaFila([{ nome: 'A', ok: true }, { nome: 'B', ok: false }, { nome: 'C', ok: true }]);
    expect(r).toEqual({ tudoBem: false, instalados: 2, total: 3, falharam: ['B'] });
  });

  it('todos falharam', () => {
    const r = resumoDaFila([{ nome: 'A', ok: false }, { nome: 'B', ok: false }]);
    expect(r.tudoBem).toBe(false);
    expect(r.instalados).toBe(0);
    expect(r.falharam).toEqual(['A', 'B']);
  });

  it('fila vazia é "tudo bem", e não um erro', () => {
    expect(resumoDaFila([])).toEqual({ tudoBem: true, instalados: 0, total: 0, falharam: [] });
    expect(resumoDaFila(null).tudoBem).toBe(true);
  });
});
