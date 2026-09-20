/**
 * Tipos de verilog_stats.js, para os modulos .ts importarem a analise do
 * Verilog gerado sem o tsc reclamar de modulo sem declaracao. Mesma razao do
 * electron_api.d.ts: enquanto o .js nao vira .ts, a declaracao mora ao lado.
 *
 * Declaracao PARCIAL, como a do electronAPI: so o que os .ts ja migrados
 * usam. `resumirHierarquiaYosys` fica de fora ate o primeiro .ts precisar
 * dela. Quando verilog_stats.js virar .ts, este arquivo sai junto.
 */

export interface PortaVerilog {
  name: string;
  dir: string;
}

export interface InstanciaVerilog {
  name: string;
  module: string;
}

export interface ModuloVerilog {
  name: string;
  ports: PortaVerilog[];
  instances: InstanciaVerilog[];
}

export interface AnaliseVerilog {
  modules: ModuloVerilog[];
}

export interface TotaisVerilog {
  modules: number;
  ports: number;
  inputs: number;
  outputs: number;
  inouts: number;
  instances: number;
}

export function analisarVerilog(texto: string): AnaliseVerilog;
export function totaisDoVerilog(analise: AnaliseVerilog | null | undefined): TotaisVerilog;
