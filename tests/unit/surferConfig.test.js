/**
 * Testes da parte pura da configuracao do Surfer.
 *
 * O caso que mais importa aqui e o `safeMappingName`. O nome de um mapping vem
 * de dado do projeto e vira nome de arquivo dentro do diretorio global de
 * mappings do Surfer; se ele conseguisse carregar separador de caminho ou `..`,
 * escreveria fora daquele diretorio. Ate 08/08/2026 essa higienizacao era uma
 * expressao regular solta dentro de um laco em main/ipc/compile.js, sem teste.
 */

import { describe, it, expect } from 'vitest';

import {
  MARKER,
  surferWindowGeometry,
  surferConfigToml,
  podeSobrescreverConfig,
  safeMappingName,
} from '../../main/ipc/surfer_config.js';

describe('safeMappingName', () => {
  it('mantem o que ja e seguro', () => {
    expect(safeMappingName('aurora_asm_proc1.toml')).toBe('aurora_asm_proc1.toml');
    expect(safeMappingName('a-b.c_d')).toBe('a-b.c_d');
  });

  it('nao deixa separador de caminho sobreviver', () => {
    for (const mau of ['a/b', 'a\\b', 'a/../b', '..\\..\\evil']) {
      const saida = safeMappingName(mau);
      expect(saida).not.toContain('/');
      expect(saida).not.toContain('\\');
    }
  });

  it('neutraliza a travessia classica', () => {
    // Os pontos sobrevivem, e podem: o que faz travessia e o separador.
    expect(safeMappingName('../../../etc/passwd')).toBe('.._.._.._etc_passwd');
    expect(safeMappingName('..\\..\\Windows\\System32\\evil.dll'))
      .toBe('.._.._Windows_System32_evil.dll');
  });

  it('remove dois-pontos, que no Windows viraria outra unidade', () => {
    expect(safeMappingName('C:evil')).toBe('C_evil');
  });

  it('devolve vazio para entrada que nao e string', () => {
    for (const v of [null, undefined, 42, {}, []]) expect(safeMappingName(v)).toBe('');
  });

  it('e idempotente: aplicar duas vezes nao muda mais nada', () => {
    const uma = safeMappingName('a/b\\c:d');
    expect(safeMappingName(uma)).toBe(uma);
  });
});

describe('surferWindowGeometry', () => {
  it('ocupa 85% e fica centrado na area util', () => {
    const g = surferWindowGeometry({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(g.w).toBe(1632); // 85%
    expect(g.h).toBe(918);
    expect(g.x).toBe(144); // (1920-1632)/2
    expect(g.y).toBe(81);
  });

  it('respeita o piso de 800 por 600 em tela pequena', () => {
    const g = surferWindowGeometry({ x: 0, y: 0, width: 800, height: 600 });
    expect(g.w).toBe(800);
    expect(g.h).toBe(600);
  });

  it('leva em conta a origem da area util, que nao e sempre zero', () => {
    // Barra de tarefas na esquerda, ou monitor secundario com offset.
    const g = surferWindowGeometry({ x: 100, y: 40, width: 1000, height: 800 });
    expect(g.x).toBe(100 + Math.round((1000 - g.w) / 2));
    expect(g.y).toBe(40 + Math.round((800 - g.h) / 2));
  });

  it('nunca posiciona a janela antes da origem da area util', () => {
    // Com o piso ativo a janela pode ser maior que a area; a conta nao pode
    // devolver posicao que jogue a barra de titulo para fora da tela por cima.
    const g = surferWindowGeometry({ x: 0, y: 0, width: 640, height: 480 });
    expect(g.w).toBe(800);
    expect(g.h).toBe(600);
    expect(g.x).toBeLessThanOrEqual(0); // centrado de uma janela maior que a area
  });
});

describe('surferConfigToml', () => {
  const g = { w: 1632, h: 918, x: 144, y: 81 };

  it('carrega o marcador, que e o que autoriza a proxima sobrescrita', () => {
    expect(surferConfigToml(g)).toContain(MARKER);
  });

  it('escreve as quatro chaves de layout com os valores dados', () => {
    const toml = surferConfigToml(g);
    expect(toml).toContain('[layout]');
    expect(toml).toContain('window_width = 1632');
    expect(toml).toContain('window_height = 918');
    expect(toml).toContain('window_x_position = 144');
    expect(toml).toContain('window_y_position = 81');
  });
});

describe('podeSobrescreverConfig', () => {
  it('pode quando o arquivo nao existe', () => {
    expect(podeSobrescreverConfig(null)).toBe(true);
    expect(podeSobrescreverConfig(undefined)).toBe(true);
  });

  it('pode quando fomos nos que escrevemos', () => {
    expect(podeSobrescreverConfig(surferConfigToml({ w: 1, h: 2, x: 3, y: 4 }))).toBe(true);
  });

  it('NAO pode quando o usuario escreveu a mao', () => {
    expect(podeSobrescreverConfig('[layout]\nwindow_width = 1234\n')).toBe(false);
  });

  it('nao pode quando o usuario apagou so a linha do marcador', () => {
    // E o mecanismo documentado para o usuario retomar o controle da janela.
    const semMarcador = surferConfigToml({ w: 1, h: 2, x: 3, y: 4 })
      .split('\n').filter((l) => !l.includes(MARKER)).join('\n');
    expect(podeSobrescreverConfig(semMarcador)).toBe(false);
  });
});

describe('safeMappingName recusa nome feito so de pontos', () => {
  // `..` passa pelo filtro de caracteres (ponto e permitido) e sobe um nivel:
  // o .tmp ia parar em config/ e o rename falhava, deixando lixo la. Um nome
  // que vira vazio e recusado por quem chama, como qualquer outro sem letra.
  it('devolve vazio para .. e para .', () => {
    expect(safeMappingName('..')).toBe('');
    expect(safeMappingName('.')).toBe('');
    expect(safeMappingName('...')).toBe('');
  });

  it('mas deixa passar nome com ponto no meio ou na ponta', () => {
    expect(safeMappingName('a.b')).toBe('a.b');
    expect(safeMappingName('.hidden')).toBe('.hidden');
    expect(safeMappingName('x..')).toBe('x..');
  });
});
