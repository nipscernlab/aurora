/**
 * Testes do que o relato de problema faz antes de sair da máquina.
 *
 * Duas coisas aqui não dão para consertar depois. A primeira é o laço que
 * encolhe o log: ele reduz a própria condição de parada, e um laço assim, se
 * errado, não falha nem retorna, só trava o envio com a janela aberta. A
 * segunda é a decisão de para onde mandar: se o padrão vazasse para onde não
 * deve, ou se a variável de ambiente não desligasse o envio, o relato iria para
 * um destino que ninguém escolheu.
 *
 * Nada aqui abre conexão nem lê o log de verdade.
 */

import { describe, it, expect, afterEach } from 'vitest';

import {
  encolherParaCaber, endpoint, LIMITE_BYTES,
} from '../../main/ipc/bug_report.js';

function cargaCom(log) {
  return {
    titulo: 'trava ao compilar',
    oQueAconteceu: 'trava ao compilar',
    oQueEsperava: '',
    comoReproduzir: '',
    diagnostico: { versao: '6.6.1', log },
  };
}

const tamanho = (c) => Buffer.byteLength(JSON.stringify(c), 'utf8');

describe('encolherParaCaber', () => {
  it('deixa em paz o que ja cabe', () => {
    const carga = cargaCom('linha de log\n'.repeat(5));
    const antes = carga.diagnostico.log;
    encolherParaCaber(carga);
    expect(carga.diagnostico.log).toBe(antes);
  });

  it('corta um log enorme ate caber', () => {
    const carga = cargaCom('x'.repeat(5 * 1024 * 1024));
    encolherParaCaber(carga);
    expect(tamanho(carga)).toBeLessThanOrEqual(LIMITE_BYTES);
  });

  it('para mesmo quando o resto da carga sozinho ja estoura o limite', () => {
    // Sem a segunda condicao de parada, este caso encolheria o log ate string
    // vazia e continuaria rodando para sempre.
    const carga = cargaCom('y'.repeat(10000));
    carga.oQueAconteceu = 'z'.repeat(LIMITE_BYTES * 2);
    encolherParaCaber(carga);
    expect(carga.diagnostico.log.length).toBeLessThanOrEqual(10000);
  });

  it('guarda o fim do log, que e onde a falha aparece', () => {
    const carga = cargaCom('inicio\n' + 'meio\n'.repeat(200000) + 'AQUI FALHOU');
    encolherParaCaber(carga);
    expect(carga.diagnostico.log.endsWith('AQUI FALHOU')).toBe(true);
    expect(carga.diagnostico.log).not.toContain('inicio');
  });
});

describe('endpoint', () => {
  const original = process.env.AURORA_BUGREPORT_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.AURORA_BUGREPORT_URL;
    else process.env.AURORA_BUGREPORT_URL = original;
  });

  it('sem variavel, usa o Worker do NIPS-CERN', () => {
    delete process.env.AURORA_BUGREPORT_URL;
    expect(endpoint()).toBe('https://nipscern.com/api/sapho/bugreport');
  });

  it('variavel vazia desliga o envio direto', () => {
    process.env.AURORA_BUGREPORT_URL = '';
    expect(endpoint()).toBe('');
  });

  it('variavel preenchida aponta para outro Worker', () => {
    process.env.AURORA_BUGREPORT_URL = 'https://exemplo.invalid/teste';
    expect(endpoint()).toBe('https://exemplo.invalid/teste');
  });
});
