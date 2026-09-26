/**
 * exportar_log.ts: o botao "Exportar log" dos terminais.
 *
 * Grava TODOS os terminais num arquivo de texto, e nao so o que esta na frente:
 * quem manda um relato de defeito precisa do que cada etapa disse. Cartao
 * agrupado vira uma linha por mensagem, com o horario do cartao, para o
 * arquivo ser pesquisavel. Saiu do terminal_module.js (TODO 13.3).
 *
 * Layout:
 *   # Aurora terminal log export
 *   # ... metadata ...
 *
 *   ===== TCMM =====
 *   <stamp> [LEVEL] line...
 */

import { electronAPI } from '../app/electron_api.js';
import { showCardNotification } from '../ui/notification.js';
import { tr } from './texto_do_terminal.js';

/** `YYYY-MM-DD_HH-mm-ss`, sem dois-pontos nem barra, para ir no nome do arquivo. */
export function carimboParaArquivo(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** O texto de cada terminal, quantas entradas ao todo e quais terminais tinham alguma. */
export function textoDoLog(terminais: Record<string, Element | null | undefined>):
  { secoes: string[]; total: number; comConteudo: string[] } {
  const secoes: string[] = [];
  let total = 0;
  const comConteudo: string[] = [];

  Object.entries(terminais).forEach(([terminalId, terminal]) => {
    if (!terminal) return;
    const entries = terminal.querySelectorAll('.log-entry');
    if (entries.length === 0) {
      secoes.push(`===== ${terminalId.toUpperCase()} =====\n(empty)\n`);
      return;
    }
    comConteudo.push(terminalId);
    total += entries.length;

    const sectionLines = [`===== ${terminalId.toUpperCase()} =====`];
    entries.forEach((entry) => {
      const stampEl = entry.querySelector(':scope > .timestamp');
      const stamp = stampEl ? (stampEl.textContent as string).trim() : '';
      const type = entry.classList.contains('error')   ? 'ERROR'
                 : entry.classList.contains('warning') ? 'WARN '
                 : entry.classList.contains('success') ? 'OK   '
                 : entry.classList.contains('info')    ? 'INFO '
                 : entry.classList.contains('tips')    ? 'TIP  '
                 : '     ';

      const grouped = entry.querySelectorAll('.grouped-message');
      if (grouped.length > 0) {
        grouped.forEach((g) => {
          sectionLines.push(`${stamp} [${type}] ${(g.textContent as string).replace(/\s+/g, ' ').trim()}`);
        });
      } else {
        const body = entry.querySelector('.message-content') || entry;
        const text = (body === entry && stampEl)
          ? (entry.textContent as string).replace(stampEl.textContent as string, '')
          : (body.textContent as string);
        sectionLines.push(`${stamp} [${type}] ${text.replace(/\s+/g, ' ').trim()}`);
      }
    });
    secoes.push(sectionLines.join('\n') + '\n');
  });

  return { secoes, total, comConteudo };
}

/** Monta o texto, pergunta onde gravar e avisa se deu certo. */
export async function exportarLog(terminais: Record<string, Element | null | undefined>): Promise<void> {
  const { secoes, total, comConteudo } = textoDoLog(terminais);

  if (total === 0) {
    showCardNotification('All terminals are empty — nothing to export.', 'info', 3500);
    return;
  }

  const header = [
    `# Aurora terminal log export`,
    `# Exported: ${new Date().toISOString()}`,
    `# Terminals with content: ${comConteudo.join(', ') || '(none)'}`,
    `# Total entries: ${total}`,
    '',
  ].join('\n');
  const body = secoes.join('\n');

  const defaultName = `aurora-log-all-${carimboParaArquivo()}.txt`;

  try {
    const api = electronAPI;
    if (!api?.showSaveDialog || !api?.writeFile) {
      showCardNotification('Export not available in this build.', 'error', 4000);
      return;
    }
    const result = await api.showSaveDialog({
      title: tr('terminal.exportAllTitle', 'Export terminal log (all terminals)'),
      defaultPath: defaultName,
      filters: [
        { name: 'Plain text', extensions: ['txt', 'log'] },
        { name: 'All files',  extensions: ['*'] },
      ],
    });
    if (!result || result.canceled || !result.filePath) {
      // User dismissed the dialog, silent, not an error.
      return;
    }

    const writeResult = await api.writeFile(result.filePath, header + body) as unknown;
    const r = writeResult as { success?: boolean; error?: string; message?: string } | boolean | undefined;
    const ok = r === true
            || (typeof r === 'object' && r?.success === true)
            || r === undefined; // ipc handlers that resolve to void mean success
    if (ok) {
      const fileName = String(result.filePath).split(/[\\/]/).pop();
      showCardNotification(
        `Exported ${total} entries from ${comConteudo.length} terminal(s) to ${fileName}.`,
        'success', 4500, 'Export complete',
      );
    } else {
      const o = (typeof r === 'object' && r) ? r : null;
      const msg = o?.error || o?.message || 'Write failed.';
      showCardNotification(`Could not export the log: ${msg}`, 'error', 5000);
    }
  } catch (err) {
    console.error('exportCurrentLog failed:', err);
    showCardNotification(`Could not export the log: ${(err as { message?: string })?.message || err}`, 'error', 5000);
  }
}
