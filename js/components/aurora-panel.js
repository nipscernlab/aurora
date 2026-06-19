import { LitElement, html } from 'lit';

/**
 * <aurora-panel> — semantic, accessible shell for a collapsible side/bottom panel.
 *
 * Same thin-wrapper strategy as <aurora-tabs> / <aurora-editor> / <aurora-statusbar>:
 * the panel's real content (header, body, resizer) lives in light DOM and is driven
 * imperatively; a top-level <slot> passes it through unchanged, styled by the global
 * CSS via the host's class (e.g. class="file-tree-container"). resize.js still finds
 * the host by that class and drives width/collapse exactly as before.
 *
 * Deliberately NOT a docking rewrite (drag panels between zones, persist layout) —
 * that's a large, risky rearchitecture with no live coverage; this is the safe
 * semantic shell the design system asked for. What it adds today: an ARIA landmark
 * (role=region + aria-label) so the panel is reachable/announced by assistive tech.
 */

/**
 * Pure collapse decision for a resizable panel: should a panel of the given live
 * width be considered collapsed? `width < threshold`. Exported + unit-tested;
 * resize.js uses it so the threshold rule lives in one tested place.
 * @param {number} width @param {number} threshold @returns {boolean}
 */
export function nextCollapseState(width, threshold) {
  return Number(width) < Number(threshold);
}

class AuroraPanel extends LitElement {
  render() { return html`<slot></slot>`; }

  connectedCallback() {
    super.connectedCallback();
    // Landmark semantics — default only when the host didn't set its own, so a
    // caller can override per panel (e.g. aria-label="File tree").
    if (!this.hasAttribute('role')) this.setAttribute('role', 'region');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Panel');
  }
}

customElements.define('aurora-panel', AuroraPanel);
export { AuroraPanel };
