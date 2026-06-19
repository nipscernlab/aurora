/**
 * electron_api.js — importable, LIVE handle for the preload contextBridge global.
 *
 * preload.js injects the IPC surface as `window.electronAPI`. Reaching for that
 * global from every renderer module ties the code to an implicit global;
 * importing `electronAPI` from here instead is explicit, grep-able and mockable.
 *
 * This is a Proxy, NOT a snapshot (`export const electronAPI = window.electronAPI`):
 * it forwards every access to the CURRENT `window.electronAPI` at call time. That
 * keeps two things working that a load-time snapshot broke:
 *   1. unit tests that swap `globalThis.window = { electronAPI: fake }` AFTER the
 *      module graph has loaded (a snapshot captured `undefined` at import time);
 *   2. the bridge not existing yet / a non-window context (get returns undefined
 *      instead of throwing on property access).
 * Method calls forward transparently — including `this` — so `electronAPI.foo(x)`
 * behaves exactly like `window.electronAPI.foo(x)`.
 *
 * Caveat: the Proxy itself is ALWAYS truthy, so prefer a property check
 * (`if (electronAPI.foo)`) over a bare existence check (`if (electronAPI)`).
 *
 * The exported type lives in electron_api.d.ts (Window['electronAPI']) so .ts
 * importers stay fully typed without pulling this .js into tsc.
 */

const liveApi = () => (typeof window !== 'undefined' && window.electronAPI) || undefined;

export const electronAPI = new Proxy({}, {
  get(_target, prop) {
    const api = liveApi();
    return api ? api[prop] : undefined;
  },
  has(_target, prop) {
    const api = liveApi();
    return api ? prop in api : false;
  },
});
