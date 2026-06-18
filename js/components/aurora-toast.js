import { LitElement, html, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

/**
 * <aurora-toast> — a single toast card (DESIGN §9).
 *
 * Self-managing: it plays its own entry/exit, runs its own auto-dismiss with a
 * progress bar, and pauses on hover — then removes itself from the DOM. The
 * notification.js stack just creates one, sets its properties and appends it;
 * trimStack() culls via the exposed dismiss()/dismissing. The public API
 * (showCardNotification / notify / window.showNotification) is unchanged.
 *
 * Shadow DOM + only the semantic tokens (DESIGN §3). The type icon uses the
 * Phosphor webfont — an @font-face is document-global, so it resolves inside the
 * shadow tree (the live app always loads Phosphor; the Design Lab links it too).
 * The per-type glyph is set via the --toast-glyph custom property below.
 */
class AuroraToast extends LitElement {
  static properties = {
    type: { type: String, reflect: true }, // success | error | warning | info
    heading: { type: String },
    message: { type: String },
    duration: { type: Number }, // ms; <= 0 = sticky
    phase: { type: String, reflect: true }, // enter | shown | exit
  };

  constructor() {
    super();
    this.type = 'info';
    this.heading = '';
    this.message = '';
    this.duration = 5000;
    this.phase = 'enter';
    /** read by notification.js trimStack() */
    this.dismissing = false;
    this._timerId = null;
    this._startTime = 0;
    this._remaining = 0;
    this._onEnter = () => this._pause();
    this._onLeave = () => this._resume();
  }

  connectedCallback() {
    super.connectedCallback();
    // Announce to assistive tech when the toast appears: errors/warnings are
    // assertive (interrupt the user), success/info are polite. role + aria-live
    // live on the host so the whole card is read; `type` is set before append.
    const assertive = this.type === 'error' || this.type === 'warning';
    if (!this.hasAttribute('role')) this.setAttribute('role', assertive ? 'alert' : 'status');
    if (!this.hasAttribute('aria-live')) this.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    this.setAttribute('aria-atomic', 'true');
  }

  static styles = css`
    :host {
      position: relative;
      display: flex;
      width: 100%;
      pointer-events: all;
      background: var(--surface-overlay);
      border: 1px solid var(--border-hairline);
      border-radius: var(--radius-lg, 8px);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
      color: var(--text-default);
      overflow: hidden;
      transform: translateX(0) scale(1);
      opacity: 1;
      transition: transform var(--motion-flow, 260ms) var(--ease-out-quart, ease),
        opacity var(--motion-flow, 260ms) var(--ease-out-quart, ease);
    }
    :host([phase='enter']) {
      transform: translateX(20px) scale(0.98);
      opacity: 0;
    }
    :host([phase='exit']) {
      transform: translateX(20px) scale(0.96);
      opacity: 0;
      transition-duration: var(--motion-quick, 200ms);
    }

    .sidebar {
      flex: none;
      width: 4px;
      background: var(--accent);
    }

    .content {
      flex: 1 1 0;
      display: flex;
      align-items: flex-start;
      gap: var(--space-3, 12px);
      padding: 12px 16px 12px 14px;
      min-width: 0;
    }
    .icon {
      flex: none;
      width: 18px;
      height: 18px;
      margin-top: 1px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-family: 'Phosphor';
      font-size: var(--icon-xl, 20px);
      line-height: 1;
    }
    .icon::before {
      content: var(--toast-glyph, '\\E2C8');
    }

    .text {
      flex: 1 1 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .title {
      font-weight: 600;
      font-size: var(--text-sm, 13px);
      color: var(--text-default);
      letter-spacing: var(--tracking-tight);
      line-height: 1.3;
    }
    .message {
      font-size: var(--text-sm, 13px);
      color: var(--text-muted);
      line-height: 1.45;
      word-break: break-word;
    }
    .message a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-sm, 4px);
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      color: var(--text-muted);
      background: transparent;
      border: 0;
      transition: background-color var(--motion-quick, 140ms) var(--ease-aurora, ease),
        color var(--motion-quick, 140ms) var(--ease-aurora, ease);
    }
    .close:hover {
      background: var(--overlay-hover);
      color: var(--text-default);
    }

    .progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 2px;
      width: 100%;
      background: var(--accent);
    }

    /* Per-type accent: glyph, sidebar, icon, progress. */
    :host([type='success']) {
      --toast-glyph: '\\E182';
    }
    :host([type='success']) .sidebar,
    :host([type='success']) .progress {
      background: var(--state-ok);
    }
    :host([type='success']) .icon {
      color: var(--state-ok);
    }
    :host([type='error']) {
      --toast-glyph: '\\E5DA';
    }
    :host([type='error']) .sidebar,
    :host([type='error']) .progress {
      background: var(--state-error);
    }
    :host([type='error']) .icon {
      color: var(--state-error);
    }
    :host([type='warning']) {
      --toast-glyph: '\\E5CC';
    }
    :host([type='warning']) .sidebar,
    :host([type='warning']) .progress {
      background: var(--state-warn);
    }
    :host([type='warning']) .icon {
      color: var(--state-warn);
    }
    :host([type='info']) {
      --toast-glyph: '\\E2C8';
    }
    :host([type='info']) .sidebar,
    :host([type='info']) .progress {
      background: var(--state-info);
    }
    :host([type='info']) .icon {
      color: var(--state-info);
    }

    @media (prefers-reduced-motion: reduce) {
      :host {
        transition: none;
      }
    }
  `;

  render() {
    return html`
      <div class="sidebar"></div>
      <div class="content">
        <span class="icon" aria-hidden="true"></span>
        <div class="text">
          <div class="title">${this.heading}</div>
          <div class="message">${unsafeHTML(this.message)}</div>
        </div>
      </div>
      <button class="close" aria-label="Dismiss" @click=${() => this.dismiss()}>&#x2715;</button>
      <div class="progress"></div>
    `;
  }

  firstUpdated() {
    this._remaining = this.duration;
    // Play the entry on the next frame (the 'enter' state is painted first).
    requestAnimationFrame(() => {
      this.phase = 'shown';
    });
    this.addEventListener('mouseenter', this._onEnter);
    this.addEventListener('mouseleave', this._onLeave);
    const bar = this._progressEl;
    if (this.duration > 0) {
      if (bar) bar.style.width = '100%';
      requestAnimationFrame(() => this._resume());
    } else if (bar) {
      bar.style.display = 'none';
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._timerId);
    this.removeEventListener('mouseenter', this._onEnter);
    this.removeEventListener('mouseleave', this._onLeave);
  }

  get _progressEl() {
    return this.renderRoot?.querySelector('.progress') ?? null;
  }

  _resume() {
    if (this.duration <= 0 || this.dismissing) return;
    this._startTime = Date.now();
    clearTimeout(this._timerId);
    this._timerId = setTimeout(() => this.dismiss(), this._remaining);
    const bar = this._progressEl;
    if (bar) {
      bar.style.transition = `width ${this._remaining}ms linear`;
      bar.style.width = '0%';
    }
  }

  _pause() {
    if (this.duration <= 0 || this.dismissing) return;
    clearTimeout(this._timerId);
    this._remaining -= Date.now() - this._startTime;
    const bar = this._progressEl;
    if (bar) {
      const computed = getComputedStyle(bar).width;
      bar.style.transition = 'none';
      bar.style.width = computed;
    }
  }

  /** Public: animate out and remove. Idempotent. */
  dismiss() {
    if (this.dismissing) return;
    this.dismissing = true;
    clearTimeout(this._timerId);
    this.phase = 'exit';
    const remove = () => this.remove();
    this.addEventListener('transitionend', remove, { once: true });
    // Hard fallback if transitionend doesn't fire (reduced-motion, etc.).
    setTimeout(remove, 400);
  }
}

customElements.define('aurora-toast', AuroraToast);

export { AuroraToast };
