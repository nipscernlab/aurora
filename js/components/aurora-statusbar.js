import { LitElement, html, css } from 'lit';

/**
 * <aurora-statusbar> — the bottom status bar, as a Lit Web Component.
 *
 * The first shell component (DESIGN §9) and the pattern every other one follows:
 *   • Shadow DOM, so styles never leak and never need `!important`.
 *   • Reads only the SEMANTIC tokens (DESIGN §3) — they inherit across the
 *     shadow boundary from :root, so the component never cites a base token or a
 *     hardcoded hex.
 *   • Movement only via the motion tokens; the status dot glows with the state
 *     colour (DESIGN §4 — elevate by light, not shadow); reduced-motion honoured.
 *   • Reactive properties drive the display. Live wiring to ProjectStore/events
 *     happens when it replaces the light-DOM `.status-bar` (Fase C); for now it
 *     is exercised, in every state, by the Design Lab (html/design-lab.html).
 */
class AuroraStatusbar extends LitElement {
  static properties = {
    statusText: { type: String },
    statusKind: { type: String, reflect: true }, // ok | warn | error | info | idle
    processor: { type: String },
    topLevel: { type: String },
    testbench: { type: String },
    simulator: { type: String },
    cursor: { type: String },
  };

  constructor() {
    super();
    this.statusText = 'Ready';
    this.statusKind = 'idle';
    this.processor = '';
    this.topLevel = '';
    this.testbench = '';
    this.simulator = '';
    this.cursor = '';
  }

  static styles = css`
    :host {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      height: var(--h-statusbar, 24px);
      padding: 0 var(--space-3, 12px);
      background: var(--surface-raised);
      border-top: 1px solid var(--border-hairline);
      color: var(--text-muted);
      font-family: var(--font-sans);
      font-size: var(--text-xs, 11px);
      letter-spacing: var(--tracking-tight);
      user-select: none;
    }

    .zone {
      display: inline-flex;
      align-items: center;
      gap: var(--space-3, 12px);
      min-width: 0;
    }
    .zone.right {
      justify-content: flex-end;
    }

    .item {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1, 4px);
      white-space: nowrap;
    }
    .item.dim {
      color: var(--text-faint);
    }
    .label {
      color: var(--text-faint);
    }
    .value {
      color: var(--text-default);
    }
    .status-text {
      color: var(--text-default);
    }

    /* Status dot — glows with the state colour (light, not shadow). */
    .dot {
      width: 7px;
      height: 7px;
      flex: none;
      border-radius: var(--radius-full, 9999px);
      background: var(--dot-color, var(--text-muted));
      box-shadow: 0 0 8px -1px var(--dot-color, transparent);
      transition: background var(--motion-quick, 140ms) var(--ease-aurora),
        box-shadow var(--motion-quick, 140ms) var(--ease-aurora);
    }
    :host([statuskind='ok']) {
      --dot-color: var(--state-ok);
    }
    :host([statuskind='warn']) {
      --dot-color: var(--state-warn);
    }
    :host([statuskind='error']) {
      --dot-color: var(--state-error);
    }
    :host([statuskind='info']) {
      --dot-color: var(--state-info);
    }
    :host([statuskind='idle']) {
      --dot-color: var(--text-muted);
    }

    /* Active-processor chip — marked with the aurora focus ray (DESIGN §5). */
    .chip {
      display: inline-flex;
      align-items: center;
      padding: 1px var(--space-2, 8px);
      border-radius: var(--radius-sm, 4px);
      background: var(--surface-sunken);
      color: var(--text-default);
      border-left: var(--ray-width, 2px) solid transparent;
      border-image: var(--focus-ray) 1;
    }

    @media (prefers-reduced-motion: reduce) {
      .dot {
        transition: none;
      }
    }
  `;

  render() {
    return html`
      <div class="zone left">
        <span class="item">
          <span class="dot"></span>
          <span class="status-text">${this.statusText}</span>
        </span>
        ${this.processor ? html`<span class="chip">${this.processor}</span>` : ''}
      </div>

      <div class="zone center"><slot></slot></div>

      <div class="zone right">
        ${this.topLevel
          ? html`<span class="item"><span class="label">top</span><span class="value">${this.topLevel}</span></span>`
          : ''}
        ${this.testbench
          ? html`<span class="item"><span class="label">tb</span><span class="value">${this.testbench}</span></span>`
          : ''}
        ${this.simulator
          ? html`<span class="item"><span class="label">sim</span><span class="value">${this.simulator}</span></span>`
          : ''}
        ${this.cursor ? html`<span class="item dim">${this.cursor}</span>` : ''}
      </div>
    `;
  }
}

customElements.define('aurora-statusbar', AuroraStatusbar);

export { AuroraStatusbar };
