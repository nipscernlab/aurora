/**
 * A politica de esforco: main/ai/effort_policy.js.
 *
 * Uma tabela pura, sem IO, sem SDK e sem estado. O que se testa aqui nao e "a
 * funcao devolve o que a tabela diz", que seria testar o operador de indexacao;
 * e o que a politica PROMETE:
 *
 *   - que o turno livre, que e o caminho dominante, continua no valor da
 *     interface, para nao criar uma linhagem de cache so dele;
 *   - que compilar com sucesso e compilar com erro sao linhas DIFERENTES, que
 *     foi a mudanca pedida na revisao da tabela;
 *   - que operacao desconhecida cai no valor da interface em vez de num padrao
 *     nosso, porque inventar esforco para algo que ninguem classificou seria
 *     decidir por quem paga a conta;
 *   - que o numero de linhagens de cache nao cresce sem alguem perceber.
 *
 * Este ultimo e o teste que importa a longo prazo. Cada valor distinto de
 * esforco aquece um prefixo de ~10,4 mil tokens por conta propria; uma linha
 * nova com um valor novo custa dinheiro de quem usa a AURORA, e o custo nao
 * aparece em lugar nenhum ate a fatura.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { POLITICA, esforcoPara, porqueDe, linhagensDeCache } = require('../../main/ai/effort_policy.js');

describe('a tabela', () => {
  it('cobre as cinco operacoes combinadas, e so elas', () => {
    expect(Object.keys(POLITICA).sort()).toEqual([
      'acharErros', 'comentar', 'livre', 'posCompilacaoFalha', 'posCompilacaoOk',
    ]);
  });

  it('toda linha diz por que, e o porque nao e o nome da linha', () => {
    for (const [nome, linha] of Object.entries(POLITICA)) {
      expect(linha.porque, `${nome} sem motivo`).toBeTruthy();
      expect(linha.porque.length, `${nome} com motivo curto demais para servir`).toBeGreaterThan(20);
    }
  });

  it('so usa valores que a API entende', () => {
    for (const [nome, linha] of Object.entries(POLITICA)) {
      expect(['low', 'medium', 'high', null], `${nome}`).toContain(linha.esforco);
    }
  });
});

describe('o que a politica promete', () => {
  it('comentar e rapido, achar erro e caro', () => {
    // As duas pontas da tabela. Comentar e transformacao local; achar erro
    // exige simular execucao, e e onde raciocinio muda o RESULTADO.
    expect(esforcoPara('comentar', 'medium')).toBe('low');
    expect(esforcoPara('acharErros', 'medium')).toBe('high');
  });

  it('compilacao que passou e compilacao que falhou sao tarefas diferentes', () => {
    // A mudanca pedida na revisao. Antes as duas eram "continuacao apos
    // compilacao", uma linha so. Passou: resumir o que ja veio pronto. Falhou:
    // inferir a causa de um erro do C+-, o caso dificil, porque as restricoes
    // da linguagem nao estao na documentacao.
    expect(esforcoPara('posCompilacaoOk', 'medium')).toBe('low');
    expect(esforcoPara('posCompilacaoFalha', 'medium')).toBe('high');
    expect(esforcoPara('posCompilacaoOk')).not.toBe(esforcoPara('posCompilacaoFalha'));
  });

  it('o motivo da falha cita o que o texto do erro nao diz', () => {
    // Se um dia alguem baixar esta linha para `low`, o motivo aqui e o que
    // vai ter de ser contestado primeiro.
    expect(porqueDe('posCompilacaoFalha')).toMatch(/nao esta na mensagem|nao estao documentadas/);
  });

  it('o turno livre fica no valor da interface, e nao num valor nosso', () => {
    // E o caminho dominante. Fixar um valor aqui criaria uma linhagem de cache
    // que ninguem pediu, justo na que e usada o tempo todo.
    expect(POLITICA.livre.esforco).toBeNull();
    expect(esforcoPara('livre', 'high')).toBe('high');
    expect(esforcoPara('livre', 'low')).toBe('low');
  });
});

describe('a queda para a interface', () => {
  it('operacao desconhecida vale o que a pessoa escolheu', () => {
    expect(esforcoPara('naoExiste', 'high')).toBe('high');
  });

  it('sem operacao e sem interface, nao manda esforco nenhum', () => {
    // `null` aqui quer dizer "nao inclua o parametro na chamada", e nao
    // "mande o padrao". Mandar um padrao nosso mudaria a linhagem de cache de
    // quem nunca tocou no controle.
    expect(esforcoPara(null, null)).toBeNull();
    expect(esforcoPara(undefined, undefined)).toBeNull();
    expect(esforcoPara('livre', null)).toBeNull();
  });

  it('porqueDe nao inventa motivo para o que nao esta na tabela', () => {
    expect(porqueDe('naoExiste')).toBeNull();
    expect(porqueDe(null)).toBeNull();
  });
});

describe('quantas linhagens de cache isto cria', () => {
  it('tres, e nao uma por operacao', () => {
    // low, high e o valor da interface. Cinco operacoes, tres prefixos a
    // aquecer. Se este numero subir, alguem precisa ter decidido que sobe.
    expect(linhagensDeCache('medium')).toBe(3);
  });

  it('duas quando a interface ja esta num valor que a tabela usa', () => {
    // Interface em `high` nao cria prefixo novo: `acharErros` e
    // `posCompilacaoFalha` ja moram nele.
    expect(linhagensDeCache('high')).toBe(2);
    expect(linhagensDeCache('low')).toBe(2);
  });

  it('sem valor de interface, o turno livre vai sem esforco e isso tambem e uma linhagem', () => {
    expect(linhagensDeCache(null)).toBe(3);
  });
});
