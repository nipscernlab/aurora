import { LitElement, html } from 'lit';

/**
 * <aurora-terminal>, semantic shell for the terminal panel.
 *
 * Same thin-wrapper strategy as <aurora-tabs>: the terminal tabs, content
 * panels, and log entries are all created/managed imperatively by
 * terminal_module.js and live in light DOM. All styles come from the global
 * terminal.css via the `class="terminal-container"` attribute on the host.
 *
 * Future: progressive enhancement, individual .terminal-body panels will
 * become <aurora-terminal-body> Lit components with virtual scrolling once
 * the imperative log-entry system is replaced by a data-driven append API.
 */
class AuroraTerminal extends LitElement {
  render() { return html`<slot></slot>`; }
}

customElements.define('aurora-terminal', AuroraTerminal);
export { AuroraTerminal };
