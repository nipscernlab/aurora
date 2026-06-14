import { LitElement, html, css } from 'lit';

// Phosphor lives at the document level; class-based icons (.ph) don't pierce a
// shadow root, so the palette pulls the stylesheet into its own shadow. Absolute
// URL via document.baseURI so it resolves in dev (http) and built (file://).
// The webfont itself is already loaded/cached by index.html.
const PHOSPHOR_HREF = new URL('vendor/phosphor/src/regular/style.css', document.baseURI).href;

/**
 * <aurora-command-palette> — the Ctrl+Shift+K action surface (DESIGN §9/§11).
 *
 * View only: command_palette.js keeps the command registry, the fuzzy scoring
 * and the global keyboard handling (open shortcut + while-open nav). It drives
 * this element via `.items` (the filtered list, in display order) + `.selected`
 * + `.open`, and listens for the events it emits:
 *   • cmdk-input  (detail: query)  — the user typed
 *   • cmdk-run    (detail: index)  — an item was clicked
 *   • cmdk-hover  (detail: index)  — pointer moved over an item
 *   • cmdk-close                   — the backdrop was clicked
 * Shadow DOM + semantic tokens; the input is focused/cleared on open.
 */
class AuroraCommandPalette extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    items: { attribute: false }, // [{ title, icon, group }]
    selected: { type: Number },
  };

  constructor() {
    super();
    this.open = false;
    this.items = [];
    this.selected = 0;
  }

  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: var(--z-command, 10050);
      /* Closed, the host still spans the screen at a huge z-index — without this
         it would be an invisible click-wall over the whole IDE. Only the open
         state is interactive (and catches the backdrop click). */
      pointer-events: none;
    }
    :host([open]) {
      pointer-events: auto;
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 14vh;
      background: var(--bg-overlay);
      backdrop-filter: blur(14px) saturate(140%);
      -webkit-backdrop-filter: blur(14px) saturate(140%);
      opacity: 0;
      visibility: hidden;
      transition: opacity var(--motion-quick, 140ms) var(--ease-out-quart, ease),
        visibility 0s linear var(--motion-quick, 140ms);
    }
    :host([open]) .overlay {
      opacity: 1;
      visibility: visible;
      transition: opacity var(--motion-quick, 140ms) var(--ease-out-quart, ease);
    }

    /* Same surface as the app's modals (modal_config.css): luminous border +
       aurora glow ring, no flat top bar. */
    .panel {
      position: relative;
      width: min(560px, 92vw);
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      background: var(--surface-overlay);
      border: 1px solid var(--border-luminous);
      border-radius: var(--radius-xl, 12px);
      box-shadow: 0 16px 50px -12px rgba(0, 0, 0, 0.6),
        0 0 40px -12px var(--accent-glow),
        var(--shadow-inset-line);
      overflow: hidden;
      transform: scale(0.97) translateY(6px);
      opacity: 0;
      transition: transform var(--motion-flow, 220ms) var(--ease-out-quart, ease),
        opacity var(--motion-quick, 160ms) var(--ease-out-quart, ease);
    }
    :host([open]) .panel {
      transform: scale(1) translateY(0);
      opacity: 1;
    }

    .input-row {
      display: flex;
      align-items: center;
      gap: var(--space-2, 8px);
      padding: 0 var(--space-3, 12px);
      height: 48px;
      border-bottom: 1px solid var(--border-hairline);
      flex-shrink: 0;
    }
    .input-icon {
      color: var(--text-muted);
      font-size: var(--text-md, 16px);
    }
    .input {
      flex: 1 1 0;
      min-width: 0;
      background: transparent;
      border: none;
      outline: none;
      color: var(--text-default);
      font-family: var(--font-sans);
      font-size: var(--text-md, 15px);
      letter-spacing: var(--tracking-tight);
    }
    .input::placeholder {
      color: var(--text-muted);
    }
    .esc {
      font-family: var(--font-mono);
      font-size: var(--text-2xs, 10px);
      color: var(--text-muted);
      background: var(--surface-sunken);
      border: 1px solid var(--border-hairline);
      border-radius: var(--radius-sm, 4px);
      padding: 1px 6px;
      flex-shrink: 0;
    }

    .list {
      overflow-y: auto;
      padding: var(--space-1, 4px) 0 var(--space-2, 8px);
      scrollbar-width: thin;
      scrollbar-color: var(--border-hairline) transparent;
    }
    .list::-webkit-scrollbar {
      width: 8px;
    }
    .list::-webkit-scrollbar-thumb {
      background: var(--border-hairline);
      border-radius: 8px;
    }

    .group {
      padding: var(--space-2, 8px) var(--space-3, 12px) var(--space-1, 4px);
      font-size: var(--text-2xs, 10px);
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .item {
      display: flex;
      align-items: center;
      gap: var(--space-2, 10px);
      height: 36px;
      margin: 0 var(--space-2, 8px);
      padding: 0 var(--space-2, 10px);
      border-radius: var(--radius-md, 8px);
      cursor: pointer;
      color: var(--text-muted);
      border-left: 2px solid transparent;
    }
    .item-icon {
      font-size: var(--text-base, 16px);
      color: var(--text-muted);
      width: 18px;
      display: inline-flex;
      justify-content: center;
      flex-shrink: 0;
    }
    .item-title {
      font-size: var(--text-sm, 13px);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item.selected {
      background: var(--accent-soft);
      color: var(--text-bright);
      border-left-color: var(--accent);
    }
    .item.selected .item-icon {
      color: var(--accent-hover);
    }

    .empty {
      padding: var(--space-5, 24px);
      text-align: center;
      color: var(--text-muted);
      font-size: var(--text-sm, 13px);
    }

    @media (prefers-reduced-motion: reduce) {
      .overlay,
      .panel {
        transition: none;
      }
    }
  `;

  render() {
    return html`
      <link rel="stylesheet" href=${PHOSPHOR_HREF} />
      <div class="overlay" @mousedown=${this._onBackdrop}>
        <div class="panel" role="document">
          <div class="input-row">
            <i class="ph ph-magnifying-glass input-icon" aria-hidden="true"></i>
            <input
              class="input"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="Type a command…"
              aria-label="Command palette"
              @input=${this._onInput}
            />
            <kbd class="esc">esc</kbd>
          </div>
          <div class="list" role="listbox">${this._renderList()}</div>
          ${this.items.length === 0
            ? html`<div class="empty">No matching commands</div>`
            : ''}
        </div>
      </div>
    `;
  }

  _renderList() {
    const rows = [];
    let lastGroup = null;
    this.items.forEach((cmd, i) => {
      if (cmd.group !== lastGroup) {
        rows.push(html`<div class="group">${cmd.group}</div>`);
        lastGroup = cmd.group;
      }
      rows.push(html`
        <div
          class="item ${i === this.selected ? 'selected' : ''}"
          role="option"
          aria-selected=${i === this.selected}
          @click=${() => this._emit('cmdk-run', i)}
          @mousemove=${() => this._emit('cmdk-hover', i)}
        >
          <i class="${cmd.icon} item-icon" aria-hidden="true"></i>
          <span class="item-title">${cmd.title}</span>
        </div>
      `);
    });
    return rows;
  }

  _onInput(e) {
    this._emit('cmdk-input', e.target.value);
  }

  _onBackdrop(e) {
    if (e.target === e.currentTarget) this._emit('cmdk-close');
  }

  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  get _inputEl() {
    return this.renderRoot?.querySelector('.input') ?? null;
  }

  updated(changed) {
    if (changed.has('open') && this.open) {
      const input = this._inputEl;
      if (input) {
        input.value = '';
        input.focus();
      }
    }
    if (changed.has('selected')) {
      this.renderRoot?.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' });
    }
  }
}

customElements.define('aurora-command-palette', AuroraCommandPalette);

export { AuroraCommandPalette };
