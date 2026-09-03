// Era o <script> inline da propria pagina; saiu do HTML para a CSP do
// aplicativo poder viver sem 'unsafe-inline' em script-src. Conteudo
// movido verbatim; o comportamento e o mesmo.

// ============================================================
//  i18n da janela (independente do i18n principal)
// ============================================================
const UI = {
  en: {
    avTitle: (v) => `Version ${v} is ready`,
    whatsNew: 'What changed',
    later: 'Not now', download: 'Download',
    dlTitle: 'Downloading',
    dnTitle: 'Downloaded',
    dnSub: 'Restart now to open on the new version, or keep working: it installs by itself the next time SAPHO opens.',
    later2: 'Keep working', install: 'Restart now',
    calc: 'estimating', noNotes: 'No release notes for this version.',
    eta: (t) => `${t} left`,
    secs: (s) => `${s}s`, mins: (m) => `${m} min`,
    retrying: (a, of, s) =>
      `The connection dropped. Trying again in ${s}s, attempt ${a} of ${of}.`,
    resuming: 'Reconnecting',
  },
  pt: {
    avTitle: (v) => `A versão ${v} está pronta`,
    whatsNew: 'O que mudou',
    later: 'Agora não', download: 'Baixar',
    dlTitle: 'Baixando',
    dnTitle: 'Baixada',
    dnSub: 'Reinicie agora para abrir na versão nova, ou continue trabalhando: ela se instala sozinha na próxima vez que o SAPHO abrir.',
    later2: 'Continuar trabalhando', install: 'Reiniciar agora',
    calc: 'estimando', noNotes: 'Sem notas de versão para esta versão.',
    eta: (t) => `falta ${t}`,
    secs: (s) => `${s}s`, mins: (m) => `${m} min`,
    retrying: (a, of, s) =>
      `A conexão caiu. Tentando de novo em ${s}s, tentativa ${a} de ${of}.`,
    resuming: 'Reconectando',
  },
};

let locale = (() => {
  try {
    const v = localStorage.getItem('aurora-locale');
    if (v === 'en' || v === 'pt') return v;
    const legacy = localStorage.getItem('aurora-yanc-lang');
    if (legacy === 'en' || legacy === 'pt') return legacy;
  } catch (_) { /* localStorage indisponivel */ }
  return 'pt';
})();

// payload do update guardado para re-render ao trocar idioma
let payload = null;

// ============================================================
//  Renderer das release notes.
//
//  Suporta dois formatos, porque o conteúdo chega em dois caminhos
//  diferentes do mesmo updater:
//    - HTML — electron-updater (GitHub provider) lê o atom feed de
//      releases, cujo `<content type="html">` já vem renderizado.
//      Sem este caminho, as tags `<h2>`, `<ul>`, ... aparecem
//      escapadas no painel (foi o bug que motivou a reescrita).
//    - Markdown — fallback `fetchReleaseNotes()` em main/updater.js,
//      que bate na API REST do GitHub e devolve `body` cru.
// ============================================================
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
function mdToHtml(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  let html = '', inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (/^#{1,6}\s/.test(line)) {
      closeList();
      const level = line.match(/^#+/)[0].length;
      const txt = line.replace(/^#+\s/, '');
      html += level <= 2 ? `<h2>${inline(txt)}</h2>` : `<h3>${inline(txt)}</h3>`;
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`;
    } else if (/^(-{3,}|_{3,}|\*{3,})$/.test(line)) {
      closeList(); html += '<hr>';
    } else {
      closeList(); html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

// Heurística: presença de uma tag de bloco real (`<p>`, `<h2>`, `<ul>` ...)
// indica HTML — markdown não as produz literalmente. Tags inline como
// `<br>` ou `<a>` ficam de fora propositalmente para não classificar
// markdown com HTML embutido pontual como "HTML puro".
function looksLikeHtml(s) {
  return /<(h[1-6]|ul|ol|li|p|pre|blockquote|div)[\s>]/i.test(s);
}

// Allowlist de tags que o CSS da janela estiliza. Tudo fora disso é
// desempacotado (mantém o texto, descarta o invólucro) — assim
// `<svg>`, `<img>`, anchors decorativos do GitHub e afins somem sem
// deixar buracos. Atributos são removidos por padrão; só href em <a>
// sobrevive, e ainda restrita a http/https.
const ALLOWED_TAGS = {
  H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3',
  UL: 'ul', OL: 'ul', LI: 'li',
  P: 'p', PRE: 'p', BLOCKQUOTE: 'p',
  STRONG: 'strong', B: 'strong', EM: 'em', I: 'em',
  CODE: 'code', A: 'a', HR: 'hr', BR: 'br',
};
function cleanNode(src, out) {
  src.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      out.appendChild(document.createTextNode(node.textContent));
      return;
    }
    if (node.nodeType !== 1) return; // skip comments / others
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    const mapped = ALLOWED_TAGS[tag];
    if (!mapped) { cleanNode(node, out); return; } // unwrap
    const el = document.createElement(mapped);
    if (mapped === 'a') {
      const href = node.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) el.setAttribute('href', href);
    }
    cleanNode(node, el);
    out.appendChild(el);
  });
}
function htmlToSafe(html) {
  // <template> parses sem executar scripts e sem disparar
  // requisições de recurso — o que torna o passo de saneamento
  // posterior puramente "DOM walk", sem side-effects.
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const box = document.createElement('div');
  cleanNode(tpl.content, box);
  return box.innerHTML;
}

function renderNotes(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return looksLikeHtml(text) ? htmlToSafe(text) : mdToHtml(text);
}

// ============================================================
//  Separa as notas bilíngues. Convenções suportadas, em ordem:
//   1. marcadores  <!-- EN -->  …  <!-- PT -->
//   2. cabeçalhos  ## English / ## Português (com ou sem emoji)
//  Sem nenhuma das duas → mesmas notas para ambos os idiomas.
// ============================================================
function splitLangs(body) {
  const text = String(body || '').trim();
  if (!text) return { en: '', pt: '' };

  const enM = text.match(/<!--\s*EN\s*-->/i);
  const ptM = text.match(/<!--\s*PT\s*-->/i);
  if (enM && ptM) {
    const enStart = enM.index + enM[0].length;
    const ptStart = ptM.index + ptM[0].length;
    if (enM.index < ptM.index) {
      return {
        en: text.slice(enStart, ptM.index).trim(),
        pt: text.slice(ptStart).trim(),
      };
    }
    return {
      pt: text.slice(ptStart, enM.index).trim(),
      en: text.slice(enStart).trim(),
    };
  }

  // cabeçalhos de idioma
  const lines = text.split('\n');
  let enIdx = -1, ptIdx = -1;
  lines.forEach((l, i) => {
    if (/^#{1,6}\s/.test(l.trim())) {
      if (enIdx < 0 && /english/i.test(l)) enIdx = i;
      if (ptIdx < 0 && /portugu/i.test(l)) ptIdx = i;
    }
  });
  if (enIdx >= 0 && ptIdx >= 0) {
    const a = Math.min(enIdx, ptIdx), b = Math.max(enIdx, ptIdx);
    const first = lines.slice(a + 1, b).join('\n').trim();
    const second = lines.slice(b + 1).join('\n').trim();
    return enIdx < ptIdx ? { en: first, pt: second } : { pt: first, en: second };
  }

  return { en: text, pt: text };
}

// ============================================================
//  Render
// ============================================================
const $ = (id) => document.getElementById(id);

// Todo link do changelog (o commit de cada item) abre no navegador. O
// main bloqueia a navegacao desta janela, entao sem este desvio o clique
// simplesmente nao faria nada; e antes do bloqueio ele fazia pior, trazia
// o github.com para dentro da janela transparente.
document.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a) return;
  e.preventDefault();
  window.updateAPI?.openExternal?.(a.getAttribute('href'));
});

function applyLocale() {
  const T = UI[locale];
  document.documentElement.lang = locale;
  $('t-av-title').textContent = T.avTitle(payload ? 'v' + payload.newVersion : '');
  $('t-whatsnew').firstChild.textContent = T.whatsNew + ' ';
  $('t-later').textContent    = T.later;
  $('t-download').textContent = T.download;
  $('t-dl-title').textContent = T.dlTitle;
  $('t-dn-title').textContent = T.dnTitle;
  $('t-dn-sub').textContent   = T.dnSub;
  $('t-later2').textContent   = T.later2;
  $('t-install').textContent  = T.install;
  $('lang-en').classList.toggle('active', locale === 'en');
  $('lang-pt').classList.toggle('active', locale === 'pt');
  renderChangelog();
}

function renderChangelog() {
  if (!payload) return;
  const langs = splitLangs(payload.releaseNotes);
  const notes = langs[locale] || langs.en || langs.pt;
  $('changelog').innerHTML = notes
    ? renderNotes(notes)
    : `<p style="color:var(--text-dim)">${UI[locale].noNotes}</p>`;
  $('changelog').scrollTop = 0;
  // O changelog e a parte que mais muda de tamanho, entao a altura e
  // recalculada depois de ele ser pintado, e nao so ao trocar de estado.
  ajustarAltura();
}

/**
 * Pede que a janela fique do tamanho do conteudo.
 *
 * Depois do proximo quadro, e nao no ato: a troca de estado acabou de mexer
 * no DOM e a medida sairia do layout antigo. O `ceil` mais a margem cobrem o
 * arredondamento do zoom da tela, que de outro modo cortaria um fio do
 * ultimo pixel.
 */
function ajustarAltura() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const caixa = document.querySelector('.window');
    if (!caixa) return;
    window.updateAPI?.resizeToContent?.(Math.ceil(caixa.getBoundingClientRect().height) + 2);
  }));
}

function showState(name) {
  ['available', 'downloading', 'done'].forEach((s) => {
    $('state-' + s).classList.toggle('active', s === name);
  });
  // trava o X durante o download
  $('close').classList.toggle('locked', name === 'downloading');
  ajustarAltura();
}

function fmtEta(sec) {
  const T = UI[locale];
  if (sec == null || !isFinite(sec) || sec <= 0) return T.calc;
  if (sec < 60) return T.eta(T.secs(Math.ceil(sec)));
  return T.eta(T.mins(Math.ceil(sec / 60)));
}

// ---- aviso de reconexao --------------------------------------------
// O main tenta de novo sozinho quando o download cai; sem isto a janela
// ficaria numa barra imovel, parecendo travada.
let retryTimer = null;

function clearRetryNotice() {
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  const el = $('dl-retry');
  el.hidden = true;
  el.textContent = '';
}

function startRetryCountdown(attempt, ofAttempts, seconds) {
  if (retryTimer) clearInterval(retryTimer);
  const el = $('dl-retry');
  el.hidden = false;
  let left = Math.max(0, Number(seconds) || 0);
  const paint = () => {
    const T = UI[locale];
    el.textContent = left > 0
      ? T.retrying(attempt, ofAttempts, left)
      : T.resuming;
  };
  paint();
  retryTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) { clearInterval(retryTimer); retryTimer = null; }
    paint();
  }, 1000);
  // Velocidade e estimativa ficam velhas no instante em que a
  // transferencia para.
  $('dl-speed').textContent = '';
  $('dl-eta').textContent   = '';
}

// ============================================================
//  IPC
// ============================================================
if (window.updateAPI) {
  window.updateAPI.onState((data) => {
    payload = data;
    if (data.state === 'available') {
      $('v-from').textContent = 'v' + data.currentVersion;
      $('v-to').textContent   = 'v' + data.newVersion;
      $('v-size').textContent = data.sizeMB ? `· ${data.sizeMB} MB` : '';
      $('dl-version').textContent = 'v' + data.newVersion;
      $('dn-version').textContent = 'v' + data.newVersion;
      showState('available');
    } else if (data.state === 'downloaded') {
      $('dn-version').textContent = 'v' + data.newVersion;
      showState('done');
    }
    applyLocale();
  });

  window.updateAPI.onProgress((p) => {
    showState('downloading');
    // Bytes correndo de novo: some o aviso de reconexao que sobrou.
    clearRetryNotice();
    $('dl-pct').textContent  = Math.round(p.percent) + '%';
    $('dl-fill').style.width = p.percent + '%';
    $('dl-transferred').textContent = `${p.transferredMB} / ${p.totalMB} MB`;
    $('dl-speed').textContent = `${p.speedMBs} MB/s`;
    $('dl-eta').textContent   = fmtEta(p.etaSec);
  });

  // O download caiu e o main vai tentar de novo. A contagem faz a barra
  // parada ler como recuperacao, e nao como travamento.
  window.updateAPI.onRetrying((r) => {
    showState('downloading');
    startRetryCountdown(r.attempt, r.ofAttempts, r.inSeconds);
  });

  window.updateAPI.onError((e) => {
    clearRetryNotice();
    const nota = $('err-note');
    nota.textContent = e.message || 'Update error';
    nota.hidden = false;
    showState('available');
  });

  window.updateAPI.onShake(() => {
    const w = $('window');
    w.classList.remove('shake');
    void w.offsetWidth;
    w.classList.add('shake');
  });
}

// ============================================================
//  Eventos de UI
// ============================================================
$('lang-en').onclick = () => { locale = 'en'; persistLocale(); applyLocale(); };
$('lang-pt').onclick = () => { locale = 'pt'; persistLocale(); applyLocale(); };
function persistLocale() {
  try { localStorage.setItem('aurora-locale', locale); } catch (_) { /* localStorage indisponivel */ }
}

$('btn-download').onclick = () => {
  $('err-note').hidden = true;
  window.updateAPI?.download();
  showState('downloading');
};
$('btn-install').onclick  = () => window.updateAPI?.install();
$('btn-later').onclick    = () => window.updateAPI?.dismiss();
$('btn-later2').onclick   = () => window.updateAPI?.dismiss();
$('close').onclick        = () => window.updateAPI?.dismiss();

applyLocale();
