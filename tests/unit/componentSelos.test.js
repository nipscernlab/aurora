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
