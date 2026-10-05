/**
 * processadores_do_spf.ts: criar, apagar e renomear processador, com a lista
 * de processadores do `.spf` gravada SO pelo renderer.
 *
 * POR QUE EXISTE
 * --------------
 * O `.spf` tem um escritor so, o SpfStore (spf_store.ts), que le, muda e grava
 * numa fila por arquivo. Os tres canais do processador no main
 * (`create-processor-project`, `delete-processor`, `rename-processor`) tambem
 * gravavam o `.spf`, cada um a partir de uma leitura propria, e a ultima
 * escrita apagava a outra. Pela API, com a IA criando processador e a arvore
 * se atualizando ao mesmo tempo, as duas coincidiam: o processador nascia no
 * disco e sumia do `.spf`, 1 vez em 5 a 7 no E2E `cpp-processor` (04/10/2026).
 *
 * Agora o main so mexe no disco (pastas, fonte, artefatos) e devolve o que
 * mudou; a lista vai para o `.spf` por aqui, pela fila do SpfStore. Quem avisa
 * a interface que a lista mudou continua sendo o main, quando recebe a
 * gravacao (`project:write-spf`), entao quem escuta `processor:created` e
 * `project:processors` le um `.spf` que ja tem a mudanca.
 *
 * As funcoes puras (o que muda na estrutura) ficam separadas das que falam
 * com a ponte, e sao o que os testes exercitam primeiro.
 */

import { electronAPI } from '../app/electron_api.js';
import { SpfStore, type SpfStructure } from './spf_store.js';

/** Uma entrada da lista: o nome, ou um objeto com o nome e a config. */
type EntradaDaLista = string | { name?: string; [k: string]: unknown };

const nomeDe = (p: unknown): string | undefined =>
  typeof p === 'string' ? p : (p as { name?: string } | null)?.name;

// Sempre uma copia: um `.spf` sem lista recebe do SpfStore o array dos
// STRUCTURE_DEFAULTS, que e um so para todos, e mexer nele no lugar sujaria o
// padrao de todo `.spf` lido depois.
const listaDe = (estrutura: SpfStructure): EntradaDaLista[] =>
  [...(Array.isArray(estrutura.processors) ? estrutura.processors : [])] as EntradaDaLista[];

/**
 * Acrescenta o processador, sem duplicar (o nome compara sem caixa). Bugs
 * antigos chegaram a acumular o mesmo nome varias vezes no `.spf`.
 */
export function acrescentarNaLista(estrutura: SpfStructure, entrada: { name: string; language?: string }): void {
  const lista = listaDe(estrutura);
  const alvo = entrada.name.toLowerCase();
  if (!lista.some((p) => nomeDe(p)?.toLowerCase() === alvo)) lista.push({ ...entrada });
  estrutura.processors = lista as SpfStructure['processors'];
}

/** Tira o processador da lista, pelo nome exato. */
export function tirarDaLista(estrutura: SpfStructure, nome: string): void {
  estrutura.processors = listaDe(estrutura).filter((p) => nomeDe(p) !== nome) as SpfStructure['processors'];
}

/**
 * O caminho de um arquivo depois de a pasta do processador mudar de nome.
 *
 * So mexe no que esta dentro de `<projeto>/<velho>`. Os artefatos nomeados
 * pelo processador (`<velho>.v`, `<velho>_tb.v`, `.sv`, `.asm`, `.cmm`, `.cpp`)
 * trocam de nome junto; arquivo que a pessoa nomeou acompanha a pasta e mantem
 * o nome. Os caminhos chegam absolutos pelo SpfStore, com o separador que
 * tiverem. Substitui o remapProcessorPath que o main aplicava sobre o `.spf`
 * cru, onde o SpfStore guarda relativo o que esta dentro do projeto, e por
 * isso nada era remapeado.
 */
export function caminhoRenomeado(caminho: string, projeto: string, velho: string, novo: string): string {
  if (!caminho || typeof caminho !== 'string') return caminho;
  const sep = caminho.includes('\\') ? '\\' : '/';
  const barra = (s: string) => s.replace(/[\\/]+/g, '/');
  const pastaVelha = `${barra(projeto).replace(/\/+$/, '')}/${velho}`;
  const atual = barra(caminho);
  const baixo = atual.toLowerCase();
  const velhaBaixo = pastaVelha.toLowerCase();
  if (baixo !== velhaBaixo && !baixo.startsWith(`${velhaBaixo}/`)) return caminho;

  const resto = atual.slice(pastaVelha.length);
  const fim = resto.lastIndexOf('/');
  const pasta = `${barra(projeto).replace(/\/+$/, '')}/${novo}${fim > 0 ? resto.slice(0, fim) : ''}`;
  const base = fim >= 0 ? resto.slice(fim + 1) : '';
  const escapado = velho.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trocado = base.replace(
    new RegExp(`^${escapado}(_tb)?(\\.v|\\.sv|\\.asm|\\.cmm|\\.cpp)$`, 'i'),
    (_m, tb: string | undefined, ext: string) => `${novo}${tb || ''}${ext}`,
  );
  return (base ? `${pasta}/${trocado}` : pasta).replace(/\//g, sep);
}

/**
 * Renomeia o processador no `.spf`: a entrada (a config dele vai junto) e todo
 * caminho guardado que estava dentro da pasta velha.
 */
export function renomearNaLista(
  estrutura: SpfStructure, projeto: string, velho: string, novo: string,
): void {
  const lista = listaDe(estrutura);
  const i = lista.findIndex((p) => nomeDe(p)?.toLowerCase() === velho.toLowerCase());
  if (i >= 0) {
    const atual = lista[i];
    lista[i] = typeof atual === 'string' ? { name: novo } : { ...atual, name: novo };
  }
  estrutura.processors = lista as SpfStructure['processors'];

  const mover = (c: string) => caminhoRenomeado(c, projeto, velho, novo);
  estrutura.topLevelFile = mover(estrutura.topLevelFile);
  estrutura.testbenchFile = mover(estrutura.testbenchFile);
  for (const chave of ['synthesizableFiles', 'testbenchFiles'] as const) {
    const arquivos = Array.isArray(estrutura[chave]) ? estrutura[chave] : [];
    for (const f of arquivos) {
      if (!f || typeof f !== 'object' || !f.path) continue;
      const novoCaminho = mover(f.path);
      if (novoCaminho === f.path) continue;
      f.path = novoCaminho;
      f.name = novoCaminho.split(/[\\/]/).pop();
    }
  }
}

// ---- pela ponte --------------------------------------------------------------

type RespostaDoMain = { success?: boolean; message?: string; spfPath?: string; [k: string]: unknown } | null;

/**
 * Cria o processador: o main faz as pastas e o fonte, e a entrada entra no
 * `.spf` por aqui. Devolve a resposta do main.
 */
export async function criarProcessador(formData: Record<string, unknown>) {
  const r = await electronAPI.createProcessorProject(formData) as RespostaDoMain & {
    success: boolean; path?: string; entrada?: { name: string; language?: string };
  };
  if (r && r.success && r.spfPath && r.entrada) {
    const entrada = r.entrada;
    await SpfStore.update(r.spfPath, (estrutura) => acrescentarNaLista(estrutura, entrada));
  }
  return r;
}

/** Apaga o processador: o main tira a pasta, e a entrada sai do `.spf` por aqui. */
export async function apagarProcessador(nome: string) {
  const r = await electronAPI.deleteProcessor(nome) as RespostaDoMain & { name?: string };
  if (r && r.success && r.spfPath && r.name) {
    const exato = r.name;
    await SpfStore.update(r.spfPath, (estrutura) => tirarDaLista(estrutura, exato));
  }
  return r;
}

/** Renomeia o processador: o main move a pasta e os arquivos, e o `.spf` muda por aqui. */
export async function renomearProcessador(velho: string, novo: string) {
  const renomear = electronAPI.renameProcessor as NonNullable<typeof electronAPI.renameProcessor>;
  const r = await renomear(velho, novo) as RespostaDoMain & {
    oldName?: string; newName?: string; oldDir?: string; newDir?: string; projectDir?: string;
  };
  if (r && r.success && r.spfPath && r.projectDir && r.oldName && r.newName) {
    const { projectDir, oldName, newName } = r;
    await SpfStore.update(r.spfPath, (estrutura) => renomearNaLista(estrutura, projectDir, oldName, newName));
  }
  return r;
}
