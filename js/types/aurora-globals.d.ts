/**
 * aurora-globals.d.ts: ambient declarations for Aurora's window-global surface.
 *
 * Aurora's renderer shares state through `window.*` globals (no bundler/import
 * graph). As modules migrate to TS they need these typed. This file grows
 * incrementally: add a method/global here the first time a converted .ts touches
 * it. Type-only, emits no JS.
 */

/** Result of electronAPI.getPythonStatus(), the bundled-Python probe. */
interface PythonStatus {
  ok: boolean;
  isBundled?: boolean;
  hasCocotb?: boolean;
  expectedCocotbVersion?: string;
  cocotbVersion?: string;
  pythonPath: string;
}

/** Subset of the preload's electronAPI used by already-migrated .ts modules. */
interface AuroraElectronAPI {
  joinPath(...parts: string[]): Promise<string>;
  dirname(p: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  readFile(path: string, options?: { encoding?: string }): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** mkdir -p: cria .aurora, Temp e a pasta do processador de uma vez. */
  createDirectory(path: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  /** Entradas de uma pasta, com a marca de quem e diretorio. */
  getFolderFiles(path: string): Promise<Array<{ path: string, isDirectory?: boolean }>>;
  listFilesInDirectory(dir: string): Promise<string[]>;
  renamePath(oldPath: string, newPath: string, opts?: { overwrite?: boolean }):
    Promise<{ success: boolean; code?: string; error?: string; path?: string }>;
  trashPath(path: string): Promise<{ success: boolean; error?: string }>;
  copyAnyPath(src: string, dest: string, opts?: { overwrite?: boolean }):
    Promise<{ success: boolean; code?: string; error?: string; path?: string }>;
  getComponentsPath(): Promise<string>;
  /** Cria a pasta do processador, o fonte e a entrada no .spf. */
  createProcessorProject(formData: Record<string, unknown>):
    Promise<{ success: boolean, path?: string, message?: string }>;
  /** Pede ao main que a arvore de arquivos se redesenhe. */
  triggerFileTreeRefresh(): Promise<void>;
  /** O main avisa que o botao do Processor Hub pode habilitar. */
  onProcessorHubState?(cb: (...args: unknown[]) => void): void;
  /** O main avisa que a lista de processadores do projeto mudou. */
  onProcessorsUpdated?(cb: (data: { projectPath: string }) => void): void;
  /** Pasta do usuario; a lista de recentes a resolve uma vez e encurta caminhos com ela. */
  getHomePath(): Promise<string>;
  /** Manda a pasta do projeto que esta janela acabou de fechar para a Lixeira. */
  trashProject(spfPath: string): Promise<{ success: boolean, message?: string }>;
  getPythonStatus(): Promise<PythonStatus>;
  execSpec(req: { spec: unknown; baseSpec: unknown }): Promise<ExecSpecResult>;
  execSpecStreamed(req: { spec: unknown; baseSpec: unknown }): Promise<ExecSpecResult>;
}

declare global {
  /** Result of a CommandSpec execution in the main process. */
  interface ExecSpecResult {
    code: number;
    stdout?: string;
    stderr?: string;
    pid?: number;
  }
  interface Window {
    electronAPI: AuroraElectronAPI;
    /** Absolute path of the currently open .spf, set by the project lifecycle. */
    currentSpfPath?: string | null;
    /** Absolute path of the current project dir (per-processor compile root). */
    currentProjectPath?: string | null;
    /** Absolute path of the open project file (legacy; dirname → project dir). */
    currentOpenProjectPath?: string | null;
    /** Returns the active yanc message language ('pt' | 'en'). */
    getYancLang?: () => string;
    /** i18n do renderer; os modulos usam o shim `tr()`, que cai na chave se ela nao tiver subido. */
    t?: (chave: string, params?: Record<string, unknown>) => string;
    /** Ligada pelo compilation_flow ao Cancelar: o .exe morto reporta a morte como falha propria. */
    isCompilationCanceled?: () => boolean;
    /** Owned by processor_list.ts. */
    availableProcessors?: string[];
    /** Set by command_overrides.ts for non-module callers. */
    CommandOverrides?: unknown;
    /** Set by wave_state_store.ts for non-module callers. */
    WaveStore?: unknown;
    /** Set by spf_store.ts for non-module callers. */
    SpfStore?: unknown;
    /** Set by command_spec.ts for non-module callers. */
    CommandSpec?: unknown;
  }
}

export {};
