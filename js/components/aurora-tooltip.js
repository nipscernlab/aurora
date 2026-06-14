import { LitElement, html, css } from 'lit';

/**
 * <aurora-tooltip> — the singleton floating tooltip (DESIGN §9).
 *
 * Just the visual surface: a box + a directional arrow, in Shadow DOM with the
 * semantic tokens. The controller (tooltip.js) still owns discovery
 * (MutationObserver over [data-tooltip]/[title] + the universal selector),
 * hover timing, enable/disable, and the positioning math; it drives this element
 * by setting `.content`, the `placement` attribute and the `--arrow-x` custom
 * property, then toggling the `visible` class. Because Lit renders async, the
 * controller awaits `updateComplete` before measuring/placing it.
 */
class AuroraTooltip extends LitElement {
  static properties = {
    content: { type: String },
    placement: { type: String, reflect: true }, // 'top' = box below cursor (arrow up) | 'bottom' = box above (arrow down)
  };

  constructor() {
    super();
    this.content = '';
    this.placement = 'bottom';
  }

  static styles = css`
    :host {
      position: fixed;
      left: 0;
      top: 0;
      /* Always above modals/popovers — a transient hint should never be
         occluded. (The old .custom-tooltip raised z-index only when a modal was
         open via a sibling selector; the component just stays on top.) */
      z-index: var(--z-tooltip-top, 10001);
      max-width: 280px;
      width: max-content;
      background: var(--surface-overlay);
      color: var(--text-default);
      border: 1px solid var(--border-hairline);
      border-radius: var(--radius-md, 6px);
      box-shadow: var(--shadow-md);
      font-family: var(--font-sans);
      font-size: var(--text-xs, 11px);
      line-height: 1.45;
      letter-spacing: var(--tracking-tight);
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity var(--motion-quick, 160ms) var(--ease-aurora, ease),
        transform var(--motion-quick, 160ms) var(--ease-aurora, ease);
      display: none;
    }
    :host(.visible) {
      opacity: 1;
      transform: translateY(0);
      display: block;
    }
    .content {
      padding: var(--space-2, 8px) var(--space-3, 12px);
      white-space: normal;
      overflow-wrap: break-word;
    }

    /* Arrow — a CSS triangle (::after = fill, ::before = 1px border edge),
       positioned horizontally by the --arrow-x the controller sets. */
    :host::after,
    :host::before {
      content: '';
      position: absolute;
      left: var(--arrow-x, 50%);
      margin-left: -6px;
      width: 0;
      height: 0;
      border: 6px solid transparent;
    }
    :host([placement='bottom'])::before {
      bottom: -13px;
      border-top-color: var(--border-hairline);
    }
    :host([placement='bottom'])::after {
      bottom: -12px;
      border-top-color: var(--surface-overlay);
    }
    :host([placement='top'])::before {
      top: -13px;
      border-bottom-color: var(--border-hairline);
    }
    :host([placement='top'])::after {
      top: -12px;
      border-bottom-color: var(--surface-overlay);
    }

    @media (prefers-reduced-motion: reduce) {
      :host {
        transition: none;
      }
    }
  `;

  render() {
    return html`<div class="content">${this.content}</div>`;
  }
}

customElements.define('aurora-tooltip', AuroraTooltip);

export { AuroraTooltip };
