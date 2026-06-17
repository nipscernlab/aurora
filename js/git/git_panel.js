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
// i18n: window.t returns the dotted key itself when a string is missing.
// `tt` swaps that loud key for a sensible English fallback so users never
// see a raw `git.foo` path if a locale entry is absent.
function tt(key, fallback) {
  const fn = window.t;
  if (typeof fn !== 'function') return fallback;
  const v = fn(key);
  return (v && v !== key) ? v : fallback;
}
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
let amendOn = false;
let lastHasChanges = false;
let historyCommits = [];

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
    setStatus(typeof msg === 'string' && msg ? msg : label, 'ok');
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
    wrap.innerHTML = `<div class="git-clean"><i class="ph ph-check-circle"></i> ${esc(tt('git.treeClean', 'Working tree clean — no changes.'))}</div>`;
    return;
  }
  wrap.innerHTML = `
    ${staged.length ? `<div class="git-section">
      <div class="git-section-head"><span>${esc(tt('git.staged', 'Staged'))} · ${staged.length}</span>
        <button class="git-mini" data-action="unstage-all" title="Tirar tudo da área de stage (não entra no commit)">${esc(tt('git.unstageAll', 'Unstage all'))}</button></div>
      <ul class="git-file-list">${staged.map((f) => fileRow(f, 'staged')).join('')}</ul></div>` : ''}
    ${unstaged.length ? `<div class="git-section">
      <div class="git-section-head"><span>${esc(tt('git.changes', 'Changes'))} · ${unstaged.length}</span>
        <button class="git-mini" data-action="stage-all" title="Preparar TODAS as mudanças para o próximo commit (git add -A)">${esc(tt('git.stageAll', 'Stage all'))}</button></div>
      <ul class="git-file-list">${unstaged.map((f) => fileRow(f, 'unstaged')).join('')}</ul></div>` : ''}`;
}

function renderRepoHeader(st, info) {
  const repo = $('git-repo');
  if (!repo) return;
  const ahead = st.ahead ? `<span class="git-sync git-ahead" title="à frente do remoto">↑ ${st.ahead}</span>` : '';
  const behind = st.behind ? `<span class="git-sync git-behind" title="atrás do remoto">↓ ${st.behind}</span>` : '';
  // Push only makes sense when there's something to push: an upstream that we're
  // ahead of, or no upstream yet (a fresh branch that needs the first push -u).
  const pushDisabled = !!st.tracking && !st.ahead;
  const tFetch = esc(tt('git.fetch', 'Fetch'));
  const tPull = esc(tt('git.pull', 'Pull'));
  const tPush = esc(tt('git.push', 'Push'));
  const remoteBtns = info.hasOrigin ? `
      <button class="git-mini" data-action="fetch" title="${tFetch}"><i class="ph ph-cloud-arrow-down"></i> ${tFetch}</button>
      <button class="git-mini" data-action="pull" title="${tPull}"><i class="ph ph-arrow-down"></i> ${tPull}</button>
      <button class="git-mini git-mini-primary" data-action="push" title="${tPush}" ${pushDisabled ? 'disabled' : ''}><i class="ph ph-arrow-up"></i> ${tPush}${st.ahead ? ` (${st.ahead})` : ''}</button>` : '';
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
      <button class="git-mini" data-action="refresh" title="${esc(tt('git.refresh', 'Refresh'))}"><i class="ph ph-arrows-clockwise"></i></button>
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
    <div class="git-bm-head">${esc(tt('git.branches', 'Branches'))}</div>
    <ul class="git-bm-list">
      ${branches.map((b) => `<li class="git-bm-item ${b === current ? 'current' : ''}">
        <button class="git-bm-switch" data-action="checkout-branch" data-branch="${esc(b)}" ${b === current ? 'disabled' : ''}>
          <i class="ph ${b === current ? 'ph-check' : 'ph-git-branch'}"></i> ${esc(b)}
        </button>
        ${b !== current ? `<button class="git-bm-merge" data-action="merge-branch" data-branch="${esc(b)}" title="Merge → ${esc(current)}"><i class="ph ph-git-merge"></i></button>` : ''}
      </li>`).join('')}
    </ul>
    <div class="git-bm-new">
      <input type="text" id="git-new-branch" class="git-pat-input" placeholder="${esc(tt('git.newBranchPlaceholder', 'new branch'))}" spellcheck="false" />
      <button class="git-mini git-mini-primary" data-action="create-branch"><i class="ph ph-plus"></i> ${esc(tt('git.create', 'Create'))}</button>
    </div>`;
  menu.hidden = false;
}

function renderPublish(info) {
  const el = $('git-publish');
  if (!el) return;
  if (info.hasOrigin) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `
    <div class="git-publish-head"><i class="ph ph-cloud-arrow-up"></i> ${esc(tt('git.publishHead', 'No remote — publish to GitHub'))}</div>
    <div class="git-publish-form">
      <input type="text" id="git-repo-name" class="git-pat-input" value="${esc(info.folder || '')}" placeholder="${esc(tt('git.repoNamePlaceholder', 'repository name'))}" spellcheck="false" />
      <div class="git-visibility" role="group" aria-label="Visibility">
        <button class="git-vis-opt ${publishPrivate ? 'active' : ''}" data-action="set-private" data-private="true"><i class="ph ph-lock-simple"></i> ${esc(tt('git.private', 'Private'))}</button>
        <button class="git-vis-opt ${!publishPrivate ? 'active' : ''}" data-action="set-private" data-private="false"><i class="ph ph-globe-hemisphere-west"></i> ${esc(tt('git.public', 'Public'))}</button>
      </div>
      <button class="git-mini git-mini-primary" data-action="publish"><i class="ph ph-github-logo"></i> ${esc(tt('git.publish', 'Publish'))}</button>
    </div>
    <div class="git-hint">${tt('git.tokenHint', 'To create repositories, the token must be <b>classic</b> with the <code>repo</code> scope — github.com/settings/tokens/new')}</div>`;
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
        <span class="git-user-ok" title="${esc(tt('git.connect', 'Connect'))}"><i class="ph ph-check-circle"></i></span></span>
      <span class="git-account-actions">
        <button class="git-mini" data-action="clone-toggle"><i class="ph ph-download-simple"></i> ${esc(tt('git.clone', 'Clone'))}</button>
        <button class="git-icon-btn git-disconnect" data-action="disconnect" title="${esc(tt('git.disconnect', 'Disconnect'))}" aria-label="${esc(tt('git.disconnect', 'Disconnect'))}"><i class="ph ph-sign-out"></i></button>
      </span>`;
  } else {
    el.innerHTML = `
      <div class="git-connect">
        <input type="password" id="git-pat" class="git-pat-input" placeholder="${esc(tt('git.tokenPlaceholder', 'GitHub classic token (repo scope)'))}" autocomplete="off" spellcheck="false" />
        <button class="git-mini git-mini-primary" data-action="connect"><i class="ph ph-github-logo"></i> ${esc(tt('git.connect', 'Connect'))}</button>
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
    if (changes) changes.innerHTML = `<div class="git-empty"><i class="ph ph-folder-dashed"></i> ${esc(tt('git.openProject', 'Open a project to use version control.'))}</div>`;
    hideDiff();
    return;
  }
  if (!isRepo.isRepo) {
    if (repo) repo.innerHTML = '';
    if (commitbox) commitbox.hidden = true;
    if (tabs) tabs.hidden = true;
    if (changes) changes.innerHTML = `<div class="git-empty">
      <i class="ph ph-git-merge"></i>
      <p>${esc(tt('git.notRepo', 'This project is not a Git repository yet.'))}</p>
      <button class="git-mini git-mini-primary" data-action="init">${esc(tt('git.initRepo', 'Initialize repository'))}</button>
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
  lastHasChanges = !!st.files.length;
  const commitBtn = $('git-commit-btn');
  if (commitBtn) commitBtn.disabled = !lastHasChanges && !amendOn;
  hideDiff();
  if (activeTab === 'history') loadHistory();
  updateBadge();
}

// --- diff (diff2html) ------------------------------------------------------
// Files we never render a textual diff for (images/blobs/generated artifacts):
// even when git treats them as text, a multi-MB .mif/.hex would choke the panel.
const BINARY_EXT_RE = /\.(png|jpe?g|gif|bmp|ico|webp|tiff?|svg|pdf|zip|gz|tgz|7z|rar|exe|dll|so|dylib|o|a|lib|bin|dat|vcd|fst|ghw|wlf|woff2?|ttf|otf|eot|mp[34]|wav|ogg|class|jar|mif|hex|coe)$/i;
function isBinaryFile(f) { return !!(f && (f.binary || BINARY_EXT_RE.test(f.path || ''))); }

// diff2html, line-by-line. We deliberately DON'T use matching:'words' — that
// intra-line word diff is O(n²)-ish and was a big part of the freeze on large
// diffs. Per-file + capped + no word-matching keeps rendering snappy.
function diffHtml(text) {
  const start = text.indexOf('diff --git');
  const body = start >= 0 ? text.slice(start) : text;
  if (!body.trim()) return `<div class="git-diff-empty">${esc(tt('git.noTextDiff', 'No textual differences.'))}</div>`;
  return renderDiff(body, { drawFileList: false, outputFormat: 'line-by-line', colorScheme: 'dark' });
}
function truncNote(truncated) {
  return truncated
    ? `<div class="git-diff-trunc"><i class="ph ph-warning-circle"></i> ${esc(tt('git.diffTruncated', 'Large diff — showing the first part only.'))}</div>`
    : '';
}
function hideDiff() { const d = $('git-diff'); if (d) d.hidden = true; }
async function showDiff(file, staged) {
  const d = $('git-diff'); const body = $('git-diff-body');
  if (!d || !body) return;
  $('git-diff-title').textContent = `${file}${staged ? '  ·  staged' : ''}`;
  d.hidden = false;
  if (BINARY_EXT_RE.test(file)) {
    body.innerHTML = `<div class="git-diff-empty"><i class="ph ph-file-image"></i> ${esc(tt('git.binaryNotShown', 'Binary file — diff not shown.'))}</div>`;
    return;
  }
  body.innerHTML = `<div class="git-diff-loading"><span class="git-spinner"></span> ${esc(tt('git.loading', 'Loading…'))}</div>`;
  const r = await api().diff({ file, staged });
  if (!r.ok) { body.innerHTML = `<div class="git-diff-empty">${esc(r.error)}</div>`; return; }
  const text = (r.diff || '').trim();
  if (!text) {
    body.innerHTML = `<div class="git-diff-empty">${esc(tt('git.noDiffYet', 'No differences (a new file appears once staged, or it is binary).'))}</div>`;
    return;
  }
  // Render on the next frame so the spinner paints first (large files).
  requestAnimationFrame(() => { body.innerHTML = truncNote(r.truncated) + diffHtml(text); });
}

// History diff — GitHub-Desktop model: a FAST file list (numstat only), then the
// per-file diff is lazy-loaded on expand. We never render the whole commit at
// once, so even a 10k-line commit opens instantly.
function commitDetailHtml(commit, hash) {
  return `<div class="git-commit-detail">
    <div class="git-commit-detail-subject">${esc(commit.message || '')}</div>
    ${commit.body ? `<pre class="git-commit-detail-body">${esc(commit.body)}</pre>` : ''}
    <div class="git-commit-detail-meta"><i class="ph ph-user-circle"></i> ${esc(commit.author || '')} &middot; <i class="ph ph-git-commit"></i> ${esc(String(hash).slice(0, 7))} &middot; ${esc(relDate(commit.date))}</div>
  </div>`;
}
function fileDiffRow(f, i, hash) {
  const bin = isBinaryFile(f);
  const stats = bin
    ? `<span class="git-fd-bin" title="${esc(tt('git.binaryNotShown', 'Binary file — diff not shown.'))}">bin</span>`
    : `<span class="git-fd-add">+${f.additions}</span><span class="git-fd-del">-${f.deletions}</span>`;
  return `<div class="git-fd ${bin ? 'is-binary' : ''}" data-file="${esc(f.path)}" data-index="${i}">
    <button class="git-fd-head" data-action="commit-file-toggle" data-hash="${esc(hash)}" data-file="${esc(f.path)}" data-binary="${bin}" ${bin ? 'disabled' : ''}>
      <i class="ph ph-caret-right git-fd-caret" aria-hidden="true"></i>
      <span class="git-fd-path" title="${esc(f.path)}">${esc(f.path)}</span>
      ${stats}
    </button>
    ${bin
      ? `<div class="git-fd-note"><i class="ph ph-file-image"></i> ${esc(tt('git.binaryNotShown', 'Binary file — diff not shown.'))}</div>`
      : `<div class="git-fd-body" hidden></div>`}
  </div>`;
}
async function showCommitDiff(hash) {
  const d = $('git-history-diff'); const body = $('git-history-diff-body');
  if (!d || !body) return;
  const commit = historyCommits.find((c) => c.hash === hash) || {};
  d.hidden = false;
  $('git-history-diff-title').textContent = String(hash).slice(0, 7);
  body.innerHTML = commitDetailHtml(commit, hash)
    + `<div class="git-diff-loading"><span class="git-spinner"></span> ${esc(tt('git.loading', 'Loading…'))}</div>`;
  let r;
  try { r = await api().commitFiles({ hash }); } catch (e) { r = { ok: false, error: e?.message || String(e) }; }
  if (!r || !r.ok) { body.innerHTML = commitDetailHtml(commit, hash) + `<div class="git-diff-empty">${esc(r?.error || '')}</div>`; return; }
  const files = Array.isArray(r.files) ? r.files : [];
  if (!files.length) { body.innerHTML = commitDetailHtml(commit, hash) + `<div class="git-diff-empty">${esc(tt('git.noFileChanges', 'No file changes in this commit.'))}</div>`; return; }
  const head = `<div class="git-fd-summary">${files.length} ${esc(files.length === 1 ? tt('git.fileOne', 'file') : tt('git.fileMany', 'files'))}</div>`;
  body.innerHTML = commitDetailHtml(commit, hash) + head
    + `<div class="git-filelist">${files.map((f, i) => fileDiffRow(f, i, hash)).join('')}</div>`;
  // Auto-expand the first text file so there's something visible immediately.
  const firstText = body.querySelector('.git-fd:not(.is-binary) .git-fd-head');
  if (firstText) toggleCommitFile(firstText);
}
async function toggleCommitFile(btn) {
  const fd = btn.closest('.git-fd');
  if (!fd) return;
  const body = fd.querySelector('.git-fd-body');
  if (!body) return;
  if (!body.hidden) { body.hidden = true; fd.classList.remove('expanded'); return; }
  fd.classList.add('expanded'); body.hidden = false;
  if (body.dataset.loaded) return;
  body.innerHTML = `<div class="git-diff-loading"><span class="git-spinner"></span> ${esc(tt('git.loading', 'Loading…'))}</div>`;
  const hash = btn.dataset.hash; const file = btn.dataset.file;
  let r;
  try { r = await api().show({ hash, file }); } catch (e) { r = { ok: false, error: e?.message || String(e) }; }
  if (!r || !r.ok) { body.innerHTML = `<div class="git-diff-empty">${esc(r?.error || '')}</div>`; return; }
  body.dataset.loaded = '1';
  requestAnimationFrame(() => { body.innerHTML = truncNote(r.truncated) + diffHtml(r.diff || ''); });
}

async function loadHistory() {
  const list = $('git-history-list');
  if (!list) return;
  const r = await api().log({ maxCount: 50 });
  if (!r.ok) { list.innerHTML = `<li class="git-commit-empty">${esc(r.error)}</li>`; return; }
  historyCommits = r.commits || [];
  if (!historyCommits.length) { list.innerHTML = `<li class="git-commit-empty">${esc(tt('git.noCommits', 'No commits yet.'))}</li>`; return; }
  list.innerHTML = historyCommits.map((c) => `
    <li class="git-commit" data-hash="${esc(c.hash)}">
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
      case 'stage':      return run(tt('git.staged', 'Stage'), async () => { await api().stage(file); refresh(); });
      case 'unstage':    return run(tt('git.staged', 'Unstage'), async () => { await api().unstage(file); refresh(); });
      case 'stage-all':  return run(tt('git.stageAll', 'Stage all'), async () => { await api().stageAll(); refresh(); });
      case 'unstage-all':return run(tt('git.unstageAll', 'Unstage all'), async () => { const st = await api().status(); await api().unstage(st.files.map((f) => f.path)); refresh(); });
      case 'discard':    return discard(file);
      case 'undo':       return undoLast();
      case 'toggle-amend': {
        amendOn = !amendOn;
        const b = $('git-amend-btn'); if (b) { b.classList.toggle('active', amendOn); b.setAttribute('aria-pressed', String(amendOn)); }
        const cb = $('git-commit-btn'); if (cb) cb.disabled = !lastHasChanges && !amendOn;
        return undefined;
      }
      case 'init':       return run(tt('git.initRepo', 'Initialize'), async () => { const r = await api().init(); if (!r.ok) throw new Error(r.error); refresh(); return tt('git.initRepo', 'Repository initialized'); });
      case 'fetch':      return run(tt('git.fetch', 'Fetch'), async () => { const r = await api().fetch(); if (!r.ok) throw new Error(r.error); refresh(); return tt('git.fetch', 'Fetch'); });
      case 'pull':       return run(tt('git.pull', 'Pull'), async () => { const r = await api().pull(); if (!r.ok) throw new Error(r.error); refresh(); return tt('git.pull', 'Pull'); });
      case 'push':       return run(tt('git.push', 'Push'), async () => { const r = await api().push({ setUpstream: true }); if (!r.ok) throw new Error(r.error); refresh(); return tt('git.push', 'Push'); });
      case 'publish':    return publish();
      case 'set-private': {
        publishPrivate = actEl.dataset.private === 'true';
        document.querySelectorAll('#git-publish .git-vis-opt').forEach((b) => b.classList.toggle('active', b.dataset.private === String(publishPrivate)));
        return undefined;
      }
      case 'connect':    return connect();
      case 'disconnect': return disconnectAccount();
      case 'commit-file-toggle': return toggleCommitFile(actEl);
      case 'clone-toggle': return toggleClone();
      case 'clone-list-select': return selectCloneRepo(actEl);
      case 'clone-choose-dir': return chooseCloneDir();
      case 'clone-do':   return doClone();
      case 'clone-open-spf': return openClonedSpf(actEl.dataset.spf);
      case 'branch-menu': return toggleBranchMenu();
      case 'checkout-branch': return run(tt('git.branches', 'Switch branch'), async () => { const r = await api().checkout({ branch: actEl.dataset.branch }); if (!r.ok) throw new Error(r.error); refresh(); return actEl.dataset.branch; });
      case 'merge-branch': return run('Merge', async () => { const r = await api().merge({ branch: actEl.dataset.branch }); if (!r.ok) throw new Error(r.error); refresh(); return `Merge ${actEl.dataset.branch}`; });
      case 'create-branch': {
        const nb = $('git-new-branch')?.value?.trim();
        if (!nb) { flash(tt('git.branchNameRequired', 'Give the branch a name.'), 'error'); return undefined; }
        return run(tt('git.create', 'New branch'), async () => { const r = await api().checkout({ branch: nb, create: true }); if (!r.ok) throw new Error(r.error); refresh(); return nb; });
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
    return showCommitDiff(commit.dataset.hash);
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
  await run('Discard', async () => { const r = await api().discard(file); if (!r.ok) throw new Error(r.error); refresh(); });
}

async function disconnectAccount() {
  const action = await window.AuroraUI?.dialog?.({
    title: tt('git.disconnect', 'Disconnect'),
    message: tt('git.disconnectConfirm', 'Disconnect your GitHub account from Aurora? The stored token will be removed from secure storage.'),
    variant: 'warning',
    buttons: [
      { label: tt('git.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
      { label: tt('git.disconnect', 'Disconnect'), action: 'confirm', type: 'danger' },
    ],
  });
  if (action !== 'confirm') return;
  await run(tt('git.disconnect', 'Disconnect'), async () => { await api().githubDisconnect(); refresh(); return tt('git.disconnect', 'Account disconnected'); });
}

async function undoLast() {
  const action = await window.AuroraUI?.dialog?.({
    title: 'Desfazer último commit',
    message: 'Desfazer o último commit? As alterações voltam para a área de stage (soft reset).',
    variant: 'warning',
    buttons: [{ label: 'Cancelar', action: 'cancel', type: 'cancel' }, { label: 'Desfazer', action: 'confirm', type: 'danger' }],
  });
  if (action !== 'confirm') return;
  await run(tt('git.undoLast', 'Undo commit'), async () => { const r = await api().undoLastCommit(); if (!r.ok) throw new Error(r.error); refresh(); return tt('git.undoLast', 'Last commit undone'); });
}

// --- clone experience ------------------------------------------------------
// Rich clone flow: pick one of the user's repos, choose a target folder,
// validate the resulting path, clone, then offer to open any .spf in SAPHO.
const cloneState = { open: false, repos: [], selUrl: null, selName: null, dir: null, dest: null, spfs: [], myLogin: null };
// Only allow clean, shell-safe paths (no spaces / exotic chars). The backslash
// is for Windows separators; the set is intentionally conservative.
const SAFE_PATH_RE = /^[A-Za-z0-9._/\\:-]+$/;

function joinPath(dir, name) {
  if (!dir) return name || '';
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`;
}

async function toggleClone() {
  const c = $('git-clone');
  if (!c) return;
  cloneState.open = c.hidden; // about to flip
  c.hidden = !c.hidden;
  if (c.hidden) return;
  // Reset selection each time it opens (folder choice is kept for convenience).
  cloneState.selUrl = null; cloneState.selName = null; cloneState.spfs = [];
  renderClone();
  await loadCloneRepos();
}

async function loadCloneRepos() {
  const list = $('git-clone-list');
  if (list) list.innerHTML = `<li class="git-clone-loading"><span class="git-spinner"></span> ${esc(tt('git.loading', 'Loading…'))}</li>`;
  try { const s = await api().githubStatus(); cloneState.myLogin = s?.user?.login || null; } catch (_) { /* group still works without it */ }
  let r;
  try { r = await api().listRepos(); } catch (e) { r = { ok: false, error: e?.message || String(e) }; }
  if (!r || !r.ok) {
    if (list) list.innerHTML = `<li class="git-clone-empty">${esc(r?.error || tt('git.connectFirst', 'Connect your GitHub account first.'))}</li>`;
    return;
  }
  cloneState.repos = Array.isArray(r.repos) ? r.repos : [];
  renderCloneList();
}

function renderClone() {
  const c = $('git-clone');
  if (!c) return;
  const dirLabel = cloneState.dir ? esc(cloneState.dir) : esc(tt('git.chooseLocation', 'Choose location'));
  c.innerHTML = `
    <div class="git-clone-head"><i class="ph ph-download-simple"></i> ${esc(tt('git.cloneRepos', 'Clone a repository'))}</div>
    <ul class="git-clone-list" id="git-clone-list"></ul>
    <div class="git-clone-loc">
      <button class="git-mini" data-action="clone-choose-dir"><i class="ph ph-folder-open"></i> ${esc(tt('git.chooseLocation', 'Choose location'))}</button>
      <span class="git-clone-dir" id="git-clone-dir" title="${dirLabel}">${dirLabel}</span>
    </div>
    <div class="git-clone-actions">
      <button class="git-mini git-mini-primary" data-action="clone-do"><i class="ph ph-download-simple"></i> ${esc(tt('git.cloneBtn', 'Clone'))}</button>
      <span class="git-clone-spf" id="git-clone-spf" hidden></span>
    </div>
    <div class="git-clone-progress" id="git-clone-progress" hidden>
      <div class="git-clone-progress-track"><div class="git-clone-progress-fill" id="git-clone-progress-fill"></div></div>
      <span class="git-clone-progress-label" id="git-clone-progress-label"></span>
    </div>`;
  renderCloneList();
}

function cloneItemHtml(repo) {
  const sel = repo.cloneUrl === cloneState.selUrl;
  const icon = repo.private ? 'ph-lock-simple' : 'ph-globe-hemisphere-west';
  const desc = repo.description ? `<span class="git-clone-desc" title="${esc(repo.description)}">${esc(repo.description)}</span>` : '';
  return `<li class="git-clone-item ${sel ? 'selected' : ''}" data-action="clone-list-select"
      data-url="${esc(repo.cloneUrl)}" data-name="${esc(repo.name)}">
    <i class="ph ${icon} git-clone-vis" title="${repo.private ? esc(tt('git.private', 'Private')) : esc(tt('git.public', 'Public'))}"></i>
    <span class="git-clone-name">${esc(repo.name)}</span>
    ${desc}
  </li>`;
}
function renderCloneList() {
  const list = $('git-clone-list');
  if (!list) return;
  if (!cloneState.repos.length) {
    list.innerHTML = `<li class="git-clone-empty">${esc(tt('git.connectFirst', 'Connect your GitHub account first.'))}</li>`;
    return;
  }
  // Group by owner so organization repos sit under their org header (your repos
  // first), like GitHub Desktop's clone list.
  const groups = new Map();
  for (const repo of cloneState.repos) {
    const owner = repo.owner || '—';
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(repo);
  }
  const my = cloneState.myLogin;
  const owners = Array.from(groups.keys()).sort((a, b) => {
    if (a === my) return -1; if (b === my) return 1;
    return a.localeCompare(b);
  });
  // Single owner (just you) → no group headers, keep it flat and clean.
  if (owners.length <= 1) {
    list.innerHTML = cloneState.repos.map(cloneItemHtml).join('');
    return;
  }
  list.innerHTML = owners.map((owner) => {
    const repos = groups.get(owner);
    const isOrg = repos[0] && repos[0].ownerType === 'Organization';
    const ownerIcon = isOrg ? 'ph-buildings' : 'ph-user';
    const label = owner === my ? `${esc(owner)} · ${esc(tt('git.you', 'you'))}` : esc(owner);
    return `<li class="git-clone-group"><i class="ph ${ownerIcon}"></i> <span class="git-clone-group-name">${label}</span> <span class="git-clone-group-count">${repos.length}</span></li>`
      + repos.map(cloneItemHtml).join('');
  }).join('');
}

function selectCloneRepo(el) {
  cloneState.selUrl = el.dataset.url || null;
  cloneState.selName = el.dataset.name || null;
  cloneState.spfs = [];
  const spf = $('git-clone-spf'); if (spf) { spf.hidden = true; spf.innerHTML = ''; }
  renderCloneList();
}

async function chooseCloneDir() {
  let res;
  try { res = await window.electronAPI?.selectDirectory(); } catch (e) { flash(e?.message || String(e), 'error'); return; }
  // selectDirectory may return a string, {filePaths:[...]}, or {canceled:true}.
  let dir = null;
  if (typeof res === 'string') dir = res;
  else if (res && Array.isArray(res.filePaths) && res.filePaths.length) dir = res.filePaths[0];
  if (!dir || (res && res.canceled)) return;
  cloneState.dir = dir;
  const el = $('git-clone-dir');
  if (el) { el.textContent = dir; el.title = dir; }
}

// Live clone progress bar (git --progress, streamed from main). scaleX on the
// fill keeps it GPU-composited; we auto-hide a moment after done/error.
let cloneProgressHideTimer = null;
function updateCloneProgress(data) {
  const wrap = $('git-clone-progress'); const fill = $('git-clone-progress-fill'); const label = $('git-clone-progress-label');
  if (!wrap || !fill) return;
  if (cloneProgressHideTimer) { clearTimeout(cloneProgressHideTimer); cloneProgressHideTimer = null; }
  const stage = data && data.stage;
  const pct = Math.max(0, Math.min(100, Math.round(Number(data && data.progress) || 0)));
  wrap.hidden = false;
  fill.style.transform = `scaleX(${pct / 100})`;
  fill.dataset.stage = stage || '';
  if (label) {
    const word = stage === 'error' ? tt('git.cloneFailed', 'Clone failed')
      : stage === 'done' ? tt('git.cloneDone', 'Done')
        : `${tt('git.cloning', 'Cloning')}… ${pct}%`;
    label.textContent = word;
  }
  if (stage === 'done' || stage === 'error') {
    cloneProgressHideTimer = setTimeout(() => { if (wrap) wrap.hidden = true; }, 1200);
  }
}
function showCloneProgress() {
  const wrap = $('git-clone-progress'); const fill = $('git-clone-progress-fill'); const label = $('git-clone-progress-label');
  if (cloneProgressHideTimer) { clearTimeout(cloneProgressHideTimer); cloneProgressHideTimer = null; }
  if (fill) fill.style.transform = 'scaleX(0)';
  if (label) label.textContent = `${tt('git.cloning', 'Cloning')}… 0%`;
  if (wrap) wrap.hidden = false;
}

async function doClone() {
  if (!cloneState.selUrl || !cloneState.selName) { flash(tt('git.pasteUrl', 'Select a repository to clone.'), 'error'); return; }
  if (!cloneState.dir) { flash(tt('git.chooseLocation', 'Choose a destination folder.'), 'error'); return; }
  // Validate both the chosen folder and the repo name for unsafe characters.
  if (!SAFE_PATH_RE.test(cloneState.dir) || !SAFE_PATH_RE.test(cloneState.selName)) {
    flash(tt('git.invalidPath', 'Path contains spaces or invalid characters.'), 'error');
    return;
  }
  const dest = joinPath(cloneState.dir, cloneState.selName);
  cloneState.dest = dest;
  showCloneProgress();
  await run(tt('git.cloneBtn', 'Clone'), async () => {
    const r = await api().clone({ url: cloneState.selUrl, dest });
    if (!r.ok) { updateCloneProgress({ stage: 'error', progress: 0 }); throw new Error(r.error); }
    if (r.canceled) return tt('git.cloneBtn', 'Clone canceled');
    // After cloning, look for project files to offer "Open in SAPHO".
    let scan;
    try { scan = await api().scanSpf({ dir: r.dest || dest }); } catch (_) { scan = { ok: false }; }
    cloneState.spfs = (scan && scan.ok && Array.isArray(scan.spfs)) ? scan.spfs : [];
    renderCloneSpf();
    return r.dest || dest;
  });
}

function renderCloneSpf() {
  const el = $('git-clone-spf');
  if (!el) return;
  if (!cloneState.spfs.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<button class="git-mini git-clone-open" data-action="clone-open-spf" data-spf="${esc(cloneState.spfs[0])}">
      <i class="ph ph-rocket-launch"></i> ${esc(tt('git.openInSapho', 'Open project in SAPHO'))}
    </button>`;
}

async function openClonedSpf(spf) {
  if (!spf) return;
  try { await window.electronAPI?.openProject(spf); } catch (e) { flash(e?.message || String(e), 'error'); return; }
  close();
}

async function connect() {
  const token = $('git-pat')?.value?.trim();
  if (!token) { flash(tt('git.pasteToken', 'Paste a token first.'), 'error'); return; }
  await run(tt('git.connect', 'Connect'), async () => {
    const r = await api().githubConnect(token);
    if (!r.ok) throw new Error(r.error);
    refresh();
    return `@${r.user.login}`;
  });
}

async function publish() {
  const name = $('git-repo-name')?.value?.trim();
  const priv = publishPrivate;
  if (!name) { flash(tt('git.repoNameRequired', 'Give the repository a name.'), 'error'); return; }
  const gh = await api().githubStatus();
  if (!gh || !gh.connected) { flash(tt('git.connectFirst', 'Connect your GitHub account first.'), 'error'); return; }
  await run(tt('git.publish', 'Publish'), async () => {
    const isRepo = await api().isRepo();
    if (isRepo.ok && !isRepo.isRepo) { const ir = await api().init(); if (!ir.ok) throw new Error(ir.error); }
    const r = await api().githubCreateRepo({ name, private: priv });
    if (!r.ok) throw new Error(r.error);
    const add = await api().addRemote({ name: 'origin', url: r.cloneUrl });
    if (!add.ok) throw new Error(add.error);
    const push = await api().push({ setUpstream: true });
    refresh();
    if (!push.ok) return r.fullName;
    return r.fullName;
  });
}

async function doCommit() {
  const title = ($('git-commit-title')?.value || '').trim();
  const desc = ($('git-commit-desc')?.value || '').trim();
  const amend = amendOn;
  if (!title) { flash(tt('git.summaryRequired', 'Write a summary for the commit.'), 'error'); return; }
  const message = desc ? `${title}\n\n${desc}` : title;
  await run(tt('git.commit', 'Commit'), async () => {
    const st = await api().status();
    const { staged } = st.ok ? partition(st) : { staged: [] };
    if (!amend && st.ok && !st.files.length) throw new Error(tt('git.noChanges', 'Nothing to commit.'));
    if (!amend && !staged.length && st.files.length) { await api().stageAll(); }
    const r = await api().commit({ message, amend });
    if (!r.ok) throw new Error(r.error);
    if ($('git-commit-title')) $('git-commit-title').value = '';
    if ($('git-commit-desc')) { $('git-commit-desc').value = ''; autoGrowDesc(); }
    amendOn = false;
    const ab = $('git-amend-btn'); if (ab) { ab.classList.remove('active'); ab.setAttribute('aria-pressed', 'false'); }
    refresh();
    return amend ? tt('git.amend', 'Commit amended') : (r.commit ? String(r.commit).slice(0, 7) : tt('git.commit', 'Commit'));
  });
}

// --- init ------------------------------------------------------------------
function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
// Our own auto-growing description box (grows with the text, up to a cap).
function autoGrowDesc() {
  const el = $('git-commit-desc');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}
function init() {
  $('gitButton')?.addEventListener('click', open);
  modal = $('gitModal');
  if (modal) {
    modal.addEventListener('aurora-modal-close', close);
    modal.addEventListener('click', onClick);
  }
  $('git-commit-btn')?.addEventListener('click', doCommit);
  $('git-commit-desc')?.addEventListener('input', autoGrowDesc);
  try { api()?.onCloneProgress?.((data) => updateCloneProgress(data)); } catch (_) { /* optional */ }
  $('git-diff-close')?.addEventListener('click', hideDiff);
  $('git-history-diff-close')?.addEventListener('click', () => { const d = $('git-history-diff'); if (d) d.hidden = true; });
  window.openGitPanel = open;

  const refreshBadge = debounce(updateBadge, 700);
  setTimeout(updateBadge, 1500);
  window.addEventListener('aurora:file-saved', refreshBadge);
  window.addEventListener('aurora:spf-changed', refreshBadge);
  document.addEventListener('aurora:file-saved', refreshBadge);
  // Reflect ON-DISK changes too (the project chokidar watcher), so the count
  // stays fresh automatically — not only when the panel is opened.
  try { window.electronAPI?.onDirectoryChanged?.(() => refreshBadge()); } catch (_) { /* optional */ }
  try { window.electronAPI?.onFileChanged?.(() => refreshBadge()); } catch (_) { /* optional */ }
  setInterval(() => { if (!isOpen()) updateBadge(); }, 8000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }

export { open, close };
