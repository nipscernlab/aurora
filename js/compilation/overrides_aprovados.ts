/**
 * overrides_aprovados.ts: quais overrides gravados no .spf esta maquina
 * aceitou aplicar.
 *
 * Um override persistido viaja com o projeto. Quando o .spf vem de outra
 * pessoa, os overrides dele sao comandos que ela escolheu, e um argumento a
 * mais pode fazer a ferramenta rodar outro programa. Por isso a compilacao so
 * aplica o override que foi aceito AQUI: ao abrir o projeto, a AURORA mostra
 * os que ainda nao foram decididos e pergunta (js/project/overrides_na_abertura.ts).
 *
 * A decisao vale por entrada (o passo e o conteudo dele), e nao pelo .spf
 * inteiro: um override novo, ou um que mudou, pergunta de novo, e os que ja
 * foram aceitos continuam valendo. O que esta propria maquina grava (a pessoa
 * pela API, a IA pela ferramenta, que ja passou pela permissao) entra aceito.
 *
 * A raiz do projeto sai da assinatura: mover a pasta reescreve os caminhos
 * dos overrides (main/ipc/project.ts) e nao deve fazer perguntar de novo.
 *
 * Guardado no localStorage da AURORA, que e desta maquina e deste usuario.
 *
 * Compilado por `tsc` (npm run build:ts) num overrides_aprovados.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import type { CommandOverride } from './command_spec.js';

/** O que a pessoa respondeu para um override. */
export type Decisao = 'aplicar' | 'ignorar';

/** Um override do .spf: a chave (`passo` ou `passo:processador`) e o conteudo. */
export type EntradaDeOverride = [string, CommandOverride];

export const CHAVE_DAS_DECISOES = 'aurora.overrides.decisoes';

/** Barra normal e sem barra no fim, para comparar caminhos. */
function semBarraInvertida(caminho: string): string {
  return caminho.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** O valor com as chaves em ordem e a raiz do projeto trocada por um marcador. */
function canonico(valor: unknown, raiz: string | null): unknown {
  if (Array.isArray(valor)) return valor.map((v) => canonico(v, raiz));
  if (valor && typeof valor === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(valor).sort()) out[k] = canonico((valor as Record<string, unknown>)[k], raiz);
    return out;
  }
  if (typeof valor === 'string' && raiz) {
    const v = semBarraInvertida(valor);
    if (v.toLowerCase() === raiz.toLowerCase() || v.toLowerCase().startsWith(`${raiz.toLowerCase()}/`)) {
      return `<projeto>${v.slice(raiz.length)}`;
    }
  }
  return valor;
}

/**
 * A identidade de um override para a decisao: a chave e o conteudo, sem o
 * `scope` (que e so de onde ele veio) e sem a raiz do projeto.
 */
export function assinatura(chave: string, override: CommandOverride, raizDoProjeto: string | null): string {
  const { scope: _scope, ...conteudo } = override || ({} as CommandOverride);
  const raiz = raizDoProjeto ? semBarraInvertida(raizDoProjeto) : null;
  return `${chave}\n${JSON.stringify(canonico(conteudo, raiz))}`;
}

function lerDecisoes(): Record<string, Decisao> {
  try {
    const bruto = localStorage.getItem(CHAVE_DAS_DECISOES);
    const lido: unknown = bruto ? JSON.parse(bruto) : {};
    return lido && typeof lido === 'object' && !Array.isArray(lido) ? (lido as Record<string, Decisao>) : {};
  } catch (_) {
    return {};
  }
}

function gravarDecisoes(decisoes: Record<string, Decisao>): void {
  try {
    localStorage.setItem(CHAVE_DAS_DECISOES, JSON.stringify(decisoes));
  } catch (e) {
    console.warn('[overrides] nao gravei a decisao:', e);
  }
}

/** O que foi decidido para este override nesta maquina, ou `null`. */
export function decisaoDe(chave: string, override: CommandOverride, raizDoProjeto: string | null): Decisao | null {
  const d = lerDecisoes()[assinatura(chave, override, raizDoProjeto)];
  return d === 'aplicar' || d === 'ignorar' ? d : null;
}

/** Grava a mesma decisao para cada entrada. */
export function decidir(entradas: readonly EntradaDeOverride[], decisao: Decisao, raizDoProjeto: string | null): void {
  if (!entradas.length) return;
  const decisoes = lerDecisoes();
  for (const [chave, ov] of entradas) decisoes[assinatura(chave, ov, raizDoProjeto)] = decisao;
  gravarDecisoes(decisoes);
}

/** So os overrides aceitos nesta maquina: os que a compilacao aplica. */
export function aceitos(
  mapa: Record<string, CommandOverride>, raizDoProjeto: string | null,
): Record<string, CommandOverride> {
  const decisoes = lerDecisoes();
  const out: Record<string, CommandOverride> = {};
  for (const [chave, ov] of Object.entries(mapa)) {
    if (decisoes[assinatura(chave, ov, raizDoProjeto)] === 'aplicar') out[chave] = ov;
  }
  return out;
}

/** Os overrides que ainda nao foram decididos nesta maquina. */
export function pendentes(
  mapa: Record<string, CommandOverride>, raizDoProjeto: string | null,
): EntradaDeOverride[] {
  const decisoes = lerDecisoes();
  return Object.entries(mapa).filter(([chave, ov]) => !decisoes[assinatura(chave, ov, raizDoProjeto)]);
}
