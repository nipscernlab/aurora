import { electronAPI } from '../app/electron_api.js';
import { motivoDe } from '../app/api_reply.js';
import { showDialog } from '../ui/dialog_manager.js';
// search_panel.js, "Find in Files" panel (VS Code's Search), driven by
// electronAPI.searchInProject (main/ipc/search.js). Results are grouped
// by file: a collapsible file header + match rows. Clicking a row opens the
// file at that line via TabManager and closes the modal.

const $ = (id) => document.getElementById(id);

// i18n: window.t returns the dotted key itself when a string is missing. `tt`
// swaps that loud key for an English fallback so a missing locale entry never
// leaks a raw `search.foo` path into the UI.
function tt(key, fallback) {
  const fn = window.t;
  if (typeof fn !== 'function') return fallback;
  const v = fn(key);
  return (v && v !== key) ? v : fallback;
}

// Escape arbitrary text for safe HTML injection. The ONLY markup we inject into
// a preview is our own <mark> (computed below); everything else is escaped.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let modal = null;
let lastResults = [];                       // [{ file, abs, matches:[{line,col,preview}] }]
const collapsed = new Set();                // file paths the user collapsed
const toggles = { case: false, word: false, regex: false };
let reqSeq = 0;                             // guards against out-of-order responses

// Persist the case/word/regex modes so a search behaves the same across
// sessions (VS Code does this). Restored on load; saved on every toggle.
const TOGGLES_KEY = 'aurora.search.toggles';
try {
  const saved = JSON.parse(localStorage.getItem(TOGGLES_KEY) || '{}');
  for (const k of Object.keys(toggles)) {
    if (typeof saved[k] === 'boolean') toggles[k] = saved[k];
  }
} catch (_) { /* corrupt/absent value — keep the defaults */ }
function saveToggles() {
  try { localStorage.setItem(TOGGLES_KEY, JSON.stringify(toggles)); } catch (_) { /* ignore */ }
}

// --- open / close ----------------------------------------------------------
function open() {
  modal = modal || $('searchModal');
  if (!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  const input = $('search-input');
  if (input) { input.focus(); input.select(); }
}
function close() {
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}
const isOpen = () => modal && modal.classList.contains('show');

// --- query the main process ------------------------------------------------
function currentQuery() { return ($('search-input')?.value || ''); }

async function runSearch() {
  const query = currentQuery();
  const summary = $('search-summary');
  const wrap = $('search-results');
  if (!wrap) return;

  if (!query.trim()) {
    lastResults = [];
    wrap.innerHTML = '';
    if (summary) { summary.hidden = true; summary.textContent = ''; }
    sincronizarBotaoSubstituir();
    return;
  }

  const seq = ++reqSeq;
  let res;
  try {
    res = await electronAPI?.searchInProject?.({
      query,
      caseSensitive: toggles.case,
      wholeWord: toggles.word,
      regex: toggles.regex,
    });
  } catch (e) {
    res = { ok: false, error: e?.message || String(e) };
  }
  if (seq !== reqSeq) return; // a newer search already superseded this one

  if (!res || !res.ok) {
    lastResults = [];
    sincronizarBotaoSubstituir();
    wrap.innerHTML = `<div class="search-error"><i class="ph ph-warning-circle"></i> ${esc(motivoDe(res, tt('search.failed', 'Search failed.')))}</div>`;
    if (summary) { summary.hidden = true; summary.textContent = ''; }
    return;
  }

  lastResults = Array.isArray(res.results) ? res.results : [];
  renderResults(res);
  sincronizarBotaoSubstituir();
}

// --- substituir ------------------------------------------------------------

/** Quantas ocorrencias e quantos arquivos a lista mostra agora. */
function totaisDaLista() {
  let ocorrencias = 0;
  for (const g of lastResults) ocorrencias += (g.matches || []).length;
  return { arquivos: lastResults.length, ocorrencias };
}

/**
 * O botao so acende com resultado na tela. Substituir sem nada listado nao tem
 * o que fazer, e um botao aceso que nao faz nada e pior do que um apagado.
 */
function sincronizarBotaoSubstituir() {
  const btn = $('search-replace-all');
  if (btn) btn.disabled = lastResults.length === 0;
}

function avisar(msg, tipo) {
  try { window.showNotification?.(msg, tipo || 'info', 4000, 'search-replace'); }
  catch (_) { /* sem notificacao, sem problema */ }
}

/**
 * Substitui em todos os arquivos da lista.
 *
 * Pergunta antes, e a pergunta traz os NUMEROS: quantas ocorrencias, quantos
 * arquivos, e que a gravacao e no disco. A lista de resultados ja e a previa
 * (a pessoa esta vendo linha por linha o que vai mudar), entao o dialogo nao
 * repete a previa; ele da a dimensao, que e o que a lista rolada nao mostra.
 *
 * Sem contagem regressiva, ao contrario do apagar projeto: aqui existe volta.
 * O arquivo aberto ganha o dialogo de conflito do vigia, e o que estava no
 * controle de versao se recupera com um diff. Travar o botao por cinco
 * segundos numa acao reversivel so treinaria a pessoa a esperar sem ler.
 */
async function substituirTudo() {
  const query = currentQuery();
  if (!query.trim() || !lastResults.length) return;

  const replacement = $('search-replace-input')?.value ?? '';
  const { arquivos, ocorrencias } = totaisDaLista();

  const escolha = await showDialog({
    title: tt('search.replaceConfirmTitle', 'Replace across the project'),
    message: tt('search.replaceConfirmBody', '')
      .replace('{{matches}}', String(ocorrencias))
      .replace('{{files}}', String(arquivos)),
    variant: 'warning',
    buttons: [
      { label: tt('dialog.common.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
      { label: tt('search.replaceConfirmYes', 'Replace'), action: 'substituir', type: 'primary' },
    ],
  });
  // O dialogo resolve com o `action`; Escape e clique fora resolvem 'cancel'.
  if (escolha !== 'substituir') return;

  let res;
  try {
    res = await electronAPI?.replaceInProject?.({
      query,
      caseSensitive: toggles.case,
      wholeWord: toggles.word,
      regex: toggles.regex,
      replacement,
    });
  } catch (e) {
    res = { ok: false, error: e?.message || String(e) };
  }

  if (res && res.ok === false && res.error === 'too-many') {
    avisar(tt('search.replaceTooMany', '').replace('{{total}}', String(res.total ?? '')), 'warning');
    return;
  }
  if (!res || !res.ok) {
    avisar(tt('search.replaceFailed', 'The replacement failed: {{error}}')
      .replace('{{error}}', motivoDe(res, '')), 'error');
    return;
  }
  if (!res.arquivos) {
    avisar(tt('search.replaceNothing', 'Nothing to replace.'), 'info');
    return;
  }

  avisar(tt('search.replaceDone', '')
    .replace('{{matches}}', String(res.ocorrencias))
    .replace('{{files}}', String(res.arquivos)), 'success');

  // Um arquivo que nao deu para gravar nao pode passar batido no meio de uma
  // mensagem de sucesso: o projeto ficou metade trocado e a pessoa precisa
  // saber disso agora, nao na proxima compilacao.
  if (Array.isArray(res.falhas) && res.falhas.length) {
    avisar(tt('search.replacePartial', '').replace('{{files}}', String(res.falhas.length)), 'warning');
  }

  // A lista virou passado no instante da gravacao: refaz a busca para mostrar
  // o que sobrou, em vez de deixar na tela ocorrencias que nao existem mais.
  runSearch();
}

// --- render ----------------------------------------------------------------
/**
 * Build a preview line with every match wrapped in <mark>. We re-run the same
 * RegExp the main process used so the highlighted spans line up exactly, and we
 * escape each segment ourselves, only <mark> is injected by us.
 */
function highlight(preview, re) {
  if (!re) return esc(preview);
  let out = '';
  let last = 0;
  re.lastIndex = 0;
  let m;
  let guard = 0;
  while ((m = re.exec(preview)) !== null) {
    out += esc(preview.slice(last, m.index));
    out += `<mark class="search-mark">${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex += 1; // zero-width guard
    if (++guard > 2000) break;
  }
  out += esc(preview.slice(last));
  return out;
}

/** Mirror main's RegExp construction for client-side highlighting only. */
function buildHighlightRegex() {
  const query = currentQuery();
  if (!query) return null;
  try {
    let body = toggles.regex
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (toggles.word) body = `\\b${body}\\b`;
    return new RegExp(body, 'g' + (toggles.case ? '' : 'i'));
  } catch (_) {
    return null; // invalid regex — main already reported the error
  }
}

function renderResults(res) {
  const wrap = $('search-results');
  const summary = $('search-summary');
  if (!wrap) return;

  if (!lastResults.length) {
    wrap.innerHTML = `<div class="search-empty"><i class="ph ph-magnifying-glass"></i> ${esc(tt('search.noResults', 'No results.'))}</div>`;
    if (summary) {
      summary.hidden = false;
      summary.textContent = tt('search.noResultsSummary', 'No results found.');
    }
    return;
  }

  const re = buildHighlightRegex();
  const fileCount = lastResults.length;
  const html = lastResults.map((group, gi) => {
    const isCollapsed = collapsed.has(group.file);
    const rows = group.matches.map((mt) => `
      <button class="search-match" data-gi="${gi}" data-line="${mt.line}" data-col="${mt.col}"
              title="${esc(group.file)}:${mt.line}">
        <span class="search-match-line">${mt.line}</span>
        <span class="search-match-preview">${highlight(mt.preview, re)}</span>
      </button>`).join('');
    return `
      <div class="search-file ${isCollapsed ? 'collapsed' : ''}" data-file="${esc(group.file)}">
        <button class="search-file-head" data-gi="${gi}" data-collapse="${esc(group.file)}">
          <i class="ph ph-caret-right search-caret" aria-hidden="true"></i>
          <span class="search-file-path" title="${esc(group.file)}">${esc(group.file)}</span>
          <span class="search-file-count">${group.matches.length}</span>
        </button>
        <div class="search-file-matches">${rows}</div>
      </div>`;
  }).join('');
  wrap.innerHTML = html;

  if (summary) {
    summary.hidden = false;
    const total = typeof res?.total === 'number' ? res.total : group_total();
    const noun = total === 1 ? tt('search.resultOne', 'result') : tt('search.resultMany', 'results');
    const fnoun = fileCount === 1 ? tt('search.fileOne', 'file') : tt('search.fileMany', 'files');
    const inWord = tt('search.in', 'in');
    const trunc = res?.truncated ? ` · ${tt('search.partial', 'showing partial results (limit reached)')}` : '';
    summary.textContent = `${total} ${noun} ${inWord} ${fileCount} ${fnoun}${trunc}`;
  }
}

function group_total() {
  return lastResults.reduce((n, g) => n + g.matches.length, 0);
}

// --- open a match in the editor --------------------------------------------
async function openMatch(gi, line, col) {
  const group = lastResults[gi];
  if (!group) return;
  try {
    const content = await electronAPI.readFile(group.abs);
    window.TabManager.addTab(group.abs, content, {
      preview: false,
      revealPosition: { line, column: col || 1 },
    });
  } catch (e) {
    console.error('[search] failed to open match:', e);
    return;
  }
  close();
}

// --- events ----------------------------------------------------------------
function onResultsClick(e) {
  const head = e.target.closest('.search-file-head');
  if (head) {
    const file = head.dataset.collapse;
    if (file) {
      if (collapsed.has(file)) collapsed.delete(file);
      else collapsed.add(file);
      head.closest('.search-file')?.classList.toggle('collapsed');
    }
    return;
  }
  const match = e.target.closest('.search-match');
  if (match) {
    openMatch(Number(match.dataset.gi), Number(match.dataset.line), Number(match.dataset.col));
  }
}

function onToggleClick(btn) {
  const key = btn.dataset.toggle;
  if (!key || !(key in toggles)) return;
  toggles[key] = !toggles[key];
  btn.classList.toggle('active', toggles[key]);
  btn.setAttribute('aria-pressed', String(toggles[key]));
  saveToggles();
  runSearch();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function init() {
  modal = $('searchModal');
  $('searchButton')?.addEventListener('click', open);

  if (modal) {
    modal.addEventListener('aurora-modal-close', close);
    $('search-results')?.addEventListener('click', onResultsClick);
    modal.querySelectorAll('.search-toggle').forEach((btn) => {
      // Reflect the restored state on the button before wiring it.
      const key = btn.dataset.toggle;
      if (key && key in toggles) {
        btn.classList.toggle('active', toggles[key]);
        btn.setAttribute('aria-pressed', String(toggles[key]));
      }
      btn.addEventListener('click', () => onToggleClick(btn));
    });
    $('search-replace-all')?.addEventListener('click', substituirTudo);
    const alvo = $('search-replace-input');
    if (alvo) {
      // Enter no campo de substituicao faz o que a pessoa esta olhando, e nao
      // uma nova busca.
      alvo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); substituirTudo(); }
        if (e.key === 'Escape') { e.preventDefault(); close(); }
      });
    }
    const input = $('search-input');
    if (input) {
      input.addEventListener('input', debounce(runSearch, 250));
      // Enter re-runs immediately (no debounce wait).
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
        if (e.key === 'Escape') { e.preventDefault(); close(); }
      });
    }
  }

  // Global shortcut: Ctrl+Shift+F (Cmd+Shift+F on macOS) opens the panel.
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      if (isOpen()) close(); else open();
    }
  });

  window.openSearchPanel = open;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }

export { open, close };
