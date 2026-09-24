/**
 * grammars.ts: serves tree-sitter WASM bytes to the renderer (O7).
 *
 * The renderer's web-tree-sitter highlighter (js/editor/treesitter_highlight.js)
 * can't reliably fetch .wasm by URL under the sandboxed file:// renderer, so
 * it asks the main process for the raw BYTES of each artifact and feeds them
 * straight into web-tree-sitter (Parser.init({wasmBinary}) + Language.load
 * (bytes)). That sidesteps all URL/fetch/CSP issues.
 *
 * The artifacts live in components/Packages/tree-sitter/ (downloaded by
 * download-tree-sitter-grammars.js at bootstrap). Only a fixed set of logical
 * names maps to files here, the renderer can't ask for arbitrary paths.
 */

import path from 'node:path';
import fs from 'node:fs';
import { ipcMain } from 'electron';
import log from 'electron-log';

import { componentsPath } from '../paths.js';

const DIR = path.join(componentsPath, 'Packages', 'tree-sitter');

/** Logical name → file. The renderer is limited to these (no arbitrary read). */
const ARTIFACTS: Readonly<Record<string, string>> = {
  runtime:       'web-tree-sitter.wasm',
  systemverilog: 'tree-sitter-systemverilog.wasm',
  c:             'tree-sitter-c.wasm',
  cpp:           'tree-sitter-cpp.wasm',
};

function fileFor(name: string): string | null {
  const f = ARTIFACTS[name];
  return f ? path.join(DIR, f) : null;
}

function exists(name: string): boolean {
  const f = fileFor(name);
  try { return !!f && fs.existsSync(f); } catch { return false; }
}

function status() {
  return {
    // Usable only if the runtime AND at least one grammar are present.
    installed: exists('runtime') && (exists('systemverilog') || exists('c') || exists('cpp')),
    runtime: exists('runtime'),
    grammars: {
      systemverilog: exists('systemverilog'),
      c: exists('c'),
      cpp: exists('cpp'),
    },
  };
}

/** Raw bytes of an artifact, or null if unknown/missing. */
async function wasm(name: string): Promise<Buffer | null> {
  const f = fileFor(name);
  if (!f) return null;
  try {
    return await fs.promises.readFile(f); // Buffer → Uint8Array in the renderer
  } catch (e) {
    log.warn(`[tree-sitter] read ${name} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export function register(): void {
  ipcMain.handle('treesitter:status', () => status());
  ipcMain.handle('treesitter:wasm', (_e, name) => wasm(name));
}
