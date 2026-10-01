/**
 * layout_do_painel.ts: a largura do painel de IA e tudo o que anda com ela.
 *
 * Abrir e fechar, a largura de abertura, o limite que a janela impoe, o
 * divisor de largura e o canto que redimensiona o painel e o terminal juntos.
 * A regra de tamanho e uma so (`larguraPermitida`), e todos os caminhos passam
 * por ela: houve uma copia por arrastador, e uma delas errada.
 *
 * Saiu do ai_assistant_manager.js (TODO 13.3). O painel continua dono do
 * container e da abertura (initialize); cada funcao aqui o recebe como contexto.
 */

import { constrainTerminalHeight, persistTerminalHeight, faixaDosPaineis } from '../utils/resize.js';
import { resolvePaneSize, maxLateralWidth, PANE } from '../utils/pane_size.js';

/** O que o layout le e escreve do painel (js/ui/ai_assistant_manager.js). */
export interface PainelDoLayout {
  container: HTMLElement | null;
  inputEl?: HTMLElement | null;
  initialize(): void;
  refreshProviders(): Promise<unknown>;
  refreshChatList(): unknown;
}

const CHAVE_LARGURA = 'aurora-ai-panel-width';

/**
 * O unico lugar que decide a largura do painel e TODO o estado que anda com
 * ela: `open`, `is-collapsed`, o `ai-assistant-open` do body, o `inert` e o
 * `ai-collapsed` que acende o trilho da direita.
 *
 * Existe porque esses estados discordavam entre si. O arrasto mexia so na
 * largura e no `is-collapsed`, e o toggle decidia o sentido lendo `open`:
 * depois de fechar o painel arrastando o divisor ate o fim, o painel ficava
 * com largura zero e `open` ainda posto, e o primeiro clique no botao da barra
 * "fechava" o que ja estava fechado.
 *
 * @param w largura final, ja passada pelo limite
 */
export function aplicarLargura(p: PainelDoLayout, w: number): void {
  const c = p.container;
  if (!c) return;
  const aberto = w > 0;
  c.style.width = w + 'px';
  c.classList.toggle('open', aberto);
  c.classList.toggle('is-collapsed', !aberto);
  document.body.classList.toggle('ai-assistant-open', aberto);
  document.body.classList.toggle('ai-collapsed', !aberto);
  // Quem divide a tela com o painel (a orientacao das abas do terminal) ouve
  // isto e se ajusta na hora, sem esperar um quadro de renderizacao que numa
  // janela oculta pode nao vir.
  window.dispatchEvent(new CustomEvent('aurora:layout-changed', { detail: { origem: 'painel-ia', largura: w } }));
  // Com largura zero o painel continua no DOM, e sem isto o Tab e o leitor de
  // tela entram nele.
  if (aberto) c.removeAttribute('inert');
  else c.setAttribute('inert', '');
  try { localStorage.setItem('aurora-ai-panel-open', aberto ? '1' : '0'); } catch (_) { /* modo privado */ }
}

/**
 * A largura que o painel PODE ter, dado o que ele pediu.
 *
 * O teto nao e uma fracao da janela: e o que sobra depois da arvore de arquivos
 * e do minimo que o editor precisa. Calcular sobre `innerWidth` deixava o
 * painel crescer por cima do editor, que tem `min-width: 0` e por isso era
 * espremido ate zero, parecendo sobreposicao. A faixa vem de `faixaDosPaineis`,
 * compartilhada com o resize.js: a do `.main-container` menos os trilhos.
 *
 * @returns 0 quando colapsa, senao entre o minimo e o teto
 */
export function larguraPermitida(desejado: number): number {
  const tree = document.querySelector<HTMLElement>('.file-tree-container');
  return resolvePaneSize(desejado, {
    min: PANE.MIN_AI,
    collapseAt: PANE.COLLAPSE_AI,
    max: maxLateralWidth(
      faixaDosPaineis(),
      tree ? tree.offsetWidth : 0, PANE.MIN_EDITOR, PANE.MIN_AI,
    ),
  });
}

/**
 * Largura de abertura: a que a pessoa salvou, ou 480, sempre passada pelo
 * limite. A salva pode ter vindo de uma janela maior que a de agora, e era por
 * aqui que o painel voltava a invadir o terminal.
 */
function larguraDeAbertura(): number {
  let target = 480;
  try {
    const saved = parseInt(localStorage.getItem(CHAVE_LARGURA) as string, 10);
    if (saved >= 320) target = saved;
  } catch (_) { /* modo privado */ }
  return larguraPermitida(target);
}

/** Abre ou fecha aplicando a largura correspondente (o restore do arranque tambem). */
export function aplicarAbertura(p: PainelDoLayout, abrindo: boolean): void {
  if (!p.container) return;
  aplicarLargura(p, abrindo ? larguraDeAbertura() : 0);
}

/**
 * Abre o painel fechado, fecha o aberto.
 *
 * O sentido sai da largura ALVO, e nao da classe `open`: um painel fechado pelo
 * arrasto ainda a carregava, e o clique mandava fechar de novo. Alvo, e nao
 * medida: o `offsetWidth` de um painel fechado e 1, por causa da borda, e
 * durante os 240 ms da transicao ele devolve um valor do meio do caminho. A
 * largura inline e escrita por `aplicarLargura` de forma sincrona.
 */
export function alternar(p: PainelDoLayout): void {
  if (!p.container) p.initialize();
  const container = p.container as HTMLElement;
  const abrindo = !(parseInt(container.style.width, 10) > 0);
  // A transicao de `width` do CSS (240 ms) faz a animacao; aqui so o alvo.
  aplicarAbertura(p, abrindo);
  if (abrindo) {
    p.refreshProviders().then(() => p.inputEl?.focus());
    p.refreshChatList();
  }
}

/** Abre o painel se ele ainda nao estiver aberto (idempotente). */
export function garantirAberto(p: PainelDoLayout): void {
  if (!p.container) p.initialize();
  if (!(p.container as HTMLElement).classList.contains('open')) alternar(p);
}

/**
 * Reaplica o limite a largura atual, quando a janela muda de tamanho: uma
 * largura legitima numa janela grande passa a invadir o editor numa menor.
 */
export function reaplicarLimite(p: PainelDoLayout): void {
  const c = p.container;
  if (!c || !c.classList.contains('open')) return;
  const atual = parseInt((document.defaultView as Window).getComputedStyle(c).width, 10);
  if (!Number.isFinite(atual) || atual <= 0) return;
  const permitida = larguraPermitida(atual);
  if (permitida === atual) return;
  aplicarLargura(p, permitida);
}

/** O divisor da borda esquerda do painel: arrastar muda a largura; soltar a grava. */
export function ligarDivisorDeLargura(p: PainelDoLayout, handle: HTMLElement, container: HTMLElement): void {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    let active = true;
    let raf: number | null = null;
    const startX = e.clientX;
    const startWidth = parseInt((document.defaultView as Window).getComputedStyle(container).width, 10);

    document.body.classList.add('resizing-vertical');

    const onMove = (ev: MouseEvent) => {
      /* v8 ignore next */ // o mouseup zera `active` e tira este ouvinte na mesma chamada
      if (!active) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        aplicarLargura(p, larguraPermitida(startWidth + (startX - ev.clientX)));
      });
    };

    const onUp = () => {
      active = false;
      document.body.classList.remove('resizing-vertical');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (raf) cancelAnimationFrame(raf);
      try {
        const w = parseInt(container.style.width, 10);
        if (w >= 320) localStorage.setItem(CHAVE_LARGURA, String(w));
      } catch (_) { /* modo privado */ }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/**
 * O canto onde a borda esquerda do painel encontra o topo do terminal, o
 * espelho do canto arvore-terminal do resize.js. Arrastar muda a largura do
 * painel e a altura do terminal ao mesmo tempo. So existe com o painel aberto.
 *
 * Este canto tinha a PROPRIA copia da regra de largura, com o antigo
 * `innerWidth * 0.7`. Como ele fica por cima do divisor no encontro com o
 * terminal, era ele que a mao pegava, e o painel continuava invadindo depois
 * de o outro caminho ter sido corrigido. Agora ha uma regra so.
 */
export function ligarCantoDoTerminal(p: PainelDoLayout): void {
  const aiContainer = p.container;
  const terminalContainer = document.querySelector<HTMLElement>('.terminal-container');
  if (!aiContainer || !terminalContainer) return;

  const corner = document.createElement('div');
  corner.id = 'ai-terminal-corner-handle';
  // Area de toque generosa e invisivel; a pista visual vem dos divisores em que
  // ele se apoia. Fica acima do divisor de largura para a juncao pegar os dois eixos.
  Object.assign(corner.style, {
    position: 'fixed', width: '22px', height: '22px',
    background: 'transparent', cursor: 'all-scroll', zIndex: '100',
    display: 'none',
  });
  document.body.appendChild(corner);

  const isOpen = () => parseInt(aiContainer.style.width, 10) > 0;

  // Passar o mouse acende o divisor de largura e o do terminal, a pista de que
  // a juncao pega os dois, como o canto da arvore (styles.css / ai_assistant.css).
  corner.addEventListener('mouseenter', () => {
    if (isOpen()) document.body.classList.add('ai-corner-hovering');
  });
  corner.addEventListener('mouseleave', () => {
    document.body.classList.remove('ai-corner-hovering');
  });

  let posRaf: number | null = null;
  let lastL: number | null = null;
  let lastT: number | null = null;
  const position = () => {
    if (!isOpen()) { corner.style.display = 'none'; lastL = lastT = null; return; }
    const aiRect = aiContainer.getBoundingClientRect();
    const termRect = terminalContainer.getBoundingClientRect();
    const half = (corner.offsetWidth || 22) / 2;
    const left = aiRect.left - half;   // borda esquerda do painel
    const top = termRect.top - half;   // topo do terminal
    if (left === lastL && top === lastT && corner.style.display === 'block') return;
    lastL = left; lastT = top;
    corner.style.left = left + 'px';
    corner.style.top = top + 'px';
    corner.style.display = 'block';
  };
  const schedulePosition = () => {
    if (posRaf) return;
    posRaf = requestAnimationFrame(() => { posRaf = null; position(); });
  };

  let active = false, startX = 0, startY = 0, startW = 0, startH = 0;
  let dragRaf: number | null = null;

  const onMove = (e: MouseEvent) => {
    /* v8 ignore next */ // o mouseup zera `active` e tira este ouvinte na mesma chamada
    if (!active) return;
    if (dragRaf) cancelAnimationFrame(dragRaf);
    dragRaf = requestAnimationFrame(() => {
      // O painel fica a direita: arrastar para a esquerda (X menor) o alarga.
      const h = constrainTerminalHeight(startH - (e.clientY - startY));
      aplicarLargura(p, larguraPermitida(startW + (startX - e.clientX)));
      terminalContainer.style.height = h + 'px';
      position();
    });
  };

  const onUp = () => {
    /* v8 ignore next */ // idem: o ouvinte sai na primeira chamada
    if (!active) return;
    active = false;
    document.body.classList.remove('resizing-ai-corner');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (dragRaf) cancelAnimationFrame(dragRaf);
    try {
      const w = parseInt(aiContainer.style.width, 10);
      if (w >= PANE.MIN_AI) localStorage.setItem(CHAVE_LARGURA, String(w));
    } catch (_) { /* modo privado */ }
    // Com a mesma guarda dos outros arrastadores: gravar o colapso fazia o
    // terminal reabrir no padrao.
    persistTerminalHeight(terminalContainer.offsetHeight);
  };

  corner.addEventListener('mousedown', (e) => {
    if (!isOpen()) return;
    e.preventDefault();
    active = true;
    startX = e.clientX; startY = e.clientY;
    startW = aiContainer.offsetWidth;
    startH = terminalContainer.offsetHeight;
    // Classe propria (e nao a resizing-vertical/corner da arvore) para os
    // divisores da arvore, la na esquerda, nao acenderem. O CSS dela suspende
    // as transicoes dos dois paineis e acende o divisor de largura e o do terminal.
    document.body.classList.add('resizing-ai-corner');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // O canto acompanha a juncao quando qualquer das duas medidas (ou a abertura)
  // muda, um reflow por quadro. O ResizeObserver dispara tambem no primeiro
  // layout, entao o canto ja nasce no lugar.
  const ro = new ResizeObserver(schedulePosition);
  ro.observe(aiContainer);
  ro.observe(terminalContainer);
  window.addEventListener('resize', schedulePosition);
  position();
}
