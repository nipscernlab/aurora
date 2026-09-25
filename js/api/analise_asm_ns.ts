/**
 * analise_asm_ns.ts: `AuroraAPI.project.analyzeAsm`, a parte que acha e le o
 * .asm. A analise em si e pura e mora em js/compilation/analise_asm.ts.
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO). O projeto vem do
 * ProjectStore importado, e o arquivo em foco do TabManager importado, e nao
 * de window (o `window.tabManager` que se lia antes nem existe).
 *
 * Compilado por `tsc` (npm run build:ts) num analise_asm_ns.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { SharedModelRegistry } from '../editor/shared_models.js';
import { TabManager } from '../tabs/tab_manager.js';
import { ProjectStore } from '../project/project_store.js';
import { analisarAsm } from '../compilation/analise_asm.js';
import { ok, err } from './api_core.js';
import { loadRules } from './rules_ns.js';

export const analiseDoAsm = {
  /**
   * Parse a SAPHO assembly (.asm) file and return a structured summary
   * the AI can reason about without re-reading the whole text.
   *
   * Resolution order (one of these must work):
   *   1. explicit `filePath` (absolute, or relative to project root)
   *   2. `processorName`  → <root>/<proc>/Software/<proc>.asm
   *   3. neither          → active editor (must be .asm)
   *
   * The returned shape lets the AI ask "how many instructions are in
   * the loop at @L3?" or "how many floating-point multiplications does
   * this processor do?" in O(1) after one call.
   */
  async analyzeAsm({ filePath, processorName }: { filePath?: string; processorName?: string } = {}) {
    const root = ProjectStore.getProjectPath();
    let target: string;

    if (filePath) {
      target = String(filePath).trim();
    } else if (processorName) {
      if (!root) return err('No project open');
      target = `${root}\\${processorName}\\Software\\${processorName}.asm`;
    } else {
      const active = TabManager.getEditingFilePath?.();
      if (!active || !active.toLowerCase().endsWith('.asm')) {
        return err('no filePath/processorName and active file is not .asm');
      }
      target = active;
    }

    if (target.includes('..')) return err('path must not contain ".."');
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('\\\\');
    if (!isAbsolute && root) target = `${root}\\${target.replace(/^[\\/]+/, '')}`;

    // Stay inside the project folder, same boundary as readFile.
    if (root) {
      const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
      const r = norm(root);
      const t = norm(target);
      if (t !== r && !t.startsWith(r + '\\')) {
        return err('file is outside the open project folder');
      }
    }

    // Read text (live model wins if the file is open in Monaco, so the
    // analysis tracks unsaved edits, same contract as readFile).
    let text;
    const liveModel = SharedModelRegistry.getModel(target);
    if (liveModel) {
      text = liveModel.getValue();
    } else {
      try { text = String(await electronAPI.readFile(target) ?? ''); }
      catch (_) { return err(`File not found: "${target}"`); }
    }

    // A tabela de opcodes faz reconhecer os mnemonicos; sem ela, a analise
    // conta todo identificador em maiusculas e os marca como desconhecidos.
    const rules = await loadRules();
    return ok({ filePath: target, ...analisarAsm(text, rules?.asm?.opcodes || []) });
  },
};
