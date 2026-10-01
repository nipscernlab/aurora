/**
 * eventos_do_stream.ts: o que cada pacote do stream faz no painel de IA.
 *
 * O main manda o turno aos pedacos (texto, chamada e resultado de ferramenta,
 * citacao, fim, erro, o download da CLI no primeiro uso, a mensagem aceita no
 * meio da sessao). Pacote de outra sessao e descartado: e o que impede um
 * turno morto de escrever na tela. Qualquer pacote da sessao viva prova ao cao
 * de guarda que o turno esta vivo.
 *
 * Saiu do handleChatEvent do ai_assistant_manager.js (TODO 13.3), sem mudar o
 * corpo.
 */

import { isSubProvider } from './ai_metadata.js';
import { colherCitacaoDeFerramenta, juntarCitacao } from './citacoes_do_chat.js';
import { stripToolCallArtifacts } from './tool_call_text.js';
import type { PainelDoTurno, PacoteDoStream } from './turno_do_chat.js';

export function tratarEvento(p: PainelDoTurno, ev: PacoteDoStream | null | undefined): void {
  if (!ev || ev.sessionId !== p.currentSessionId) return;
  // Watchdog liveness: any packet from the active turn proves it's alive.
  p._lastEventAt = Date.now();
  switch (ev.type) {
    case 'cli-download':
      // B12: a subscription CLI is being fetched on first use. Display-only,
      // transient status, never persisted into the conversation.
      p._renderCliDownload(ev);
      break;
    case 'text-delta':
      // Do NOT hide the thinking dots here. A delta can be whitespace or a
      // stripped tool-call artifact that produces no bubble yet, so hiding
      // on the first raw delta left a blank gap (dots gone, no text). The
      // dots are retired inside _renderStreamingBubble the instant real
      // text actually lands on screen.
      p.appendDelta(ev.delta || '');
      break;
    case 'tool-call':
      // Reveal whatever text the model produced BEFORE p tool call, then
      // start a fresh segment below the chip.
      p._revealSegment();
      // Persist that pre-tool prose as its OWN assistant message, interleaved
      // with the tool entry, instead of dumping the whole turn's text after
      // the tool group at commitTurn. This makes a reloaded chat reproduce the
      // live layout (seg1 → [actions] → seg2). buildApiMessages re-merges
      // adjacent assistant messages so the API still sees alternating roles.
      {
        const seg = stripToolCallArtifacts(
          p.turnText.slice(p._committedTurnLen || 0)).trim();
        if (seg) p.messages.push({ role: 'assistant', content: seg });
        p._committedTurnLen = p.turnText.length;
      }
      p.showThinking(false);
      p.hadToolCalls = true;
      p.startToolChip(ev.toolName, ev.args, ev.toolUseId);
      p.currentAssistantContentEl = null;
      p.segmentBuffer = '';
      p._revealLength = 0;
      break;
    case 'tool-result':
      p.finishToolChip(ev.toolName, ev.result, ev.toolUseId);
      // Uma citacao VERIFICADA e um resultado de ferramenta como outro
      // qualquer, e vira linha no mesmo bloco que a citacao nativa da API.
      // Os dois caminhos convergem aqui de proposito: quem le a resposta nao
      // deve precisar saber por qual provedor ela veio.
      colherCitacaoDeFerramenta(p, ev.toolName, ev.result);
      break;
    case 'finish':
      p._clearCliDownload();
      p.showThinking(false);
      // `more` = a follow-up the user pushed mid-turn is already queued inside
      // the CLI and answers next, in p same session. Seal p segment but
      // stay streaming: ending the turn here would drain the renderer queue on
      // top of the CLI's own, double-dispatching, and would flip the composer
      // back to Send while the model is still working.
      //
      // SELAR, e nao encerrar. Este ramo chamava `commitTurn()` antes de
      // olhar o `more`, e o commitTurn passa por `resetTurnState()`, que
      // ZERA o `currentSessionId`. Como o `handleChatEvent` descarta todo
      // pacote cuja sessao nao bate, a resposta do follow-up chegava e era
      // jogada fora inteira: o painel ficava nos pontinhos ate o cao de
      // guarda matar o turno tres minutos depois. Era exatamente o que o
      // comentario do `_startNextSegment` dizia estar evitando, e nao
      // evitava, porque quem zerava vinha ANTES dele. O reset tambem
      // auto-nega os cartoes de confirmacao e cancela as perguntas abertas,
      // que no meio da sessao sao legitimos.
      if (ev.more) {
        p._sealTurnText();
        // O uso antes de gravar, senao o total no disco fica um turno atras.
        p.applyUsage(ev.usage);
        p.persistCurrentChat();
        p._startNextSegment();
        p.showThinking(true);
        break;
      }
      p.applyUsage(ev.usage);       // antes do commitTurn, que grava a conversa
      p.commitTurn();
      p.setStreaming(false);
      // Pull the CLI's authoritative usage snapshot at the END of every
      // turn (not just when the model popover happens to be open) so the
      // Subscription usage bars and plan limits reflect reality the next
      // time the user looks, p is what fixes "usage never updates".
      if (isSubProvider(p.currentProvider)) p.refreshSubUsage();
      break;
    case 'citation':
      // O trecho REAL da pagina do manual que sustenta o que a assistente
      // acabou de dizer, com o indice do caractere. Junta-se aqui e desenha
      // de uma vez no fim do turno: desenhar a cada chegada faria o bloco
      // crescer por baixo do texto enquanto a pessoa ainda le.
      // A mesma frase citada duas vezes fica uma linha so (citacoes_do_chat.ts).
      if (ev.citacao) juntarCitacao(p, ev.citacao);
      break;
    case 'tool-rejected':
      // Uma chamada de ferramenta que a IA escreveu como texto e que NAO
      // passou pelo esquema da propria ferramenta. Vai para o TCMD, que e o
      // painel de shell, e nao para um dos terminais de compilacao: nada foi
      // compilado, o que houve foi um pedido malformado.
      //
      // Antes isto era silencio: a chamada sumia num catch e a pessoa via a
      // assistente "nao fazer nada", sem pista nenhuma do motivo.
      try {
        window.initializeGlobalTerminalManager?.()?.appendToTerminal?.(
          'tcmd', ev.message as string, 'warning',
        );
      } catch (e) {
        console.warn('[ai] nao consegui escrever a recusa no terminal:', e);
      }
      break;
    case 'follow-up-taken':
      // A assistente terminou o que estava dizendo e pegou a mensagem que
      // esperava: agora ela entra na conversa, depois da resposta anterior.
      p._followUpTaken(ev.content);
      break;
    case 'aborted':
      p._clearCliDownload();
      p.showThinking(false);
      p.commitTurn();
      p.setStreaming(false);
      p._devolverVivasAFila();
      if (isSubProvider(p.currentProvider)) p.refreshSubUsage();
      break;
    case 'error':
      p._clearCliDownload();
      p.failTurn(ev.message || 'Unknown error');
      p._devolverVivasAFila();
      break;
  }
}
