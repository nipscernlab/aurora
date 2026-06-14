import { LitElement, html, css } from 'lit';

// Phosphor's class icons don't cross a shadow root; pull the stylesheet into the
// shadow for the close glyph (absolute URL via document.baseURI; font cached).
const PHOSPHOR_HREF = new URL('vendor/phosphor/src/regular/style.css', document.baseURI).href;

/**
 * <aurora-modal> — the shared modal chrome (DESIGN §9), matching the app's
 * modal look (was modal_config.css): a blurred scrim, a luminous-bordered panel
 * with an aurora glow ring, a header with a close button, and a scale/opacity
 * enter.
 *
 * Chrome only — the modal's CONTENT stays in the LIGHT DOM via slots, so every
 * form field id, handler and data-i18n keeps working untouched:
 *   • slot="title"   — the heading (icon + text)
 *   • (default slot) — the body
 *   • slot="footer"  — the action buttons
 * It self-manages dismissal (backdrop click + the ✕ button) by emitting
 * `aurora-modal-close`; modal_system.js owns the open stack + ESC and drives the
 * reflected `open` property. Closed, the host is pointer-events:none so it's
 * never an invisible click-wall over the app.
 *
 * Attributes: open (reflect) · size ('' | small | medium | large) ·
 * dismissable (default true; set dismissable="false" to disable backdrop close).
 */
class AuroraModal extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    size: { type: String },
    dismissable: { type: Boolean },
  };

  constructor() {
    super();
    this.open = false;
    this.size = '';
    this.dismissable = true;
  }

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal, 1000);
      pointer-events: none;            /* closed: never a click-wall */
    }
    :host([open]) { pointer-events: auto; }

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
    :host([open]) .overlay {
      opacity: 1;
      visibility: visible;
      transition: opacity var(--motion-flow, 200ms) var(--ease-out-quart, ease);
    }

    /* Same surface as the app's modals: luminous border + aurora glow ring. */
    .panel {
      position: relative;
      width: 100%;
      max-width: 460px;
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
    :host([open]) .panel { transform: scale(1) translateY(0); opacity: 1; }
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
    /* The slotted title carries the icon + text (with their own data-i18n). */
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

    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
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
            <button class="close" aria-label="Close" @click=${this._close}>
              <i class="ph ph-x" aria-hidden="true"></i>
            </button>
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

  updated(changed) {
    if (changed.has('open') && this.open) {
      // Focus the first interactive control in the slotted body (light DOM).
      const focusable = this.querySelector(
        'input:not([type=hidden]), select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable) focusable.focus();
    }
  }
}

customElements.define('aurora-modal', AuroraModal);

export { AuroraModal };
