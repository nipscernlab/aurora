/**
 * A regra do doctor (main/ipc/components.js: decidirConserto) e a leitura de
 * progresso dos instaladores.
 *
 * O doctor é a rede de segurança de todo o resto: é ele que conserta a máquina
 * do aluno cuja rede caiu no meio de 272 MB, e é ele que faz uma tag nova
 * chegar a quem já tinha a anterior. Duas regras dele são fáceis de inverter
 * sem ninguém ver, e caras nos dois sentidos:
 *
 *   - componente saudável NÃO é tocado (tocar = re-baixar 272 MB à toa);
 *   - opcional que a pessoa nunca baixou NÃO é baixado (ausência escolhida
 *     não é defeito), mas opcional DESATUALIZADO é, porque ela usa aquilo.
 *
 * E o `--force`: sem ele o instalador vê a sentinela da versão velha e sai
 * dizendo que está tudo lá, que foi exatamente como o Surfer ficou cinco
 * versões atrás. Por isso o veredito carrega o `forcar` junto: quem chama não
 * escolhe, a regra decide.
 *
 * O teste roda contra o CATÁLOGO DE VERDADE (main/components/registry.js), e
 * não contra componentes inventados: é o catálogo real que diz quem é essencial
 * e quem compila, e é lá que uma marcação errada apareceria.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { decidirConserto, lerPercentual } = require('../../main/ipc/components.js');
const { COMPONENTES, obter } = require('../../main/components/registry.js');

const d = (estado) => ({ estado, faltando: [], versaoInstalada: null });

describe('decidirConserto', () => {
  it('saudável não é tocado, seja qual for o componente', () => {
    for (const c of COMPONENTES) {
      expect(decidirConserto(d('ok'), c), c.chave).toEqual({ conserta: false, forcar: false });
    }
  });

  it('incompleto: conserta COM --force, porque a sentinela está lá e enganaria o instalador', () => {
    for (const c of COMPONENTES) {
      expect(decidirConserto(d('incompleto'), c), c.chave).toEqual({ conserta: true, forcar: true });
    }
  });

  it('desatualizado: conserta COM --force, mesmo sendo opcional', () => {
    // Opcional que a pessoa baixou é opcional que ela usa, e o que ela usa tem
    // que ser a versão que esta AURORA espera.
    expect(decidirConserto(d('desatualizado'), obter('surfer')))
      .toEqual({ conserta: true, forcar: true });
    expect(decidirConserto(d('desatualizado'), obter('clang-format')))
      .toEqual({ conserta: true, forcar: true });
  });

  it('ausente: baixa o que a AURORA precisa, SEM --force', () => {
    // Sem sentinela no disco o `--force` não teria efeito nenhum, e mandá-lo
    // assim mesmo só tornaria o log mais difícil de ler.
    expect(decidirConserto(d('ausente'), obter('msys'))).toEqual({ conserta: true, forcar: false });
    expect(decidirConserto(d('ausente'), obter('yanc'))).toEqual({ conserta: true, forcar: false });
  });

  it('ausente e opcional: fica de fora, porque ausência escolhida não é defeito', () => {
    for (const c of COMPONENTES.filter((x) => !x.essencial && !x.requerParaCompilar)) {
      expect(decidirConserto(d('ausente'), c), c.chave).toEqual({ conserta: false, forcar: false });
    }
  });

  it('quem é baixado quando falta é exatamente quem compila, mais o essencial', () => {
    // A lista inteira, de uma vez: é a resposta para "o que um doctor numa
    // máquina recém-instalada vai baixar sem perguntar".
    const baixados = COMPONENTES
      .filter((c) => decidirConserto(d('ausente'), c).conserta)
      .map((c) => c.chave)
      .sort();
    expect(baixados).toEqual(['msys', 'yanc']);
  });

  it('componente fora do catálogo não vira download: sem dono, sem conserto', () => {
    expect(decidirConserto(d('ausente'), undefined)).toEqual({ conserta: false, forcar: false });
    // Já defeituoso é diferente: quem diagnosticou sabia de quem estava
    // falando, e o conserto não depende de achar o componente na tabela.
    expect(decidirConserto(d('incompleto'), undefined)).toEqual({ conserta: true, forcar: true });
  });

  it('diagnóstico vazio ou desconhecido não conserta nada', () => {
    expect(decidirConserto(undefined, obter('msys'))).toEqual({ conserta: false, forcar: false });
    expect(decidirConserto(d('estado-novo-que-alguem-inventou'), obter('msys')))
      .toEqual({ conserta: false, forcar: false });
  });
});

describe('lerPercentual', () => {
  it('lê a porcentagem que os instaladores já escrevem, no download e na extração', () => {
    expect(lerPercentual('[surfer] 42% (18.1 / 43.0 MB)')).toBe(42);
    expect(lerPercentual('[toolchain] extraindo 7% (1200 / 17323 arquivos)')).toBe(7);
    expect(lerPercentual('[yanc] 100%')).toBe(100);
  });

  it('linha sem porcentagem vira null, e o texto vai como está para o painel', () => {
    // Uma linha de log verdadeira informa mais do que uma barra parada.
    expect(lerPercentual('Extracting aurora-msys-v1.zip → components/Packages')).toBeNull();
    expect(lerPercentual('')).toBeNull();
  });

  it('número fora da faixa não vira barra de progresso', () => {
    expect(lerPercentual('erro 999% inesperado')).toBeNull();
  });
});
