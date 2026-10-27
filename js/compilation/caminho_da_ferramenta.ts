/**
 * caminho_da_ferramenta.ts: o caminho que cada ferramenta da cadeia recusa.
 *
 * Medido em 27/10/2026 com a toolchain real (o pipeline.test.js rodado com cada
 * caractere no caminho do projeto):
 *
 *   - O Verilator so aceita letras sem acento, digitos e `_ - + = .`. O script
 *     Perl `verilator` poe uma barra invertida antes de qualquer outro
 *     caractere (sh_escape, escape de shell POSIX) e entrega a linha ao
 *     cmd.exe, que nao entende esse escape; e, contornado o script, o
 *     verilated.mk recusa pasta com espaco ("GNU Make cannot build in
 *     directories containing spaces"). Isso derruba a simulacao Verilator, o
 *     Fast Sim, o teste de hardware e o cocotb no Verilator.
 *   - Acento derruba tambem o cocotb no Icarus, porque o runner do cocotb grava
 *     o $dumpfile com caminho absoluto e o vvp nao o abre, e o PRISM, cujo
 *     script do Yosys nomeia os .v pelo caminho absoluto.
 *   - yanc, iverilog, vvp e fst2vcd aceitam todos esses caracteres.
 *
 * Recusar antes de rodar troca o "Cannot find file containing module" que o
 * Verilator imprime por uma frase que diz qual caractere e o problema. Sem
 * ela, a Aurora Intelligence tentava contornar o erro em vez de dizer que a
 * pasta nao serve.
 *
 * Isto e aritmetica de texto, sem DOM e sem disco, para poder ser testado.
 */

import type { CommandSpec } from './command_spec.js';

/** O que a ferramenta recusa num caminho: `verilator` ou so `acento`. */
export type Regra = 'verilator' | 'acento';

/** Uma recusa: o caminho, os caracteres culpados e a ferramenta. */
export interface Recusa {
  regra: Regra;
  /** nome da ferramenta para a mensagem */
  ferramenta: string;
  caminho: string;
  caracteres: string[];
}

/** O que sobra de um caminho fora da unidade e dos separadores. */
function semUnidadeNemSeparador(caminho: string): string {
  return caminho.replace(/^[A-Za-z]:(?=[\\/])/, '').replace(/[\\/]/g, '');
}

/** Os caracteres de `caminho` que o Verilator recusa, sem repeticao. */
export function caracteresQueOVerilatorRecusa(caminho: string): string[] {
  return [...new Set([...semUnidadeNemSeparador(caminho)].filter((c) => !/[A-Za-z0-9_\-+=.]/.test(c)))];
}

/** Os caracteres de `caminho` fora do ASCII, sem repeticao. */
export function caracteresForaDoAscii(caminho: string): string[] {
  return [...new Set([...caminho].filter((c) => c.charCodeAt(0) > 126))];
}

/** Um argumento que nomeia arquivo ou pasta, e nao uma opcao. */
function pareceCaminho(texto: string): boolean {
  return /[\\/]/.test(texto) && !texto.startsWith('-') && !texto.startsWith('+');
}

/**
 * Os caminhos que chegam a ferramenta: o cwd, os argumentos que nomeiam
 * arquivo e os valores de ambiente que o runner do cocotb le como caminho
 * (lista JSON ou separada por `;`). O PATH fica de fora: e da maquina, nao
 * do projeto, e nenhuma ferramenta o le como argumento.
 */
export function caminhosDoSpec(spec: Pick<CommandSpec, 'cwd' | 'args' | 'env'>): string[] {
  const achados: string[] = [];
  if (spec.cwd) achados.push(spec.cwd);
  for (const a of spec.args || []) if (pareceCaminho(a)) achados.push(a);
  for (const [chave, valor] of Object.entries(spec.env || {})) {
    if (chave.toUpperCase() === 'PATH' || typeof valor !== 'string') continue;
    let partes: unknown[] = valor.split(';');
    if (valor.startsWith('[')) {
      try { partes = JSON.parse(valor) as unknown[]; } catch { /* nao era JSON: fica a lista por ; */ }
    }
    for (const p of partes) if (typeof p === 'string' && pareceCaminho(p)) achados.push(p);
  }
  return achados;
}

/** A regra e o nome da ferramenta de cada passo, ou null se o passo aceita qualquer caminho. */
function regraDoPasso(spec: Pick<CommandSpec, 'step' | 'env'>): { regra: Regra; ferramenta: string } | null {
  if (spec.step === 'verilator-build' || spec.step === 'verilator-json' || spec.step === 'verilator-tb-build') {
    return { regra: 'verilator', ferramenta: 'Verilator' };
  }
  if (spec.step === 'cocotb-run') {
    if (spec.env?.SIM === 'verilator') return { regra: 'verilator', ferramenta: 'cocotb (Verilator)' };
    // Sem onda o runner nao grava o $dumpfile, que e o que o vvp nao abria.
    if (spec.env?.WAVES !== '0') return { regra: 'acento', ferramenta: 'cocotb (Icarus)' };
  }
  return null;
}

/** O primeiro caminho que a regra recusa, com os caracteres culpados. */
export function recusaDosCaminhos(caminhos: string[], regra: Regra, ferramenta: string): Recusa | null {
  for (const caminho of caminhos) {
    const caracteres = regra === 'verilator' ? caracteresQueOVerilatorRecusa(caminho) : caracteresForaDoAscii(caminho);
    if (caracteres.length) return { regra, ferramenta, caminho, caracteres };
  }
  return null;
}

/** A recusa de um passo da toolchain, ou null se ele pode rodar. */
export function recusaDoSpec(spec: Pick<CommandSpec, 'step' | 'cwd' | 'args' | 'env'>): Recusa | null {
  const passo = regraDoPasso(spec);
  return passo ? recusaDosCaminhos(caminhosDoSpec(spec), passo.regra, passo.ferramenta) : null;
}

/**
 * A frase da recusa, pela chave de traducao da regra. O espaco vira palavra,
 * porque entre aspas ele some na leitura.
 */
export function explicarRecusa(recusa: Recusa, tr: (k: string, p?: Record<string, unknown>) => string): string {
  const espaco = tr('error.compilation.pathSpace');
  const chars = recusa.caracteres.map((c) => (c === ' ' ? espaco : c)).join(' ');
  const chave = recusa.regra === 'verilator' ? 'error.compilation.pathRefusedVerilator' : 'error.compilation.pathRefusedAccent';
  return tr(chave, { tool: recusa.ferramenta, chars, path: recusa.caminho });
}
