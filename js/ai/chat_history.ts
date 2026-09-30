// chat_history.ts: pure history helpers for the AI assistant, extracted from
// ai_assistant_manager.js (A2 god-file decomposition).
//
// Pure: no DOM, no instance state, no IPC. The class keeps the orchestration
// (the popover element, click handling, and the window.aiAPI save/load IPC in
// main/ai/conversations.js); these build the list markup and the storage
// payload it feeds on, so both are unit-testable.

import { PROVIDER_META, formatTokens, relativeTime } from './ai_metadata.js';
import { escapeHtml } from './chat_render.js';

/** Uma linha da lista de conversas, como main/ai/conversations.js a devolve. */
export interface ConversaListada {
    id: string;
    title?: string;
    provider?: string;
    updatedAt?: number | string | null;
    cumulativeTokens?: number;
}

/** Um anexo de mensagem; na memoria leva o conteudo, gravado so os metadados. */
export interface AnexoDaMensagem {
    kind: string; name: string; mime?: string; size?: number | null; clipped?: boolean;
    dataUrl?: string; text?: string;
}

/** Uma citacao do manual; `inicio` e `fim` so existem em memoria. */
export interface CitacaoDaMensagem {
    pagina?: string; titulo?: string; trecho?: string; versao?: string;
    inicio?: number; fim?: number;
}

/**
 * Uma mensagem da conversa, em memoria ou gravada. `role` decide os outros
 * campos: 'tool' leva o rastro da ferramenta, 'citation' as citacoes, 'question'
 * a pergunta respondida, e os demais o `content`.
 */
export interface MensagemDoChat {
    role: string;
    content?: unknown;
    attachments?: AnexoDaMensagem[];
    citacoes?: CitacaoDaMensagem[];
    toolName?: string;
    status?: string;
    toolUseId?: string | null;
    args?: unknown;
    result?: unknown;
    error?: string;
    [campo: string]: unknown;
}

// Markup for the saved-conversations list in the history popover. `chatList` is
// the saved-chat metadata; `currentChatId` highlights the open one.
export function chatListHtml(chatList: ConversaListada[], currentChatId: string | null): string {
    if (!chatList.length) return '<p class="ai-history-empty">No saved chats yet.</p>';
    return chatList.map((c) => {
        const meta: { icon?: string; label?: string } = PROVIDER_META[c.provider as string] || {};
        const icon = meta.icon || '';
        const providerLabel = meta.label || c.provider || '';
        const active = c.id === currentChatId ? ' active' : '';
        // G6: per-conversation token total at a glance (0 omitted).
        const tok = (c.cumulativeTokens as number) > 0 ? ` · ${formatTokens(c.cumulativeTokens)} tok` : '';
        return `
        <div class="ai-history-item${active}" data-chat-id="${escapeHtml(c.id)}">
          ${icon ? `<img class="ai-history-item-icon" src="${icon}" alt="">` : '<span class="ai-history-item-icon-spacer"></span>'}
          <div class="ai-history-item-text">
            <span class="ai-history-item-title">${escapeHtml(c.title || 'Untitled')}</span>
            <span class="ai-history-item-meta">${escapeHtml(providerLabel)}${providerLabel ? ' · ' : ''}${escapeHtml(relativeTime(c.updatedAt))}${tok}</span>
          </div>
          <div class="ai-history-item-actions">
            <button class="ai-history-item-act" data-action="rename" title="Rename"><i class="ph ph-pencil-simple"></i></button>
            <button class="ai-history-item-act" data-action="delete" title="Delete"><i class="ph ph-trash"></i></button>
          </div>
        </div>
      `;
    }).join('');
}

// Shape the in-memory messages for persistence. Tool entries keep their full
// breadcrumb (so a re-opened chat replays every call); user/assistant entries
// keep content + lightweight attachment metadata only, the payload (image
// base64 / file text) is dropped for performance. Pure: returns a new array,
// never mutates the input.
export function serializeMessagesForStorage(messages: MensagemDoChat[]): MensagemDoChat[] {
    return messages.map((m) => {
        const entry: MensagemDoChat = { role: m.role };
        if (m.role === 'citation') {
            // O trecho e a razao de a citacao existir: sem ele, reabrir a
            // conversa deixaria so o nome da pagina, que e o que a assistente
            // ja dizia na prosa antes de citations existirem.
            //
            // OS INDICES (`inicio`, `fim`) FICAM DE FORA DE PROPOSITO, e isto
            // nao e a lista curta por descuido. Eles contam caracteres do texto
            // extraido da pagina COMO ELA ESTAVA naquele turno, e o manual se
            // atualiza sozinho por manifesto, sem esperar release da AURORA.
            // Guardado, um indice aponta para o meio de outra frase depois da
            // proxima correcao de texto: seria mentira com data para vencer.
            // O que sobrevive e o TEXTO, que ou ainda esta na pagina e e achado
            // onde quer que tenha ido parar (main/docs/realce.js), ou nao esta,
            // e ai "nao achei" e uma resposta honesta que da para dizer.
            entry.citacoes = (m.citacoes || []).map((c) => ({
                pagina: c.pagina, titulo: c.titulo, trecho: c.trecho, versao: c.versao,
            }));
        } else if (m.role === 'tool') {
            entry.toolName  = m.toolName;
            entry.status    = m.status;
            if (m.toolUseId) entry.toolUseId = m.toolUseId;
            if (m.args != null)   entry.args   = m.args;
            if (m.result != null) entry.result = m.result;
            if (m.error)          entry.error  = m.error;
        } else {
            entry.content = m.content;
            if (Array.isArray(m.attachments) && m.attachments.length) {
                entry.attachments = m.attachments.map((a) => {
                    const meta: AnexoDaMensagem = { kind: a.kind, name: a.name };
                    if (a.mime) meta.mime = a.mime;
                    if (a.size != null) meta.size = a.size;
                    if (a.clipped) meta.clipped = true;
                    return meta;
                });
            }
        }
        return entry;
    });
}
