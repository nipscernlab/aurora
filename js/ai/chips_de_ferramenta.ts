/**
 * chips_de_ferramenta.ts: os chips das chamadas de ferramenta na conversa.
 *
 * Uma sequencia de chamadas seguidas fica num grupo so, que recolhe, para um
 * turno movimentado nao encher a conversa de chips. O grupo nasce no primeiro
 * chip da sequencia; um trecho de prosa ou o fim do turno o fecham, num "N
 * actions" que a pessoa expande. Enquanto algo roda, o cabecalho diz o que.
 * O texto de cada chip (nome legivel, dica com argumentos e resultado) mora em
 * tool_chip_text.ts, que e puro.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3). O grupo aberto e os chips em
 * voo sao estado do painel; as tres pecas de desenho (o grupo, o fechamento e
 * o chip estatico) sao puras e a conversa reaberta as usa tambem.
 */

import type { MensagemDoChat } from './chat_history.js';
import { formatArgsForTitle, formatToolTooltip, prettyToolName, summariseResult } from './tool_chip_text.js';

/** O casco de um grupo: o elemento, o corpo onde os chips entram e o resumo. */
export interface GrupoDeFerramentas { el: HTMLElement; body: HTMLElement; summaryEl: HTMLElement }

/** Um chip em voo, esperando o resultado. */
export interface ChipEmVoo { toolUseId: string | null; toolName: string; args: unknown; el: HTMLElement }

/** O que os chips leem e escrevem do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDosChips {
  _toolGroup: (GrupoDeFerramentas & { total: number }) | null;
  runningChips: ChipEmVoo[];
  messages: MensagemDoChat[];
  messagesEl: HTMLElement;
  scrollToBottom(): void;
}

/**
 * O casco de um grupo, com o cabecalho que recolhe e expande. O mesmo para o
 * grupo ao vivo e para o reconstruido ao reabrir uma conversa, para os dois
 * terem a mesma cara.
 */
export function criarGrupoDeFerramentas(): GrupoDeFerramentas {
  const el = document.createElement('div');
  el.className = 'ai-tool-group';
  el.innerHTML = `
      <button class="ai-tool-group-head" type="button" aria-expanded="true">
        <i class="ph ph-caret-down ai-tool-group-caret" aria-hidden="true"></i>
        <i class="ph ph-wrench ai-tool-group-icon" aria-hidden="true"></i>
        <span class="ai-tool-group-summary">Working…</span>
      </button>
      <div class="ai-tool-group-body"></div>`;
  const head = el.querySelector('.ai-tool-group-head') as HTMLElement;
  head.addEventListener('click', () => {
    const collapsed = el.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
  });
  return {
    el,
    body: el.querySelector('.ai-tool-group-body') as HTMLElement,
    summaryEl: el.querySelector('.ai-tool-group-summary') as HTMLElement,
  };
}

function garantirGrupo(p: PainelDosChips): GrupoDeFerramentas & { total: number } {
  if (p._toolGroup && p._toolGroup.el.isConnected) return p._toolGroup;
  const parts = criarGrupoDeFerramentas();
  p.messagesEl.appendChild(parts.el);
  p._toolGroup = { ...parts, total: 0 };
  return p._toolGroup;
}

/**
 * O cabecalho ao vivo: com um chip girando, diz O QUE roda ("Running get
 * terminal output…"); com varios, quantos; parado, o total.
 */
function atualizarResumo(p: PainelDosChips): void {
  const g = p._toolGroup;
  if (!g) return;
  const running = p.runningChips.filter((c) => g.body.contains(c.el));
  if (running.length === 1) {
    g.summaryEl.textContent = `Running ${prettyToolName(running[running.length - 1].toolName)}…`;
  } else if (running.length > 1) {
    g.summaryEl.textContent = `Running ${running.length} actions…`;
  } else {
    g.summaryEl.textContent = `${g.total} action${g.total === 1 ? '' : 's'}`;
  }
}

/** Fecha o grupo aberto: troca a chave inglesa pelo check e recolhe. */
export function fecharGrupo(p: PainelDosChips): void {
  const g = p._toolGroup;
  if (!g) return;
  finalizarGrupo(g.el, g.summaryEl, g.total);
  p._toolGroup = null;
}

/**
 * O grupo terminado vira a pilula "N actions": o resumo, um check verde ou uma
 * cruz vermelha conforme algum chip tenha falhado ou sido recusado, e recolhido
 * (mesmo com uma acao so).
 */
export function finalizarGrupo(el: HTMLElement, summaryEl: HTMLElement | null, total: number): void {
  if (summaryEl) summaryEl.textContent = `${total} action${total === 1 ? '' : 's'}`;
  const failed = el.querySelector(
    '.ai-tool-group-body .ai-tool-chip.failed, .ai-tool-group-body .ai-tool-chip.denied',
  );
  const icon = el.querySelector('.ai-tool-group-icon');
  if (icon) icon.className = `ph ${failed ? 'ph-x-circle' : 'ph-check-circle'} ai-tool-group-icon`;
  el.classList.add('done');
  el.classList.toggle('has-failure', !!failed);
  if (total >= 1) {
    el.classList.add('collapsed');
    el.querySelector('.ai-tool-group-head')?.setAttribute('aria-expanded', 'false');
  }
}

/** O chip de uma chamada que comecou, girando, no grupo aberto. */
export function iniciarChip(p: PainelDosChips, toolName: string | undefined, args: unknown, toolUseId?: string | null): void {
  const name = toolName || 'tool';
  const chip = document.createElement('div');
  chip.className = 'ai-tool-chip running';
  chip.innerHTML = `
      <i class="ph ph-circle-notch ai-tool-spin" aria-hidden="true"></i>
      <span class="ai-tool-name"></span>
      <span class="ai-tool-status">running…</span>
    `;
  (chip.querySelector('.ai-tool-name') as HTMLElement).textContent = name;
  // Os argumentos vao na dica do chip, para inspecionar passando o mouse sem
  // inchar o chip visivel.
  if (args && Object.keys(args as object).length) {
    const argText = formatArgsForTitle(args);
    if (argText) chip.title = argText;
  }
  const group = garantirGrupo(p);
  group.body.appendChild(chip);
  group.total += 1;
  p.scrollToBottom();
  p.runningChips.push({ toolUseId: toolUseId || null, toolName: name, args, el: chip });
  atualizarResumo(p);
}

/**
 * Fecha o chip de uma chamada que terminou e grava a chamada na conversa, para
 * ela reaparecer ao reabrir.
 *
 * Casa pelo id da chamada, que vem do provedor ou da CLI: so pelo nome, duas
 * chamadas paralelas da mesma ferramenta colidiriam e um chip giraria para
 * sempre. Sem id (eventos antigos), casa pelo nome.
 */
export function terminarChip(p: PainelDosChips, toolName: string | undefined, result: unknown, toolUseId?: string | null): void {
  const name = toolName || 'tool';
  let idx = -1;
  if (toolUseId) {
    idx = p.runningChips.findIndex((c) => c.toolUseId === toolUseId);
  }
  if (idx < 0) {
    idx = p.runningChips.findIndex((c) => c.toolName === name);
  }
  if (idx < 0) {
    // Nenhum chip casou (ja terminou, ou id e nome nao batem). Nada a fechar,
    // mas fica no log: e assim que um chip fica girando, e o teto do cao de
    // guarda o recolhe como ultima defesa.
    console.warn('[ai] tool-result with no matching running chip:', name, toolUseId);
    return;
  }
  const running = p.runningChips.splice(idx, 1)[0];
  const { el, args } = running;
  const r = result as { ok?: boolean; error?: string } | null | undefined;
  const ok = !(r && r.ok === false);
  const denied = !ok && /denied/i.test((r && r.error) || '');
  const statusStr = ok ? 'done' : (denied ? 'denied' : 'failed');
  el.classList.remove('running');
  el.classList.add(statusStr);
  const icon = el.querySelector('i');
  const statusEl = el.querySelector('.ai-tool-status');
  if (icon) icon.className = ok ? 'ph ph-check-circle' : (denied ? 'ph ph-prohibit' : 'ph ph-x-circle');
  if (statusEl) statusEl.textContent = statusStr;
  // A dica passa a mostrar argumentos e resultado juntos.
  const tooltip = formatToolTooltip(args, result);
  if (tooltip) el.title = tooltip;

  // Argumentos e uma previa do resultado vao para a conversa gravada, para a
  // pessoa conferir depois o que cada chamada fez.
  const entry: MensagemDoChat = {
    role: 'tool',
    toolName: name,
    status: statusStr,
    toolUseId: toolUseId || running.toolUseId || null,
    args: args || null,
    result: summariseResult(result),
  };
  if (!ok && r?.error) entry.error = r.error;
  p.messages.push(entry);
  atualizarResumo(p);
}

/**
 * O chip ja terminado, sem animacao, da conversa reaberta: o estado final e a
 * dica com argumentos e resultado.
 */
export function chipEstatico(toolName?: string, status?: string, error?: string, args?: unknown, result?: unknown): HTMLElement {
  const chip = document.createElement('div');
  chip.className = `ai-tool-chip ${status || 'done'}`;
  const iconClass = status === 'done'   ? 'ph ph-check-circle'
                  : status === 'denied' ? 'ph ph-prohibit'
                                        : 'ph ph-x-circle';
  chip.innerHTML = `
      <i class="${iconClass}" aria-hidden="true"></i>
      <span class="ai-tool-name"></span>
      <span class="ai-tool-status"></span>
    `;
  (chip.querySelector('.ai-tool-name') as HTMLElement).textContent = toolName || 'tool';
  (chip.querySelector('.ai-tool-status') as HTMLElement).textContent = status || 'done';
  const tooltip = formatToolTooltip(args, result) ||
                  (error ? `error: ${error}` : '');
  if (tooltip) chip.title = tooltip;
  return chip;
}
