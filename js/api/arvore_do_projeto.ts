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

/**
 * Resolve a file the AI named to an absolute path inside the open project:
 * even when it passes just a basename or a partial nested path, and even when
 * casing differs (Windows is case-insensitive; a plain endsWith match is not).
 * Strategy, in order:
 *   1. the path as given (relative → joined to root; absolute → as-is) if it
 *      exists on disk;
 *   2. an exact relative-path match in the project tree (case-insensitive);
 *   3. a path that ENDS WITH the requested partial path ("Software/foo.cmm");
 *   4. a basename match anywhere in the tree (shortest path wins on ties).
 * Returns the absolute path string, or null if the file is nowhere in the
 * project. Shared by editor.openFile and project.readFile so both "find" a file
 * instead of erroring the moment a literal path miss happens.
 */
export async function acharArquivoNoProjeto(filePath: string | null | undefined, root: string | null | undefined): Promise<string | null> {
  if (!filePath || !root) return null;
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
  const direct = isAbsolute
    ? filePath
    : `${root}\\${String(filePath).replace(/^[\\/]+/, '').replace(/\//g, '\\')}`;

  // 1. Try the path as given first, cheapest, and the usual hit.
  try {
    await electronAPI.readFile(direct);
    return direct;
  } catch (_) { /* fall through to a project-wide search */ }

  // An absolute path that doesn't exist has nothing to search against.
  if (isAbsolute) return null;

  // 2-4. Walk the whole project tree and match by name, case-insensitively.
  const tree = await listarArquivosDoProjeto(root);
  if (!tree.ok || !Array.isArray(tree.data)) return null;
  const paths = tree.data;                       // relative, forward-slash
  const want = String(filePath).replace(/^[\\/]+/, '').replace(/\\/g, '/').toLowerCase();
  const wantBase = want.split('/').pop();

  let match = paths.find((p) => p.toLowerCase() === want)                       // exact rel path
    || paths.find((p) => p.toLowerCase().endsWith(`/${want}`));                 // partial nested path
  if (!match) {
    const byBase = paths.filter((p) => p.toLowerCase().split('/').pop() === wantBase);
    byBase.sort((a, b) => a.length - b.length);  // prefer the shallowest hit
    match = byBase[0];
  }
  if (!match) return null;
  return `${root}\\${match.replace(/\//g, '\\')}`;
}
