/**
 * processadores_ns.ts: os processadores do projeto, parte do namespace
 * `AuroraAPI.project` (listar, criar, apagar, renomear, ler e gravar a
 * config de simulacao).
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO), como o memorias_ns.ts. O
 * projeto e o .spf vem do ProjectStore e do SpfStore importados, e nao de
 * window.
 *
 * Compilado por `tsc` (npm run build:ts) num processadores_ns.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { motivoDe } from '../app/api_reply.js';
import { TabManager } from '../tabs/tab_manager.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { configComTempo } from '../project/processor_sim_config.js';
import { parseProcessorHeader } from '../compilation/processor_header.js';
import { resolveProcessorSource, type EntradaDeProcessador } from '../compilation/processor_source.js';
import { processorConfigPanel } from '../processors/processor_config_panel.js';
import { ok, err, emit } from './api_core.js';
import { arquivosAbertos, atualizarArvore, fecharEmTodoLugar } from './abas_e_arvore.js';

const falhou = (e: unknown, padrao: string) => err((e as Error | null)?.message || padrao);

type EntradaDoSpf = string | (EntradaDeProcessador & Record<string, unknown>);

export const processadoresDoProjeto = {
  /** Processors of the open project (names + per-processor config). */
  async listProcessors() {
    const root = ProjectStore.getProjectPath();
    if (!root) return err('No project open');
    try {
      const procs = await electronAPI.getAvailableProcessors(root);
      return ok(procs || []);
    } catch (e) { return falhou(e, 'listProcessors failed'); }
  },

  /**
   * Generate a processor in the open project.
   * `config`: { processorName, language, nBits, nbMantissa, nbExponent,
   *             dataStackSize, instructionStackSize, inputPorts,
   *             outputPorts, gain }
   *
   * `language` e 'cmm' (o padrao, e o que todo projeto de hoje tem) ou
   * 'cpp'. Em C++ so o nome e as duas contagens de porta viram fonte, como
   * `#pragma yanc prname/nuioin/nuioou`; os outros campos numericos sao
   * ignorados, porque o cppcomp assume o float de precisao simples sozinho.
   * A linguagem tambem vai para a entrada do processador no .spf, e e ela
   * que tira a ambiguidade quando ha um .cmm e um .cpp com o mesmo nome.
   */
  async createProcessor(config: { processorName?: string; [k: string]: unknown } | null | undefined) {
    const root = ProjectStore.getProjectPath();
    if (!root) return err('No project open');
    if (!config || !config.processorName) return err('processorName required');
    const name = config.processorName;
    try {
      // Anti-duplicata pela FILE TREE (a pasta real no disco), nao so o .spf:
      // se a pasta <root>/<name> existe, e um processador REAL ja feito:
      // bloqueia, NAO duplica. Se o nome so consta no .spf mas a pasta sumiu
      // (referencia "morta"/processador morto), deixa criar (revive a entrada).
      const procDir = await electronAPI.joinPath(root, name);
      if (await electronAPI.pathExists(procDir)) {
        return err(`Processor "${name}" already exists on disk (folder ${name}/). `
          + 'Pick a different name, or delete/rename the existing processor first.');
      }
      // O nome esta no .spf mas sem pasta? Entao a criacao revive uma referencia
      // morta, sinaliza isso na resposta (informa o usuario, sem bloquear).
      let revivedDanglingReference = false;
      try {
        const procs = await electronAPI.getAvailableProcessors(root);
        revivedDanglingReference = (Array.isArray(procs) ? procs : [])
          .map((p) => (typeof p === 'string' ? p : p && p.name))
          .some((n) => typeof n === 'string' && n.toLowerCase() === name.toLowerCase());
      } catch (_) { /* lista indisponivel — segue criando normalmente */ }

      const r = await electronAPI.createProcessorProject({
        projectLocation: root,
        ...config,
      });
      if (r && r.success) {
        await atualizarArvore();
        emit('project:processor-created', { name });
        return ok({ name, revivedDanglingReference });
      }
      return err((r && r.message) || 'createProcessor failed');
    } catch (e) { return falhou(e, 'createProcessor failed'); }
  },

  /**
   * Delete a processor from the open project. Drives the existing
   * `delete-processor` IPC which removes the processor's working
   * directory and prunes its SPF entry, then re-broadcasts the
   * processors list to the renderer (`project:processors` event).
   */
  async deleteProcessor(processorName: string | null | undefined) {
    if (!processorName) return err('processorName required');
    if (typeof electronAPI?.deleteProcessor !== 'function') {
      return err('delete-processor IPC unavailable');
    }
    try {
      const r = await electronAPI.deleteProcessor(processorName);
      if (r && r.success === false) return err(motivoDe(r, 'deleteProcessor failed'));
      await atualizarArvore();
      emit('project:processor-deleted', { processorName });
      return ok({ processorName });
    } catch (e) {
      return falhou(e, 'deleteProcessor failed');
    }
  },

  /**
   * Rename a processor everywhere it matters: the working directory, the
   * .cmm file, the `#PRNAME` directive, the auto-generated build artifacts
   * and every .spf reference. The main process does the on-disk + .spf work
   * (see the `rename-processor` IPC); here we additionally re-point any open
   * editor tabs that lived under the old folder so the user never ends up
   * staring at a tab whose file just moved.
   *
   * Only SAPHO-internal files are renamed. Custom user toplevels/testbenches
   * at the project root are left untouched, rename those with rename_file.
   */
  async renameProcessor({ processorName, newName }: { processorName?: string; newName?: string } = {}) {
    const oldNm = String(processorName || '').trim();
    const newNm = String(newName || '').trim();
    if (!oldNm) return err('processorName required');
    if (!newNm) return err('newName required');
    if (/[^A-Za-z0-9_-]/.test(newNm)) {
      return err('newName may only contain letters, numbers, _ and -');
    }
    const root = ProjectStore.getProjectPath();
    if (!root) return err('No project open');
    if (typeof electronAPI?.renameProcessor !== 'function') {
      return err('rename-processor IPC unavailable');
    }

    const sep = root.includes('\\') ? '\\' : '/';
    const norm = (p: string) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const oldDirNorm = norm(`${root}${sep}${oldNm}`);
    const isUnderOld = (p: string) => {
      const n = norm(p);
      return n === oldDirNorm || n.startsWith(oldDirNorm + '/');
    };

    // Persist unsaved edits in files that are about to move so the rename
    // doesn't strand them on a path that no longer exists.
    try { await TabManager.saveAllFiles(); } catch (_) { /* best-effort */ }

    // Snapshot which open files live under the old processor folder.
    const openUnderOld = arquivosAbertos().filter(isUnderOld);

    let r;
    try { r = await electronAPI.renameProcessor(oldNm, newNm); }
    catch (e) { return falhou(e, 'renameProcessor failed'); }
    if (r && r.success === false) return err(motivoDe(r, 'renameProcessor failed'));

    const realOld = r?.oldName || oldNm;
    const realNew = r?.newName || newNm;
    const oldDir = r?.oldDir || `${root}${sep}${realOld}`;
    const newDir = r?.newDir || `${root}${sep}${realNew}`;
    const escOld = realOld.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const artifactRe = new RegExp(`([\\\\/])${escOld}(_tb)?(\\.v|\\.sv|\\.asm|\\.cmm)$`, 'i');
    const remap = (p: string) => {
      const np = newDir + p.slice(oldDir.length);
      return np.replace(artifactRe, (_m, slash, tb, ext) => `${slash}${realNew}${tb || ''}${ext}`);
    };

    // Re-point open tabs: the old paths no longer exist on disk.
    let reopenCmm: string | null = null;
    for (const oldPath of openUnderOld) {
      if (/\.cmm$/i.test(oldPath)) reopenCmm = remap(oldPath);
      await fecharEmTodoLugar(oldPath);
    }
    if (reopenCmm) {
      try {
        const content = await electronAPI.readFile(reopenCmm);
        TabManager.addTab(reopenCmm, content);
      } catch (_) { /* the .cmm may not exist; leave it */ }
    }

    // The rename released the project's directory watcher so Windows would let
    // the processor folder move. Re-establish it on the (unchanged) project
    // root, main creates a fresh chokidar since releaseWatchersUnder dropped
    // the entry, so file-system changes are detected again, no reopen needed.
    try { await electronAPI.watchDirectory?.(ProjectStore.getProjectPath()); }
    catch (_) { /* best-effort; a project reopen would also restore it */ }

    await atualizarArvore();
    emit('project:processor-renamed', { oldName: realOld, newName: realNew });
    return ok({ oldName: realOld, newName: realNew });
  },

  /**
   * Read the per-processor simulation config (clk in MHz, numClocks,
   * showArrays). The returned `simTime_us = numClocks / clk` is what
   * Aurora bakes into the testbench's `$finish` line.
   * Omit `processorName` to return the config of every processor.
   */
  async getProcessorConfig(processorName?: string | null) {
    const spfPath = ProjectStore.getSpfPath();
    if (!spfPath) return err('No project open');
    try {
      const structure = await SpfStore.read(spfPath);
      const procs = (Array.isArray(structure.processors) ? structure.processors : []) as EntradaDoSpf[];
      const project = ProjectStore.getProjectPath();
      const all = await Promise.all(procs.map(async (p) => {
        const name = typeof p === 'string' ? p : p?.name;
        const raw = (typeof p === 'object' && p) ? p : {};
        const cfg: Record<string, unknown> & { name: string | undefined } = { name, ...configComTempo(p) };
        // Also surface the header directives (NUBITS / NBMANT / NBEXPO …) for
        // the named processor, same enrichment the Verilog flow uses. Le as
        // duas linguagens: `#NUBITS 32` no C+- e `#pragma yanc nubits 32` no
        // C++, com a chave saindo em maiuscula nas duas.
        if (project && name) {
          try {
            const { language, sourceFile } = resolveProcessorSource(
              typeof p === 'string' ? { name } : raw as EntradaDeProcessador,
            );
            const fonte = await electronAPI.joinPath(project, name, 'Software', sourceFile);
            cfg.header = parseProcessorHeader(await electronAPI.readFile(fonte), language);
          } catch (_) { /* fonte ausente — tudo bem */ }
        }
        return cfg;
      }));
      if (processorName) {
        const hit = all.find((p) => p.name === processorName);
        return hit ? ok(hit) : err(`unknown processor: ${processorName}`);
      }
      return ok(all);
    } catch (e) { return falhou(e, 'getProcessorConfig failed'); }
  },

  /**
   * Update the per-processor sim config. Any of `clk` / `numClocks` /
   * `showArrays` may be passed; omitted fields keep their current value.
   * Persisted into `structure.processors[i]` of the .spf via SpfStore.update
   * so the panel and status bar update automatically (aurora:spf-changed).
   */
  async setProcessorConfig({ processorName, clk, numClocks, showArrays }: { processorName?: string; clk?: unknown; numClocks?: unknown; showArrays?: unknown } = {}) {
    if (!processorName) return err('processorName required');
    const spfPath = ProjectStore.getSpfPath();
    if (!spfPath) return err('No project open');
    const patch: { clk?: number; numClocks?: number; showArrays?: boolean } = {};
    if (clk !== undefined) {
      const n = Number(clk);
      if (!Number.isFinite(n) || n <= 0) return err('clk must be a positive number (MHz)');
      patch.clk = n;
    }
    if (numClocks !== undefined) {
      const n = Number(numClocks);
      if (!Number.isFinite(n) || n <= 0) return err('numClocks must be a positive integer');
      patch.numClocks = Math.round(n);
    }
    if (showArrays !== undefined) patch.showArrays = !!showArrays;
    if (!Object.keys(patch).length) return err('nothing to update (pass clk, numClocks, or showArrays)');
    let foundProc = false;
    let finalCfg: Record<string, unknown> | null = null;
    try {
      await SpfStore.update(spfPath, (structure) => {
        const procs = (Array.isArray(structure.processors) ? structure.processors : []) as EntradaDoSpf[];
        structure.processors = procs.map((p) => {
          const name = typeof p === 'string' ? p : p?.name;
          if (name !== processorName) {
            return typeof p === 'string' ? { name: p } : p;
          }
          foundProc = true;
          const prev = typeof p === 'object' && p ? p : { name };
          const next = { ...prev, name, ...patch };
          finalCfg = { name, ...configComTempo(next) };
          return next;
        }) as typeof structure.processors;
      });
      if (!foundProc) return err(`processor not in this project: ${processorName}`);
      // Refresh the panel popover so any open UI reflects the change.
      processorConfigPanel.refresh();
      emit('project:processor-config-changed', { processorName, ...patch });
      return ok(finalCfg);
    } catch (e) { return falhou(e, 'setProcessorConfig failed'); }
  },
};
