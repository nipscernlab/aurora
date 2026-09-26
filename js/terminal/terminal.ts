/**
 * Troca a aba visivel do painel de terminais (tcmm/tasm/tveri/twave/...).
 *
 * Unica implementacao, compilation_flow.js e wave_config_manager.js
 * importam daqui (havia uma copia local em compilation_flow e um
 * window.switchTerminal global; consolidado em 2026-06).
 */
/**
 * Slide the single shared active-tab indicator to `activeTab`.
 *
 * Replaces the per-tab `.active::after` bar (which just popped on/off between
 * tabs) with one element that animates its position, so the accent bar glides
 * from the old tab to the new one. The indicator lives inside the scrolling
 * tab list, so it tracks the tabs as the strip scrolls for free.
 */
function positionTerminalIndicator(activeTab: HTMLElement): void {
  const list = activeTab?.closest('.terminal-tabs-list');
  if (!list || !activeTab) return;
  let ind = list.querySelector(':scope > .terminal-tab-indicator') as HTMLElement | null;
  if (!ind) {
    ind = document.createElement('div');
    ind.className = 'terminal-tab-indicator';
    list.appendChild(ind);
  }
  // Match the old ::after inset (left:6 / right:6).
  const left = activeTab.offsetLeft + 6;
  const width = Math.max(0, activeTab.offsetWidth - 12);
  ind.style.transform = `translateX(${left}px)`;
  ind.style.width = `${width}px`;
  ind.classList.add('visible');
}

/**
 * Smoothly follow a scroll container to its TRUE bottom, with acceleration and
 * deceleration. One self-sustaining rAF loop per element (guarded by
 * `_followRAF`) that RE-READS scrollHeight every frame, so it stays locked to
 * the bottom while text is still streaming in, and while `content-visibility:
 * auto` rows settle their real height only after the first paint. That is what
 * fixes both "stops short / cuts off content" (a single scrollTop = scrollHeight
 * lands before the bottom rows have height) and "doesn't follow while spitting
 * text". A spring drives the motion: velocity builds from rest (ease-in) and
 * decays as the gap closes (ease-out). Cheap to call on every appended line, a
 * call while the loop is already running is a no-op; it stops once it reaches
 * the bottom and a later append restarts it.
 */
/** O que a rolagem precisa: a caixa que rola, com o laco pendurado nela. */
interface Rolavel {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  _followRAF?: number;
  _followVel?: number;
}

export function smoothFollowToBottom(el: Rolavel | Element | null | undefined): void {
  const r = el as Rolavel | null | undefined;
  if (!r || r._followRAF) return;
  const CAP = 45;          // px/frame ceiling: a controlled glide, never a teleport
  r._followVel = 0;
  let atBottom = 0;        // consecutive frames settled at a STABLE bottom
  let lastTarget = -1;
  const step = () => {
    const target = r.scrollHeight - r.clientHeight;
    const gap = target - r.scrollTop;
    const stable = Math.abs(target - lastTarget) < 0.5;   // height stopped changing
    lastTarget = target;
    if (gap > 0.5) {
      atBottom = 0;
      // Spring: accelerates from rest (ease-in) and decelerates as the gap closes
      // (ease-out). The CAP keeps a big jump (tab switch) or a fast burst a
      // visible glide instead of the near-instant snap it was without it.
      // Velocity retention 0.62 (was 0.72) = MORE friction, so it brakes more
      // gradually near the end, a softer, smoother landing.
      r._followVel = Math.min(((r._followVel as number) + gap * 0.16) * 0.62, gap, CAP);
      r.scrollTop += Math.max(r._followVel, 1);
      r._followRAF = requestAnimationFrame(step);
      return;
    }
    // At the bottom, but don't stop yet. content-visibility:auto rows settle
    // their REAL height only a few frames after we arrive (worst on a tab
    // switch, where the whole body was unrendered while hidden), which moves the
    // true bottom down. Snap exactly and keep watching until the height has held
    // steady for a few frames, otherwise the view stops short of the last line.
    r.scrollTop = target;
    r._followVel = 0;
    if (stable && atBottom++ > 5) { r._followRAF = 0; return; }
    r._followRAF = requestAnimationFrame(step);
  };
  r._followRAF = requestAnimationFrame(step);
}

export function switchTerminal(targetId: string): void {
  const targetContent = document.getElementById(targetId);

  // Verificacao de seguranca: se o terminal nao existir no HTML, bail
  // antes de esconder os outros, senao o painel inteiro fica em branco.
  if (!targetContent) {
    console.error(`Erro: O elemento terminal com ID "${targetId}" nao foi encontrado no HTML.`);
    return;
  }

  // Hide all terminal content sections
  document.querySelectorAll('.terminal-content').forEach(content => content.classList.add('hidden'));

  // Remove the 'active' class from all tabs
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));

  // Show the selected terminal content
  targetContent.classList.remove('hidden');

  // Entering a terminal ALWAYS lands at the bottom. Content may have streamed in
  // while this terminal was hidden, its scrollHeight was 0/stale then, so the
  // per-append follow couldn't stick. Now that it's visible, glide to the end
  // (smoothFollowToBottom re-reads the height until it truly reaches the last
  // line, so it never stops short on content-visibility rows).
  smoothFollowToBottom(targetContent.querySelector('.terminal-body'));

  // Mark the corresponding tab as active
  // O replace remove o prefixo 'terminal-' para achar o data-terminal correto
  const dataTerm = targetId.replace('terminal-', '');
  const activeTab = document.querySelector<HTMLElement>(`.tab[data-terminal="${dataTerm}"]`);

  if (activeTab) {
    activeTab.classList.add('active');
    positionTerminalIndicator(activeTab);
  }
}

// Keep the sliding indicator aligned with the active terminal tab on first
// paint and whenever the strip reflows (window resize).
function syncTerminalIndicator() {
  const active = document.querySelector<HTMLElement>('.terminal-tabs-list .tab.active');
  if (active) positionTerminalIndicator(active);
}
window.addEventListener('resize', syncTerminalIndicator, { passive: true });
// This module is deferred, so the DOM is already parsed when it runs; position
// the indicator on the next frame (after layout) for the initial active tab.
requestAnimationFrame(syncTerminalIndicator);

// Compilation buttons focus the terminal their output lands in.
document.getElementById('cmmcomp')?.addEventListener('click', () => {
  switchTerminal('terminal-tcmm');
});

document.getElementById('vericomp')?.addEventListener('click', () => {
  switchTerminal('terminal-tveri');
});

document.getElementById('wavecomp')?.addEventListener('click', () => {
  switchTerminal('terminal-twave');
});

document.getElementById('prismcomp')?.addEventListener('click', () => {
  switchTerminal('terminal-tveri');
});

// Terminal tab strip.
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTerminal = tab.getAttribute('data-terminal');
    if (targetTerminal) {
      switchTerminal(`terminal-${targetTerminal}`);
    }
  });
});
