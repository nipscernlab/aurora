/**
 * path_rules.ts: o que um caminho de projeto pode conter.
 *
 * A AURORA aceitava criar projeto em qualquer pasta, e o erro só aparecia
 * depois, vindo de uma ferramenta de linha de comando, com uma mensagem que não
 * apontava a causa. O aluno lia "cannot open file" e não tinha como ligar aquilo
 * ao `&` no nome da pasta.
 *
 * A causa é que o fluxo do SAPHO atravessa muitas mãos antes de virar hardware:
 * `cmd.exe` e o PowerShell do terminal, o `bash` e o `make` do MSYS por baixo do
 * Verilator e do cocotb, o Icarus, o Yosys, o GTKWave e o Surfer. Cada um trata
 * um punhado de caracteres como sintaxe, e não como texto, e basta um deles não
 * citar o caminho para o comando quebrar longe daqui.
 *
 * Por isso a regra é conservadora: recusa o que quebra em ALGUM elo, mesmo que
 * a maioria aguente. Um projeto que não abre no meio de uma aula custa mais do
 * que renomear uma pasta antes de começar.
 *
 * Isto é aritmética de texto, sem DOM e sem disco, para poder ser testado.
 */

import { problemaNoNomeDoProcessador, type ProblemaNoNome } from '../compilation/pastas_do_processador.js';

/**
 * Caracteres que viram sintaxe em algum elo da cadeia.
 *
 *   & | < > ^     operadores do cmd.exe
 *   $ ` ! ; ( )   expansão e controle no bash e no PowerShell
 *   % # ' " { }   variável do cmd, comentário do Tcl no GTKWave, citação
 *   [ ] * ?       glob, que o make e o bash expandem sozinhos
 *   , =           separador em argumento de algumas ferramentas
 */
const PROIBIDOS = ['&', '|', '<', '>', '^', '$', '`', '!', ';', '(', ')',
  '%', '#', "'", '"', '{', '}', '[', ']', '*', '?', ',', '='];

/** Nomes que o Windows reserva, com ou sem extensão. */
const RESERVADOS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Resultado de uma análise. `motivo` é um código estável, para o chamador
 * traduzir; `detalhe` traz o trecho problemático, porque apontar o caractere é
 * o que resolve o problema para quem está lendo o aviso.
 */
export type Analise = { ok: boolean; motivo?: string; detalhe?: string };

/**
 * Analisa um caminho de projeto.
 *
 * @param caminho caminho absoluto, ou só o nome da pasta
 */
export function analisarCaminhoDeProjeto(caminho: unknown): Analise {
  const bruto = String(caminho == null ? '' : caminho);
  if (!bruto.trim()) return { ok: false, motivo: 'vazio' };

  // A unidade do Windows (`C:`) é legítima e traz dois-pontos e barra
  // invertida; o resto do caminho é que passa pela regra.
  const semUnidade = bruto.replace(/^[a-zA-Z]:[\\/]/, '');

  // Caractere de controle vindo de colagem. Comparar por codigo, e nao por
  // classe de regex, porque a classe com literais de controle e recusada
  // pelo lint e por bons motivos: ela e ilegivel.
  if ([...semUnidade].some((c) => c.charCodeAt(0) < 32)) return { ok: false, motivo: 'controle' };

  const achados = PROIBIDOS.filter((c) => semUnidade.includes(c));
  if (achados.length) {
    return { ok: false, motivo: 'caractere', detalhe: achados.join(' ') };
  }

  // Acento não quebra o Windows, mas quebra ferramenta do MSYS compilada sem
  // suporte a UTF-8, que é o caso de parte da cadeia. Fora do ASCII, recusa.
  const foraDoAscii = [...semUnidade].filter((c) => c.charCodeAt(0) > 126);
  if (foraDoAscii.length) {
    return { ok: false, motivo: 'acento', detalhe: [...new Set(foraDoAscii)].join(' ') };
  }

  // Espaço duplo passa despercebido ao olho e some em argumento não citado,
  // então o caminho deixa de apontar para onde a pessoa acha que aponta.
  if (/ {2}/.test(semUnidade)) return { ok: false, motivo: 'espacoDuplo' };

  const partes = semUnidade.split(/[\\/]/).filter(Boolean);
  for (const parte of partes) {
    if (RESERVADOS.test(parte)) return { ok: false, motivo: 'reservado', detalhe: parte };
    if (parte !== parte.trim()) return { ok: false, motivo: 'bordas', detalhe: parte };
    if (parte.endsWith('.')) return { ok: false, motivo: 'pontoFinal', detalhe: parte };
  }

  return { ok: true };
}

/** O código de `problemaNoNomeDoProcessador` virado `motivo` de `explicar`. */
const MOTIVO_DO_PROBLEMA: Record<ProblemaNoNome, string> = {
  vazio: 'nomeVazio',
  caracteres: 'nomeCaracteres',
  digito: 'nomeDigito',
  sublinhado: 'nomeSublinhado',
  reservada: 'nomeReservada',
};

/**
 * O nome de um projeto ou de um processador: uma regra só para os dois (#187).
 *
 * A base é a do processador, que é a do yanc (`pastas_do_processador.ts`),
 * porque o nome dele vira módulo Verilog. O projeto não precisaria de tanto,
 * mas duas regras parecidas são duas coisas para decorar, e quem criava os
 * dois via avisos diferentes. Por cima, os nomes que o Windows reserva, que o
 * yanc aceitaria e a pasta não. O caminho aceita espaço simples para não
 * barrar "Meus Projetos"; o nome não herda essa folga (#186).
 */
export function analisarNome(nome: unknown): Analise {
  const n = typeof nome === 'string' ? nome : '';
  const problema = problemaNoNomeDoProcessador(n);
  if (problema === 'caracteres') {
    const fora = [...new Set([...n].filter((c) => !/[A-Za-z0-9_]/.test(c)))];
    return { ok: false, motivo: 'nomeCaracteres', detalhe: fora.map((c) => (c === ' ' ? 'espaço' : c)).join(' ') };
  }
  if (problema) return { ok: false, motivo: MOTIVO_DO_PROBLEMA[problema], detalhe: n };
  if (RESERVADOS.test(n)) return { ok: false, motivo: 'reservado', detalhe: n };
  return { ok: true };
}

/** Mensagens em português, prontas para a interface. */
const MOTIVOS: Record<string, (d?: string) => string> = {
  vazio: () => 'Informe um caminho.',
  controle: () => 'O caminho tem caracteres invisíveis. Digite-o de novo.',
  caractere: (d) => `O caminho não pode conter ${d}. `
    + 'As ferramentas de compilação tratam esses caracteres como comando, '
    + 'e o erro apareceria só na hora de compilar.',
  acento: (d) => `O caminho não pode ter acento nem ${d}. `
    + 'Parte do toolchain não lê caminho fora do ASCII.',
  espacoDuplo: () => 'O caminho tem dois espaços seguidos. Use um só.',
  reservado: (d) => `"${d}" é um nome reservado pelo Windows.`,
  bordas: (d) => `"${d}" começa ou termina com espaço.`,
  pontoFinal: (d) => `"${d}" termina com ponto, o que o Windows não guarda.`,
  nomeVazio: () => 'Informe um nome.',
  nomeCaracteres: (d) => `O nome só pode ter letras sem acento, números e _. Tire: ${d}.`,
  nomeDigito: () => 'O nome não pode começar com número.',
  nomeSublinhado: () => 'O nome não pode começar com __.',
  nomeReservada: (d) => `"${d}" é palavra reservada do Verilog.`,
};

/** Texto pronto para um resultado de análise. */
export function explicar(resultado: Analise | null | undefined): string {
  if (!resultado || resultado.ok) return '';
  const f = resultado.motivo ? MOTIVOS[resultado.motivo] : undefined;
  return f ? f(resultado.detalhe) : 'Caminho inválido.';
}
