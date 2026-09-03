// Script CLASSICO, na tag logo DEPOIS do loader.js do Monaco e ANTES dos
// modulos ES: a ordem de tags entre scripts classicos e garantida pelo parser,
// e os modulos (deferidos) so executam depois. Era um <script> inline; saiu do
// HTML para a CSP do aplicativo poder viver sem 'unsafe-inline' em script-src.
//
// O caminho do `vs` vem do atributo data-vs da PROPRIA tag, e nao de uma
// string aqui dentro, porque o rewriteVendorPaths do vite.config.mjs reescreve
// node_modules/... para vendor/... apenas no HTML: na pagina crua (fallback
// file:// na raiz do repositorio) o atributo diz node_modules/, na servida e
// na empacotada ele ja chega dizendo vendor/.
//
// Anchor the `vs` base to an ABSOLUTE URL (via document.baseURI), not a bare
// relative path. Monaco builds its web-worker URL from this and loads it via
// importScripts inside a worker; under file:// a relative 'vendor/vs' resolved
// against the filesystem root (file:///vendor/vs/…workerMain.js) and failed to
// open files. document.baseURI anchors it to the real document location:
// correct in dev (http://localhost) and in the built/packaged app (file://).
/* global require */
(function () {
  var vsRel = (document.currentScript && document.currentScript.dataset.vs)
    || 'node_modules/monaco-editor/min/vs';
  require.config({ paths: { vs: new URL(vsRel, document.baseURI).href } });
})();
