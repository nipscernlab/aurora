import { LitElement, html } from 'lit';

/**
 * <aurora-editor> — semantic shell for the code editor pane.
 *
 * Same thin-wrapper strategy as <aurora-tabs> / <aurora-terminal>: the tab
 * strip (<aurora-tabs>) and the Monaco mount (#monaco-editor) are slotted
 * light-DOM children, created and driven imperatively by TabManager +
 * EditorManager (monaco_editor.js). All layout comes from the global
 * editor.css via class="editor-container" on the host (display:flex column),
 * so the slotted children lay out exactly as they did under the old <div>:
 * the <slot> is display:contents, so the tab strip and the Monaco mount become
 * the host's flex items directly.
 *
 * Shadow DOM is used purely to register a semantic element and project the
 * light-DOM children through the <slot> unchanged. EditorManager.editorContainer
 * still resolves to #monaco-editor by id, and `.editor-container` selectors
 * (split_editor.js, aurora_api.js) still match the host by class — so Monaco
 * mounts into the same node and nothing downstream changes.
 *
 * Future: progressive enhancement — declarative editor/split-pane state once
 * EditorManager is refactored to be data-driven.
 */
class AuroraEditor extends LitElement {
  render() { return html`<slot></slot>`; }
}

customElements.define('aurora-editor', AuroraEditor);
export { AuroraEditor };
