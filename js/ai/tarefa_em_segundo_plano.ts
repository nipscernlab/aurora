/**
 * tarefa_em_segundo_plano.ts: a compilacao que a assistente manda correr solta.
 *
 * O aurora_api chama `runInBackground`, a tarefa comeca e a funcao devolve na
 * hora, para o turno atual poder terminar. Quando a tarefa acaba, a assistente
 * continua sozinha (autoContinue) com o desfecho: passou, falhou, foi cancelada
 * ou lancou. Um chip na conversa mostra o estado enquanto isso.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3). O painel continua dono da
 * conversa e do turno autonomo; aqui fica a tarefa e o chip.
 */

import { motivoDe } from '../app/api_reply.js';

/** O que a tarefa le e chama do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDaTarefa {
  currentChatId: string | null;
  messagesEl: HTMLElement;
  scrollToBottom(): void;
  autoContinue(content: string, opcoes?: { label?: string; operacao?: string | null }): void;
}

type EstadoDaTarefa = 'running' | 'done' | 'failed';

/** O pedido, como chega da ferramenta run_in_background. */
export interface PedidoDeTarefa { task?: string; step?: string; note?: string }

/**
 * Comeca a tarefa e devolve na hora. A conversa de origem fica presa: se a
 * pessoa trocar de conversa antes de a tarefa acabar, o resultado NAO entra na
 * nova.
 */
export function correrEmSegundoPlano(
  p: PainelDaTarefa,
  { task, step, note }: PedidoDeTarefa = {},
): { ok: boolean; data?: { taskId: string; status: string; task: string }; error?: string } {
  const api = window.AuroraAPI;
  if (!api || !api.compile) return { ok: false, error: 'AuroraAPI.compile unavailable' };
  let job: unknown;
  if (task === 'compile_all') job = api.compile.compileAll();
  else if (task === 'compile_step') {
    if (!step) return { ok: false, error: 'compile_step requires a step' };
    job = api.compile.compileStep(step);
  } else {
    return { ok: false, error: `unknown background task: ${task}` };
  }

  const taskId = `bg-${Date.now().toString(36)}`;
  const label = task === 'compile_step' ? `compile ${step}` : 'compile all';
  const originChatId = p.currentChatId;
  desenharTarefa(p, taskId, `Running ${label} in the background…`, 'running');

  const stillSameChat = () => p.currentChatId === originChatId;

  Promise.resolve(job).then(async (res) => {
    // Cancelar nao e terminar. O fluxo de compilacao trata o cancelamento por
    // dentro (mostra o cartao amigavel e volta normalmente), entao a promessa
    // RESOLVE, e a tarefa era relatada ao modelo como "finished": ele resumia um
    // resultado que nao existe. `runStatus` ja sabe a diferenca.
    let cancelada = false;
    try {
      const st = await api.compile?.runStatus?.();
      cancelada = !!(st && st.ok && st.data && st.data.cancelled);
    } catch (_) { /* sem resposta, segue pelo desfecho da promessa */ }
    const r = res as { ok?: boolean; error?: { message?: string } } | null | undefined;
    const okJob = !cancelada && !(r && r.ok === false);
    if (!stillSameChat()) return;   // a pessoa mudou de conversa: o resultado nao vai
    if (cancelada) {
      desenharTarefa(p, taskId, `${label} cancelled`, 'failed');
      p.autoContinue(
        `[AUTONOMOUS BACKGROUND TASK] "${label}" (${taskId}) was CANCELLED by the user `
        + 'before it finished. Nothing ran to completion, so there is no result to report. '
        + 'Do not retry on your own: acknowledge briefly and ask what they want to do next.',
        { label: `Background task: ${label} cancelled` },
      );
      return;
    }
    // A saida dos terminais de compilacao vai junto, para o turno seguinte
    // poder contar o que aconteceu.
    let terminals = '';
    try {
      const t = await api.terminal?.getAll?.();
      if (t && t.ok && t.data) terminals = JSON.stringify(t.data).slice(0, 4000);
    } catch (_) { /* contexto de melhor esforco */ }
    desenharTarefa(p, taskId, `${label} ${okJob ? 'finished' : 'failed'}`, okJob ? 'done' : 'failed');
    const status = okJob ? 'completed' : `failed: ${r?.error?.message || motivoDe(res, 'unknown error')}`;
    p.autoContinue(
      `[AUTONOMOUS BACKGROUND TASK] "${label}" (${taskId}) ${status}.\n\n` +
      (note ? `Original intent: ${note}\n\n` : '') +
      `Relevant terminal output (truncated):\n${terminals || '(none captured)'}\n\n` +
      `Summarise the outcome for the user concisely, and decide whether any follow-up action is warranted.`,
      {
        label: `Background task: ${label} ${okJob ? 'finished' : 'failed'}`,
        // Passou e falhou NAO sao a mesma tarefa. Passou e resumir uma saida que
        // ja veio pronta. Falhou e inferir a causa de um erro do C+-, que nao esta
        // na mensagem (`i` reservado, array como parametro, inicializacao de
        // array global).
        operacao: okJob ? 'posCompilacaoOk' : 'posCompilacaoFalha',
      },
    );
  }).catch((e) => {
    if (!stillSameChat()) return;
    desenharTarefa(p, taskId, `${label} errored`, 'failed');
    p.autoContinue(
      `[AUTONOMOUS BACKGROUND TASK] "${label}" (${taskId}) threw: ${(e as { message?: string } | null)?.message || e}. Report this to the user.`,
      { label: `Background task: ${label} errored` },
    );
  });

  return { ok: true, data: { taskId, status: 'started', task: label } };
}

/** Desenha (ou atualiza) o chip de estado de uma tarefa na conversa. */
function desenharTarefa(p: PainelDaTarefa, taskId: string, text: string, state: EstadoDaTarefa): void {
  let el = p.messagesEl.querySelector<HTMLElement>(`.ai-bgtask[data-task-id="${taskId}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'ai-bgtask';
    el.dataset.taskId = taskId;
    el.innerHTML = '<i class="ph ai-bgtask-icon" aria-hidden="true"></i><span class="ai-bgtask-text"></span>';
    p.messagesEl.appendChild(el);
  }
  el.classList.remove('running', 'done', 'failed');
  el.classList.add(state);
  const icon = el.querySelector('.ai-bgtask-icon');
  if (icon) icon.className = `ph ai-bgtask-icon ${state === 'done' ? 'ph-check-circle' : state === 'failed' ? 'ph-x-circle' : 'ph-circle-notch ai-tool-spin'}`;
  (el.querySelector('.ai-bgtask-text') as HTMLElement).textContent = text;
  p.scrollToBottom();
}
