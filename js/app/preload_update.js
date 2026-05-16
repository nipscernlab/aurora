/**
 * preload_update.js — context bridge da janela de atualização.
 *
 * Janela única que percorre os três estados do fluxo de update
 * (available → downloading → downloaded). Espelha 1:1 os canais IPC
 * registrados em main/updater.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateAPI', {
  /* ---- main → renderer ---- */

  /** Estado do update: { state, currentVersion, newVersion, releaseName, releaseNotes, sizeMB }. */
  onState: (cb) => ipcRenderer.on('update:state', (_e, d) => cb(d)),

  /** Progresso do download: { percent, transferredMB, totalMB, speedMBs, etaSec }. */
  onProgress: (cb) => ipcRenderer.on('update:progress', (_e, d) => cb(d)),

  /** Falha durante check/download: { message }. */
  onError: (cb) => ipcRenderer.on('update:error', (_e, d) => cb(d)),

  /** Tentativa de fechar a janela durante o download — feedback visual. */
  onShake: (cb) => ipcRenderer.on('update:shake', () => cb()),

  /* ---- renderer → main ---- */

  /** Inicia o download da atualização. */
  download: () => ipcRenderer.send('update:download'),

  /** Encerra o app e instala a atualização baixada (relança a nova versão). */
  install: () => ipcRenderer.send('update:install'),

  /** Fecha a janela sem atualizar agora. */
  dismiss: () => ipcRenderer.send('update:dismiss'),
});
