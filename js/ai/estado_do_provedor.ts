/**
 * estado_do_provedor.ts: a linha "a que estou conectado?" do popover de modelo
 * do painel de IA, para assinatura (CLI) e para provedor de API (chave).
 *
 * Os dois caminhos dao a mesma forma de resposta, estado e HTML, para a pessoa
 * ver um cracha uniforme qualquer que seja o jeito de autenticar. Saiu do
 * ai_assistant_manager.js (TODO 13.3), que so poe o resultado na tela.
 */

import { comandoDeLogin, formatPlanLabel } from './ai_metadata.js';
import type { EntradaDeProvedor, MetaDaAssinatura, MetaDoProvedor } from './ai_metadata.js';
import { escapeHtml } from './chat_render.js';

/** O estado da CLI de assinatura, como o main o responde. */
export interface EstadoDaCli {
  installed?: boolean;
  downloadable?: boolean;
  authed?: boolean;
  plan?: string;
  version?: string;
  /** O executavel que o main achou, quando ha um. */
  path?: string;
}

export interface LinhaDeEstado { state: 'on' | 'off' | 'warn'; html: string }

/** A linha de uma assinatura: conferindo, sem CLI, sem login, baixa no primeiro uso, ou pronta. */
export function estadoDaAssinatura(
  s: EstadoDaCli | null | undefined,
  sm: MetaDaAssinatura,
  meta: Partial<MetaDoProvedor>,
): LinhaDeEstado {
  let state: LinhaDeEstado['state'] = 'off';
  let icon = 'ph-x-circle';
  let title: string;
  let detail = '';
  // O detalhe vai escapado. O comando de login e a excecao: vai num <code>, e
  // por isso chega aqui ja em HTML, com o comando escapado dentro. Antes o
  // <code> ia no texto e aparecia escrito na tela.
  let detailHtml = '';

  if (!s) {
    title = `Checking ${sm.cliName}…`;
  } else if (!s.installed && !s.downloadable) {
    state = 'off'; icon = 'ph-x-circle';
    title = sm.notInstalled;
    detail = sm.installHint;
  } else if (!s.authed) {
    state = 'warn'; icon = 'ph-warning-circle';
    title = 'Not signed in';
    // #190: sem a CLI no disco, a primeira mensagem a baixa e devolve o
    // comando de login dela; com a CLI, o comando leva o caminho do executavel.
    if (!s.installed && sm.loginBaixaACli) {
      detail = `Send a message: Aurora downloads ${sm.cliName} first, then shows the sign-in command.`;
    } else {
      detailHtml = `Run <code>${escapeHtml(comandoDeLogin(sm, s.path))}</code> in a terminal, then re-check.`;
    }
  } else if (!s.installed) {
    // B12: signed in and downloadable, ready to use; the ~230 MB binary is
    // fetched on the first message (then this flips to the version detail).
    state = 'on'; icon = 'ph-check-circle';
    const plan = formatPlanLabel(s.plan) || 'SUBSCRIPTION';
    title = `${meta.label || sm.cliName} · ${plan}`;
    detail = 'Downloads on first message';
  } else {
    state = 'on'; icon = 'ph-check-circle';
    const plan = formatPlanLabel(s.plan) || 'SUBSCRIPTION';
    title = `${meta.label || sm.cliName} · ${plan}`;
    detail = s.version || sm.cliName;
  }

  return {
    state,
    html: `
      <div class="ai-cc-row">
        <i class="ph ${icon} ai-cc-icon" aria-hidden="true"></i>
        <span class="ai-cc-title">${title}</span>
        <button type="button" class="ai-cc-recheck" data-cc-recheck
                title="Re-check connection">
          <i class="ph ph-arrow-clockwise" aria-hidden="true"></i>
        </button>
      </div>
      ${detailHtml || detail ? `<p class="ai-cc-detail">${detailHtml || escapeHtml(detail)}</p>` : ''}`,
  };
}

/** A linha de um provedor de API: conectado com o modelo, ou sem chave. */
export function estadoDoProvedor(
  provider: string,
  meta: Partial<MetaDoProvedor>,
  entry: EntradaDeProvedor | null | undefined,
  configurado: boolean,
): LinhaDeEstado {
  let state: LinhaDeEstado['state'], icon: string, title: string, detail: string;
  if (configurado) {
    state = 'on';
    icon = 'ph-check-circle';
    title = `${meta.label || provider} · Connected`;
    const model = entry?.model || entry?.defaultModel || '';
    detail = model ? `Model: ${model}` : '';
  } else {
    state = 'off';
    icon = 'ph-x-circle';
    title = `${meta.label || provider} · Not configured`;
    detail = 'Add an API key in Settings → AI Assistant.';
  }
  return {
    state,
    html: `
      <div class="ai-cc-row">
        <i class="ph ${icon} ai-cc-icon" aria-hidden="true"></i>
        <span class="ai-cc-title">${escapeHtml(title)}</span>
      </div>
      ${detail ? `<p class="ai-cc-detail">${escapeHtml(detail)}</p>` : ''}`,
  };
}
