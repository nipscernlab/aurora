/**
 * conversao_na_abertura.ts: quando um projeto da estrutura de antes do yanc
 * v7.1 abre, perguntar se pode converter, converter e mostrar o que mudou.
 *
 * A regra (decidida em 13/10/2026): converter ao abrir, pedindo confirmacao
 * uma vez por projeto antes de mover arquivos da pessoa, e mostrar depois o
 * que foi movido. "Uma vez por projeto" quer dizer uma pergunta para o
 * projeto inteiro, e nao uma por arquivo ou por processador; quem disser
 * "agora nao" nao e perguntado de novo nesta sessao, e o projeto segue sem
 * compilar ate ser convertido.
 *
 * O que vai para onde, e a troca dos caminhos do .spf, moram em
 * estrutura_antiga.ts; aqui so a conversa e a gravacao.
 *
 * Compilado por `tsc` (npm run build:ts) num conversao_na_abertura.js ao lado,
 * e esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { showDialog } from '../ui/dialog_manager.js';
import { SpfStore } from './spf_store.js';
import { setAvailableProcessors } from './processor_list.js';
import { renomearProcessador } from './processadores_do_spf.js';
import { nomesDosProcessadores } from '../compilation/pastas_do_processador.js';
import {
  converter, inspecionar, mapaDosMovidos, remapearEstrutura, renomesSugeridos, tirarDasListas,
  type DiscoDaConversao, type EstruturaDoSpf, type RenomeSugerido, type ResultadoDaConversao,
} from './estrutura_antiga.js';

/** O resultado da conversao, e os renames que a pessoa aceitou e deram certo. */
export type ResultadoNaAbertura = ResultadoDaConversao & { renomeados: RenomeSugerido[] };

/** Quem renomeia um processador: o mesmo caminho do rename normal (main + .spf). */
export type Renomeador = (de: string, para: string) => Promise<{ success?: boolean } | null>;

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** Os projetos que ja recusaram nesta sessao, pela chave do .spf. */
const recusados = new Set<string>();

/** Para o teste: esquece as recusas. */
export function esquecerRecusas(): void {
  recusados.clear();
}

/** Texto para dentro do HTML do dialogo, que entra por innerHTML. */
function escapar(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A mensagem do dialogo: o texto e, embaixo, a lista, tudo escapado. */
export function mensagemComLista(texto: string, itens: readonly string[]): string {
  const lista = itens.length
    ? `<ul class="estrutura-antiga-lista">${itens.map((i) => `<li>${escapar(i)}</li>`).join('')}</ul>`
    : '';
  return `<p>${escapar(texto)}</p>${lista}`;
}

/** O caminho relativo ao projeto, para a lista do relatorio. */
function relativo(projeto: string, caminho: string): string {
  const p = projeto.replace(/\\/g, '/').replace(/\/+$/, '');
  const c = caminho.replace(/\\/g, '/');
  return c.toLowerCase().startsWith(`${p.toLowerCase()}/`) ? c.slice(p.length + 1) : c;
}

/** As linhas do relatorio depois da conversao. */
export function linhasDoRelatorio(projeto: string, r: ResultadoDaConversao): string[] {
  const linhas: string[] = r.movidos.map((m) => `${relativo(projeto, m.de)} → ${relativo(projeto, m.para)}`);
  for (const p of r.pulados) {
    linhas.push(tr('dialog.estruturaAntiga.pulado', { arquivo: relativo(projeto, p.de), motivo: p.motivo }));
  }
  for (const s of r.semPrname) {
    linhas.push(tr('dialog.estruturaAntiga.semPrname', { arquivo: relativo(projeto, s.arquivo), nome: s.nomeAntigo }));
  }
  for (const n of r.nomesInvalidos) {
    linhas.push(tr('dialog.estruturaAntiga.nomeInvalido', { nome: n }));
  }
  for (const d of r.pastasQueFicaram) {
    linhas.push(tr('dialog.estruturaAntiga.pastaFicou', { pasta: relativo(projeto, d) }));
  }
  // O que o yanc antigo gerou foi para a Lixeira (#211): uma linha so, porque
  // listar cada .mif e .asm afogaria o que a pessoa precisa ler.
  if (r.descartados?.length) {
    linhas.push(tr('dialog.estruturaAntiga.descartados', { n: r.descartados.length }));
  }
  return linhas;
}

/**
 * Pergunta e converte, se o projeto aberto ainda tem subpastas antigas.
 * Devolve o resultado da conversao, ou `null` quando nao havia o que converter
 * ou a pessoa recusou. Nunca lanca: uma falha aqui nao pode impedir o projeto
 * de abrir.
 */
export async function oferecerConversao(
  spfPath: string, projeto: string, processors: unknown,
  disco: DiscoDaConversao = electronAPI as unknown as DiscoDaConversao,
  renomear: Renomeador = renomearProcessador as Renomeador,
): Promise<ResultadoNaAbertura | null> {
  try {
    const chave = spfPath.replace(/\\/g, '/').toLowerCase();
    if (recusados.has(chave)) return null;
    const antigos = await inspecionar(projeto, nomesDosProcessadores(processors), disco);
    if (antigos.length === 0) return null;

    const escolha = await showDialog({
      title: tr('dialog.estruturaAntiga.title'),
      message: mensagemComLista(tr('dialog.estruturaAntiga.message'), antigos.map((p) => p.nome)),
      variant: 'warning',
      buttons: [
        { label: tr('dialog.estruturaAntiga.depois'), action: 'depois', type: 'cancel' },
        { label: tr('dialog.estruturaAntiga.converter'), action: 'converter', type: 'primary' },
      ],
    });
    if (escolha !== 'converter') {
      recusados.add(chave);
      return null;
    }

    const r = await converter(projeto, antigos, disco);
    const mapa = mapaDosMovidos(r);
    if (mapa.size) {
      await SpfStore.update(spfPath, (cfg) => {
        remapearEstrutura(cfg as unknown as EstruturaDoSpf, mapa);
        // O gerado que foi para a Lixeira sai das listas ate a proxima
        // compilacao o recriar (#211).
        tirarDasListas(cfg as unknown as EstruturaDoSpf, r.descartados.map((d) => d.para));
      });
    }

    // O rename que mantem o nome do modulo que o top-level instancia (o do
    // #PRNAME antigo), ou que troca um nome que nao serve mais de modulo.
    const sugestoes = renomesSugeridos(r, nomesDosProcessadores(processors));
    const relatorio = mensagemComLista(
      tr('dialog.estruturaAntiga.feito', { movidos: r.movidos.length }), linhasDoRelatorio(projeto, r));
    const escolhaDoRename = await showDialog({
      title: tr('dialog.estruturaAntiga.feitoTitle'),
      message: sugestoes.length
        ? relatorio + mensagemComLista(tr('dialog.estruturaAntiga.renomear'),
          sugestoes.map((s) => `${s.de} → ${s.para}`))
        : relatorio,
      variant: r.pulados.length || r.nomesInvalidos.length || sugestoes.length ? 'warning' : 'success',
      buttons: sugestoes.length
        ? [
          { label: tr('dialog.estruturaAntiga.manterNomes'), action: 'manter', type: 'cancel' },
          { label: tr('dialog.estruturaAntiga.renomearBotao'), action: 'renomear', type: 'primary' },
        ]
        : [{ label: tr('dialog.common.ok'), action: 'ok', type: 'primary' }],
    });

    const renomeados: RenomeSugerido[] = [];
    if (escolhaDoRename === 'renomear') {
      for (const s of sugestoes) {
        try {
          const resposta = await renomear(s.de, s.para);
          if (resposta && resposta.success) renomeados.push(s);
        } catch (e) {
          console.warn(`[estrutura antiga] nao renomeei ${s.de}:`, e);
        }
      }
      if (renomeados.length) {
        // A lista de processadores da janela foi semeada antes da conversao.
        const estrutura = await SpfStore.read(spfPath);
        setAvailableProcessors(estrutura.processors);
      }
    }
    return { ...r, renomeados };
  } catch (e) {
    console.warn('[estrutura antiga] a conversao nao terminou:', e);
    return null;
  }
}
