/**
 * aurora-globals.d.ts — ambient declarations for Aurora's window-global surface.
 *
 * Aurora's renderer shares state through `window.*` globals (no bundler/import
 * graph). As modules migrate to TS they need these typed. This file grows
 * incrementally: add a method/global here the first time a converted .ts touches
 * it. Type-only — emits no JS.
 */

/** Subset of the preload's electronAPI used by already-migrated .ts modules. */
interface AuroraElectronAPI {
  joinPath(...parts: string[]): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  readFile(path: string, options?: { encoding?: string }): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  listFilesInDirectory(dir: string): Promise<string[]>;
}

declare global {
  interface Window {
    electronAPI: AuroraElectronAPI;
    /** Absolute path of the currently open .spf, set by the project lifecycle. */
    currentSpfPath?: string | null;
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
