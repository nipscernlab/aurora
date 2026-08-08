/**
 * preload_docs.js — ponte da barra da janela do manual (html/docs-browser.html).
 *
 * A superfície é deliberadamente mínima: navegar, controlar a janela e ouvir o
 * estado. Aquela página não lê arquivo, não roda comando e não fala com o
 * projeto, então nada disso aparece aqui.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('docsWindowAPI', {
  back:     () => ipcRenderer.invoke('docs-window:nav', 'back'),
  forward:  () => ipcRenderer.invoke('docs-window:nav', 'forward'),
  reload:   () => ipcRenderer.invoke('docs-window:nav', 'reload'),
  home:     () => ipcRenderer.invoke('docs-window:nav', 'home'),

  minimize: () => ipcRenderer.invoke('docs-window:control', 'minimize'),
  maximize: () => ipcRenderer.invoke('docs-window:control', 'maximize'),
  close:    () => ipcRenderer.invoke('docs-window:control', 'close'),

  /** Pede o estado atual; o main responde pelo mesmo evento de onState. */
  sync:     () => ipcRenderer.invoke('docs-window:sync'),

  /** @param {(s: {canGoBack: boolean, canGoForward: boolean, title: string}) => void} cb */
  onState: (cb) => {
    const h = (/** @type {any} */ _e, /** @type {any} */ s) => cb(s);
    ipcRenderer.on('docs-window:state', h);
    return () => ipcRenderer.removeListener('docs-window:state', h);
  },
});
