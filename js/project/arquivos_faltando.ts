/**
 * arquivos_faltando.ts: o relatorio `.aurora-missing-files.log` dos arquivos
 * que o .spf cita e que nao existem mais no disco.
 *
 * Saiu do js/project/project_manager.js (item 13.3 do TODO). O texto e
 * montado por uma funcao pura, `relatorioDeFaltantes`, e o resto so escreve,
 * abre como aba de previa e apaga quando nao falta mais nada.
 *
 * Compilado por `tsc` (npm run build:ts) num arquivos_faltando.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';

/** Um arquivo que o .spf cita e o disco nao tem, como a arvore o lista. */
export interface ArquivoFaltando {
  name: string;
  path: string;
  category?: string | null;
}

export const NOME_DO_RELATORIO = '.aurora-missing-files.log';

/**
 * O texto do relatorio: um cabecalho que explica o que fazer, e a lista
 * agrupada pela categoria (sintetizavel, testbench, ...), na ordem em que
 * cada categoria aparece.
 */
export function relatorioDeFaltantes(missing: readonly ArquivoFaltando[], spfPath: string | null | undefined, basePath: string, quando: string): string {
  const projectName = (spfPath || '').split(/[\\/]/).pop() || '(unknown)';

  const lines = [
    '# Aurora — relatorio de arquivos faltantes',
    '',
    `Gerado em: ${quando}`,
    `Projeto:   ${projectName}`,
    `Base path: ${basePath}`,
    '',
    '--------------------------------------------------------------------------------',
    'Estes paths estao listados no .spf do projeto, mas NAO existem no disco',
    '(foram movidos, renomeados fora do Aurora, ou deletados manualmente).',
    '',
    'O que fazer:',
    '  1. Restaure / recoloque o arquivo no caminho original abaixo, OU',
    '  2. Remova-o do projeto clicando direito na file tree -> Remove from tree.',
    '',
    'Este arquivo e regenerado a cada abertura do projeto — se nao houver',
    'arquivos faltantes na proxima vez, ele nao sera criado nem aberto.',
    '--------------------------------------------------------------------------------',
    '',
  ];

  const grouped = new Map<string, ArquivoFaltando[]>();
  for (const f of missing) {
    const cat = f.category || 'unknown';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(f);
  }
  for (const [cat, list] of grouped.entries()) {
    lines.push(`[${cat}] (${list.length})`);
    for (const f of list) {
      lines.push(`  - ${f.name}`);
      lines.push(`      ${f.path}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Escreve (sobrescrevendo) o relatorio na raiz do projeto e o abre como aba
 * de previa, que some com um clique noutro arquivo. No-op sem faltantes ou
 * sem raiz; falha de escrita propaga, e quem chama registra no console.
 */
export async function abrirRelatorioDeFaltantes(missing: readonly ArquivoFaltando[] | null | undefined, spfPath: string | null | undefined, basePath: string | null | undefined): Promise<void> {
  if (!Array.isArray(missing) || missing.length === 0) return;
  if (!basePath) return;
  const content = relatorioDeFaltantes(missing, spfPath, basePath, new Date().toLocaleString());
  const logPath = await electronAPI.joinPath(basePath, NOME_DO_RELATORIO);
  await electronAPI.writeFile(logPath, content);
  TabManager.addTab(logPath, content, { preview: true });
}

/**
 * Apaga o relatorio de uma abertura anterior quando nao falta mais nada, para
 * ele nao ficar grudado no projeto. Fecha a aba antes, senao o salvar ao sair
 * o recriaria.
 */
export async function apagarRelatorioDeFaltantes(basePath: string | null | undefined): Promise<void> {
  if (!basePath) return;
  const logPath = await electronAPI.joinPath(basePath, NOME_DO_RELATORIO);
  const exists = await electronAPI.fileExists?.(logPath);
  if (!exists) return;
  if (TabManager?.tabs?.has?.(logPath)) {
    try { await TabManager.closeTab?.(logPath); } catch (_) { /* best effort */ }
  }
  if (typeof electronAPI.deleteFile === 'function') {
    await electronAPI.deleteFile(logPath);
  }
}
