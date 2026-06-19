/**
 * Types for electron_api.js (a runtime Proxy). Lets .ts modules import the
 * importable bridge handle and keep it fully typed as the preload surface
 * (Window['electronAPI'] === AuroraElectronAPI, declared in aurora-globals.d.ts).
 */
export const electronAPI: Window['electronAPI'];
