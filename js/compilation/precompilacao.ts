/**
 * precompilacao.ts: achar os processadores do projeto e compilar cada um
 * (fonte + ASM) antes do passo que o botao pediu.
 *
 * Saiu do compilation_flow. Verilog, Wave, PRISM, Fast Sim e o Verilator do
 * processador comecam todos pelo mesmo pre-flight: para cada processador
 * conhecido, o front end da linguagem e o asmcomp. Um for sobre lista vazia
 * (projeto sem processador) e no-op natural, sem branch sobre "tem
 * processador?".
 *
 * O projeto e o do COMPILADOR (`compiler.projectPath`), e nao o que estiver
 * aberto no instante de cada leitura: e o mesmo caminho quando tudo corre
 * bem, mas assim uma execucao nao muda de projeto no meio.
 *
 * Compilado por `tsc` (npm run build:ts) num precompilacao.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { getAvailableProcessors } from '../project/processor_list.js';
import { lerConfigDeSimulacao } from '../project/processor_sim_config.js';
import { checkCancellation } from './cancelamento.js';
import { compileProcessorSource, locateProcessorSource, type FrontEnds } from './processor_dispatch.js';
import type { EntradaDeProcessador } from './processor_source.js';

/** O pedaco do terminal que a pre-compilacao usa. */
export interface Terminal {
  appendToTerminal?(terminalId: string, texto: string, tipo: string): unknown;
}

/** O que a pre-compilacao precisa do CompilationModule. */
export interface CompiladorDoProjeto extends FrontEnds {
  projectPath: string;
  projectConfig?: { processors?: unknown[] } | null;
  initializeComponentsPath(): Promise<unknown>;
  ensureDirectories(nome: string): Promise<unknown>;
  asmCompilation(processor: EntradaDeProcessador, preamble?: unknown): Promise<unknown>;
}

type Entrada = EntradaDeProcessador & Record<string, unknown>;

const comNome = (p: unknown): Entrada | null => {
  if (typeof p === 'string') return p ? { name: p } : null;
  const o = p as Entrada | null;
  return o && o.name ? o : null;
};

/**
 * Resolve a qual processador um arquivo pertence olhando seu path:
 *   <projectPath>/<procName>/{Hardware|Software|Simulation}/<arquivo>
 * Devolve o objeto do processador (preservando casing original) ou null.
 *
 * Mirrors ProjectTreeManager._getProcessorForFile (replicado aqui pra
 * evitar acoplamento entre o pipeline de compilacao e o file tree).
 */
export function findProcessorForPath(filePath: string | null | undefined, projectPath: string | null | undefined, processors: unknown): Entrada | null {
  if (!filePath || !projectPath || !Array.isArray(processors)) return null;
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
  const fp = norm(filePath);
  const pp = norm(projectPath);
  if (!fp.startsWith(pp)) return null;
  const rel = fp.slice(pp.length).replace(/^\/+/, '');
  const segs = rel.split('/');
  if (segs.length < 3) return null;
  const sub = segs[1];
  if (sub !== 'hardware' && sub !== 'software' && sub !== 'simulation') return null;
  const procNameLower = segs[0];
  // Tolera entrada como string (window.availableProcessors) ou
  // objeto com .name (.spf structure.processors).
  const match = processors.find((p: unknown) => {
    const n = typeof p === 'string' ? p : (p as Entrada | null)?.name;
    return n && n.toLowerCase() === procNameLower;
  });
  if (!match) return null;
  return typeof match === 'string' ? { name: match } : match as Entrada;
}

/**
 * A lista canonica de processadores conhecidos do projeto, pelo
 * processor_list (semeado pelo project_manager a partir do .spf).
 */
export function collectProcessors(): Entrada[] {
  return getAvailableProcessors().map(comNome).filter((p): p is Entrada => p !== null);
}

/**
 * Os processadores a pre-compilar. Prioriza as entries completas do .spf (com
 * clk/numClocks/showArrays setados pelo painel de config) sobre a lista de
 * nomes; cai nela so se o projectConfig do compilador nao tem entries, algo
 * upstream estaria errado, mas evita perder o pipeline.
 */
function processadoresDe(compiler: CompiladorDoProjeto): Entrada[] {
  const doSpf = Array.isArray(compiler.projectConfig?.processors)
    ? compiler.projectConfig.processors.map(comNome).filter((p): p is Entrada => p !== null)
    : [];
  return doSpf.length > 0 ? doSpf : collectProcessors();
}

/**
 * Pre-flight comum aos botoes Verilog / Wave / PRISM: pra cada processador
 * conhecido, roda o front end da linguagem + asmCompilation.
 *
 * Pulamos processadores sem fonte em <proj>/<proc>/Software/ (nem .cmm nem
 * .cpp; o front end falharia). Quem acha o fonte e o processor_dispatch.
 *
 * @returns contagem de processadores efetivamente compilados.
 */
export async function precompileAllProcessors(compiler: CompiladorDoProjeto, terminalId: string, tm: Terminal | null): Promise<number> {
  const procs = processadoresDe(compiler);
  if (procs.length === 0) return 0;

  // componentsPath e populado pelo construtor sem await (background
  // promise). Garante que resolveu antes do primeiro ensureDirectories,
  // que le this.componentsPath direto.
  await compiler.initializeComponentsPath();

  tm?.appendToTerminal?.(
    terminalId,
    `Info: pre-compiling ${procs.length} processor(s) (source + ASM).`,
    'tips',
  );

  let compiled = 0;
  for (const proc of procs) {
    checkCancellation();
    const fonte = await locateProcessorSource(compiler.projectPath, proc, electronAPI);
    if (!fonte || !(await electronAPI.fileExists(fonte.sourcePath))) {
      tm?.appendToTerminal?.(
        terminalId,
        `Warning: no ${fonte ? fonte.sourceFile : `${proc.name}.cmm / ${proc.name}.cpp`} in ${proc.name}/Software — skipping ${proc.name}.`,
        'warning',
      );
      continue;
    }

    const overrideProcessor = {
      ...proc,
      ...lerConfigDeSimulacao(proc),
      sourceFile: fonte.sourceFile,
    };

    await compiler.ensureDirectories(proc.name);
    await compileProcessorSource(compiler, overrideProcessor);
    await compiler.asmCompilation(overrideProcessor);
    compiled++;
  }
  return compiled;
}

/**
 * Variante de precompileAllProcessors que NAO roda o front end. Usada pela
 * Aurora Intelligence quando ela quer testar um .asm otimizado a mao: o
 * fonte fica intacto e o .asm sandbox (apontado via override de -i no step
 * asm) e o input do asmcomp.
 *
 * Mantem o mesmo contrato de error/skip que precompileAllProcessors pra que
 * o resto do pipeline (iverilog/wave) funcione identico.
 */
export async function precompileAsmOnly(compiler: CompiladorDoProjeto, terminalId: string, tm: Terminal | null): Promise<number> {
  const procs = processadoresDe(compiler);
  if (procs.length === 0) return 0;

  await compiler.initializeComponentsPath();

  tm?.appendToTerminal?.(
    terminalId,
    `Info: assembling ${procs.length} processor(s) without re-running cmmcomp.`,
    'tips',
  );

  let compiled = 0;
  for (const proc of procs) {
    checkCancellation();
    // O nome do .asm segue a base do fonte; sem fonte no disco, a
    // convencao <nome>.cmm de sempre (o asmcomp e quem vai reclamar).
    const fonte = await locateProcessorSource(compiler.projectPath, proc, electronAPI);
    const overrideProcessor = {
      ...proc,
      ...lerConfigDeSimulacao(proc),
      sourceFile: fonte ? fonte.sourceFile : `${proc.name}.cmm`,
    };
    await compiler.ensureDirectories(proc.name);
    // NOTE: o front end fica de fora de proposito, o .asm no disco
    // (canonico ou roteado por um override `asm.-i`) e o input do asmcomp.
    await compiler.asmCompilation(overrideProcessor);
    compiled++;
  }
  return compiled;
}

/**
 * Resolve o fonte canonico a compilar quando NENHUM fonte esta em foco
 * (caso tipico de um compile disparado pela Aurora Intelligence). Ordem:
 *   1. o ultimo processador que esteve em foco (sticky), se ainda existe;
 *   2. se o projeto tem exatamente um processador, esse.
 * Retorna o path `<proj>/<proc>/Software/<proc>.<cmm|cpp>` (o que existir,
 * por locateProcessorSource) ou null se nao da pra decidir com seguranca
 * (varios processadores e nenhum foi focado ainda, ou nenhum fonte no disco).
 */
export async function resolveFallbackCmmPath(ultimoAtivo: string | null): Promise<string | null> {
  const projeto = ProjectStore.getProjectPath();
  if (!projeto) return null;
  const procs = collectProcessors().map((p) => p.name);
  if (procs.length === 0) return null;
  let proc = (ultimoAtivo && procs.includes(ultimoAtivo)) ? ultimoAtivo : null;
  if (!proc && procs.length === 1) proc = procs[0];
  if (!proc) return null;
  const entry = collectProcessors().find((p) => p.name === proc) || { name: proc };
  const fonte = await locateProcessorSource(projeto, entry, electronAPI);
  return fonte ? fonte.sourcePath : null;
}
