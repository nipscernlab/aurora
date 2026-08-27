/**
 * A ordem em que a carga do relato encolhe quando nao cabe no limite.
 *
 * Cortar e inevitavel: um relato de uma build enorme passa do teto de envio.
 * O que NAO e inevitavel e cortar a coisa errada. O texto que a pessoa
 * escreveu e a unica parte que ninguem consegue recuperar depois, e o recorte
 * do terminal e o que explica a falha; o log do aplicativo e o mais
 * dispensavel dos tres.
 *
 * Este teste fixa essa ordem, e tambem que o laco sempre termina: ele encolhe
 * a propria condicao de parada, e um erro ali travaria o envio com a janela
 * aberta, sem erro nenhum na tela.
 */

import { describe, it, expect } from 'vitest';

import { encolherParaCaber, LIMITE_BYTES } from '../../main/ipc/bug_report.js';

const tamanho = (c) => Buffer.byteLength(JSON.stringify(c), 'utf8');

function carga({ log = '', terminal = '', escrito = 'trava ao compilar' } = {}) {
  return {
    titulo: 'trava ao compilar',
    oQueAconteceu: escrito,
    oQueEsperava: '',
    comoReproduzir: '',
    email: '',
    terminal,
    diagnostico: { versao: '6.6.1', log },
  };
}

describe('encolherParaCaber', () => {
  it('nao mexe no que ja cabe', () => {
    const c = carga({ log: 'log curto', terminal: 'terminal curto' });
    encolherParaCaber(c);
    expect(c.diagnostico.log).toBe('log curto');
    expect(c.terminal).toBe('terminal curto');
  });

  it('sacrifica o log do aplicativo ANTES do terminal', () => {
    // O log fala do aplicativo; o terminal fala da compilacao que falhou, que
    // e o assunto do relato.
    const c = carga({ log: 'L'.repeat(400000), terminal: 'T'.repeat(20000) });
    encolherParaCaber(c);
    expect(tamanho(c)).toBeLessThanOrEqual(LIMITE_BYTES);
    expect(c.terminal).toBe('T'.repeat(20000));
    expect(c.diagnostico.log.length).toBeLessThan(400000);
  });

  it('so entao encolhe o terminal', () => {
    const c = carga({ log: 'L'.repeat(200000), terminal: 'T'.repeat(200000) });
    encolherParaCaber(c);
    expect(tamanho(c)).toBeLessThanOrEqual(LIMITE_BYTES);
    expect(c.terminal.length).toBeLessThan(200000);
  });

  it('NUNCA toca no que a pessoa escreveu', () => {
    const escrito = 'E'.repeat(8000);
    const c = carga({ log: 'L'.repeat(300000), terminal: 'T'.repeat(300000), escrito });
    encolherParaCaber(c);
    expect(c.oQueAconteceu).toBe(escrito);
  });

  it('guarda o FIM de cada um, que e onde a falha aparece', () => {
    const c = carga({ log: 'inicio' + 'x'.repeat(300000) + 'FIM-DO-LOG' });
    encolherParaCaber(c);
    expect(c.diagnostico.log.endsWith('FIM-DO-LOG')).toBe(true);
    expect(c.diagnostico.log).not.toContain('inicio');
  });

  it('termina mesmo quando o texto escrito sozinho ja estoura o limite', () => {
    // Sem os pisos por campo, este caso encolheria ate string vazia e
    // continuaria rodando para sempre.
    const c = carga({
      log: 'L'.repeat(50000),
      terminal: 'T'.repeat(50000),
      escrito: 'E'.repeat(LIMITE_BYTES * 2),
    });
    encolherParaCaber(c);
    expect(c.diagnostico.log.length).toBeLessThanOrEqual(50000);
    expect(c.terminal.length).toBeLessThanOrEqual(50000);
  });

  it('aguenta carga sem campo de terminal', () => {
    // Cliente antigo, ou relato aberto sem terminal nenhum na tela.
    const c = carga({ log: 'L'.repeat(300000) });
    delete c.terminal;
    encolherParaCaber(c);
    expect(tamanho(c)).toBeLessThanOrEqual(LIMITE_BYTES);
  });
});
