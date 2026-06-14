import { LitElement, html, css } from 'lit';

// Phosphor's class-based icons (.ph) don't cross a shadow root, so the welcome
// pulls the stylesheet into its own shadow (absolute URL via document.baseURI so
// it resolves in dev http:// and packaged file://; the webfont is already cached).
const PHOSPHOR_HREF = new URL('vendor/phosphor/src/regular/style.css', document.baseURI).href;
const WATERMARK_SRC = new URL('assets/icons/sapho_aurora_icon.svg', document.baseURI).href;

/**
 * <aurora-welcome> — the empty-project welcome screen (DESIGN §6/§9), the
 * "Start + Recent" stage shown inside #editor-overlay when no project is open.
 *
 * View + chrome only. It does NOT own state:
 *   • the New / Open Project buttons delegate to the toolbar buttons
 *     (#newProjectBtn / #openProjectBtn), which carry the real handlers — so
 *     the welcome can't drift from the toolbar and needs no wiring of its own.
 *   • the Recent list is driven by RecentProjectsManager: it sets `.projects`
 *     (each { name, path, displayPath }) and listens for the events emitted here:
 *       project-open   (detail: path) — a row was clicked
 *       project-remove (detail: path) — the row's × was clicked
 * Strings come from window.t(); it re-renders on `aurora:locale-changed`.
 * #editor-overlay stays in the light DOM (TabManager toggles it, and a sibling
 * selector hides the editor behind it) — only its content moved into the shadow.
 */
class AuroraWelcome extends LitElement {
  static properties = {
    projects: { attribute: false },
    version: { type: String },
  };

  constructor() {
    super();
    this.projects = [];
    this.version = 'v6.3.2';
    this._removing = new Set();
    this._onLocale = () => this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('aurora:locale-changed', this._onLocale);
  }

  disconnectedCallback() {
    window.removeEventListener('aurora:locale-changed', this._onLocale);
    super.disconnectedCallback();
  }

  /** Translate via the global i18n helper, falling back to the English string. */
  _t(key, fallback) {
    const v = window.t ? window.t(key) : null;
    return v && v !== key ? v : fallback;
  }

  static styles = css`
    /* The stage fills #editor-overlay when it's visible. */
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      justify-content: center;
      overflow-y: auto;
      position: relative;
      background: var(--surface-sky);
      /* "cortina que clareia" — the aurora reveal (DESIGN §6). */
      animation: welcomeFadeIn var(--motion-curtain, 480ms) var(--ease-reveal, ease) both;
    }
    @keyframes welcomeFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      :host, .project-item { animation: none; }
    }

    /* Ambient aurora canvas, behind everything. */
    .bg-canvas {
      position: absolute;
      inset: 0;
      z-index: var(--z-0, 0);
      pointer-events: none;
    }

    /* Watermark — large dimmed SAPHO logo as a brand backdrop, centred on both
       axes so it stays balanced as the welcome area is resized. */
    .watermark {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: clamp(120px, min(32vw, 50vh), 440px);
      height: auto;
      opacity: 0.045;
      pointer-events: none;
      user-select: none;
      filter: grayscale(0.2);
      z-index: var(--z-0, 0);
    }

    .content {
      width: 100%;
      max-width: 880px;
      padding: clamp(48px, 8vh, 96px) clamp(32px, 6vw, 96px) var(--space-6);
      display: flex;
      flex-direction: column;
      gap: var(--space-7);
      user-select: none;
      position: relative;
      z-index: var(--z-1, 1);
    }

    /* Topbar — wordmark + tagline */
    .topbar {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
      padding-bottom: var(--space-3);
      border-bottom: 1px solid var(--border-subtle);
    }
    .mark {
      font-size: var(--text-lg);
      font-weight: var(--font-semibold);
      letter-spacing: 0.18em;
      background: var(--gradient-text);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
    }
    .tagline {
      font-size: var(--text-xs);
      color: var(--text-faint);
      letter-spacing: var(--tracking-tight);
    }

    /* Two-column grid */
    .grid {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(280px, 1.6fr);
      gap: clamp(32px, 5vw, 72px);
    }
    @media (max-width: 700px) {
      .grid { grid-template-columns: 1fr; gap: var(--space-6); }
    }
    .col { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
    .section-title {
      margin: 0 0 var(--space-2);
      font-size: var(--text-md);
      font-weight: var(--font-semibold);
      color: var(--text-default);
      letter-spacing: var(--tracking-tight);
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }

    /* Start: link-style action list */
    .link-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .link {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      padding: var(--space-2) 0;
      background: transparent;
      border: 0;
      color: var(--accent-hover);
      font-family: var(--font-sans);
      font-size: var(--text-sm);
      font-weight: var(--font-normal);
      letter-spacing: var(--tracking-tight);
      text-align: left;
      cursor: pointer;
      transition: color var(--transition-fast);
    }
    .link i { font-size: var(--icon-base); color: var(--text-faint); transition: color var(--transition-fast); }
    .link:hover, .link:hover i { color: var(--accent); }
    .link:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-sm); }
    .link-dim { color: var(--text-faint); font-weight: var(--font-normal); }

    /* Recent */
    .count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 16px;
      padding: 0 5px;
      font-size: var(--text-2xs);
      font-weight: var(--font-medium);
      color: var(--text-faint);
      background: var(--surface-raised);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-full);
      font-family: var(--font-mono);
    }
    .recent-list {
      display: grid;
      grid-template-columns: minmax(0, max-content) minmax(0, 1fr) auto;
      align-items: center;
      column-gap: var(--space-3);
      max-height: 360px;
      overflow-y: auto;
    }
    .recent-list::-webkit-scrollbar { width: 6px; }
    .recent-list::-webkit-scrollbar-track { background: transparent; }
    .recent-list::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }

    .project-item {
      display: grid;
      grid-template-columns: subgrid;
      grid-column: 1 / -1;
      align-items: center;
      column-gap: var(--space-3);
      padding: var(--space-2) var(--space-2) var(--space-2) 0;
      border-radius: var(--radius-sm);
      cursor: pointer;
      position: relative;
      min-height: 28px;
      transition: background-color var(--transition-fast),
        opacity 200ms var(--ease-out-quart), transform 200ms var(--ease-out-quart);
      animation: itemIn 200ms var(--ease-out-quart) both;
    }
    @keyframes itemIn { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
    .project-item:hover { background-color: var(--overlay-hover); }
    .project-item.removing { opacity: 0; transform: translateX(-12px); pointer-events: none; }
    .project-name {
      font-size: var(--text-sm);
      font-weight: var(--font-normal);
      color: var(--accent-hover);
      letter-spacing: var(--tracking-tight);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding-left: var(--space-2);
      transition: color var(--transition-fast);
    }
    .project-item:hover .project-name { color: var(--accent); }
    .project-path {
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-family: var(--font-mono);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .project-remove {
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; border-radius: var(--radius-sm);
      color: var(--text-faint); font-size: var(--icon-xs); cursor: pointer;
      opacity: 0; flex-shrink: 0;
      transition: opacity var(--transition-fast), background-color var(--transition-fast), color var(--transition-fast);
    }
    .project-item:hover .project-remove { opacity: 1; }
    .project-remove:hover { background: rgba(226, 108, 108, 0.10); color: var(--state-error); }

    .empty-state { grid-column: 1 / -1; padding: var(--space-3) 0; color: var(--text-faint); }
    .empty-state p { margin: 0; font-size: var(--text-sm); color: var(--text-faint); font-style: italic; }

    /* Footer */
    .footer {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--text-xs);
      color: var(--text-faint);
      font-family: var(--font-sans);
      letter-spacing: var(--tracking-tight);
      margin-top: auto;
      padding-top: var(--space-3);
      border-top: 1px solid var(--border-subtle);
    }
    .footer-link { color: var(--text-faint); text-decoration: none; cursor: pointer; transition: color var(--transition-fast); }
    .footer-link:hover { color: var(--accent-hover); }
    .divider { opacity: 0.5; }
    .version { font-variant-numeric: tabular-nums; }
    .signature {
      display: inline-flex; align-items: center; gap: 0;
      font-family: var(--font-sans); font-size: var(--text-2xs); font-weight: var(--font-semibold);
      line-height: 1; letter-spacing: var(--tracking-widest); text-transform: uppercase;
      color: var(--text-secondary); user-select: none; white-space: nowrap;
      transition: color var(--transition-fast);
    }
    .signature:hover { color: var(--text-default); }
    .signature-sep { margin: 0 6px; color: var(--text-disabled); font-weight: var(--font-normal); }
  `;

  render() {
    return html`
      <link rel="stylesheet" href=${PHOSPHOR_HREF} />
      <aurora-canvas class="bg-canvas" intensity="0.95" speed="1.0" aria-hidden="true"></aurora-canvas>
      <img class="watermark" src=${WATERMARK_SRC} alt="" aria-hidden="true" />
      <div class="content">
        <header class="topbar">
          <span class="mark">SAPHO</span>
          <span class="tagline">${this._t('welcome.tagline', 'Scalable Architecture for Hardware Optimization')}</span>
        </header>

        <div class="grid">
          <section class="col">
            <h2 class="section-title">${this._t('welcome.sectionStart', 'Start')}</h2>
            <ul class="link-list">
              <li>
                <button class="link" @click=${() => this._delegate('newProjectBtn')}>
                  <i class="ph ph-folder-plus" aria-hidden="true"></i>
                  <span>${this._t('welcome.newProject', 'New Project')}<span class="link-dim">...</span></span>
                </button>
              </li>
              <li>
                <button class="link" @click=${() => this._delegate('openProjectBtn')}>
                  <i class="ph ph-folder-open" aria-hidden="true"></i>
                  <span>${this._t('welcome.openProject', 'Open Project')}<span class="link-dim">...</span></span>
                </button>
              </li>
            </ul>
          </section>

          <section class="col">
            <h2 class="section-title">
              <span>${this._t('welcome.sectionRecent', 'Recent')}</span>
              ${this.projects.length ? html`<span class="count">${this.projects.length}</span>` : ''}
            </h2>
            <div class="recent-list">${this._renderRecent()}</div>
          </section>
        </div>

        <footer class="footer">
          <a class="footer-link" @click=${this._openWebsite}>nipscern.com</a>
          <span class="divider">·</span>
          <span class="signature" aria-hidden="true">SAPHO<span class="signature-sep">·</span>AURORA</span>
          <span class="divider">·</span>
          <span class="version">${this.version}</span>
        </footer>
      </div>
    `;
  }

  _renderRecent() {
    if (!this.projects.length) {
      return html`<div class="empty-state"><p>${this._t('welcome.noRecent', 'No recent projects')}</p></div>`;
    }
    return this.projects.map((p, i) => html`
      <div
        class="project-item ${this._removing.has(p.path) ? 'removing' : ''}"
        title=${p.path}
        style="animation-delay:${i * 50}ms"
        @click=${(e) => this._open(p.path, e)}
      >
        <span class="project-name">${p.name}</span>
        <span class="project-path">${p.displayPath ?? p.path}</span>
        <button
          class="project-remove"
          title="Remove from recent projects"
          aria-label="Remove from recent projects"
          @click=${(e) => this._remove(p.path, e)}
        ><i class="ph ph-x" aria-hidden="true"></i></button>
      </div>
    `);
  }

  _delegate(id) {
    document.getElementById(id)?.click();
  }

  _open(path, e) {
    if (e.target.closest('.project-remove')) return;
    this.dispatchEvent(new CustomEvent('project-open', { detail: path, bubbles: true, composed: true }));
  }

  _remove(path, e) {
    e.stopPropagation();
    // Slide the row out (matches the old behaviour), then tell the manager.
    this._removing.add(path);
    this.requestUpdate();
    setTimeout(() => {
      this.dispatchEvent(new CustomEvent('project-remove', { detail: path, bubbles: true, composed: true }));
    }, 200);
  }

  _openWebsite() {
    const url = 'https://nipscern.com';
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, '_blank');
  }
}

customElements.define('aurora-welcome', AuroraWelcome);

export { AuroraWelcome };
