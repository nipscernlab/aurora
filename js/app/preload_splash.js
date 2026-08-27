/**
 * preload_splash.js: context bridge dedicado à janela de splash.
 *
 * A splash não precisa de toda a superfície de `preload.js`; expõe só o
 * canal de progresso real (alimentado por main/windows.js conforme a
 * janela principal atravessa seus marcos de carregamento) e o lookup
 * de versão.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashAPI', {
  /** Recebe { percent:number, phase:string } a cada marco real de boot. */
  onProgress: (cb) => {
    ipcRenderer.on('splash:progress', (_e, data) => cb(data));
  },
  /**
   * Avisa o main que a barra atingiu 100% visualmente. O coordenador
   * espera uma batida curta (SPLASH_HOLD_MS, em main/windows.js) após esse
   * sinal para então revelar a janela principal.
   */
  notifyFilled: () => ipcRenderer.send('splash:filled'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});
