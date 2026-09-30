/**
 * perguntas_inline.ts: os dois cartoes com que a assistente para e pergunta a
 * pessoa no meio do chat, e o registro que fica depois.
 *
 * O de permissao (Allow/Deny) aparece antes de uma ferramenta que o modo de
 * permissao nao libera sozinho; o tool_runner o espera pelo `confirmToolCall`
 * do painel. O de pergunta e o `ask_user_question`, que o aurora_api espera
 * pelo `showAskUserQuestionInline`. Os dois ficam no fluxo das mensagens, nao
 * num modal, e se registram no painel para o fim do turno (resetTurnState)
 * fecha-los: o de permissao como recusado, o de pergunta como abortado. O cao
 * de guarda do stream tambem os consulta, para nunca resgatar um turno que
 * esta so esperando a pessoa.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3).
 */

import { escapeHtml } from './chat_render.js';
import type { MensagemDoChat } from './chat_history.js';
import { decideToolPermission, previewArgs, splitArgs, type DefDaFerramenta } from './tool_permission.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** A resposta a uma pergunta, como volta para a ferramenta. */
export interface RespostaDaPergunta { answer: string; selected: string[] }

/** Uma opcao do cartao de pergunta. */
export interface OpcaoDaPergunta { label?: string; description?: string }

/** O registro permanente de uma pergunta, em `messages` e na tela. */
export type RegistroDaPergunta = {
  question?: string;
  selected?: unknown;
  custom?: string;
  cancelled?: boolean;
};

/** O que os cartoes leem e escrevem do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDasPerguntas {
  container: HTMLElement | null;
  messagesEl: HTMLElement;
  messages: MensagemDoChat[];
  permissionMode: string;
  /** As funcoes que decidem cada cartao de permissao aberto. */
  pendingConfirms: Set<(allowed: boolean) => void>;
  /** As que decidem cada cartao de pergunta aberto. */
  pendingAskUserQuestions?: Set<(r: RespostaDaPergunta) => void>;
  initialize(): void;
  scrollToBottom(): void;
}

/** O cartao some 180 ms depois de decidido, o tempo da animacao de saida. */
const SAIDA_MS = 180;

/**
 * A ferramenta pode rodar? O modo de permissao decide (tool_permission.ts); se
 * ele manda perguntar, o cartao de permissao aparece e a resposta e a da pessoa.
 */
export function confirmarFerramenta(p: PainelDasPerguntas, def: DefDaFerramenta | null | undefined, args: unknown): Promise<boolean> {
  return decideToolPermission(def, p.permissionMode) === 'allow'
    ? Promise.resolve(true)
    : cartaoDePermissao(p, def, args);
}

/**
 * O cartao Allow/Deny no fluxo das mensagens. Resolve com a escolha e se tira
 * da tela depois de decidido.
 */
function cartaoDePermissao(p: PainelDasPerguntas, def: DefDaFerramenta | null | undefined, args: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    const card = document.createElement('div');
    card.className = 'ai-confirm enter';
    const verb = def && def.access === 'write' ? 'make a change' : 'read something';
    card.innerHTML = `
      <div class="ai-confirm-head">
        <i class="ph ph-shield-check" aria-hidden="true"></i>
        <span>Aurora Intelligence wants to ${verb}</span>
      </div>
      <div class="ai-confirm-tool"></div>
      <div class="ai-confirm-desc"></div>
      <div class="ai-confirm-notes"></div>
      <pre class="ai-confirm-args"></pre>
      <div class="ai-confirm-actions">
        <button class="ai-confirm-deny" type="button">Deny</button>
        <button class="ai-confirm-allow" type="button">Allow</button>
      </div>
    `;
    const achar = (sel: string) => card.querySelector(sel) as HTMLElement;
    achar('.ai-confirm-tool').textContent = def ? def.name : 'tool';
    achar('.ai-confirm-desc').textContent = def ? (def.description || '') : '';
    // A prosa do modelo (note, question) vai como texto; so os argumentos
    // estruturais ficam no bloco JSON. Sempre textContent: e saida do modelo,
    // nunca e lida como marcacao.
    const { prose, rest } = splitArgs(args);
    const notes = achar('.ai-confirm-notes');
    for (const item of prose) {
      const row = document.createElement('div');
      row.className = 'ai-confirm-note';
      const key = document.createElement('span');
      key.className = 'ai-confirm-note-key';
      key.textContent = item.key;
      const text = document.createElement('span');
      text.className = 'ai-confirm-note-text';
      text.textContent = item.text;
      row.append(key, text);
      notes.appendChild(row);
    }
    if (!prose.length) notes.remove();

    const preview = previewArgs(rest);
    const pre = achar('.ai-confirm-args');
    if (preview) pre.textContent = preview; else pre.remove();

    let settled = false;
    const finish = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      p.pendingConfirms.delete(decide);
      card.classList.add('done');
      setTimeout(() => card.remove(), SAIDA_MS);
      resolve(allowed);
    };
    // Registrada para o fim do turno recusar um cartao que ficou para tras.
    const decide = (allowed: boolean) => finish(allowed);
    p.pendingConfirms.add(decide);

    achar('.ai-confirm-allow').addEventListener('click', () => finish(true));
    achar('.ai-confirm-deny').addEventListener('click', () => finish(false));

    p.messagesEl.appendChild(card);
    p.scrollToBottom();
    requestAnimationFrame(() => card.classList.remove('enter'));
  });
}

/**
 * O cartao de pergunta, o jeito de a assistente parar o turno e pedir uma
 * decisao. Como o `AskUserQuestion` do Claude Code: uma pergunta, opcoes de
 * escolha unica ou multipla, e um campo livre.
 *
 * Resolve com `{ answer, selected }` quando a pessoa envia ou cancela. O turno
 * que acaba antes resolve com `answer: '[turn aborted before user answered]'`
 * (resetTurnState), nunca com null: a ferramenta que espera sempre recebe texto.
 */
export function perguntarAPessoa(
  p: PainelDasPerguntas,
  { question, options = [], multiSelect = false }: { question?: string; options?: unknown; multiSelect?: boolean } = {},
): Promise<RespostaDaPergunta> {
  if (!p.container) p.initialize();
  return new Promise((resolve) => {
    const card = document.createElement('div');
    card.className = 'ai-ask-question enter';
    const inputType = multiSelect ? 'checkbox' : 'radio';
    const safeOptions: OpcaoDaPergunta[] = Array.isArray(options) ? options : [];
    const optsHtml = safeOptions.map((opt, idx) => {
      const label = escapeHtml(opt.label || `Option ${idx + 1}`);
      const desc = opt.description ? `<span class="ai-askq-opt-desc">${escapeHtml(opt.description)}</span>` : '';
      return `
        <label class="ai-askq-opt">
          <input type="${inputType}" name="ai-askq-opt" value="${idx}">
          <span class="ai-askq-opt-text">
            <span class="ai-askq-opt-label">${label}</span>${desc}
          </span>
        </label>`;
    }).join('');
    card.innerHTML = `
      <div class="ai-askq-head">
        <i class="ph ph-question" aria-hidden="true"></i>
        <span>Aurora Intelligence is asking</span>
      </div>
      <div class="ai-askq-question"></div>
      <div class="ai-askq-options">${optsHtml}</div>
      <div class="ai-askq-other">
        <label class="ai-askq-other-label">Other / write your own answer</label>
        <textarea class="ai-askq-other-input" rows="2"
                  placeholder="${tr('ai.customAnswerPlaceholder')}"></textarea>
      </div>
      <div class="ai-askq-actions">
        <button type="button" class="ai-askq-cancel">Cancel</button>
        <button type="button" class="ai-askq-submit">Send answer</button>
      </div>
    `;
    (card.querySelector('.ai-askq-question') as HTMLElement).textContent = question as string;
    const campo = card.querySelector('.ai-askq-other-input') as HTMLTextAreaElement;

    let settled = false;
    /**
     * O `record` deixa o rastro permanente da troca no chat. Sem ele o cartao
     * so sumia: o que foi perguntado e escolhido sobrevivia dentro do JSON do
     * chip da ferramenta, e a conversa reaberta perdia a decisao, que costuma
     * ser a coisa mais relida dela. So vai em resposta ou dispensa deliberada;
     * o turno que morre por outro motivo resolve sem registro.
     */
    const finish = (payload: RespostaDaPergunta, record: (RegistroDaPergunta & { role: 'question' }) | null = null) => {
      if (settled) return;
      settled = true;
      p.pendingAskUserQuestions?.delete(decide);
      if (record) {
        p.messages.push(record);
        // No lugar do cartao, antes de ele sumir.
        p.messagesEl.insertBefore(desenharRegistroDaPergunta(record), card);
      }
      card.classList.add('done');
      setTimeout(() => card.remove(), SAIDA_MS);
      resolve(payload);
    };
    const decide = (val: RespostaDaPergunta) => finish(val);
    if (!p.pendingAskUserQuestions) p.pendingAskUserQuestions = new Set();
    p.pendingAskUserQuestions.add(decide);

    const submit = () => {
      const otherText = campo.value.trim();
      const checked = Array.from(card.querySelectorAll<HTMLInputElement>('input[name="ai-askq-opt"]:checked'))
        .map((el) => safeOptions[Number(el.value)]?.label).filter(Boolean) as string[];
      // O texto proprio, quando existe, e a resposta, com as escolhas de apoio;
      // senao, as escolhas.
      let answer: string;
      if (otherText) {
        answer = checked.length
          ? `${otherText} (also selected: ${checked.join(', ')})`
          : otherText;
      } else if (checked.length) {
        answer = multiSelect ? checked.join(', ') : checked[0];
      } else {
        // Nada escolhido e nada escrito: o cartao fica e sacode, para dizer
        // que falta a resposta.
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 320);
        return;
      }
      finish({ answer, selected: checked },
        { role: 'question', question, selected: checked, custom: otherText, cancelled: false });
    };

    (card.querySelector('.ai-askq-submit') as HTMLElement).addEventListener('click', submit);
    (card.querySelector('.ai-askq-cancel') as HTMLElement).addEventListener('click', () => {
      finish({ answer: '[user cancelled the question]', selected: [] },
        { role: 'question', question, selected: [], custom: '', cancelled: true });
    });
    // Enter no campo (sem Shift) tambem envia.
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });

    p.messagesEl.appendChild(card);
    p.scrollToBottom();
    requestAnimationFrame(() => card.classList.remove('enter'));
  });
}

/**
 * O rastro permanente de uma pergunta: o que foi perguntado e o que a pessoa
 * escolheu. Desenhado ao vivo no lugar do cartao e de novo ao reabrir a
 * conversa, o mesmo elemento nos dois casos.
 *
 * So de tela: `question` sai do buildApiMessages, porque o modelo ja soube a
 * resposta pelo retorno da ferramenta.
 */
export function desenharRegistroDaPergunta(entry: RegistroDaPergunta): HTMLElement {
  const el = document.createElement('div');
  el.className = `ai-askq-record${entry.cancelled ? ' cancelled' : ''}`;

  const head = document.createElement('div');
  head.className = 'ai-askq-record-head';
  const icon = document.createElement('i');
  icon.className = entry.cancelled ? 'ph ph-x-circle' : 'ph ph-check-circle';
  icon.setAttribute('aria-hidden', 'true');
  const headText = document.createElement('span');
  headText.textContent = entry.cancelled ? 'You dismissed a question' : 'You answered';
  head.append(icon, headText);
  el.appendChild(head);

  const q = document.createElement('div');
  q.className = 'ai-askq-record-q';
  q.textContent = entry.question || '';   // texto do modelo, nunca marcacao
  el.appendChild(q);

  const selected: unknown[] = Array.isArray(entry.selected) ? entry.selected : [];
  if (selected.length) {
    const chips = document.createElement('div');
    chips.className = 'ai-askq-record-chips';
    for (const label of selected) {
      const chip = document.createElement('span');
      chip.className = 'ai-askq-record-chip';
      const tick = document.createElement('i');
      tick.className = 'ph ph-check';
      tick.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = String(label);     // texto do modelo, nunca marcacao
      chip.append(tick, text);
      chips.appendChild(chip);
    }
    el.appendChild(chips);
  }

  if (entry.custom) {
    const custom = document.createElement('div');
    custom.className = 'ai-askq-record-custom';
    custom.textContent = entry.custom;      // as palavras da propria pessoa
    el.appendChild(custom);
  }
  return el;
}
