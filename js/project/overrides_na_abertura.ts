/**
 * overrides_na_abertura.ts: quando o projeto que abre traz no .spf overrides
 * que esta maquina ainda nao decidiu, mostrar cada um e perguntar se aplica.
 *
 * Ate a resposta, a compilacao roda sem eles (overrides_aprovados.ts). Aplicar
 * e Ignorar ficam gravados nesta maquina; Esc nao decide, e a pergunta volta
 * na proxima abertura. Um override que mude no .spf pergunta de novo.
 *
 * O conteudo vem do .spf, que pode ser de outra pessoa: cada linha entra no
 * dialogo escapada, pelo mesmo mensagemComLista da conversao na abertura.
 *
 * Compilado por `tsc` (npm run build:ts) num overrides_na_abertura.js ao lado,
 * e esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { showDialog } from '../ui/dialog_manager.js';
import { showCardNotification } from '../ui/notification.js';
import { SpfStore } from './spf_store.js';
import { mensagemComLista } from './conversao_na_abertura.js';
import { decidir, pendentes, type Decisao } from '../compilation/overrides_aprovados.js';
import type { CommandOverride } from '../compilation/command_spec.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** Uma linha da lista: o passo e o conteudo exato, sem o `scope`. */
export function linhaDoOverride(chave: string, override: CommandOverride): string {
  const { scope: _scope, ...conteudo } = override || ({} as CommandOverride);
  return `${chave}: ${JSON.stringify(conteudo)}`;
}

/**
 * Pergunta pelos overrides do .spf que esta maquina ainda nao decidiu.
 * Devolve a decisao, ou `null` quando nao havia o que perguntar ou a pessoa
 * fechou sem decidir. Nunca lanca: uma falha aqui nao impede o projeto de
 * abrir, e sem decisao nada se aplica.
 */
export async function perguntarSobreOverrides(spfPath: string, raizDoProjeto: string): Promise<Decisao | null> {
  try {
    const estrutura = await SpfStore.read(spfPath);
    const gravados = estrutura.commandOverrides;
    if (!gravados || typeof gravados !== 'object' || Array.isArray(gravados)) return null;
    const novos = pendentes(gravados as Record<string, CommandOverride>, raizDoProjeto);
    if (novos.length === 0) return null;

    const escolha = await showDialog({
      title: tr('dialog.overridesDoSpf.title'),
      message: mensagemComLista(tr('dialog.overridesDoSpf.message'), novos.map(([k, ov]) => linhaDoOverride(k, ov))),
      variant: 'warning',
      // Um clique fora sem querer nao decide (#209).
      fecharPorFora: false,
      buttons: [
        { label: tr('dialog.overridesDoSpf.ignorar'), action: 'ignorar', type: 'cancel' },
        { label: tr('dialog.overridesDoSpf.aplicar'), action: 'aplicar', type: 'primary' },
      ],
    });
    if (escolha !== 'aplicar' && escolha !== 'ignorar') {
      showCardNotification(tr('dialog.overridesDoSpf.adiada'), 'warning', 8000, 'AURORA');
      return null;
    }
    decidir(novos, escolha, raizDoProjeto);
    return escolha;
  } catch (e) {
    console.warn('[overrides] a pergunta da abertura nao terminou:', e);
    return null;
  }
}
