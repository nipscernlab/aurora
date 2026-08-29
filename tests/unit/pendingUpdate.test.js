import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { decidirPendente } = require('../../main/pending_update.js');

// A instalacao saiu do fechamento e foi para a abertura seguinte, porque no
// laboratorio fechar a AURORA e desligar o computador acontecem com segundos de
// diferenca, e um NSIS interrompido deixa a pasta pela metade. Esta e a decisao
// que o arranque toma, e ela e testavel porque nao depende do Electron.

describe('a atualizacao pendente, no arranque', () => {
  it('instala quando ha uma baixada e ela e mais nova que a que esta rodando', () => {
    expect(decidirPendente({ versao: '6.11.0', em: Date.now() }, '6.10.0')).toBe('instalar');
  });

  it('sem registro nenhum, nao faz nada', () => {
    expect(decidirPendente(null, '6.10.0')).toBe('nada');
    expect(decidirPendente({}, '6.10.0')).toBe('nada');
    expect(decidirPendente({ versao: '' }, '6.10.0')).toBe('nada');
  });

  it('se a versao pendente JA e a que esta rodando, apaga o registro', () => {
    // Este e o caso que faz o laco: a instalacao aconteceu, o registro
    // sobreviveu a ela, e sem esta regra todo arranque tentaria instalar de
    // novo a versao que ja esta no disco.
    expect(decidirPendente({ versao: '6.11.0', em: Date.now() }, '6.11.0')).toBe('limpar');
  });

  it('registro velho demais e descartado', () => {
    // Trinta dias nao e prazo da atualizacao, e sim do CACHE: se o arquivo
    // baixado sumiu do disco, insistir a cada boot custa uma ida a rede que
    // nunca vai dar em nada. A verificacao silenciosa normal reencontra.
    const agora = Date.parse('2026-08-29T12:00:00Z');
    const trintaEUmDias = agora - 31 * 24 * 60 * 60 * 1000;
    expect(decidirPendente({ versao: '6.11.0', em: trintaEUmDias }, '6.10.0', agora)).toBe('limpar');
    const vinteENoveDias = agora - 29 * 24 * 60 * 60 * 1000;
    expect(decidirPendente({ versao: '6.11.0', em: vinteENoveDias }, '6.10.0', agora)).toBe('instalar');
  });

  it('registro sem data ainda instala', () => {
    // Compatibilidade com um registro escrito por uma versao anterior deste
    // codigo: falta de data nao pode virar "nunca instala".
    expect(decidirPendente({ versao: '6.11.0' }, '6.10.0')).toBe('instalar');
  });
});
