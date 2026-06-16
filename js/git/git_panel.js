// git_panel.js — Source Control panel (GitHub-Desktop-style), driven by
// window.gitAPI (main/ipc/git.js → simple-git) + GitHub account connection.
// The on-disk truth is real `git`, so .gitignore, diffs and merges behave
// exactly as on the command line. Diffs render with diff2html.

import { html as renderDiff } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
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
let publishPrivate = true;
let activeTab = 'changes';

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
function setBusy(on) { const m = $('gitModal'); if (m) m.classList.toggle('git-busy', !!on); }
function flash(msg, kind) {
  setStatus(msg, kind || 'info');
  statusTimer = setTimeout(() => setStatus('', null), 4500);
}
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
  return (st && st.ok && st.isRepo && Array.isArray(st.files)) ? st.files.length : 0;
}
async function updateBadge() {
  const badge = $('git-badge');
  if (!badge || !api()) return;
  try {
    const st = await api().status();
    const n = changeCount(st);
    if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.hidden = false; badge.dataset.kind = 'changes'; }
    else if (st && st.ok && st.ahead > 0) { badge.textContent = '↑'; badge.hidden = false; badge.dataset.kind = 'ahead'; }
    else { badge.hidden = true; }
  } catch (_) { badge.hidden = true; }
}

// --- status grouping -------------------------------------------------------
function partition(st) {
  const staged = []; const unstaged = [];
  for (const f of st.files) {
    const i = (f.index || '').trim(); const w = (f.working || '').trim();
    if (i && i !== '?') staged.push(f);
    if (w || i === '?') unstaged.push(f);
  }
  return { staged, unstaged };
}
const STATUS_LABEL = { M: 'modificado', A: 'adicionado', D: 'deletado', R: 'renomeado', C: 'copiado', U: 'conflito', '?': 'novo' };

function fileRow(f, group) {
  const flag = group === 'staged' ? (f.index || '').trim()
    : ((f.working || '').trim() || (f.index === '?' ? '?' : '')) || (f.index || '').trim();
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
  const count = $('git-tab-count');
  if (count) { const n = st.files.length; count.textContent = String(n); count.hidden = !n; }
  if (!staged.length && !unstaged.length) {
    wrap.innerHTML = `<div class="git-clean"><i class="ph ph-check-circle"></i> Árvore limpa — nenhuma alteração.</div>`;
    return;
  }
  wrap.innerHTML = `
    ${staged.length ? `<div class="git-section">
      <div class="git-section-head"><span>Staged · ${staged.length}</span>
        <button class="git-mini" data-action="unstage-all">Unstage all</button></div>
      <ul class="git-file-list">${staged.map((f) => fileRow(f, 'staged')).join('')}</ul></div>` : ''}
    ${unstaged.length ? `<div class="git-section">
      <div class="git-section-head"><span>Changes · ${unstaged.length}</span>
        <button class="git-mini" data-action="stage-all">Stage all</button></div>
      <ul class="git-file-list">${unstaged.map((f) => fileRow(f, 'unstaged')).join('')}</ul></div>` : ''}`;
}

function renderRepoHeader(st, info) {
  const repo = $('git-repo');
  if (!repo) return;
  const ahead = st.ahead ? `<span class="git-sync git-ahead" title="à frente do remoto">↑ ${st.ahead}</span>` : '';
  const behind = st.behind ? `<span class="git-sync git-behind" title="atrás do remoto">↓ ${st.behind}</span>` : '';
  const remoteBtns = info.hasOrigin ? `
      <button class="git-mini" data-action="fetch" title="Fetch"><i class="ph ph-cloud-arrow-down"></i> Fetch</button>
      <button class="git-mini" data-action="pull" title="Pull"><i class="ph ph-arrow-down"></i> Pull</button>
      <button class="git-mini git-mini-primary" data-action="push" title="Push"><i class="ph ph-arrow-up"></i> Push</button>` : '';
  repo.innerHTML = `
    <div class="git-repo-left">
      <span class="git-repo-name" title="${esc(info.originUrl || info.name || '')}"><i class="ph ph-git-repository"></i> ${esc(info.name || '—')}</span>
      <div class="git-branch-wrap">
        <button class="git-branch-chip" data-action="branch-menu"><i class="ph ph-git-branch"></i> ${esc(st.branch || '—')} <i class="ph ph-caret-down git-caret"></i></button>
        <div class="git-branch-menu" id="git-branch-menu" hidden></div>
      </div>
      ${ahead}${behind}
    </div>
    <div class="git-repo-actions">
      <button class="git-mini" data-action="refresh" title="Atualizar"><i class="ph ph-arrows-clockwise"></i></button>
      ${remoteBtns}
    </div>`;
}

async function toggleBranchMenu() {
  const menu = $('git-branch-menu');
  if (!menu) return;
  if (!menu.hidden) { menu.hidden = true; return; }
  const r = await api().branches();
  if (!r.ok) { flash(`Branches: ${r.error}`, 'error'); return; }
  renderBranchMenu(r.branches || [], r.current);
}
function renderBranchMenu(branches, current) {
  const menu = $('git-branch-menu');
  if (!menu) return;
  menu.innerHTML = `
    <div class="git-bm-head">Branches</div>
    <ul class="git-bm-list">
      ${branches.map((b) => `<li class="git-bm-item ${b === current ? 'current' : ''}">
        <button class="git-bm-switch" data-action="checkout-branch" data-branch="${esc(b)}" ${b === current ? 'disabled' : ''}>
          <i class="ph ${b === current ? 'ph-check' : 'ph-git-branch'}"></i> ${esc(b)}
        </button>
        ${b !== current ? `<button class="git-bm-merge" data-action="merge-branch" data-branch="${esc(b)}" title="Merge em ${esc(current)}"><i class="ph ph-git-merge"></i></button>` : ''}
      </li>`).join('')}
    </ul>
    <div class="git-bm-new">
      <input type="text" id="git-new-branch" class="git-pat-input" placeholder="nova branch" spellcheck="false" />
      <button class="git-mini git-mini-primary" data-action="create-branch"><i class="ph ph-plus"></i> Criar</button>
    </div>`;
  menu.hidden = false;
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
      <span class="git-account-actions">
        <button class="git-mini" data-action="clone-toggle"><i class="ph ph-download-simple"></i> Clonar</button>
        <button class="git-mini" data-action="disconnect">Desconectar</button>
      </span>`;
  } else {
    el.innerHTML = `
      <div class="git-connect">
        <input type="password" id="git-pat" class="git-pat-input" placeholder="GitHub token clássico (escopo repo)" autocomplete="off" spellcheck="false" />
        <button class="git-mini git-mini-primary" data-action="connect"><i class="ph ph-github-logo"></i> Conectar</button>
      </div>`;
  }
}

// --- tabs ------------------------------------------------------------------
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#git-tabs .git-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const changes = $('git-pane-changes'); const history = $('git-pane-history');
  if (changes) changes.hidden = tab !== 'changes';
  if (history) history.hidden = tab !== 'history';
  if (tab === 'history') loadHistory();
}

async function refresh() {
  await renderAccount();
  const repo = $('git-repo'); const changes = $('git-changes'); const commitbox = $('git-commitbox');
  const tabs = $('git-tabs');
  if ($('git-publish')) $('git-publish').hidden = true;
  let isRepo;
  try { isRepo = await api().isRepo(); } catch (e) { isRepo = { ok: false, error: e?.message }; }
  if (!isRepo || isRepo.ok === false) {
    if (repo) repo.innerHTML = '';
    if (commitbox) commitbox.hidden = true;
    if (tabs) tabs.hidden = true;
    if (changes) changes.innerHTML = `<div class="git-empty"><i class="ph ph-folder-dashed"></i> Abra um projeto para usar o controle de versão.</div>`;
    hideDiff();
    return;
  }
  if (!isRepo.isRepo) {
    if (repo) repo.innerHTML = '';
    if (commitbox) commitbox.hidden = true;
    if (tabs) tabs.hidden = true;
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
  if (tabs) tabs.hidden = false;
  let info = { hasOrigin: false, name: null, folder: null };
  try { const r = await api().info(); if (r && r.ok) info = r; } catch (_) { /* keep */ }
  renderRepoHeader(st, info);
  renderPublish(info);
  renderChanges(st);
  const commitBtn = $('git-commit-btn');
  if (commitBtn) commitBtn.disabled = !st.files.length && !$('git-amend')?.checked;
  hideDiff();
  if (activeTab === 'history') loadHistory();
  updateBadge();
}

// --- diff (diff2html) ------------------------------------------------------
function diffHtml(text) {
  const start = text.indexOf('diff --git');
  const body = start >= 0 ? text.slice(start) : text;
  if (!body.trim()) return `<div class="git-diff-empty">Sem diferenças textuais.</div>`;
  return renderDiff(body, { drawFileList: false, matching: 'words', outputFormat: 'line-by-line', colorScheme: 'dark' });
}
function hideDiff() { const d = $('git-diff'); if (d) d.hidden = true; }
async function showDiff(file, staged) {
  const d = $('git-diff'); const body = $('git-diff-body');
  if (!d || !body) return;
  const r = await api().diff({ file, staged });
  if (!r.ok) { flash(`diff: ${r.error}`, 'error'); return; }
  const text = (r.diff || '').trim();
  body.innerHTML = text ? diffHtml(text)
    : `<div class="git-diff-empty">Sem diferenças (arquivo novo aparece após o stage, ou é binário).</div>`;
  $('git-diff-title').textContent = `${file}${staged ? '  ·  staged' : ''}`;
  d.hidden = false;
}
async function showCommitDiff(hash, subject) {
  const d = $('git-history-diff'); const body = $('git-history-diff-body');
  if (!d || !body) return;
  const r = await api().show({ hash });
  if (!r.ok) { flash(`show: ${r.error}`, 'error'); return; }
  body.innerHTML = diffHtml(r.diff || '');
  $('git-history-diff-title').textContent = `${String(hash).slice(0, 7)} · ${subject || ''}`;
  d.hidden = false;
}

async function loadHistory() {
  const list = $('git-history-list');
  if (!list) return;
  const r = await api().log({ maxCount: 50 });
  if (!r.ok) { list.innerHTML = `<li class="git-commit-empty">${esc(r.error)}</li>`; return; }
  if (!r.commits.length) { list.innerHTML = `<li class="git-commit-empty">Nenhum commit ainda.</li>`; return; }
  list.innerHTML = r.commits.map((c) => `
    <li class="git-commit" data-hash="${esc(c.hash)}" data-subject="${esc(c.message)}">
      <span class="git-commit-hash">${esc(String(c.hash).slice(0, 7))}</span>
      <span class="git-commit-msg" title="${esc(c.message)}">${esc(c.message)}</span>
      <span class="git-commit-meta">${esc(c.author)} · ${esc(relDate(c.date))}</span>
    </li>`).join('');
}

// --- actions ---------------------------------------------------------------
async function onClick(e) {
  const bm = $('git-branch-menu');
  if (bm && !bm.hidden && !e.target.closest('.git-branch-wrap')) bm.hidden = true;
  const actEl = e.target.closest('[data-action]');
  if (actEl) {
    const action = actEl.dataset.action;
    const file = actEl.dataset.file;
    e.stopPropagation();
    switch (action) {
      case 'tab':        return switchTab(actEl.dataset.tab);
      case 'refresh':    return refresh();
      case 'stage':      return run('Stage', async () => { await api().stage(file); refresh(); });
      case 'unstage':    return run('Unstage', async () => { await api().unstage(file); refresh(); });
      case 'stage-all':  return run('Stage all', async () => { await api().stageAll(); refresh(); });
      case 'unstage-all':return run('Unstage all', async () => { const st = await api().status(); await api().unstage(st.files.map((f) => f.path)); refresh(); });
      case 'discard':    return discard(file);
      case 'undo':       return undoLast();
      case 'init':       return run('Inicializar', async () => { const r = await api().init(); if (!r.ok) throw new Error(r.error); refresh(); return 'Repositório inicializado'; });
      case 'fetch':      return run('Fetch', async () => { const r = await api().fetch(); if (!r.ok) throw new Error(r.error); refresh(); return 'Fetch concluído'; });
      case 'pull':       return run('Pull', async () => { const r = await api().pull(); if (!r.ok) throw new Error(r.error); refresh(); return 'Pull concluído'; });
      case 'push':       return run('Push', async () => { const r = await api().push({ setUpstream: true }); if (!r.ok) throw new Error(r.error); refresh(); return 'Push enviado'; });
      case 'publish':    return publish();
      case 'set-private': {
        publishPrivate = actEl.dataset.private === 'true';
        document.querySelectorAll('#git-publish .git-vis-opt').forEach((b) => b.classList.toggle('active', b.dataset.private === String(publishPrivate)));
        return undefined;
      }
      case 'connect':    return connect();
      case 'disconnect': return run('Desconectar', async () => { await api().githubDisconnect(); refresh(); return 'Conta desconectada'; });
      case 'clone-toggle': { const c = $('git-clone'); if (c) c.hidden = !c.hidden; return undefined; }
      case 'clone':      return doClone();
      case 'branch-menu': return toggleBranchMenu();
      case 'checkout-branch': return run('Trocar branch', async () => { const r = await api().checkout({ branch: actEl.dataset.branch }); if (!r.ok) throw new Error(r.error); refresh(); return `Na branch ${actEl.dataset.branch}`; });
      case 'merge-branch': return run('Merge', async () => { const r = await api().merge({ branch: actEl.dataset.branch }); if (!r.ok) throw new Error(r.error); refresh(); return `Merge de ${actEl.dataset.branch}`; });
      case 'create-branch': {
        const nb = $('git-new-branch')?.value?.trim();
        if (!nb) { flash('Dê um nome à branch.', 'error'); return undefined; }
        return run('Nova branch', async () => { const r = await api().checkout({ branch: nb, create: true }); if (!r.ok) throw new Error(r.error); refresh(); return `Branch ${nb} criada`; });
      }
      default: return undefined;
    }
  }
  const row = e.target.closest('.git-file');
  if (row) {
    document.querySelectorAll('.git-file.selected').forEach((n) => n.classList.remove('selected'));
    row.classList.add('selected');
    return showDiff(row.dataset.file, row.dataset.staged === 'true');
  }
  const commit = e.target.closest('.git-commit');
  if (commit && commit.dataset.hash) {
    document.querySelectorAll('.git-commit.selected').forEach((n) => n.classList.remove('selected'));
    commit.classList.add('selected');
    return showCommitDiff(commit.dataset.hash, commit.dataset.subject);
  }
  return undefined;
}

async function discard(file) {
  const action = await window.AuroraUI?.dialog?.({
    title: 'Descartar alterações',
    message: `Descartar as alterações de <strong>${esc(file)}</strong>? Isto não pode ser desfeito.`,
    variant: 'warning',
    buttons: [{ label: 'Cancelar', action: 'cancel', type: 'cancel' }, { label: 'Descartar', action: 'confirm', type: 'danger' }],
  });
  if (action !== 'confirm') return;
  await run('Descartar', async () => { const r = await api().discard(file); if (!r.ok) throw new Error(r.error); refresh(); });
}

async function undoLast() {
  const action = await window.AuroraUI?.dialog?.({
    title: 'Desfazer último commit',
    message: 'Desfazer o último commit? As alterações voltam para a área de stage (soft reset).',
    variant: 'warning',
    buttons: [{ label: 'Cancelar', action: 'cancel', type: 'cancel' }, { label: 'Desfazer', action: 'confirm', type: 'danger' }],
  });
  if (action !== 'confirm') return;
  await run('Desfazer commit', async () => { const r = await api().undoLastCommit(); if (!r.ok) throw new Error(r.error); refresh(); return 'Último commit desfeito'; });
}

async function doClone() {
  const url = $('git-clone-url')?.value?.trim();
  if (!url) { flash('Cole a URL do repositório.', 'error'); return; }
  await run('Clonar', async () => {
    const r = await api().clone({ url });
    if (!r.ok) throw new Error(r.error);
    if (r.canceled) return 'Clone cancelado';
    const c = $('git-clone'); if (c) c.hidden = true;
    return `Clonado em ${r.dest}`;
  });
}

async function connect() {
  const token = $('git-pat')?.value?.trim();
  if (!token) { flash('Cole um token primeiro.', 'error'); return; }
  await run('Conectar', async () => {
    const r = await api().githubConnect(token);
    if (!r.ok) throw new Error(r.error);
    refresh();
    return `Conectado como @${r.user.login}`;
  });
}

async function publish() {
  const name = $('git-repo-name')?.value?.trim();
  const priv = publishPrivate;
  if (!name) { flash('Dê um nome ao repositório.', 'error'); return; }
  const gh = await api().githubStatus();
  if (!gh || !gh.connected) { flash('Conecte sua conta GitHub primeiro.', 'error'); return; }
  await run('Publicar', async () => {
    const isRepo = await api().isRepo();
    if (isRepo.ok && !isRepo.isRepo) { const ir = await api().init(); if (!ir.ok) throw new Error(ir.error); }
    const r = await api().githubCreateRepo({ name, private: priv });
    if (!r.ok) throw new Error(r.error);
    const add = await api().addRemote({ name: 'origin', url: r.cloneUrl });
    if (!add.ok) throw new Error(add.error);
    const push = await api().push({ setUpstream: true });
    refresh();
    if (!push.ok) return `Repo ${r.fullName} criado — faça um commit e Push.`;
    return `Publicado em ${r.fullName}`;
  });
}

async function doCommit() {
  const title = ($('git-commit-title')?.value || '').trim();
  const desc = ($('git-commit-desc')?.value || '').trim();
  const amend = !!$('git-amend')?.checked;
  if (!title) { flash('Escreva um resumo para o commit.', 'error'); return; }
  const message = desc ? `${title}\n\n${desc}` : title;
  await run('Commit', async () => {
    const st = await api().status();
    const { staged } = st.ok ? partition(st) : { staged: [] };
    if (!amend && st.ok && !st.files.length) throw new Error('Nada para commitar.');
    if (!amend && !staged.length && st.files.length) { await api().stageAll(); }
    const r = await api().commit({ message, amend });
    if (!r.ok) throw new Error(r.error);
    if ($('git-commit-title')) $('git-commit-title').value = '';
    if ($('git-commit-desc')) $('git-commit-desc').value = '';
    if ($('git-amend')) $('git-amend').checked = false;
    refresh();
    return amend ? 'Commit corrigido (amend)' : `Commit ${r.commit ? String(r.commit).slice(0, 7) : ''} criado`;
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
  $('git-history-diff-close')?.addEventListener('click', () => { const d = $('git-history-diff'); if (d) d.hidden = true; });
  window.openGitPanel = open;

  const refreshBadge = debounce(updateBadge, 700);
  setTimeout(updateBadge, 1500);
  window.addEventListener('aurora:file-saved', refreshBadge);
  window.addEventListener('aurora:spf-changed', refreshBadge);
  document.addEventListener('aurora:file-saved', refreshBadge);
  setInterval(() => { if (!isOpen()) updateBadge(); }, 30_000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }

export { open, close };
