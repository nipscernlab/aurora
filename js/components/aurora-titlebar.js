/**
 * <aurora-titlebar> — the window chrome, which in AURORA is the top toolbar
 * itself: the project title, the toolbar actions, the window drag region and
 * the minimize / maximize-restore / close controls.
 *
 * Unlike the other shell components (<aurora-tabs>, <aurora-statusbar>), this
 * one uses NO Shadow DOM. The toolbar is the window's `-webkit-app-region: drag`
 * region with `no-drag` carve-outs on the buttons; keeping the children in light
 * DOM (no <slot>, no shadow boundary) guarantees Chromium's app-region
 * hit-testing keeps working EXACTLY as it did on the old <div> — both the
 * window-drag and the clickable controls. The host carries
 * `class="toolbar" id="custom-titlebar"`, so all existing CSS and the inline
 * window-control driver (`getElementById('custom-titlebar')`) are untouched.
 *
 * It is a semantic shell marker today; declarative rendering (a reactive title,
 * OS-platform detection for control placement) can be layered on later without
 * changing this contract.
 */
class AuroraTitlebar extends HTMLElement {}

customElements.define('aurora-titlebar', AuroraTitlebar);

export { AuroraTitlebar };
