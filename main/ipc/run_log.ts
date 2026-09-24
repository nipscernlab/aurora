/**
 * run_log.ts: onde o registro de execucoes mora no disco.
 *
 * `<projeto>/.aurora/execucoes/<id>.json`, um arquivo por execucao. Dentro do
 * projeto, e nao no perfil do usuario, porque o registro so faz sentido ao lado
 * do que ele descreve: copiar o projeto para outra maquina leva o historico
 * junto, e apagar o projeto apaga o historico junto, que e o que qualquer um
 * espera.
 *
 * O NOME DO ARQUIVO E MONTADO AQUI, e nao aceito do renderer. O id vem de la,
 * mas passa por um filtro que so deixa passar o que o proprio gerador produz;
 * sem isso, um id com `..` escreveria fora da pasta. E a mesma razao pela qual
 * a pasta e derivada do caminho do projeto e nao recebida pronta.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from 'electron';
import log from 'electron-log';

import { podar } from '../../js/compilation/run_log.js';
import { ocultarPastaDeSistemaEm } from '../pastas_ocultas.js';

/** O resumo de uma execucao, como a lista mostra. */
interface ResumoDaExecucao {
  id: unknown;
  pedido: unknown;
  inicio: unknown;
  ms: unknown;
  ok: unknown;
  cancelada: boolean;
  passos: number;
}

const PASTA = path.join('.aurora', 'execucoes');
/** O mesmo formato que `idDe` produz: data, hora e o pedido. */
export const ID_VALIDO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[\w-]{1,32}$/;

export function pastaDe(projeto: unknown): string | null {
  if (!projeto || typeof projeto !== 'string' || !path.isAbsolute(projeto)) return null;
  return path.join(projeto, PASTA);
}

/**
 * Grava uma execucao e poda as antigas.
 */
export async function gravar(
  projeto: unknown,
  exec: ({ id?: string } & Record<string, unknown>) | null | undefined,
): Promise<{ ok: true; id: string | undefined } | { ok: false; erro: string }> {
  const dir = pastaDe(projeto);
  if (!dir || !exec || !ID_VALIDO.test(String(exec.id || ''))) {
    return { ok: false, erro: 'projeto ou id invalido' };
  }
  await fs.promises.mkdir(dir, { recursive: true });
  // A `.aurora` pode nascer aqui, antes de qualquer abertura de projeto
  // marca-la; ver main/pastas_ocultas.js.
  ocultarPastaDeSistemaEm(dir);
  await fs.promises.writeFile(
    path.join(dir, `${exec.id}.json`),
    JSON.stringify(exec, null, 2),
    'utf8',
  );

  // A poda e melhor esforco: falhar em apagar o velho nao pode fazer parecer
  // que a gravacao do novo falhou.
  try {
    const nomes = await fs.promises.readdir(dir);
    for (const velho of podar(nomes, 50)) {
      await fs.promises.unlink(path.join(dir, velho)).catch(() => {});
    }
  } catch (e) {
    log.warn('[run-log] poda falhou:', e);
  }
  return { ok: true, id: exec.id };
}

/**
 * As execucoes gravadas, da mais recente para a mais antiga, so o resumo.
 */
export async function listar(
  projeto: unknown,
): Promise<{ ok: boolean; erro?: string; execucoes: ResumoDaExecucao[] }> {
  const dir = pastaDe(projeto);
  if (!dir) return { ok: false, execucoes: [] };
  let nomes: string[] = [];
  try {
    nomes = (await fs.promises.readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch (e) {
    const erro = e as NodeJS.ErrnoException | null;
    if (erro && erro.code === 'ENOENT') return { ok: true, execucoes: [] };
    return { ok: false, erro: String(erro && erro.message), execucoes: [] };
  }
  const execucoes: ResumoDaExecucao[] = [];
  for (const nome of nomes.sort().reverse()) {
    try {
      const bruto = JSON.parse(await fs.promises.readFile(path.join(dir, nome), 'utf8'));
      execucoes.push({
        id: bruto.id,
        pedido: bruto.pedido,
        inicio: bruto.inicio,
        ms: bruto.ms ?? null,
        ok: bruto.ok,
        cancelada: !!bruto.cancelada,
        passos: Array.isArray(bruto.passos) ? bruto.passos.length : 0,
      });
    } catch (_) { /* arquivo corrompido nao derruba a listagem */ }
  }
  return { ok: true, execucoes };
}

/**
 * Uma execucao inteira, para a tela de detalhe.
 */
export async function ler(
  projeto: unknown,
  id: unknown,
): Promise<{ ok: true; execucao: unknown } | { ok: false; erro: string }> {
  const dir = pastaDe(projeto);
  if (!dir || !ID_VALIDO.test(String(id || ''))) return { ok: false, erro: 'id invalido' };
  try {
    return { ok: true, execucao: JSON.parse(await fs.promises.readFile(path.join(dir, `${id}.json`), 'utf8')) };
  } catch (e) {
    return { ok: false, erro: String(e && (e as Error).message) };
  }
}

export function register(): void {
  ipcMain.handle('runlog:gravar', (_e, projeto, exec) => gravar(projeto, exec));
  ipcMain.handle('runlog:listar', (_e, projeto) => listar(projeto));
  ipcMain.handle('runlog:ler', (_e, projeto, id) => ler(projeto, id));
}
