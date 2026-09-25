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
  deleteFile(path: string): Promise<unknown>;
  /** Apaga arquivo ou pasta (a pasta com tudo dentro). */
  deleteFileOrDirectory(path: string): Promise<unknown>;
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
  /**
   * Manda um comando para a pagina do PRISM (a simulacao logica interativa).
   * Este e o lado de QUEM PEDE, o renderer principal; os dois abaixo sao o
   * lado de quem executa, a propria pagina do PRISM (preload_prism.js).
   */
  prismCommand(cmd: Record<string, unknown>):
    Promise<{ ok: boolean, data?: unknown, error?: string } | null | undefined>;
  /**
   * O resto do que a pagina do PRISM usa do bridge (preload_prism.js). Varios
   * devolvem estrutura do digitaljs ou do Yosys, que nao tem tipo publicado,
   * e por isso sao `unknown`: quem consome ja trata como dado externo.
   */
  getPrismCompilationPaths(): Promise<any>;
  generateSVGFromModule(...args: any[]): Promise<any>;
  buildDigitalJS(...args: any[]): Promise<any>;
  prismRecompile(...args: any[]): Promise<any>;
  exportWave(...args: any[]): Promise<any>;
  openSourceFile(...args: any[]): Promise<any>;
  logToTerminal(...args: unknown[]): void;
  onCompilationComplete(cb: (...args: unknown[]) => void): void;
  /** Controles da janela propria do PRISM. */
  onWindowState(cb: (estado: unknown) => void): void;
  windowMinimize(): void;
  windowMaximizeToggle(): void;
  windowClose(): void;
  /** A pagina do PRISM recebe o comando que o main entregou. */
  onPrismCommand?(callback: (id: string, cmd: Record<string, unknown>) => void): void;
  /** ...e responde por aqui, com o mesmo id. */
  replyPrismCommand?(id: string, result: unknown): void;
  /** O catalogo dos projetos de exemplo. */
  exemplosListar?(): Promise<{ ok: boolean, exemplos?: unknown[] } | undefined>;
  /** Cria os projetos de exemplo numa pasta que o usuario escolhe. */
  exemplosInstalar?(): Promise<{
    ok: boolean, cancelado?: boolean, pasta?: string, criados?: unknown[], pulados?: unknown[],
  } | undefined>;
  /** Procura no manual do SAPHO e devolve as paginas mais proximas. */
  docsBuscar?(query: string, options?: Record<string, unknown>):
    Promise<{ ok: boolean, resultados?: unknown[], total?: number, online?: boolean } | undefined>;
  /** Le uma pagina do manual. */
  docsLer?(pagePath: string, options?: Record<string, unknown>):
    Promise<{ ok: boolean, caminho?: string, titulo?: string, texto?: string, truncado?: boolean } | undefined>;
  /** Confere uma citacao do manual contra o arquivo em disco. */
  docsCitar?(pagePath: string, locator: string):
    Promise<{ ok: boolean, erro?: string, error?: string, pagina?: string, titulo?: string, trecho?: string, versao?: string } | undefined>;
  /** O manual esta instalado nesta maquina, e em que versao. */
  docsStatus?(): Promise<unknown>;
  /** Abre um capitulo do manual na janela propria da documentacao. */
  docsOpenHelp?(pagina: string, opcoes?: Record<string, unknown>):
    Promise<{ ok: boolean } | undefined>;
  /** Abre uma URL no navegador do sistema. Recusa `file://` de proposito. */
  openExternal?(url: string): Promise<unknown>;
  /** Cria a pasta do processador, o fonte e a entrada no .spf. */
  createProcessorProject(formData: Record<string, unknown>):
    Promise<{ success: boolean, path?: string, message?: string }>;
  /** Pede ao main que a arvore de arquivos se redesenhe. */
  triggerFileTreeRefresh(): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  openProject(spfPath: string): Promise<unknown>;
  getProjectInfo?(projectPath: string): Promise<unknown>;
  /** Cria a pasta e o .spf de um projeto novo. O main ignora o terceiro argumento. */
  createProjectStructure(projectPath: string, spfPath: string, name?: string): Promise<{ success?: boolean; message?: string } | null>;
  listRecentProjects?(): Promise<string[] | null>;
  createBackup?(folderPath: string): Promise<{ success?: boolean; message?: string } | null>;
  renameProject?(newName: string): Promise<{ success?: boolean; message?: string; failedStep?: string; steps?: Array<Record<string, unknown>>; newSpfPath?: string; newName?: string; oldName?: string; [k: string]: unknown } | null>;
  watchDirectory?(path: string | null): Promise<unknown>;
  /** Os processadores do projeto, como o .spf os lista (nome, ou objeto com config). */
  getAvailableProcessors(projectPath: string): Promise<Array<string | { name?: string; [k: string]: unknown }> | null>;
  deleteProcessor?(name: string): Promise<{ success?: boolean; message?: string; [k: string]: unknown } | null>;
  renameProcessor?(oldName: string, newName: string): Promise<{ success?: boolean; message?: string; oldName?: string; newName?: string; oldDir?: string; newDir?: string; [k: string]: unknown } | null>;
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
  runLogGravar?(projeto: string, exec: import('../compilation/run_log.js').Execucao): Promise<unknown>;
  runLogListar?(projeto: string): Promise<{ execucoes?: import('../compilation/run_log.js').ResumoDeExecucao[] } | null>;
  runLogLer?(projeto: string | null | undefined, id: string | null): Promise<{ ok: boolean; execucao: import('../compilation/run_history.js').ExecucaoGravada } | null>;
  onFileChanged?(cb: (filePath: string) => void): void;
  componentesListar?(): Promise<{ componentes?: Array<{ nome: string; instalado: boolean; requerParaCompilar?: boolean; downloadMB: number }> } | null>;
  prismCompileWithPaths(paths: unknown): Promise<{ success: boolean; message?: string; [k: string]: unknown }>;
  cancelVvpProcess(): Promise<{ success?: boolean } | null>;
  onProcessorCreated?(cb: (data: unknown) => void): void;
  onDirectoryChanged?(cb: (directoryPath: string, files: unknown) => void): void;
}

/** Subset do window.gitAPI do preload (main/ipc/git.ts) que os .ts ja usam. */
interface AuroraGitAPI {
  status(opts?: unknown): Promise<{ ok?: boolean; isRepo?: boolean; files?: Array<{ path?: string; index?: string; working?: string }> } | null>;
  ignored?(opts?: unknown): Promise<{ ok?: boolean; isRepo?: boolean; paths?: string[] } | null>;
}

declare global {
  /** O pedaco do TerminalManager (js/terminal/terminal_module.js) que os .ts usam. */
  interface AuroraTerminalManager {
    appendToTerminal?(terminalId: string, texto: string, tipo?: string): unknown;
    clearTerminalImmediate?(terminalId: string): unknown;
    clearHardwareProgress?(): unknown;
  }
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
    /** Espelho do ProjectStore para quem ainda nao o importa (js/project/project_store.ts). */
    ProjectStore?: typeof import('../project/project_store.js').ProjectStore;
    gitAPI?: AuroraGitAPI;
    /** Os paineis do editor dividido (js/editor/split_editor.js), cada um com as suas abas. */
    SplitEditorManager?: {
      panes?: Iterable<{ tabs?: Map<string, unknown>; paneIndex?: number; _closeFile?(filePath: string): Promise<unknown> }>;
      closePane?(paneIndex: number | undefined): unknown;
    };
    /** O gerenciador de projeto do renderer (js/project/project_manager.js). */
    projectManager?: { loadProject?(spfPath: string): Promise<unknown> };
    /** A lista de recentes da tela inicial (js/project/recent_projects.js). */
    recentProjectsManager?: { removeProject?(spfPath: string): unknown };
    /** O aviso no canto (js/ui/notification.js). */
    showNotification?: (mensagem: string, tipo?: string, duracaoMs?: number) => unknown;
    /** O seletor de .gtkw (js/wave/gtkw_picker.js); a barra so pede para re-sincronizar. */
    gtkwPickerManager?: { refresh?: () => unknown };
    /** De js/compilation/botoes_da_barra.ts, so para o E2E que as chama de dentro da pagina. */
    syncCmmcompEnabled?: () => void;
    syncToolbarEnabledState?: () => Promise<void>;
    /** O TerminalManager do renderer (renderer.js), criado sob demanda. */
    globalTerminalManager?: AuroraTerminalManager;
    initializeGlobalTerminalManager?: () => AuroraTerminalManager | null;
    /** O ultimo CompilationModule criado; o fluxo acha o terminal por ele em ultimo caso. */
    _latestCompilationModule?: { terminalManager?: AuroraTerminalManager };
    /** O pedaco da API da AURORA que a barra e o Cancelar usam (js/api/aurora_api.js). */
    AuroraAPI?: {
      compile: { compileStep(step: string): unknown; compileAll(): unknown; cancel(): unknown };
      events?: { emit?(nome: string, dados: unknown): void };
    };
    /** O TabManager exposto em window (renderer.js); o PRISM em aba abre por ele. */
    TabManager?: { openPrismTab?(resultado: unknown): unknown };
    /** A instancia do js/tree/git_decorations.ts, para os testes e o console. */
    gitDecorations?: unknown;
    /** Returns the active yanc message language ('pt' | 'en'). */
    getYancLang?: () => string;
    /** i18n do renderer; os modulos usam o shim `tr()`, que cai na chave se ela nao tiver subido. */
    t?: (chave: string, params?: Record<string, unknown>) => string;
    /** De js/compilation/cancelamento.ts: o .exe morto pelo Cancelar reporta a morte como falha propria. */
    isCompilationCanceled?: () => boolean;
    /** A pagina do PRISM se publica para o preload e para os testes. */
    prismViewer?: unknown;
    /** A tabela de traducao que a pagina do PRISM carrega antes do script. */
    __prismI18n?: Record<string, unknown>;
    /** Abre o fonte no editor principal; a pagina do PRISM chama ao clicar num sinal. */
    gotosrc?: (...args: unknown[]) => void;
    /** O digitaljs traz o jQuery junto, e a pagina do PRISM o usa por ele. */
    jQuery?: unknown;
    /** O Monaco, carregado pelo loader da AMD antes dos modulos do editor. */
    monaco?: any;
    /** Owned by processor_list.ts. */
    availableProcessors?: string[];
    /** Set by command_overrides.ts for non-module callers. */
    CommandOverrides?: unknown;
    /** Set by command_spec.ts for non-module callers. */
    CommandSpec?: unknown;
    /** A ponte dos dialogos para quem nao e modulo. Escrita por dialog_manager.ts. */
    AuroraUI?: Record<string, unknown>;
  }
}

export {};
