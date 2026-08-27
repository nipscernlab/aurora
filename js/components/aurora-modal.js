import { LitElement, html, css } from 'lit';

// Phosphor's class icons don't cross a shadow root; pull the stylesheet into the
// shadow for the close glyph (absolute URL via document.baseURI; font cached).
const PHOSPHOR_HREF = new URL('vendor/phosphor/src/regular/style.css', document.baseURI).href;

/**
 * <aurora-modal>, the shared modal chrome (DESIGN §9), matching the app's modal
 * look (was modal_config.css): a blurred scrim, a luminous-bordered glow panel,
 * a header with a close button, and a scale/opacity enter.
 *
 * Drop-in for the old `.modal-overlay` div: it shows/hides PURELY from the same
 * signals the existing code already toggles, `aria-hidden="false"`, the `.show`
 * class (modal_system / processor-hub / wave-config) or the `.visible` class
 * (aurora-settings), so every existing controller keeps working untouched. The
 * modal's CONTENT stays in the LIGHT DOM via slots, so every form id, handler and
 * data-i18n is preserved:
 *   • slot="title"  , the heading (icon + text)
 *   • slot="actions", optional header buttons (e.g. a modal's own ✕, which may
 *                      run extra cleanup); set `noclose` to hide the built-in ✕
 *   • (default slot), the body (e.g. <main class="modal-body">)
 *   • slot="footer" , the action buttons
 * Its built-in backdrop + ✕ live in the shadow (the document-level backdrop
 * delegation can't reach them), so it emits `aurora-modal-close` for modal_system
 * to close it through the unified stack. Closed, the host is pointer-events:none.
 *
 * Attributes: size ('' | small | medium | large) · dismissable (default true) ·
 * noclose (hide the built-in ✕). `el.open = true/false` is sugar over aria-hidden.
 */
class AuroraModal extends LitElement {
  static properties = {
    size: { type: String },
    dismissable: { type: Boolean },
    noclose: { type: Boolean },
  };

  constructor() {
    super();
    this.size = '';
    this.dismissable = true;
    this.noclose = false;
    this._trapped = false;
    this._inerted = [];
    this._returnFocusTo = null;
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('aria-hidden') &&
        !this.classList.contains('show') &&
        !this.classList.contains('visible')) {
      this.setAttribute('aria-hidden', 'true');
    }
    // P17 a11y: inert on the host when closed, prevents Tab + screen reader from
    // reaching slotted content inside a visually-hidden modal.
    this._syncInert();
    this._mutObs = new MutationObserver(() => this._syncInert());
    this._mutObs.observe(this, { attributes: true, attributeFilter: ['aria-hidden', 'class'] });
    AuroraModal._ensureGlobalKeydown();
  }

  // Esc closes the topmost open, dismissable modal. One shared capture-phase
  // listener handles every <aurora-modal> (Find in files, Source Control, …) so
  // each panel doesn't have to wire its own, and so Esc works regardless of
  // where focus sits inside the modal.
  static _ensureGlobalKeydown() {
    if (AuroraModal._keydownBound) return;
    AuroraModal._keydownBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const open = Array.from(document.querySelectorAll('aurora-modal'))
        .filter((m) => m.open && m.dismissable && !m.noclose);
      if (!open.length) return;
      e.preventDefault();
      e.stopPropagation();
      open[open.length - 1]._close(); // topmost in DOM order
    }, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._mutObs?.disconnect();
  }

  _syncInert() {
    const isOpen = this.open;
    this.toggleAttribute('inert', !isOpen);
    if (isOpen === this._trapped) return;
    this._trapped = isOpen;
    if (isOpen) this._trapFocus();
    else this._releaseFocus();
  }

  // Focus trap (the partner to aria-modal): while open, make every OTHER
  // top-level element inert so Tab and screen readers can't reach the
  // background, and move focus into the modal. Stacked modals nest correctly:
  // each one inerts everything else, and closing the top restores the one
  // beneath. We only un-inert what WE set, so an already-closed sibling modal
  // (inert via P17) stays inert.
  _trapFocus() {
    this._returnFocusTo = (this.getRootNode && this.getRootNode().activeElement) || document.activeElement;
    this._inerted = [];
    for (const el of Array.from(document.body.children)) {
      if (el === this || el.contains(this)) continue;
      if (!el.hasAttribute('inert')) { el.setAttribute('inert', ''); this._inerted.push(el); }
    }
    this.updateComplete.then(() => {
      const f = this.querySelector(
        'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) || (this.renderRoot && this.renderRoot.querySelector('.close'));
      if (f) f.focus();
    });
  }

  _releaseFocus() {
    for (const el of this._inerted) el.removeAttribute('inert');
    this._inerted = [];
    const t = this._returnFocusTo;
    this._returnFocusTo = null;
    // Restore focus to whatever opened the modal (if it's still around).
    if (t && document.contains(t) && typeof t.focus === 'function') t.focus();
  }

  get open() {
    return this.getAttribute('aria-hidden') === 'false' ||
      this.classList.contains('show') ||
      this.classList.contains('visible');
  }

  set open(v) {
    this.setAttribute('aria-hidden', v ? 'false' : 'true');
    // Focus management + the background inert run in _syncInert (fired by the
    // MutationObserver) so they happen for EVERY open path, el.open, the .show
    // class (modal_system) and the .visible class (settings) alike.
  }

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal, 1000);
      pointer-events: none;            /* closed: never a click-wall */
    }
    :host([aria-hidden='false']),
    :host(.show),
    :host(.visible) { pointer-events: auto; }

    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-4, 16px);
      overflow-y: auto;
      background: var(--bg-overlay);
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      opacity: 0;
      visibility: hidden;
      transition: opacity var(--motion-flow, 200ms) var(--ease-out-quart, ease),
        visibility 0s linear var(--motion-flow, 200ms);
    }
    :host([aria-hidden='false']) .overlay,
    :host(.show) .overlay,
    :host(.visible) .overlay {
      opacity: 1;
      visibility: visible;
      transition: opacity var(--motion-flow, 200ms) var(--ease-out-quart, ease);
    }

    /* Same surface as the app's modals: luminous border + aurora glow ring. */
    .panel {
      position: relative;
      width: 100%;
      /* Per-size default; a host can override with --aurora-modal-width (e.g. the
         wide Settings modal). */
      max-width: var(--aurora-modal-width, 460px);
      max-height: 86vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--surface-overlay);
      border: 1px solid var(--border-luminous);
      border-radius: var(--radius-xl, 12px);
      box-shadow: 0 16px 50px -12px rgba(0, 0, 0, 0.6),
        0 0 40px -12px var(--accent-glow),
        var(--shadow-inset-line);
      transform: scale(0.97) translateY(6px);
      opacity: 0;
      transition: transform var(--motion-flow, 220ms) var(--ease-out-quart, ease),
        opacity var(--motion-quick, 160ms) var(--ease-out-quart, ease);
    }
    :host([aria-hidden='false']) .panel,
    :host(.show) .panel,
    :host(.visible) .panel { transform: scale(1) translateY(0); opacity: 1; }
    .panel.size-small  { max-width: 360px; }
    .panel.size-medium { max-width: 540px; }
    .panel.size-large  { max-width: 640px; }

    .header {
      flex-shrink: 0;
      height: 48px;
      display: flex;
      align-items: center;
      gap: var(--space-2, 8px);
      padding: 0 var(--space-2, 8px) 0 var(--space-4, 16px);
      border-bottom: 1px solid var(--border-hairline);
    }
    .title {
      flex: 1 1 auto;
      min-width: 0;
      font-size: var(--text-md, 15px);
      font-weight: var(--font-semibold, 600);
      color: var(--text-bright);
      letter-spacing: var(--tracking-tight);
    }
    ::slotted([slot='title']) {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2, 8px);
    }

    .close {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: var(--radius-md, 6px);
      background: transparent;
      color: var(--text-muted);
      font-size: var(--text-md, 16px);
      cursor: pointer;
      transition: background-color var(--motion-quick, 140ms) ease,
        color var(--motion-quick, 140ms) ease;
    }
    .close:hover { background: var(--overlay-hover); color: var(--text-bright); }
    .close:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }

    /* Passthrough flex column, the slotted body (e.g. .modal-body) keeps its own
       padding + overflow, so we don't impose a second scroll region. */
    .body {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    @media (prefers-reduced-motion: reduce) {
      .overlay, .panel { transition: none; }
    }
  `;

  render() {
    return html`
      <link rel="stylesheet" href=${PHOSPHOR_HREF} />
      <div class="overlay" @mousedown=${this._onBackdrop}>
        <div
          class="panel size-${this.size || 'default'}"
          role="dialog"
          aria-modal="true"
          @mousedown=${this._stop}
        >
          <header class="header">
            <div class="title"><slot name="title"></slot></div>
            <slot name="actions"></slot>
            ${this.noclose
              ? ''
              : html`<button class="close" aria-label="Close" @click=${this._close}>
                  <i class="ph ph-x" aria-hidden="true"></i>
                </button>`}
          </header>
          <div class="body"><slot></slot></div>
          <slot name="footer"></slot>
        </div>
      </div>
    `;
  }

  _stop(e) { e.stopPropagation(); }

  _onBackdrop(e) {
    if (e.target === e.currentTarget && this.dismissable) this._close();
  }

  _close() {
    this.dispatchEvent(new CustomEvent('aurora-modal-close', { bubbles: true, composed: true }));
  }
}

customElements.define('aurora-modal', AuroraModal);

export { AuroraModal };
