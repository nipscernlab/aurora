import { LitElement, html } from 'lit';

/**
 * <aurora-tabs>, semantic, accessible shell for the editor tab strip.
 *
 * The `.tab` children are still created imperatively by TabManager and live in
 * light DOM (a full data-driven rewrite of that imperative DOM, addTab/closeTab/
 * drag/preview/active across tab_manager + tab_drag + tab_watchers + split_editor:
 * is a high-risk, cross-file rearchitecture with no live E2E for the chat/tab
 * paths, so it's deliberately NOT done here; same call as <aurora-tree> passo 2).
 *
 * Passo 2 (this version) makes the component actually DO something instead of
 * being a pure slot: it turns the slotted tabs into a proper ARIA tablist:
 * role=tablist on the host, role=tab + aria-selected on each tab (mirroring the
 * `.active` class TabManager owns), a roving tabindex so the strip is a single
 * tab stop, and Arrow/Home/End/Enter keyboard navigation. It NEVER touches
 * TabManager state or the data-loss-sensitive save logic, it only reflects the
 * `.active` class and activates via the tab's existing click handler.
 */

/**
 * Roving-tablist focus math (pure): given the focused tab index, the tab count
 * and a key, return the index to move focus to, or -1 for keys we don't handle.
 * Arrow keys wrap around; Home/End jump to the ends.
 * @param {number} current @param {number} count @param {string} key
 * @returns {number}
 */
export function nextRovingIndex(current, count, key) {
  if (count <= 0 || current < 0) return -1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown': return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return -1;
  }
}

class AuroraTabs extends LitElement {
  render() { return html`<slot></slot>`; }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'tablist');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Open editors');
    // TabManager mutates the light-DOM tabs imperatively (adds/removes them and
    // flips the `.active` class). Re-apply the a11y semantics whenever that
    // happens. We only WRITE role/aria-selected/tabindex (not class), so the
    // class-filtered observer never loops on our own writes.
    this._obs = new MutationObserver(() => this._syncTabs());
    this._obs.observe(this, { childList: true, subtree: true, attributeFilter: ['class'] });
    this._onKeydown = (e) => this._handleKeydown(e);
    this.addEventListener('keydown', this._onKeydown);
    this._syncTabs();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._obs?.disconnect();
    this._obs = null;
    if (this._onKeydown) this.removeEventListener('keydown', this._onKeydown);
  }

  /** Main-pane tabs only (split tabs live in their own strips). */
  _tabs() {
    return /** @type {HTMLElement[]} */ (Array.from(this.querySelectorAll('.tab:not(.split-tab)')));
  }

  _syncTabs() {
    const tabs = this._tabs();
    const hasActive = tabs.some((t) => t.classList.contains('active'));
    tabs.forEach((tab, i) => {
      const selected = tab.classList.contains('active');
      setAttr(tab, 'role', 'tab');
      setAttr(tab, 'aria-selected', selected ? 'true' : 'false');
      // Roving tabindex: the active tab is the single tab stop. With no active
      // tab, the first one is reachable so the strip never traps Tab.
      const stop = selected || (!hasActive && i === 0);
      setAttr(tab, 'tabindex', stop ? '0' : '-1');
    });
  }

  _handleKeydown(e) {
    const tabs = this._tabs();
    if (!tabs.length) return;
    const current = tabs.indexOf(/** @type {HTMLElement} */ (this.ownerDocument.activeElement));
    if (current === -1) return; // focus isn't on a tab — let the key pass through
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      tabs[current].click();
      return;
    }
    const next = nextRovingIndex(current, tabs.length, e.key);
    if (next === -1) return;
    e.preventDefault();
    tabs[next].focus();
  }
}

/** Set an attribute only when it would change, so we never trigger redundant mutations. */
function setAttr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

customElements.define('aurora-tabs', AuroraTabs);
export { AuroraTabs };
