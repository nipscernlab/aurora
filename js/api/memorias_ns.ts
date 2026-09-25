/**
 * memorias_ns.ts: as memorias do projeto, parte do namespace
 * `AuroraAPI.project` (listMemories, remember, forget).
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO). O `project` misturava o
 * ciclo do projeto, os arquivos, os processadores e isto; cada parte vira um
 * modulo, e o aurora_api.js monta o namespace a partir deles.
 *
 * PROJECT MEMORY, `<root>/.aurora/memory/<name>.md`, one fact per file.
 *
 * Why a first-class Aurora tool and not the CLI's own file-based memory:
 * `Write` is in DISALLOWED_TOOLS (main/ai/claude_agent.js) on purpose, every
 * write goes through Aurora's MCP tools so it hits the permission card and the
 * audit log, and the native tool would bypass both. Routing memory through the
 * API keeps that gate AND makes it work on all three transports (Agent SDK,
 * Claude Code CLI, Codex) instead of only the one that ships a memory feature.
 *
 * In-project (not userData) so memories survive moving the folder and the user
 * can read, version, or gitignore them. Keying off an absolute path has
 * already bitten this codebase, a stale testbench sidecar still points at a
 * project that moved.
 *
 * O nome que vira arquivo passa pelo `memorySlug` (js/ai/memory.ts), que e a
 * fronteira de seguranca: nada que saia dele escapa da pasta.
 *
 * Compilado por `tsc` (npm run build:ts) num memorias_ns.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { memorySlug } from '../ai/memory.js';
import { ok, err, emit } from './api_core.js';

const falhou = (e: unknown, padrao: string) => err((e as Error | null)?.message || padrao);

export const memoriasDoProjeto = {
  async listMemories() {
    const root = ProjectStore.getProjectPath();
    if (!root) return err('No project open');
    try {
      const dir = await electronAPI.joinPath(root, '.aurora', 'memory');
      if (!(await electronAPI.fileExists(dir))) return ok({ count: 0, memories: [] });
      const names: Array<string | { name?: string }> = (await electronAPI.listFilesInDirectory(dir)) || [];
      const memories: Array<{ name: string; content: string }> = [];
      for (const n of names) {
        const base = typeof n === 'string' ? n : (n?.name || '');
        if (!base.toLowerCase().endsWith('.md')) continue;
        try {
          const p = await electronAPI.joinPath(dir, base);
          memories.push({ name: base.replace(/\.md$/i, ''), content: (await electronAPI.readFile(p)) || '' });
        } catch (_) { /* a memory we can't read is not worth failing the turn over */ }
      }
      return ok({ count: memories.length, memories });
    } catch (e) { return falhou(e, 'listMemories failed'); }
  },

  /** Write (or overwrite) one memory. `name` is slugified into the filename. */
  async remember(name: unknown, content: unknown) {
    const root = ProjectStore.getProjectPath();
    if (!root) return err('No project open');
    const slug = memorySlug(name);
    if (!slug) return err('name required');
    if (typeof content !== 'string' || !content.trim()) return err('content required');
    try {
      const dir = await electronAPI.joinPath(root, '.aurora', 'memory');
      await electronAPI.createDirectory(dir);
      const p = await electronAPI.joinPath(dir, `${slug}.md`);
      await electronAPI.writeFile(p, content.trim() + '\n');
      emit('project:memory-written', { name: slug, path: p });
      return ok({ name: slug, path: p });
    } catch (e) { return falhou(e, 'remember failed'); }
  },

  /** Drop one memory. Returns { removed:false } when it was not there. */
  async forget(name: unknown) {
    const root = ProjectStore.getProjectPath();
    if (!root) return err('No project open');
    const slug = memorySlug(name);
    if (!slug) return err('name required');
    try {
      const p = await electronAPI.joinPath(root, '.aurora', 'memory', `${slug}.md`);
      if (!(await electronAPI.fileExists(p))) return ok({ name: slug, removed: false });
      await electronAPI.deleteFile(p);
      emit('project:memory-forgotten', { name: slug });
      return ok({ name: slug, removed: true });
    } catch (e) { return falhou(e, 'forget failed'); }
  },
};
