// git_panel.js — the Source Control modal + toolbar badge, driven by
// window.gitAPI (main/ipc/git.js → simple-git) and the GitHub account
// connection. The on-disk truth is real `git`, so .gitignore, diffs and merges
// behave exactly as on the command line. Diffs are rendered with diff2html.

import { html as renderDiff } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
// Git feedback lives IN the panel status bar, NOT in corner toasts.
const notify = (msg, type) => flash(msg, type === 'success' ? 'ok' : (type === 'warning' || type === 'error') ? 'error' : 'info');
const api = () => window.gitAPI;
function relDate(iso) {
  try {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'agora';
    if (s < 3600) return `${Math.floor(s / 60)}min`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 2592000) return `${Math.floor(s / 86400)}d`;
    return new Date(iso).toLocaleDateString();
  } catch (_) { return ''; }
}

let modal = null;
let busy = false;
let historyShown = false;
let publishPrivate = true;

// --- open / close ----------------------------------------------------------
function open() {
  modal = modal || $('gitModal');
  if (!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  refresh();
}
function close() {
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}
const isOpen = () => modal && modal.classList.contains('show');

// --- live feedback: status bar + spinner + busy state ----------------------
let statusTimer = null;
function setStatus(msg, kind) {
  const el = $('git-status');
  if (!el) return;
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  if (!msg) { el.innerHTML = ''; el.dataset.kind = ''; return; }
  const icon = kind === 'busy' ? '<span class="git-spinner" aria-hidden="true"></span>'
    : kind === 'ok' ? '<i class="ph ph-check-circle" aria-hidden="true"></i>'
    : kind === 'error' ? '<i class="ph ph-warning-circle" aria-hidden="true"></i>'
    : '<i class="ph ph-info" aria-hidden="true"></i>';
  el.dataset.kind = kind || 'info';
  el.innerHTML = `${icon}<span>${esc(msg)}</span>`;
}
function setBusy(on) {
  const m = $('gitModal');
  if (m) m.classList.toggle('git-busy', !!on);
}

// A one-off status line that auto-clears (for input warnings).
function flash(msg, kind) {
  setStatus(msg, kind || 'info');
  statusTimer = setTimeout(() => setStatus('', null), 4500);
}

// Every action runs through here: shows "…" + spinner while running, then the
// result IN-PANEL (no corner toasts). fn may return a string for a custom OK
// line. One op at a time.
async function run(label, fn) {
  if (busy) return;
  busy = true; setBusy(true); setStatus(`${label}…`, 'busy');
  try {
    const msg = await fn();
    setStatus(typeof msg === 'string' && msg ? msg : `${label} concluído`, 'ok');
    statusTimer = setTimeout(() => setStatus('', null), 4000);
  } catch (e) {
    setStatus(`${label}: ${e?.message || e}`, 'error');
  } finally { busy = false; setBusy(false); }
}

// --- toolbar badge (change count) ------------------------------------------
function changeCount(st) {
  if (!st || !st.ok || !st.isRepo || !Array.isArray(st.files)) return 0;
  return st.files.length;
}
async function updateBadge() {
  const badge = $('git-badge');
  if (!badge || !api()) return;
  try {
    const st = await api().status();
    const n = changeCount(st);
    if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.hidden = false; }
    else { badge.hidden = true; }
  } catch (_) { badge.hidden = true; }
}

// --- status grouping (a file can be staged AND unstaged) -------------------
function partition(st) {
  const staged = [];
  const unstaged = [];
  for (const f of st.files) {
    const i = (f.index || '').trim();
    const w = (f.working || '').trim();
    if (i && i !== '?') staged.push(f);
    if (w || i === '?') unstaged.push(f);
  }
  return { staged, unstaged };
}

const STATUS_LABEL = {
  M: 'modificado', A: 'adicionado', D: 'deletado', R: 'renomeado',
  C: 'copiado', U: 'conflito', '?': 'novo',
};

function fileRow(f, group) {
  const flag = group === 'staged' ? (f.index || '').trim() : ((f.working || '').trim() || (f.index === '?' ? '?' : '')) || (f.index || '').trim();
  const letter = flag || '?';
  const actions = group === 'staged'
    ? `<button class="git-act" data-action="unstage" data-file="${esc(f.path)}" title="Unstage"><i class="ph ph-minus"></i></button>`
    : `<button class="git-act" data-action="stage" data-file="${esc(f.path)}" title="Stage"><i class="ph ph-plus"></i></button>`
      + `<button class="git-act git-act-danger" data-action="discard" data-file="${esc(f.path)}" title="Descartar"><i class="ph ph-arrow-counter-clockwise"></i></button>`;
  return `<li class="git-file" data-file="${esc(f.path)}" data-staged="${group === 'staged'}">
    <span class="git-file-flag git-flag-${esc(letter)}" title="${esc(STATUS_LABEL[letter] || '')}">${esc(letter)}</span>
    <span class="git-file-path" title="${esc(f.path)}">${esc(f.path)}</span>
    <span class="git-file-actions">${actions}</span>
  </li>`;
}

function renderChanges(st) {
  const wrap = $('git-changes');
  if (!wrap) return;
  const { staged, unstaged } = partition(st);
  if (!staged.length && !unstaged.length) {
    wrap.innerHTML = `<div class="git-clean"><i class="ph ph-check-circle"></i> Árvore limpa — nenhuma alteração.</div>`;
    return;
  }
  wrap.innerHTML = `
    ${staged.length ? `<div class="git-section">
      <div class="git-section-head"><span>Staged · ${staged.length}</span>
        <button class="git-mini" data-action="unstage-all">Unstage all</button></div>
      <ul class="git-file-list">${staged.map((f) => fileRow(f, 'staged')).join('')}</ul>
    </div>` : ''}
    ${unstaged.length ? `<div class="git-section">
      <div class="git-section-head"><span>Changes · ${unstaged.length}</span>
        <button class="git-mini" data-action="stage-all">Stage all</button></div>
      <ul class="git-file-list">${unstaged.map((f) => fileRow(f, 'unstaged')).join('')}</ul>
    </div>` : ''}`;
}

function renderRepoHeader(st, info) {
  const repo = $('git-repo');
  if (!repo) return;
  const ahead = st.ahead ? `<span class="git-sync git-ahead" title="à frente do remoto">↑ ${st.ahead}</span>` : '';
  const behind = st.behind ? `<span class="git-sync git-behind" title="atrás do remoto">↓ ${st.behind}</span>` : '';
  // Remote actions only make sense once there's an origin (otherwise the Publish
  // section below handles it).
  const remoteBtns = info.hasOrigin ? `
      <button class="git-mini" data-action="fetch" title="Fetch"><i class="ph ph-cloud-arrow-down"></i> Fetch</button>
      <button class="git-mini" data-action="pull" title="Pull"><i class="ph ph-arrow-down"></i> Pull</button>
      <button class="git-mini git-mini-primary" data-action="push" title="Push"><i class="ph ph-arrow-up"></i> Push</button>` : '';
  repo.innerHTML = `
    <div class="git-repo-left">
      <span class="git-repo-name" title="${esc(info.originUrl || info.name || '')}"><i class="ph ph-git-repository"></i> ${esc(info.name || '—')}</span>
      <span class="git-branch-chip"><i class="ph ph-git-branch"></i> ${esc(st.branch || '—')}</span>
      ${ahead}${behind}
    </div>
    <div class="git-repo-actions">
      <button class="git-mini" data-action="refresh" title="Atualizar"><i class="ph ph-arrows-clockwise"></i></button>
      ${remoteBtns}
    </div>`;
}

function renderPublish(info) {
  const el = $('git-publish');
  if (!el) return;
  if (info.hasOrigin) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `
    <div class="git-publish-head"><i class="ph ph-cloud-arrow-up"></i> Sem remoto — publicar no GitHub</div>
    <div class="git-publish-form">
      <input type="text" id="git-repo-name" class="git-pat-input" value="${esc(info.folder || '')}" placeholder="nome do repositório" spellcheck="false" />
      <div class="git-visibility" role="group" aria-label="Visibilidade">
        <button class="git-vis-opt ${publishPrivate ? 'active' : ''}" data-action="set-private" data-private="true"><i class="ph ph-lock-simple"></i> Privado</button>
        <button class="git-vis-opt ${!publishPrivate ? 'active' : ''}" data-action="set-private" data-private="false"><i class="ph ph-globe-hemisphere-west"></i> Público</button>
      </div>
      <button class="git-mini git-mini-primary" data-action="publish"><i class="ph ph-github-logo"></i> Publicar</button>
    </div>
    <div class="git-hint">Para criar repositórios, o token precisa ser <b>clássico</b> com escopo <code>repo</code> — github.com/settings/tokens/new</div>`;
}

async function loadHistory() {
  const list = $('git-history-list');
  if (!list) return;
  if (!historyShown) { list.hidden = true; return; }
  const r = await api().log({ maxCount: 30 });
  if (!r.ok) { list.innerHTML = `<li class="git-commit-empty">${esc(r.error)}</li>`; list.hidden = false; return; }
  if (!r.commits.length) { list.innerHTML = `<li class="git-commit-empty">Nenhum commit ainda.</li>`; list.hidden = false; return; }
  list.innerHTML = r.commits.map((c) => `
    <li class="git-commit">
      <span class="git-commit-hash">${esc(String(c.hash).slice(0, 7))}</span>
      <span class="git-commit-msg" title="${esc(c.message)}">${esc(c.message)}</span>
      <span class="git-commit-meta">${esc(c.author)} · ${esc(relDate(c.date))}</span>
    </li>`).join('');
  list.hidden = false;
}

async function renderAccount() {
  const el = $('git-account');
  if (!el) return;
  let s;
  try { s = await api().githubStatus(); } catch (_) { s = { connected: false }; }
  if (s && s.connected && s.user) {
    const avatarSrc = s.user.avatarDataUrl || s.user.avatarUrl;
    const avatar = avatarSrc
      ? `<img class="git-avatar" src="${esc(avatarSrc)}" alt="" referrerpolicy="no-referrer" />`
      : `<i class="ph ph-github-logo git-avatar-icon"></i>`;
    el.innerHTML = `<span class="git-user">${avatar}<span class="git-user-name">@${esc(s.user.login)}</span>
        <span class="git-user-ok" title="conectado"><i class="ph ph-check-circle"></i></span></span>
      <button class="git-mini" data-action="disconnect">Desconectar</button>`;
  } else {
    el.innerHTML = `
      <div class="git-connect">
        <input type="password" id="git-pat" class="git-pat-input" placeholder="GitHub Personal Access Token (escopo repo)" autocomplete="off" spellcheck="false" />
        <button class="git-mini git-mini-primary" data-action="connect"><i class="ph ph-github-logo"></i> Conectar</button>
      </div>`;
  }
}

async function refresh() {
  await renderAccount();
  const repo = $('git-repo');
  const changes = $('git-changes');
  const commitbox = $('git-commitbox');
  if ($('git-publish')) $('git-publish').hidden = true;
  if ($('git-history')) $('git-history').hidden = true;
  let isRepo;
  try { isRepo = await api().isRepo(); } catch (e) { isRepo = { ok: false, error: e?.message }; }
  if (!isRepo || isRepo.ok === false) {
    if (repo) repo.innerHTML = '';
    if (commitbox) commitbox.hidden = true;
    if (changes) changes.innerHTML = `<div class="git-empty"><i class="ph ph-folder-dashed"></i> Abra um projeto para usar o controle de versão.</div>`;
    hideDiff();
    return;
  }
  if (!isRepo.isRepo) {
    if (repo) repo.innerHTML = '';
    if (commitbox) commitbox.hidden = true;
    if (changes) changes.innerHTML = `<div class="git-empty">
      <i class="ph ph-git-merge"></i>
      <p>Este projeto ainda não é um repositório Git.</p>
      <button class="git-mini git-mini-primary" data-action="init">Inicializar repositório</button>
    </div>`;
    hideDiff();
    return;
  }
  const st = await api().status();
  if (!st.ok) { if (changes) changes.innerHTML = `<div class="git-empty">${esc(st.error)}</div>`; return; }
  if (commitbox) commitbox.hidden = false;
  if ($('git-history')) $('git-history').hidden = false;
  let info = { hasOrigin: false, name: null, folder: null };
  try { const r = await api().info(); if (r && r.ok) info = r; } catch (_) { /* keep defaults */ }
  renderRepoHeader(st, info);
  renderPublish(info);
  renderChanges(st);
  // Commit is only meaningful when there's something to commit.
  const commitBtn = $('git-commit-btn');
  if (commitBtn) commitBtn.disabled = !st.files.length;
  hideDiff();
  loadHistory();
  updateBadge();
}

// --- diff (diff2html) ------------------------------------------------------
function hideDiff() { const d = $('git-diff'); if (d) d.hidden = true; }
async function showDiff(file, staged) {
  const d = $('git-diff');
  const body = $('git-diff-body');
  if (!d || !body) return;
  const r = await api().diff({ file, staged });
  if (!r.ok) { notify(`diff: ${r.error}`, 'error'); return; }
  const text = (r.diff || '').trim();
  if (!text) {
    body.innerHTML = `<div class="git-diff-empty">Sem diferenças textuais (arquivo novo só aparece após o stage, ou é binário).</div>`;
  } else {
    body.innerHTML = renderDiff(text, {
      drawFileList: false,
      matching: 'words',
      outputFormat: 'line-by-line',
      colorScheme: 'dark',
    });
  }
  $('git-diff-title').textContent = `${file}${staged ? '  ·  staged' : ''}`;
  d.hidden = false;
}

// --- actions (event delegation) --------------------------------------------
async function onClick(e) {
  const actEl = e.target.closest('[data-action]');
  if (actEl) {
    const action = actEl.dataset.action;
    const file = actEl.dataset.file;
    e.stopPropagation();
    switch (action) {
      case 'refresh':    return refresh();
      case 'stage':      return run('Stage', async () => { await api().stage(file); refresh(); });
      case 'unstage':    return run('Unstage', async () => { await api().unstage(file); refresh(); });
      case 'stage-all':  return run('Stage all', async () => { await api().stageAll(); refresh(); });
      case 'unstage-all':return run('Unstage all', async () => { const st = await api().status(); await api().unstage(st.files.map((f) => f.path)); refresh(); });
      case 'discard':    return discard(file);
      case 'init':       return run('Init', async () => { const r = await api().init(); if (!r.ok) throw new Error(r.error); notify('Repositório inicializado.', 'success'); refresh(); });
      case 'fetch':      return run('Fetch', async () => { const r = await api().fetch(); if (!r.ok) throw new Error(r.error); notify('Fetch concluído.', 'success'); refresh(); });
      case 'pull':       return run('Pull', async () => { const r = await api().pull(); if (!r.ok) throw new Error(r.error); notify('Pull concluído.', 'success'); refresh(); });
      case 'push':       return run('Push', async () => { const r = await api().push({ setUpstream: true }); if (!r.ok) throw new Error(r.error); notify('Push concluído.', 'success'); refresh(); });
      case 'publish':    return publish();
      case 'set-private': {
        publishPrivate = actEl.dataset.private === 'true';
        document.querySelectorAll('#git-publish .git-vis-opt').forEach((b) => b.classList.toggle('active', b.dataset.private === String(publishPrivate)));
        return undefined;
      }
      case 'toggle-history': {
        historyShown = !historyShown;
        const t = $('git-history-toggle');
        if (t) t.textContent = historyShown ? 'Ocultar' : 'Mostrar';
        return loadHistory();
      }
      case 'connect':    return connect();
      case 'disconnect': return run('Desconectar', async () => { await api().githubDisconnect(); notify('Conta desconectada.', 'info'); refresh(); });
      default: return undefined;
    }
  }
  const row = e.target.closest('.git-file');
  if (row) {
    document.querySelectorAll('.git-file.selected').forEach((n) => n.classList.remove('selected'));
    row.classList.add('selected');
    showDiff(row.dataset.file, row.dataset.staged === 'true');
  }
}

async function discard(file) {
  // OUR dialog, never the native confirm() (which freezes the whole window).
  const action = await window.AuroraUI?.dialog?.({
    title: 'Descartar alterações',
    message: `Descartar as alterações de <strong>${esc(file)}</strong>? Isto não pode ser desfeito.`,
    variant: 'warning',
    buttons: [
      { label: 'Cancelar', action: 'cancel', type: 'cancel' },
      { label: 'Descartar', action: 'confirm', type: 'danger' },
    ],
  });
  if (action !== 'confirm') return;
  await run('Descartar', async () => { const r = await api().discard(file); if (!r.ok) throw new Error(r.error); refresh(); });
}

async function publish() {
  const name = $('git-repo-name')?.value?.trim();
  const priv = publishPrivate;
  if (!name) { notify('Dê um nome ao repositório.', 'warning'); return; }
  const gh = await api().githubStatus();
  if (!gh || !gh.connected) { notify('Conecte sua conta GitHub primeiro.', 'warning'); return; }
  await run('Publicar', async () => {
    const isRepo = await api().isRepo();
    if (isRepo.ok && !isRepo.isRepo) { const ir = await api().init(); if (!ir.ok) throw new Error(ir.error); }
    const r = await api().githubCreateRepo({ name, private: priv });
    if (!r.ok) throw new Error(r.error);
    const add = await api().addRemote({ name: 'origin', url: r.cloneUrl });
    if (!add.ok) throw new Error(add.error);
    const push = await api().push({ setUpstream: true });
    if (!push.ok) { notify(`Repo ${r.fullName} criado, mas o push falhou (${push.error}). Faça um commit e use Push.`, 'warning'); refresh(); return; }
    notify(`Publicado em ${r.fullName}.`, 'success');
    refresh();
  });
}

async function connect() {
  const token = $('git-pat')?.value?.trim();
  if (!token) { notify('Cole um token primeiro.', 'warning'); return; }
  await run('Conectar', async () => {
    const r = await api().githubConnect(token);
    if (!r.ok) throw new Error(r.error);
    notify(`Conectado como @${r.user.login}.`, 'success');
    refresh();
  });
}

async function doCommit() {
  const ta = $('git-commit-msg');
  const message = (ta?.value || '').trim();
  if (!message) { notify('Escreva uma mensagem de commit.', 'warning'); return; }
  await run('Commit', async () => {
    const st = await api().status();
    const { staged } = st.ok ? partition(st) : { staged: [] };
    if (!staged.length) { await api().stageAll(); } // nothing staged → stage all (VS Code-style)
    const r = await api().commit({ message });
    if (!r.ok) throw new Error(r.error);
    if (ta) ta.value = '';
    notify(`Commit ${r.commit ? String(r.commit).slice(0, 7) : ''} criado.`, 'success');
    refresh();
  });
}

// --- init ------------------------------------------------------------------
function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

function init() {
  $('gitButton')?.addEventListener('click', open);
  modal = $('gitModal');
  if (modal) {
    modal.addEventListener('aurora-modal-close', close);
    modal.addEventListener('click', onClick);
  }
  $('git-commit-btn')?.addEventListener('click', doCommit);
  $('git-diff-close')?.addEventListener('click', hideDiff);
  window.openGitPanel = open;

  // Keep the toolbar badge fresh: after boot, on file saves / project changes,
  // and a slow fallback poll. (git status is cheap.)
  const refreshBadge = debounce(updateBadge, 700);
  setTimeout(updateBadge, 1500);
  window.addEventListener('aurora:file-saved', refreshBadge);
  window.addEventListener('aurora:spf-changed', refreshBadge);
  document.addEventListener('aurora:file-saved', refreshBadge);
  setInterval(() => { if (!isOpen()) updateBadge(); }, 30_000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { open, close };
