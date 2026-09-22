/**
 * processor_sim_config.ts: a config de simulacao de um processador, como ela
 * mora no `.spf` e como se le dela.
 *
 * Sao tres campos, `clk` em MHz, `numClocks` e `showArrays`, e a leitura
 * estava escrita a mao em QUATRO lugares, todos com os mesmos numeros
 * digitados de novo:
 *
 *   - `DEFAULT_CONFIG` e `_readConfig`, em js/processors/processor_config_panel.js;
 *   - `PROC_DEFAULTS` e `readProcessorConfig`, em js/compilation/compilation_flow.js;
 *   - literais soltos no `enrichProcessors` do main/ipc/project.js;
 *   - literais soltos no `getProcessorConfig` e no `setProcessorConfig` da
 *     js/api/aurora_api.js.
 *
 * O tempo simulado, que sai dos dois primeiros, ja tinha divergido: o
 * `main/ipc/project.js` fazia `numClocks / clk` cru e a `aurora_api.js`
 * guardava com `numClocks > 0 && clk > 0`. Com `clk` zero num `.spf` editado a
 * mao, a mesma pergunta era respondida com `Infinity` por um caminho e `null`
 * pelo outro. Um terceiro lugar, o `setProcessorConfig`, nao guardava nada.
 *
 * A guarda venceu porque ela ja era a regra da tela: o painel de config mostra
 * um travessao quando `clk` ou `numClocks` nao sao positivos, e nunca mostrou
 * `Infinity`. O que estava errado era o resto concordar com ela.
 *
 * Compilado por `tsc` (npm run build:ts) num processor_sim_config.js ao lado,
 * e esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/**
 * O que vale quando o `.spf` nao diz.
 *
 * 100 MHz e 2000 ciclos dao os 20 us que a AURORA escreve na linha de
 * `$finish` do testbench, e sao os mesmos numeros que o painel mostra como
 * sugestao. Um `.spf` antigo, em que a entrada do processador era so o nome,
 * cai aqui e se comporta como sempre se comportou.
 */
export const PADROES_DE_SIMULACAO = Object.freeze({
  clk: 100,
  numClocks: 2000,
  showArrays: false,
});

export interface ConfigDeSimulacao {
  /** Frequencia em MHz. */
  clk: number;
  /** Quantos ciclos o testbench roda antes do `$finish`. */
  numClocks: number;
  showArrays: boolean;
}

/**
 * O tempo simulado em microssegundos, ou `null` quando a conta nao faz
 * sentido.
 *
 * `null`, e nao `Infinity` nem `0`: com `clk` zero nao ha tempo a calcular, e
 * com zero ciclos nao ha simulacao. Quem mostra escreve um travessao, e quem
 * le por programa (hoje a IA) recebe uma ausencia em vez de um numero errado.
 */
export function tempoDeSimulacaoUs(numClocks: unknown, clk: unknown): number | null {
  const n = Number(numClocks);
  const c = Number(clk);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(c) || c <= 0) return null;
  return n / c;
}

/**
 * Le a config de uma entrada de `structure.processors`.
 *
 * A entrada pode ser o objeto, uma string com o nome (o formato antigo do
 * `.spf`) ou nada; nos tres casos o que falta vem dos padroes, que e o que as
 * quatro copias faziam.
 */
export function lerConfigDeSimulacao(entrada: unknown): ConfigDeSimulacao {
  const e = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  return {
    clk: Number.isFinite(e.clk) ? e.clk as number : PADROES_DE_SIMULACAO.clk,
    numClocks: Number.isFinite(e.numClocks)
      ? e.numClocks as number
      : PADROES_DE_SIMULACAO.numClocks,
    showArrays: !!e.showArrays,
  };
}

/** A config mais o tempo simulado, que e o formato que a API devolve. */
export function configComTempo(entrada: unknown): ConfigDeSimulacao & { simTime_us: number | null } {
  const cfg = lerConfigDeSimulacao(entrada);
  return { ...cfg, simTime_us: tempoDeSimulacaoUs(cfg.numClocks, cfg.clk) };
}
