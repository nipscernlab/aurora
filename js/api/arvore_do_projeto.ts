/**
 * arvore_do_projeto.ts: todos os arquivos do projeto aberto, numa lista plana.
 *
 * Morava dentro do `AuroraAPI.project.getTree`, e o namespace `wave` chegava
 * nele por `projectNs.getTree`, o que prendia os dois no mesmo arquivo. Aqui
 * ele nao depende de namespace nenhum: `project.getTree` e a busca de layouts
 * do `wave` importam daqui.
 *
 * Compilado por `tsc` (npm run build:ts) num arvore_do_projeto.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { ok, err } from './api_core.js';

/** Ate quantas pastas abaixo da raiz a listagem desce. */
const MAX_DEPTH = 8;

/**
 * Todo arquivo sob `rootPath` (ou sob o projeto aberto), relativo a raiz e com
 * barra normal. Lista plana, para a IA escolher o caminho certo sem precisar
 * de uma chamada por nivel de pasta. Pasta que nao se le e pulada.
 */
export async function listarArquivosDoProjeto(rootPath?: string | null) {
  const root = rootPath || ProjectStore.getProjectPath();
  if (!root) return err('No project open');

  const relPaths: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    try {
      const entries = await electronAPI?.getFolderFiles?.(dir);
      if (!entries) return;
      for (const entry of entries) {
        const rel = entry.path.slice((root as string).length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
        if (entry.isDirectory) {
          await walk(entry.path, depth + 1);
        } else {
          relPaths.push(rel);
        }
      }
    } catch (_) { /* skip unreadable directories */ }
  }

  await walk(root, 0);
  return ok(relPaths);
}
