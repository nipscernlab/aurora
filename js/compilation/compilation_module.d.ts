/**
 * Tipos de compilation_module.js, para os modulos .ts que o importam sem o tsc
 * reclamar de modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: o CompilationModule real tem quase quatro
 * mil linhas. Aqui mora so o que os .ts ja migrados chamam (hoje, o
 * compilation_flow). Acrescente o proximo quando ele for preciso, e apague o
 * arquivo quando o compilation_module.js virar .ts.
 */

import type { EntradaDeProcessador } from './processor_source.js';

export class CompilationModule {
  constructor(projectPath: string | null);
  projectPath: string;
  projectConfig: { processors?: unknown[] } | null;
  terminalManager?: unknown;
  loadConfig(): Promise<unknown>;
  initializeComponentsPath(): Promise<unknown>;
  ensureDirectories(nome: string): Promise<unknown>;
  cmmCompilation(processor: EntradaDeProcessador): Promise<string>;
  cppCompilation(processor: EntradaDeProcessador): Promise<string>;
  asmCompilation(processor: EntradaDeProcessador, preamble?: unknown): Promise<unknown>;
  verilogSyntaxCheck(): Promise<unknown>;
  runGtkWave(): Promise<unknown>;
  verilatorProcessorRun(): Promise<unknown>;
  runFastSim(): Promise<unknown>;
}
