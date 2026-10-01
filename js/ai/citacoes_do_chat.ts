/**
 * citacoes_do_chat.ts: as citacoes do manual na conversa.
 *
 * Elas chegam por dois caminhos no meio do turno: o evento `citation` do
 * stream e o resultado da ferramenta `cite_manual` (a regra deste ultimo,
 * pura, esta em manual_citation.ts). Juntam-se no turno, uma linha por frase,
 * e no fim viram um bloco embaixo da resposta e um registro `citation` na
 * conversa. Clicar na pagina abre o manual com o trecho realcado, e quando o
 * clique nao chega ao ponto o bloco diz por que.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3). A lista do turno e a versao do
 * manual continuam estado do painel; cada funcao o recebe como contexto.
 */

import type { MensagemDoChat } from './chat_history.js';
import { citacaoDeResultado, citacaoJaEsta, type CitacaoDoManual } from './manual_citation.js';

/** O que as citacoes leem e escrevem do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDasCitacoes {
  _citacoesDoTurno: CitacaoDoManual[] | null;
  _versaoDoManual?: string;
  messages: MensagemDoChat[];
  messagesEl: HTMLElement;
  scrollToBottom?(): void;
}

/**
 * Le a versao do manual instalado, para carimbar as citacoes. Lida na
 * montagem e relida ao voltar o foco: o manual se atualiza sozinho por
 * manifesto, no meio da sessao.
 */
export async function lerVersaoDoManual(p: PainelDasCitacoes): Promise<void> {
  try {
    const st = await window.electronAPI?.docsStatus?.() as { version?: string } | null | undefined;
    p._versaoDoManual = (st && st.version) || '';
  } catch (_) { p._versaoDoManual = ''; }
}

/**
 * Junta uma citacao a lista do turno. Desenhar a cada chegada faria o bloco
 * crescer por baixo do texto enquanto a pessoa ainda le, entao o desenho e um
 * so, no fim. A mesma frase citada duas vezes (o modelo a usou em duas
 * afirmacoes) fica uma linha so.
 */
export function juntarCitacao(p: PainelDasCitacoes, c: CitacaoDoManual): void {
  if (!p._citacoesDoTurno) p._citacoesDoTurno = [];
  if (citacaoJaEsta(p._citacoesDoTurno, c)) return;
  p._citacoesDoTurno.push(c);
}

/** A citacao que veio da ferramenta `cite_manual`; recusada, nao vira nada (o modelo e quem fica sabendo). */
export function colherCitacaoDeFerramenta(p: PainelDasCitacoes, toolName: unknown, resultado: unknown): void {
  const c = citacaoDeResultado(toolName, resultado, p._versaoDoManual);
  if (!c) return;
  juntarCitacao(p, c);
}

/**
 * Fecha as citacoes do turno: guarda na conversa e desenha.
 *
 * Entram como registro de papel `citation`, que o buildApiMessages filtra
 * (chat_turn): sao para a pessoa conferir, nao para o modelo reler o que ele
 * mesmo citou.
 *
 * Carimba a versao do manual, que serve para daqui a um mes: quem reabrir a
 * conversa, clicar e nao achar a frase sabe de que manual ela era. SINCRONO de
 * proposito, por um valor guardado: o commitTurn nao espera por isto, e a
 * citacao precisa estar em `messages` antes de a conversa ser gravada.
 */
export function registrarCitacoes(p: PainelDasCitacoes): void {
  const lista = p._citacoesDoTurno || [];
  p._citacoesDoTurno = null;
  if (!lista.length) return;
  const versao = p._versaoDoManual;
  if (versao) for (const c of lista) c.versao = versao;
  p.messages.push({ role: 'citation', citacoes: lista });
  p.messagesEl.appendChild(desenharBlocoDeCitacoes(lista));
  p.scrollToBottom?.();
}

/**
 * Diz ao leitor por que o clique nao levou ao ponto, quando nao levou.
 *
 * O MANUAL MUDA SOZINHO: vive em repositorio proprio e se atualiza por
 * manifesto. Uma citacao de semana passada pode apontar para uma frase
 * reescrita ou uma pagina renomeada, e sem explicacao o leitor conclui que a
 * assistente inventou a citacao. So fala quando ha o que falar.
 */
async function explicarCitacao(item: HTMLElement, resposta: { ok?: boolean; motivo?: string; versao?: string } | null | undefined): Promise<void> {
  let chave: string | null = null;
  const versao = resposta && resposta.versao;
  if (resposta && resposta.ok === false) {
    chave = resposta.motivo === 'manual-ausente'
      ? 'ai.citations.manualMissing'
      : 'ai.citations.pageGone';
  } else {
    // A pagina abriu; o realce e assincrono, entao o desfecho se pergunta
    // depois. `achou` falso quer dizer que a pagina esta la e a frase nao: o
    // caso classico de manual atualizado.
    let d: { achou?: boolean; motivo?: string } | null | undefined = null;
    try { d = await window.electronAPI?.docsRealceDesfecho?.(); } catch (_) { /* sem resposta */ }
    if (d && d.achou === false && d.motivo === 'trecho-ausente') chave = 'ai.citations.textGone';
  }
  const anterior = item.querySelector('.ai-citacao-nota');
  if (anterior) anterior.remove();
  if (!chave) return;

  const nota = document.createElement('p');
  nota.className = 'ai-citacao-nota';
  nota.setAttribute('data-i18n', chave);
  nota.textContent = chave;
  item.appendChild(nota);
  window.i18nApplyDOM?.(nota);
  // A versao vai DEPOIS da traducao, senao o applyDOM a apagaria ao reescrever
  // o texto da chave.
  if (versao) nota.textContent = `${nota.textContent} (${versao})`;
}

/**
 * O bloco embaixo da resposta: o titulo da pagina e a frase citada.
 *
 * A frase fica A VISTA, e nao atras de um hover: hover nao existe no toque, nao
 * sobrevive a um print e esconde o que a coisa existe para revelar. Frase
 * comprida e cortada por CSS e abre no botao. Sem marcador sobrescrito na
 * prosa: numa resposta em portugues corrido, ele le como artigo academico.
 *
 * Clicar no titulo abre o manual naquela pagina, com o trecho realcado.
 */
export function desenharBlocoDeCitacoes(lista: Array<Partial<CitacaoDoManual>>): HTMLElement {
  const bloco = document.createElement('div');
  bloco.className = 'ai-citacoes';

  const titulo = document.createElement('div');
  titulo.className = 'ai-citacoes-head';
  titulo.setAttribute('data-i18n', 'ai.citations.head');
  titulo.textContent = 'From the manual';
  bloco.appendChild(titulo);

  for (const c of lista) {
    const item = document.createElement('div');
    item.className = 'ai-citacao';

    const pagina = document.createElement('button');
    pagina.type = 'button';
    pagina.className = 'ai-citacao-pagina';
    pagina.textContent = c.titulo || c.pagina || '';
    pagina.title = c.pagina || '';
    pagina.addEventListener('click', async () => {
      // `docs:open-help` monta o caminho a partir da pasta do manual e recusa
      // caminho para fora dela (main/ipc/docs.js). O TRECHO vai junto: a janela
      // o procura, rola ate ele e o realca, em vez de abrir no topo da pagina.
      try {
        const r = await window.electronAPI?.docsOpenHelp?.(c.pagina as string, { trecho: c.trecho });
        explicarCitacao(item, r);
      } catch (e) {
        console.warn('[ai] nao consegui abrir o manual:', e);
      }
    });
    item.appendChild(pagina);

    const trecho = document.createElement('p');
    trecho.className = 'ai-citacao-trecho';
    trecho.textContent = c.trecho || '';
    item.appendChild(trecho);

    // O botao de expandir so aparece quando a frase REALMENTE nao coube: botao
    // que aparece sempre e clicado a toa.
    const mais = document.createElement('button');
    mais.type = 'button';
    mais.className = 'ai-citacao-mais hidden';
    mais.setAttribute('data-i18n', 'ai.citations.expand');
    mais.textContent = 'Expand';
    mais.addEventListener('click', () => {
      const aberto = item.classList.toggle('aberta');
      mais.setAttribute('data-i18n', aberto ? 'ai.citations.collapse' : 'ai.citations.expand');
      mais.textContent = aberto ? 'Collapse' : 'Expand';
      window.i18nApplyDOM?.(mais);
    });
    item.appendChild(mais);

    // A medida so vale depois de o elemento estar no documento e pintado.
    requestAnimationFrame(() => {
      if (trecho.scrollHeight > trecho.clientHeight + 1) mais.classList.remove('hidden');
    });

    bloco.appendChild(item);
  }

  // Traduzido na HORA DE MOSTRAR: quem troca o idioma com a conversa aberta
  // veria o bloco congelado no idioma de antes.
  window.i18nApplyDOM?.(bloco);
  return bloco;
}
