// Era o <script> inline da propria pagina; saiu do HTML para a CSP do
// aplicativo poder viver sem 'unsafe-inline' em script-src. Conteudo
// movido verbatim; o comportamento e o mesmo.

// ============================================================
//  i18n local — splash roda antes do i18n principal; lê o
//  locale direto do localStorage e traz sua própria tabela.
// ============================================================
const STRINGS = {
  en: {
    tagline: 'Scalable-Architecture Processor for Hardware Optimization',
    boot: 'Starting SAPHO', window: 'Creating workspace',
    loading: 'Loading interface', dom: 'Building components',
    resources: 'Loading resources', editor: 'Initializing editor',
    ready: 'Ready',
  },
  pt: {
    tagline: 'Processador de Arquitetura Escalável para Otimização de Hardware',
    boot: 'Iniciando o SAPHO', window: 'Criando ambiente',
    loading: 'Carregando interface', dom: 'Montando componentes',
    resources: 'Carregando recursos', editor: 'Inicializando editor',
    ready: 'Pronto',
  },
};
const locale = (() => {
  try {
    const v = localStorage.getItem('aurora-locale');
    if (v === 'en' || v === 'pt') return v;
    const legacy = localStorage.getItem('aurora-yanc-lang');
    if (legacy === 'en' || legacy === 'pt') return legacy;
  } catch (_) { /* localStorage indisponivel */ }
  return 'pt';
})();
const T = STRINGS[locale] || STRINGS.pt;
document.getElementById('tagline').textContent = T.tagline;
/* A fase também, e não só a tagline. O rótulo inicial está cravado em
   inglês no markup e só era traduzido quando o PRIMEIRO evento de progresso
   chegava com uma fase conhecida — o que acontece uns instantes depois de a
   janela aparecer. Numa máquina em português, a splash abria com
   "Starting SAPHO" embaixo de uma tagline em português, e voltava ao normal
   tão rápido que passava por defeito de renderização. */
document.getElementById('phase').textContent = T.boot;

// ============================================================
//  Progresso real — alimentado por main/windows.js via IPC.
//  `target` é o último marco recebido; `shown` persegue o
//  alvo suavemente para a barra nunca travar de forma seca.
// ============================================================
const fillEl    = document.getElementById('fill');
const pctEl     = document.getElementById('pct');
const phaseEl   = document.getElementById('phase');
const elapsedEl = document.getElementById('elapsed');
const versionEl = document.getElementById('version');

const startedAt = performance.now();
let target = 4, shown = 0, filled = false;

(function ease() {
  // creep suave: aproxima `shown` de `target` sem ultrapassar
  shown += (target - shown) * 0.08;
  if (shown > 99.5 && target >= 100) shown = 100;
  fillEl.style.width = shown.toFixed(1) + '%';
  pctEl.textContent  = Math.round(shown) + '%';
  elapsedEl.textContent = ((performance.now() - startedAt) / 1000).toFixed(1) + 's';

  // a barra encheu de verdade — avisa o main, que aguarda 1s e
  // só então abre a interface principal.
  if (!filled && shown >= 100 && target >= 100) {
    filled = true;
    window.splashAPI?.notifyFilled?.();
  }
  requestAnimationFrame(ease);
})();

if (window.splashAPI) {
  window.splashAPI.onProgress(({ percent, phase }) => {
    if (typeof percent === 'number') target = Math.max(target, percent);
    if (phase && T[phase]) phaseEl.textContent = T[phase];
  });
  window.splashAPI.getAppVersion()
    .then((v) => { if (v) versionEl.textContent = v.startsWith('v') ? v : 'v' + v; })
    .catch(() => {});
}
