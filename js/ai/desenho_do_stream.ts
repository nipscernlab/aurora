/**
 * desenho_do_stream.ts: o texto da assistente aparecendo enquanto chega.
 *
 * O texto flui conforme chega. Houve uma epoca de "acumula e revela no fim",
 * porque re-renderizar markdown a cada token tremia e o codigo so ganhava
 * realce no final. O que resolve as duas coisas e renderizar POR QUADRO (um
 * requestAnimationFrame junta os tokens do quadro), com uma maquina de escrever
 * que solta aos poucos os blocos grandes das CLIs, e deixar o realce de codigo
 * e os links para a passada final de cada segmento.
 *
 * Um segmento e o texto entre duas chamadas de ferramenta. O artefato de
 * chamada que alguns modelos escrevem como texto (tool_call_text.ts) nunca vai
 * a tela, e balao que ficaria vazio nao nasce, ou sai.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3). O texto do turno, o cursor da
 * maquina de escrever e o balao corrente sao estado do painel; cada funcao o
 * recebe como contexto.
 */

import type { MensagemDoChat } from './chat_history.js';
import { renderMarkdown, highlightCodeBlocks, linkifyFileRefs } from './chat_render.js';
import { mayHaveToolArtifacts, stripToolCallArtifacts } from './tool_call_text.js';

/** O que o desenho le e escreve do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDoStream {
  messagesEl: HTMLElement | null;
  messages: MensagemDoChat[];
  segmentBuffer: string;
  turnText: string;
  _committedTurnLen?: number;
  _revealLength?: number;
  _streamFlush?: boolean;
  _streamRenderRaf?: number | null;
  _streamRenderTimer?: ReturnType<typeof setTimeout> | null;
  currentAssistantContentEl: HTMLElement | null;
  hadToolCalls?: boolean;
  appendBubble(role: string, content: string): HTMLElement;
  showThinking(show: boolean): void;
  scrollToBottom(): void;
  _closeToolGroup(): void;
}

/** O texto que vai a tela: sem artefato de chamada de ferramenta, sem espaco nas pontas. */
function textoVisivel(buf: string): string {
  // mayHaveToolArtifacts poupa as tres varreduras no caso comum (sem marcador).
  return (mayHaveToolArtifacts(buf) ? stripToolCallArtifacts(buf) : buf).trim();
}

/** Tira o balao corrente da tela (ele ficaria vazio). */
function largarBalao(p: PainelDoStream): void {
  if (p.currentAssistantContentEl) {
    p.currentAssistantContentEl.closest('.ai-message')?.remove();
    p.currentAssistantContentEl = null;
  }
}

/** O balao do segmento, criado so quando ha texto de verdade para mostrar. */
function balaoDoSegmento(p: PainelDoStream): HTMLElement {
  if (!p.currentAssistantContentEl) {
    const bubble = p.appendBubble('assistant', '');
    p.currentAssistantContentEl = bubble.querySelector('.ai-msg-content');
  }
  return p.currentAssistantContentEl as HTMLElement;
}

/** Um pedaco de texto chegou: entra no segmento e no turno, e o desenho vai no proximo quadro. */
export function receberPedaco(p: PainelDoStream, delta: string): void {
  if (!delta) return;
  // Texto retomando depois de ferramentas fecha o grupo delas.
  p._closeToolGroup();
  p.segmentBuffer += delta;
  p.turnText += delta;
  if (!p._revealLength) p.showThinking(true);
  agendarDesenho(p);
}

/**
 * A passada final do segmento: cancela o quadro pendente, desenha o texto
 * inteiro sem a maquina de escrever, e so agora faz o que custa caro e nao
 * pode ir por quadro: realce de codigo e links de arquivo.
 */
export function revelarSegmento(p: PainelDoStream): void {
  cancelarDesenho(p);
  const displayText = textoVisivel(p.segmentBuffer || '');

  if (!displayText) {
    // So artefato ou espaco: nunca deixar balao vazio.
    largarBalao(p);
    p._revealLength = 0;
    return;
  }

  p.showThinking(false);
  const nadaMostrado = !p.currentAssistantContentEl || !((p._revealLength as number) > 0);
  const el = balaoDoSegmento(p);
  el.innerHTML = renderMarkdown(displayText);
  highlightCodeBlocks(el);
  linkifyFileRefs(el);
  // A cascata so quando o texto NAO estava na tela (segmento que chegou inteiro
  // de uma vez); animar de novo o que ja se leu e tremor.
  if (nadaMostrado) cascata(el);
  p._revealLength = 0;
  p.scrollToBottom();
}

/** A entrada escalonada dos blocos de um segmento revelado de uma vez. */
function cascata(el: HTMLElement | null): void {
  /* v8 ignore next */ // so e chamada com o balao que acabou de ser garantido
  if (!el) return;
  const kids = Array.from(el.children) as HTMLElement[];
  kids.forEach((k, i) => {
    k.classList.add('ai-reveal-block');
    k.style.animationDelay = `${Math.min(i * 45, 360)}ms`;
  });
}

/**
 * Pede o desenho para o proximo quadro (um por quadro). O requestAnimationFrame
 * junta os tokens, mas numa janela ao fundo o Electron o estrangula (medido: o
 * texto parava em 10 de 66 caracteres); um temporizador curto corre junto, e o
 * primeiro que disparar cancela o outro.
 */
function agendarDesenho(p: PainelDoStream): void {
  if (p._streamRenderRaf) return;
  const rodar = () => {
    cancelarDesenho(p);
    desenharStream(p);
  };
  p._streamRenderRaf = requestAnimationFrame(rodar);
  p._streamRenderTimer = setTimeout(rodar, 40);
}

export function cancelarDesenho(p: PainelDoStream): void {
  if (p._streamRenderRaf) { cancelAnimationFrame(p._streamRenderRaf); p._streamRenderRaf = null; }
  if (p._streamRenderTimer) { clearTimeout(p._streamRenderTimer); p._streamRenderTimer = null; }
}

/** Um quadro do stream: a maquina de escrever avanca e o trecho novo entra realcado. */
function desenharStream(p: PainelDoStream): void {
  const buf = p.segmentBuffer;
  const displayText = textoVisivel(buf);
  // Se nao sobrou nada e o buffer parece o JSON de uma chamada sendo escrito
  // token a token, nao mostrar o JSON cru: o chip da ferramenta vem logo.
  const looksLikeToolArtifact = !displayText &&
    /^\s*[⺀-鿿]*\s*\{/.test(p.segmentBuffer) &&
    /"name"\s*:/.test(p.segmentBuffer);
  // So o texto limpo. Um recurso antigo ao buffer cru criava balao vazio, cujas
  // bordas apareciam como um par de linhas finas entre respostas.
  const sourceText = looksLikeToolArtifact ? '' : displayText;

  if (!sourceText) {
    // Nada visivel ainda (so artefato ou espaco), ou um bloco de chamada acabou
    // de fechar e foi retirado: o balao criado de antemao sai.
    if (p.currentAssistantContentEl) {
      largarBalao(p);
      p._revealLength = 0;
    }
    return;
  }

  // Texto de verdade vai entrar: os pontos de pensando saem AGORA, e nao no
  // primeiro pedaco cru, para nao haver vao entre os pontos e as palavras.
  p.showThinking(false);
  const el = balaoDoSegmento(p);

  // A maquina de escrever: o cursor (_revealLength, caracteres ja mostrados)
  // avanca uma fracao da distancia por quadro, para um bloco grande das CLIs
  // entrar suave em vez de cair inteiro. O trecho revelado neste quadro anima.
  const prevShown = Math.min(p._revealLength || 0, sourceText.length);
  let shown: number;
  if (p._streamFlush || prevShown >= sourceText.length) {
    shown = sourceText.length;
  } else {
    const gap = sourceText.length - prevShown;
    shown = Math.min(sourceText.length, prevShown + Math.max(2, Math.ceil(gap * 0.16)));
  }
  p._streamFlush = false;
  el.innerHTML = comRealceDoNovo(sourceText.slice(0, shown), prevShown);
  p._revealLength = shown;
  p.scrollToBottom();
  // Continua soltando o resto nos proximos quadros, mesmo sem pedaco novo.
  if (shown < sourceText.length) agendarDesenho(p);
}

/**
 * Markdown com um span de realce em volta do que comeca em `revealOffset`. O
 * marcador entra no texto ANTES do markdown, por um par de sentinelas que
 * sobrevivem ao escape e a divisao em paragrafos e listas, e depois vira o span.
 */
function comRealceDoNovo(text: string, revealOffset: number): string {
  /* v8 ignore next */ // o cursor avanca pelo menos um caractere, entao o texto nunca e vazio
  if (!text) return '';
  if (revealOffset <= 0 || revealOffset >= text.length) return renderMarkdown(text);
  const OPEN = 'AI_REVEAL_OPEN';
  const CLOSE = 'AI_REVEAL_CLOSE';
  const head = text.slice(0, revealOffset);
  const tail = text.slice(revealOffset);
  // Sem cortar uma cerca de codigo: com o ``` aberto na cabeca, desenha sem
  // realce para nao envenenar o realce de sintaxe; o proximo pedaco tenta de novo.
  const openFences = (head.match(/```/g) || []).length;
  if (openFences % 2 !== 0) return renderMarkdown(text);
  const marked = `${head}${OPEN}${tail}${CLOSE}`;
  let html = renderMarkdown(marked);
  html = html.split(OPEN).join('<span class="ai-fade-reveal">');
  html = html.split(CLOSE).join('</span>');
  return html;
}

/**
 * Sela o que o turno produziu: revela o ultimo segmento, guarda-o e arruma o
 * DOM. E tudo o que o commitTurn faz MENOS o encerramento do turno, porque o
 * `finish` com `more` precisa so desta metade.
 */
export function selarTextoDoTurno(p: PainelDoStream): void {
  p._closeToolGroup();
  cancelarDesenho(p);
  revelarSegmento(p);
  // So o segmento FINAL (o que veio depois da ultima ferramenta) e guardado
  // aqui; os anteriores ja foram nas fronteiras das chamadas. Sem os artefatos
  // de chamada, que confundem o modelo nos turnos seguintes.
  const cleanText = stripToolCallArtifacts(
    p.turnText.slice(p._committedTurnLen || 0)).trim();
  if (cleanText) {
    p.messages.push({ role: 'assistant', content: cleanText });
  }
  if (p.currentAssistantContentEl) {
    highlightCodeBlocks(p.currentAssistantContentEl);
    linkifyFileRefs(p.currentAssistantContentEl);
  }

  // O modelo chamou ferramentas e nao explicou nada (comum em alguns modelos
  // do Ollama): uma linha diz que o turno acabou.
  if (!cleanText && p.hadToolCalls) {
    p.appendBubble('assistant', '_All actions completed. Ask a follow-up if you want details._');
  }

  limparBaloesVazios(p);
}

/**
 * Tira os baloes de assistente sem conteudo visivel (sem texto e sem elemento,
 * para preservar o que so tem imagem ou codigo). Defesa contra as linhas finas
 * de balao vazio; a criacao preguicosa ja as evita no caso comum.
 */
function limparBaloesVazios(p: PainelDoStream): void {
  /* v8 ignore next */ // so roda no fim de um turno, com o painel montado
  if (!p.messagesEl) return;
  for (const content of p.messagesEl.querySelectorAll('.ai-msg-assistant .ai-msg-content')) {
    if (!content.firstElementChild && !(content.textContent as string).trim()) {
      content.closest('.ai-message')?.remove();
    }
  }
}
