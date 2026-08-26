import { describe, it, expect } from 'vitest';
import { selosDe, selecionavel, resumoDaFila } from '../../js/ui/components_panel.js';

/**
 * O selo de estado do painel de Componentes: sempre exatamente um, e o que
 * vale entre os cinco estados possíveis.
 *
 * Isto é testado por unidade e não por captura de tela porque os estados quase
 * nunca aparecem juntos numa máquina só: numa máquina com tudo instalado a tela
 * fica idêntica esteja a regra certa ou errada, e foi exatamente essa a
 * dificuldade ao conferir na AURORA rodando.
 */
describe('selosDe: sempre um selo, e o que vale', () => {
  it('desatualizado vence "instalado": a novidade e o que importa dizer', () => {
    expect(selosDe({ instalado: true, estado: 'desatualizado' })).toEqual(['desatualizado']);
    // Inclusive num essencial, que tambem esta sempre instalado.
    expect(selosDe({ essencial: true, instalado: true, estado: 'desatualizado' }))
      .toEqual(['desatualizado']);
  });

  it('essencial vence "instalado": dizer que o YANC esta instalado e inutil', () => {
    expect(selosDe({ essencial: true, instalado: true })).toEqual(['essencial']);
  });

  it('instalado e em dia', () => {
    expect(selosDe({ instalado: true, estado: 'ok' })).toEqual(['instalado']);
    // Mesmo sendo necessario para compilar: quem TEM o componente compila, e
    // nao ha urgencia nenhuma a anunciar.
    expect(selosDe({ instalado: true, requerParaCompilar: true })).toEqual(['instalado']);
  });

  it('ausente e necessario para compilar e o unico caso de urgencia', () => {
    expect(selosDe({ instalado: false, requerParaCompilar: true })).toEqual(['urgente']);
  });

  it('ausente e opcional e escolha, nao defeito', () => {
    expect(selosDe({ instalado: false })).toEqual(['ausente']);
    expect(selosDe({ instalado: false, requerParaCompilar: false })).toEqual(['ausente']);
  });

  it('e SEMPRE exatamente um selo, que e o que a linha do nome comporta', () => {
    const casos = [
      { essencial: true, instalado: true },
      { essencial: true, instalado: true, estado: 'desatualizado' },
      { instalado: true, estado: 'ok' },
      { instalado: false, requerParaCompilar: true },
      { instalado: false },
      {},
    ];
    for (const c of casos) expect(selosDe(c)).toHaveLength(1);
  });

  it('so entrada nula fica sem selo', () => {
    expect(selosDe(null)).toEqual([]);
    expect(selosDe(undefined)).toEqual([]);
  });
});

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
