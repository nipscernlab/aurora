// @ts-check
/**
 * electron_api.js — importable handle for the preload contextBridge global.
 *
 * preload.js injects the IPC surface as `window.electronAPI` (a contextBridge
 * global). Reaching for `window.electronAPI` from every renderer module ties
 * the code to an implicit global; re-exporting it here lets modules do
 * `import { electronAPI } from '.../app/electron_api.js'` instead — explicit,
 * grep-able, and mockable in tests. The bridge itself still lives on window
 * (preload owns its lifecycle); this is just a typed, importable reference.
 *
 * A3 (migrar globais) migrates call sites to this import incrementally. Until
 * every site is migrated the `window.electronAPI` global stays in place, so
 * both styles coexist safely.
 */

// Type is inferred from the `window.electronAPI` global (declared in
// js/types/aurora-globals.d.ts), so imports stay fully typed under @ts-check.
export const electronAPI = window.electronAPI;
