import { LitElement, html } from 'lit';

/**
 * <aurora-tree> — semantic shell for the file/hierarchy tree panel.
 *
 * Thin wrapper: the .file-tree-item rows, empty-state cards, and tree subviews
 * are rendered imperatively by file_tree_manager.js and live in light DOM.
 * All styles come from the global file_tree.css via class="file-tree" on the
 * host.
 *
 * Future: progressive enhancement — convert tree rows to declarative Lit
 * rendering with key-based reconciliation for 3 subviews (files/hierarchy/
 * folders) once the imperative tree render is data-driven.
 */
class AuroraTree extends LitElement {
  render() { return html`<slot></slot>`; }
}

customElements.define('aurora-tree', AuroraTree);
export { AuroraTree };
