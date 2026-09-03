// Script CLASSICO, carregado com <script src> no MEIO do markup da arvore de
// arquivos, de proposito: ele precisa rodar de forma sincrona durante o parse,
// antes do primeiro paint, para o "No project open" nao piscar num arranque
// que vai restaurar projeto. Era um <script> inline; saiu do HTML para a CSP
// do aplicativo poder viver sem 'unsafe-inline' em script-src.
//
// Avoid the "No project open" flash on cold start when a project is about to
// be auto-restored. AppInitializer.restoreLastSession() will replace this with
// the actual project name once the IPC roundtrip lands.
(function () {
  try {
    if (localStorage.getItem('aurora-last-project-path')) {
      var el = document.getElementById('current-spf-name');
      if (el) {
        // Pre-i18n: window.t nao existe ainda. Setamos o fallback EN no
        // textContent e marcamos a chave; applyDOM no fim do boot do i18n
        // sobrescreve com a traducao correta.
        el.textContent = 'Loading…';
        el.setAttribute('data-i18n', 'fileTree.loading');
      }
    }
  } catch (_) { /* localStorage unavailable */ }
})();
