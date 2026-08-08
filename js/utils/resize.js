/**
 * Panel Resizer — file tree (vertical) + terminal (horizontal) + corner.
 *
 * Fix: durante o drag, desabilitamos transitions de width/height nos containers
 * (via `body.resizing-*`), evitando o lag de 280ms causado pelo
 * `transition: width 0.28s` que existia em layout.css.
 */

// Registers <aurora-panel> (the file-tree sidebar's semantic shell) and supplies
// the shared collapse-threshold rule used by applyFileTreeWidth below.
import { nextCollapseState } from '../components/aurora-panel.js';
// Regra de tamanho compartilhada com o painel de IA: mínimo, colapso ao forçar,
// e teto que desconta os vizinhos. Ver js/utils/pane_size.js.
import { resolvePaneSize, maxLateralWidth, maxTerminalHeight, PANE } from './pane_size.js';

const verticalResizer   = document.querySelector('.resizer-vertical');
const horizontalResizer = document.querySelector('.resizer-horizontal');
const fileTreeContainer = document.querySelector('.file-tree-container');
const terminalContainer = document.querySelector('.terminal-container');

// File tree always keeps a minimum width while visible — guarantees the
// vertical resizer is reachable. Use the toolbar sidebar toggle to fully
// hide / restore the panel.
const MIN_FILE_TREE_WIDTH  = 180;
const COLLAPSED_THRESHOLD  = 24;
const DEFAULT_OPEN_WIDTH   = 260;
const MAX_FILE_TREE_RATIO  = 0.5;

// Altura do `.resizer-horizontal`, que fica entre o editor e o terminal e
// portanto sai do que sobra para os dois. Casa com o `height` dele no
// `css/base/styles.css`.
const RESIZER_HEIGHT = 6;

const STORAGE_FT_WIDTH = 'fileTreeWidth';
const STORAGE_TERM_H   = 'terminalHeight';

// Inject runtime CSS para hit-area do corner handle e estados de drag.
// (As classes `resizing-vertical/horizontal/corner` são consumidas em styles.css)
const style = document.createElement('style');
style.textContent = `
  body.resizing-vertical,
  body.resizing-vertical * { cursor: col-resize !important; user-select: none !important; }
  body.resizing-horizontal,
  body.resizing-horizontal * { cursor: row-resize !important; user-select: none !important; }
  body.resizing-corner,
  body.resizing-corner * { cursor: all-scroll !important; user-select: none !important; }

  #resize-corner-handle {
    position: fixed;
    /* Generous invisible hit area so the meeting point of the two resizers
       is easy to grab. Visual highlighting of the resizers on hover/active
       gives the user the discovery cue. */
    width: 22px;
    height: 22px;
    background: transparent;
    cursor: all-scroll;
    z-index: 100;
  }
`;
document.head.appendChild(style);


/**
 * Largura final da árvore a partir do que o arrasto pediu.
 *
 * Antes era um clamp simples entre o mínimo e metade da janela, o que travava
 * o arrasto no mínimo e tornava o `is-collapsed` inalcançável pelo divisor:
 * fechar só era possível pelo botão da barra. Agora forçar além do limiar
 * colapsa, como no VS Code. O teto também passou a descontar o painel de IA,
 * quando ele está aberto, e o mínimo do editor.
 */
function constrainFileTreeWidth(w) {
  const ai = document.querySelector('.ai-assistant-container');
  const larguraAi = ai ? ai.offsetWidth : 0;
  // A faixa disputada e a do .main-container, e nao a janela: os tres paineis
  // dividem ELE.
  const faixaEl = document.querySelector('.main-container');
  const faixa = faixaEl ? faixaEl.clientWidth : window.innerWidth;
  return resolvePaneSize(w, {
    min: MIN_FILE_TREE_WIDTH,
    collapseAt: PANE.COLLAPSE_LATERAL,
    max: Math.min(
      faixa * MAX_FILE_TREE_RATIO,
      maxLateralWidth(faixa, larguraAi, PANE.MIN_EDITOR, MIN_FILE_TREE_WIDTH),
    ),
  });
}

/**
 * Teto do terminal, medido na faixa que ele divide com o editor.
 *
 * Antes isto derivava de `window.innerHeight` menos a barra de ferramentas,
 * a barra de estado e o divisor, e não reservava nada para o editor. Duas
 * consequências, as duas medidas: o terminal podia crescer até engolir o
 * editor, e o número devolvido não batia com o `max-height: 80vh` que o
 * `terminal.css` também impunha. Quando o arrasto pedia mais que 80vh a caixa
 * parava de crescer e o resto virava vão acima do terminal, que nenhum arrasto
 * fechava. O CSS não impõe mais teto nenhum; a conta é esta, e é uma só.
 */
function getMaxTerminalHeight() {
  const faixaEl = document.querySelector('.editor-terminal-container');
  const faixa = faixaEl ? faixaEl.clientHeight : window.innerHeight;
  return maxTerminalHeight(
    faixa, RESIZER_HEIGHT, PANE.MIN_EDITOR_HEIGHT, PANE.MIN_TERMINAL,
  );
}

/** Mesma regra do painel lateral, no eixo vertical: encosta no mínimo, e
    colapsa quando o arrasto força além do limiar. */
function constrainTerminalHeight(h) {
  return resolvePaneSize(h, {
    min: PANE.MIN_TERMINAL,
    collapseAt: PANE.COLLAPSE_TERMINAL,
    max: getMaxTerminalHeight(),
  });
}

/**
 * Guarda a altura do terminal, e só quando ela é utilizável.
 *
 * Mesma regra da largura da árvore, pelo mesmo motivo: colapsar arrastando não
 * pode apagar a altura de volta, senão o terminal reabre no padrão em vez de
 * voltar ao tamanho em que estava. Havia três cópias desta linha, e só a do
 * canto tinha a guarda; as outras duas gravavam o colapso.
 */
function persistTerminalHeight(h) {
  if (h >= PANE.MIN_TERMINAL) {
    try { localStorage.setItem(STORAGE_TERM_H, String(h)); } catch (_) { /* modo privado */ }
  }
}

function applyFileTreeWidth(w) {
  if (!fileTreeContainer) return;
  fileTreeContainer.style.width = w + 'px';
  fileTreeContainer.classList.toggle('is-collapsed', nextCollapseState(w, COLLAPSED_THRESHOLD));
}

// Public toggle for the sidebar — exposed on window so the toolbar button
// `<button id="sidebarMenu" onclick="toggleSidebar()">` can reach it.
function toggleSidebar() {
  if (!fileTreeContainer) return;
  const isHidden = fileTreeContainer.classList.contains('is-collapsed') ||
                   fileTreeContainer.offsetWidth < COLLAPSED_THRESHOLD;
  if (isHidden) {
    const last = parseInt(localStorage.getItem(STORAGE_FT_WIDTH), 10);
    const bruto = (!isNaN(last) && last >= MIN_FILE_TREE_WIDTH) ? last : DEFAULT_OPEN_WIDTH;
    // Pelo mesmo limite do arrasto e do boot. A largura salva pode ter vindo de
    // uma janela maior, ou o painel de IA pode ter aberto desde entao: sem isto
    // reabrir a arvore devolvia uma largura que nao cabe mais.
    const target = constrainFileTreeWidth(bruto);
    applyFileTreeWidth(target);
    localStorage.setItem(STORAGE_FT_WIDTH, target);
  } else {
    // Persist the current width so we can restore it later.
    const current = fileTreeContainer.offsetWidth;
    if (current >= MIN_FILE_TREE_WIDTH) {
      localStorage.setItem(STORAGE_FT_WIDTH, current);
    }
    applyFileTreeWidth(0);
  }
}

if (typeof window !== 'undefined') {
  window.toggleSidebar = toggleSidebar;
}

// ── Vertical (file tree width) ────────────────────────────────────────────
function setupVerticalResizer() {
  let active = false, startX = 0, startW = 0, raf = null, lastW = 0;

  verticalResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    active = true;
    startX = e.clientX;
    startW = fileTreeContainer.offsetWidth;
    lastW  = startW;
    document.body.classList.add('resizing-vertical');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    if (!active) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      lastW = constrainFileTreeWidth(startW + (e.clientX - startX));
      fileTreeContainer.style.width = lastW + 'px';
    });
  }

  function onUp() {
    if (!active) return;
    active = false;

    // O colapso já foi decidido durante o arrasto, por constrainFileTreeWidth:
    // aqui só consolidamos a largura final e o estado da classe. O antigo
    // SNAP_THRESHOLD valia 0 e portanto nunca disparava.
    const finalW = lastW;
    applyFileTreeWidth(finalW);

    // Só persiste largura utilizável. Colapsar arrastando não pode apagar a
    // largura de volta, senão reabrir pelo botão cairia no padrão.
    if (finalW >= MIN_FILE_TREE_WIDTH) localStorage.setItem(STORAGE_FT_WIDTH, finalW);
    document.body.classList.remove('resizing-vertical');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (raf) cancelAnimationFrame(raf);
  }

  // Double-click toggles between fully-hidden and the saved/default width.
  verticalResizer.addEventListener('dblclick', () => {
    toggleSidebar();
  });
}

// ── Horizontal (terminal height) ──────────────────────────────────────────
function setupHorizontalResizer() {
  let active = false, startY = 0, startH = 0, raf = null;

  horizontalResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    active = true;
    startY = e.clientY;
    startH = terminalContainer.offsetHeight;
    document.body.classList.add('resizing-horizontal');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    if (!active) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const h = constrainTerminalHeight(startH - (e.clientY - startY));
      terminalContainer.style.height = h + 'px';
    });
  }

  function onUp() {
    if (!active) return;
    active = false;
    persistTerminalHeight(terminalContainer.offsetHeight);
    document.body.classList.remove('resizing-horizontal');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (raf) cancelAnimationFrame(raf);
  }
}

// ── Corner handle (both axes simultaneously) ─────────────────────────────
function setupCornerHandle() {
  const corner = document.createElement('div');
  corner.id = 'resize-corner-handle';
  document.body.appendChild(corner);

  let cornerRaf = null, lastLeft = null, lastTop = null;

  function positionCorner() {
    const ftRect   = fileTreeContainer.getBoundingClientRect();
    const termRect = terminalContainer.getBoundingClientRect();
    // Center the (now larger) handle on the resizer junction.
    const size = corner.offsetWidth || 22;
    const half = size / 2;
    const left = ftRect.right - half;
    const top  = termRect.top  - half;
    // Idempotent: skip the style writes when the junction hasn't moved. The
    // MutationObserver below fires on every width/height change during ANY
    // drag — without this guard each vertical/horizontal resize frame paid a
    // pointless corner reflow.
    if (left === lastLeft && top === lastTop) return;
    lastLeft = left;
    lastTop  = top;
    corner.style.left = left + 'px';
    corner.style.top  = top  + 'px';
  }

  // Coalesce observer/resize-driven repositioning into one reflow per frame.
  // (The corner's own drag handler calls positionCorner directly so the handle
  // tracks the cursor without a frame of lag.)
  function schedulePositionCorner() {
    if (cornerRaf) return;
    cornerRaf = requestAnimationFrame(() => {
      cornerRaf = null;
      positionCorner();
    });
  }

  // Hover discovery: lighting up both resizers when the user grazes the
  // junction is the cue that this corner is grabbable.
  corner.addEventListener('mouseenter', () => {
    document.body.classList.add('corner-hovering');
  });
  corner.addEventListener('mouseleave', () => {
    document.body.classList.remove('corner-hovering');
  });

  let active = false, startX = 0, startY = 0, startW = 0, startH = 0, raf = null;

  corner.addEventListener('mousedown', (e) => {
    e.preventDefault();
    active = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = fileTreeContainer.offsetWidth;
    startH = terminalContainer.offsetHeight;
    document.body.classList.add('resizing-corner');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    if (!active) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = constrainFileTreeWidth(startW + (e.clientX - startX));
      const h = constrainTerminalHeight(startH - (e.clientY - startY));
      fileTreeContainer.style.width  = w + 'px';
      terminalContainer.style.height = h + 'px';
      positionCorner();
    });
  }

  function onUp() {
    if (!active) return;
    active = false;
    // O colapso já vem decidido do arrasto; aqui só consolidamos.
    const finalW = fileTreeContainer.offsetWidth;
    applyFileTreeWidth(finalW);
    if (finalW >= MIN_FILE_TREE_WIDTH) localStorage.setItem(STORAGE_FT_WIDTH, finalW);
    persistTerminalHeight(terminalContainer.offsetHeight);
    document.body.classList.remove('resizing-corner');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (raf) cancelAnimationFrame(raf);
  }

  // ResizeObserver (not a style MutationObserver): it fires on the INITIAL
  // layout pass too, so the handle lands on the junction from the start. The old
  // style-observer only caught explicit inline-style writes, so on a fresh
  // profile (no saved sizes) the handle stayed mispositioned — and therefore not
  // hoverable — until the first manual resize.
  const ro = new ResizeObserver(schedulePositionCorner);
  if (fileTreeContainer) ro.observe(fileTreeContainer);
  if (terminalContainer) ro.observe(terminalContainer);
  window.addEventListener('resize', schedulePositionCorner);
  positionCorner();
}

// ── Init ─────────────────────────────────────────────────────────────────
function initPanelSizes() {
  const savedW = parseInt(localStorage.getItem(STORAGE_FT_WIDTH), 10);
  if (!isNaN(savedW) && fileTreeContainer) {
    applyFileTreeWidth(constrainFileTreeWidth(savedW));
  }
  const savedH = parseInt(localStorage.getItem(STORAGE_TERM_H), 10);
  if (!isNaN(savedH) && terminalContainer) {
    terminalContainer.style.height = constrainTerminalHeight(savedH) + 'px';
  }
}

if (verticalResizer && fileTreeContainer)   setupVerticalResizer();
if (horizontalResizer && terminalContainer) setupHorizontalResizer();
if (fileTreeContainer && terminalContainer) setupCornerHandle();

window.addEventListener('resize', () => {
  if (fileTreeContainer && !fileTreeContainer.classList.contains('is-collapsed')) {
    const w = constrainFileTreeWidth(fileTreeContainer.offsetWidth);
    fileTreeContainer.style.width = w + 'px';
  }
  if (terminalContainer) {
    const h = constrainTerminalHeight(terminalContainer.offsetHeight);
    terminalContainer.style.height = h + 'px';
  }
});

document.addEventListener('DOMContentLoaded', initPanelSizes);

export { constrainFileTreeWidth, constrainTerminalHeight, persistTerminalHeight };
