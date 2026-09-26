/**
 * abrir_referencia.ts: o clique num nome de arquivo da resposta da IA abre o
 * arquivo do projeto, na linha quando ela veio.
 *
 * A regra de para onde o nome aponta mora em file_ref.ts, que e pura e tem
 * teste; e regra de sandbox, entao precisa ter. Aqui fica a leitura do que ela
 * pede (os arquivos da arvore e a raiz do projeto) e o que fazer com a
 * resposta. Saiu do ai_assistant_manager.js (TODO 13.3).
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { showCardNotification } from '../ui/notification.js';
import { fileRefCandidates } from './file_ref.js';
import { aiPathIsText } from './chat_render.js';
import { ProjectStore } from '../project/project_store.js';

/** Os caminhos que um nome pode ser, do mais provavel ao menos. */
export function candidatosDaReferencia(ref: unknown): string[] {
  return fileRefCandidates(ref, {
    trackedFiles: window.projectTreeManager?.verilogFiles,
    projectRoot: ProjectStore.getProjectPath(),
  });
}

/** Abre o primeiro candidato que existe, na linha `line` se ela veio. */
export async function abrirReferencia(fileName: string, line?: number | null): Promise<void> {
  const tr = (k: string, p: Record<string, unknown>) => (window.t ? window.t(k, p) : null);
  let filePath: string | null = null;
  for (const cand of candidatosDaReferencia(fileName)) {
    try {
      if (await electronAPI.fileExists(cand)) { filePath = cand; break; }
    } catch (_) { /* try the next candidate */ }
  }
  if (!filePath) {
    showCardNotification(
      tr('notification.ai.fileNotFound', { name: fileName }) || `File not in project: ${fileName}`,
      'warning', 3000,
    );
    return;
  }
  try {
    const content = await electronAPI.readFile(filePath);
    const opts = (Number.isFinite(line) && (line as number) > 0)
      ? { revealPosition: { line: line as number, column: 1 } }
      : {};
    TabManager.addTab(filePath, content, opts);
  } catch (_e) {
    showCardNotification(
      tr('notification.ai.fileOpenError', { name: fileName }) || `Could not open ${fileName}`,
      'error', 3000,
    );
  }
}

/**
 * Um caminho absoluto clicado na conversa. Pergunta ao main o que ele e:
 * pasta abre no explorador do sistema; arquivo de texto ou codigo abre numa
 * aba de previa; qualquer outro (imagem, video, pdf) abre no programa padrao.
 */
export async function abrirCaminhoDoChat(rawPath: string | null | undefined): Promise<void> {
  if (!rawPath) return;
  let info: { isDirectory?: boolean } | null | undefined = null;
  try { info = await electronAPI?.getFileStats?.(rawPath); }
  catch (_) { info = null; }
  if (!info) {
    try { window.showNotification?.(`Path not found: ${rawPath}`, 'warning'); } catch (_) { /* ignore */ }
    return;
  }
  if (info.isDirectory) {
    electronAPI?.openFolder?.(rawPath);           // shell.openPath → Explorer
    return;
  }
  if (aiPathIsText(rawPath)) {
    try {
      const content = await electronAPI.readFile(rawPath);
      window.TabManager?.addTab?.(rawPath, content ?? '', { preview: true });
    } catch (_) {
      electronAPI?.openFolder?.(rawPath);         // fallback: default app
    }
  } else {
    electronAPI?.openFolder?.(rawPath);           // shell.openPath → default app
  }
}
