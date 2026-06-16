import { LitElement, html } from 'lit';

/**
 * <aurora-tabs> — semantic shell for the editor tab strip.
 *
 * This is a intentionally thin wrapper: the .tab children are created
 * imperatively by TabManager and live in light DOM. All visual styles come
 * from the global tabs.css via the `class="tabs-container"` attribute on the
 * host — no Shadow DOM styles override needed.
 *
 * Shadow DOM is used purely to register a semantic custom element in the DOM
 * tree. The <slot> passes slotted light-DOM children through unmodified so
 * that TabManager's querySelectorAll/.getAttribute/classList calls continue to
 * work on the direct children exactly as they did on the old <div>.
 *
 * Future: progressive enhancement — move .tab styles into ::slotted() and
 * adopt declarative rendering once TabManager is refactored to be data-driven.
 */
class AuroraTabs extends LitElement {
  render() { return html`<slot></slot>`; }
}

customElements.define('aurora-tabs', AuroraTabs);
export { AuroraTabs };
