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
  // Free any heavy diff DOM held by the (now hidden) diff panels.
  hideDiff();
  hideHistoryDiff();
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
  let stashes = [];
  try { const s = await api().stashList(); if (s && s.ok) stashes = s.stashes || []; } catch (_) { /* optional */ }
  renderBranchMenu(r.branches || [], r.current, stashes);
}
// Switch branches, handling a dirty tree gracefully: offer to STASH the
// uncommitted changes first (git checkout has no --autostash), then switch. The
// changes are restorable from the branch menu's stash row.
async function checkoutBranch(branch) {
  if (!branch) return undefined;
  let dirty = false;
  try { const st = await api().status(); dirty = !!(st && st.ok && st.files && st.files.length); } catch (_) { /* treat as clean */ }
  if (dirty) {
    const action = await window.AuroraUI?.dialog?.({
      title: tt('git.switchBranch', 'Switch branch'),
      message: tt('git.dirtySwitchMsg', 'You have uncommitted changes that would be overwritten. Stash them and switch? You can restore them later from the branch menu.'),
      variant: 'warning',
      buttons: [
        { label: tt('git.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
        { label: tt('git.stashSwitch', 'Stash & switch'), action: 'stash', type: 'primary' },
      ],
    });
    if (action !== 'stash') return undefined;
    return run(tt('git.switchBranch', 'Switch branch'), async () => {
      const s = await api().stash({ message: `aurora: ${branch}` });
      if (!s.ok) throw new Error(s.error);
      const r = await api().checkout({ branch });
      if (!r.ok) throw new Error(r.error);
      refresh();
      try { window.showNotification?.(tt('git.stashed', 'Changes stashed'), 'info', 5000, 'Git'); } catch (_) { /* optional */ }
      return `${branch} · ${tt('git.stashed', 'stashed')}`;
    });
  }
  return run(tt('git.switchBranch', 'Switch branch'), async () => {
    const r = await api().checkout({ branch });
    if (!r.ok) throw new Error(r.error);
    refresh();
    return branch;
  });
}
async function stashDrop() {
  const ok = await window.AuroraUI?.dialog?.({
    title: tt('git.discard', 'Discard'),
    message: tt('git.stashDropConfirm', 'Discard the stashed changes? This cannot be undone.'),
    variant: 'warning',
    buttons: [
      { label: tt('git.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
      { label: tt('git.discard', 'Discard'), action: 'confirm', type: 'danger' },
    ],
  });
  if (ok !== 'confirm') return;
  await run(tt('git.discard', 'Discard'), async () => { const r = await api().stashDrop(); if (!r.ok) throw new Error(r.error); const bm = $('git-branch-menu'); if (bm) bm.hidden = true; refresh(); return tt('git.discarded', 'Stash discarded'); });
}
function renderBranchMenu(branches, current, stashes = []) {
  const menu = $('git-branch-menu');
  if (!menu) return;
  menu.innerHTML = `
    ${stashes.length ? `<div class="git-bm-stash">
      <span class="git-bm-stash-label"><i class="ph ph-archive"></i> ${esc(tt('git.stashes', 'Stashed changes'))} (${stashes.length})</span>
      <span class="git-bm-stash-actions">
        <button class="git-mini git-mini-primary" data-action="stash-pop"><i class="ph ph-arrow-counter-clockwise"></i> ${esc(tt('git.restore', 'Restore'))}</button>
        <button class="git-mini" data-action="stash-drop" title="${esc(tt('git.discard', 'Discard'))}"><i class="ph ph-trash"></i></button>
      </span>
    </div>` : ''}
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
        <button class="git-mini" data-action="cloned-toggle"><i class="ph ph-folders"></i> ${esc(tt('git.cloned', 'Projects'))}</button>
        <button class="git-icon-btn git-disconnect" data-action="disconnect" title="${esc(tt('git.disconnect', 'Disconnect'))}" aria-label="${esc(tt('git.disconnect', 'Disconnect'))}"><i class="ph ph-sign-out"></i></button>
      </span>`;
  } else {
    let oauthOn = false;
    try { const c = await api().githubOauthConfigured?.(); oauthOn = !!(c && c.configured); } catch (_) { /* fall back to PAT only */ }
    el.innerHTML = `
      <div class="git-signin">
        ${oauthOn ? `<button class="git-btn git-btn-primary git-signin-btn" data-action="oauth-login"><i class="ph ph-github-logo"></i> ${esc(tt('git.signIn', 'Sign in with GitHub'))}</button>` : ''}
        <div class="git-signin-advanced">
          <button class="git-linklike" data-action="toggle-pat"><i class="ph ph-key"></i> ${esc(tt('git.useToken', 'Use a token instead'))}</button>
          <button class="git-icon-btn git-help-btn" data-action="token-help" title="${esc(tt('git.howToToken', 'How to get a token'))}" aria-label="${esc(tt('git.howToToken', 'How to get a token'))}"><i class="ph ph-question"></i></button>
        </div>
      </div>
      <div class="git-connect" id="git-connect" ${oauthOn ? 'hidden' : ''}>
        <input type="password" id="git-pat" class="git-pat-input" placeholder="${esc(tt('git.tokenPlaceholder', 'GitHub classic token (repo scope)'))}" autocomplete="off" spellcheck="false" />
        <button class="git-btn git-btn-primary" data-action="connect"><i class="ph ph-github-logo"></i> ${esc(tt('git.connect', 'Connect'))}</button>
      </div>
      <div class="git-oauth-code" id="git-oauth-code" hidden></div>
      <div class="git-token-help" id="git-token-help" hidden></div>`;
  }
}

// OAuth device-flow. The device flow polls for up to ~15 min, so we deliberately
// DON'T route it through run()/setBusy (which would lock the whole panel that
// whole time). Instead a local guard + a sequence token let the user CANCEL or
// RETRY at any moment — a late/failed result from a superseded attempt is
// ignored, so the interface is always free to try again.
let oauthCodeUnsub = null;
let oauthSeq = 0;
let oauthBusy = false;
function clearOauthSub() { if (oauthCodeUnsub) { try { oauthCodeUnsub(); } catch (_) { /* ignore */ } oauthCodeUnsub = null; } }
function oauthWaitingCard(inner) {
  const codeBox = $('git-oauth-code');
  if (!codeBox) return;
  codeBox.hidden = false;
  codeBox.innerHTML = inner;
}
async function oauthLogin() {
  if (oauthBusy) return;
  oauthBusy = true;
  const seq = ++oauthSeq;
  clearOauthSub();
  oauthWaitingCard(`<div class="git-oauth-wait"><span class="git-spinner"></span> ${esc(tt('git.signingIn', 'Starting sign-in…'))}
      <button class="git-mini" data-action="oauth-cancel">${esc(tt('git.cancel', 'Cancel'))}</button></div>`);
  // Live device code from main (shown until the user authorizes). NOTE: this
  // listener lives on gitAPI (same group as githubOauthLogin), NOT electronAPI.
  oauthCodeUnsub = api()?.onGithubOauthCode?.((data) => {
    if (seq !== oauthSeq) return; // a newer attempt/cancel superseded this one
    oauthWaitingCard(`
      <div class="git-oauth-step"><i class="ph ph-arrow-square-out"></i> ${esc(tt('git.oauthOpened', 'We opened GitHub in your browser. Enter this code:'))}</div>
      <div class="git-oauth-codebox"><span class="git-oauth-codeval">${esc(data.userCode || '')}</span>
        <button class="git-icon-btn" data-action="oauth-copy-code" data-code="${esc(data.userCode || '')}" title="${esc(tt('git.copied', 'Copy'))}"><i class="ph ph-copy"></i></button></div>
      <div class="git-oauth-wait"><span class="git-spinner"></span> ${esc(tt('git.oauthWaiting', 'Waiting for authorization…'))}
        <button class="git-mini" data-action="oauth-cancel">${esc(tt('git.cancel', 'Cancel'))}</button></div>`);
  });
  setStatus(`${tt('git.signIn', 'Sign in')}…`, 'busy');

  let r;
  try { r = await api().githubOauthLogin(); }
  catch (e) { r = { ok: false, error: e?.message || String(e) }; }

  // The user cancelled or started another attempt while we were polling — drop
  // this result entirely (the UI already moved on).
  if (seq !== oauthSeq) return;
  oauthBusy = false;
  clearOauthSub();

  if (!r || !r.ok) {
    // Failure/timeout → keep the interface free + offer an explicit retry.
    oauthWaitingCard(`<div class="git-oauth-error"><i class="ph ph-warning-circle"></i> ${esc((r && r.error) || tt('git.oauthFailed', 'Sign-in failed.'))}</div>
      <button class="git-btn git-btn-primary" data-action="oauth-login"><i class="ph ph-arrow-clockwise"></i> ${esc(tt('git.tryAgain', 'Try again'))}</button>`);
    setStatus(`${tt('git.signIn', 'Sign in')}: ${(r && r.error) || ''}`, 'error');
    return;
  }
  const codeBox = $('git-oauth-code');
  if (codeBox) { codeBox.hidden = true; codeBox.innerHTML = ''; }
  setStatus(`@${r.user.login}`, 'ok');
  statusTimer = setTimeout(() => setStatus('', null), 4000);
  refresh();
}
// Abort the in-flight attempt and free the UI immediately (the main-side poll is
// left to expire harmlessly; the sequence bump makes its result a no-op).
function oauthCancel() {
  oauthSeq++;
  oauthBusy = false;
  clearOauthSub();
  const codeBox = $('git-oauth-code');
  if (codeBox) { codeBox.hidden = true; codeBox.innerHTML = ''; }
  setStatus(tt('git.cancelled', 'Cancelled'), 'info');
  statusTimer = setTimeout(() => setStatus('', null), 3000);
}

// In-panel guide: how to mint the token + exactly which permission each AURORA
// feature needs (classic scope AND fine-grained equivalent). Authored strings,
// so the few <code>/<b> snippets are injected as trusted HTML.
function renderTokenHelp() {
  const el = $('git-token-help');
  if (!el) return;
  const row = (feat, classic, fine) => `<tr><td>${feat}</td><td><code>${classic}</code></td><td>${fine}</td></tr>`;
  el.innerHTML = `
    <div class="git-help-title"><i class="ph ph-key"></i> ${esc(tt('git.howToToken', 'How to get a GitHub token'))}</div>
    <ol class="git-help-steps">
      <li>${tt('git.tokenStepOpen', 'Open <b>Settings → Developer settings → Personal access tokens → Tokens (classic)</b> and click <b>Generate new token (classic)</b>.')}</li>
      <li>${tt('git.tokenStepName', 'Give it a name (e.g. <b>AURORA</b>) and an expiration date.')}</li>
      <li>${tt('git.tokenStepScope', 'Tick the <code>repo</code> scope — it covers clone, pull, push, commit and creating repositories.')}</li>
      <li>${tt('git.tokenStepOrg', 'To also see <b>organization</b> repos, tick <code>read:org</code>.')}</li>
      <li>${tt('git.tokenStepCopy', 'Generate it, copy the token, and paste it in the field above.')}</li>
    </ol>
    <div class="git-help-title"><i class="ph ph-shield-check"></i> ${esc(tt('git.tokenTableTitle', 'Which permission each feature needs'))}</div>
    <table class="git-help-table">
      <thead><tr>
        <th>${esc(tt('git.thFeature', 'Feature'))}</th>
        <th>${esc(tt('git.thClassic', 'Classic scope'))}</th>
        <th>${esc(tt('git.thFine', 'Fine-grained permission'))}</th>
      </tr></thead>
      <tbody>
        ${row(esc(tt('git.featClonePull', 'Clone / Pull')), 'repo', 'Contents: Read')}
        ${row(esc(tt('git.featCommitPush', 'Commit / Push')), 'repo', 'Contents: Read &amp; write')}
        ${row(esc(tt('git.featCreateRepo', 'Create repo (Publish)')), 'repo', 'Administration: Read &amp; write')}
        ${row(esc(tt('git.featListRepos', 'List your repos')), 'repo', 'Metadata: Read (auto)')}
        ${row(esc(tt('git.featOrgRepos', 'Organization repos')), 'repo, read:org', tt('git.fineOrgGrant', 'grant org access + Metadata: Read'))}
      </tbody>
    </table>
    <div class="git-help-note"><i class="ph ph-info"></i> ${tt('git.tokenFineNote', 'Fine-grained tokens often <b>cannot create repositories</b> — if Publish fails, use a <b>classic</b> token with <code>repo</code>.')}</div>
    <button class="git-mini git-mini-primary git-help-open" data-action="open-token-page"><i class="ph ph-arrow-square-out"></i> ${esc(tt('git.openTokenPage', 'Open GitHub token page'))}</button>`;
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
      <div class="git-empty-actions">
        <button class="git-btn git-btn-primary" data-action="create-repo-files"><i class="ph ph-git-commit"></i> ${esc(tt('git.createRepoFiles', 'Create a repository from these files'))}</button>
        <button class="git-btn" data-action="init"><i class="ph ph-git-branch"></i> ${esc(tt('git.initRepo', 'Initialize empty repository'))}</button>
      </div>
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

// Hard cap on diff lines handed to diff2html. Even the byte cap (main side) can
// leave ~20k short lines, and building that many DOM nodes froze the panel. A
// file with one 900k-line .txt is the worst case. 1500 lines renders instantly.
const MAX_DIFF_LINES = 1500;

// A file whose total changed lines exceed the cap is NOT auto-rendered. We know
// the counts up front from numstat, so we gate BEFORE fetching/rendering — the
// user can still force a capped view.
function isTooBig(f) {
  return !isBinaryFile(f) && ((Number(f && f.additions) || 0) + (Number(f && f.deletions) || 0)) > MAX_DIFF_LINES;
}

// diff2html, line-by-line. No matching:'words' (O(n²), a big part of the freeze).
// We ALSO truncate to MAX_DIFF_LINES here as a universal safety net — whatever
// reaches this function, diff2html never sees more than the cap.
function diffHtml(text, byteTruncated) {
  const start = text.indexOf('diff --git');
  let body = start >= 0 ? text.slice(start) : text;
  if (!body.trim()) return `<div class="git-diff-empty">${esc(tt('git.noTextDiff', 'No textual differences.'))}</div>`;
  const lines = body.split('\n');
  let lineTruncated = false;
  if (lines.length > MAX_DIFF_LINES) { body = lines.slice(0, MAX_DIFF_LINES).join('\n'); lineTruncated = true; }
  const note = (byteTruncated || lineTruncated)
    ? `<div class="git-diff-trunc"><i class="ph ph-warning-circle"></i> ${esc(tt('git.diffTruncated', 'Large diff — showing the first part only.'))}</div>`
    : '';
  return note + renderDiff(body, { drawFileList: false, outputFormat: 'line-by-line', colorScheme: 'dark' });
}
// Closing a diff drops its (potentially heavy) diff2html DOM so the memory is
// reclaimed instead of lingering until the next render.
function hideDiff() {
  const d = $('git-diff'); const body = $('git-diff-body');
  if (d) d.hidden = true;
  if (body) body.innerHTML = '';
}
function hideHistoryDiff() {
  const d = $('git-history-diff'); const body = $('git-history-diff-body');
  if (d) d.hidden = true;
  if (body) body.innerHTML = '';
}
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
  requestAnimationFrame(() => { body.innerHTML = diffHtml(text, r.truncated); });
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
  const big = isTooBig(f);
  const stats = bin
    ? `<span class="git-fd-bin" title="${esc(tt('git.binaryNotShown', 'Binary file — diff not shown.'))}">bin</span>`
    : `<span class="git-fd-add">+${f.additions}</span><span class="git-fd-del">-${f.deletions}</span>`;
  let inner;
  if (bin) {
    inner = `<div class="git-fd-note"><i class="ph ph-file-image"></i> ${esc(tt('git.binaryNotShown', 'Binary file — diff not shown.'))}</div>`;
  } else if (big) {
    const n = (Number(f.additions) || 0) + (Number(f.deletions) || 0);
    inner = `<div class="git-fd-note"><i class="ph ph-warning-circle"></i> ${esc(tt('git.largeDiff', 'Large change — diff hidden to keep the UI responsive.'))} (${n})
        <button class="git-mini" data-action="commit-file-force" data-hash="${esc(hash)}" data-file="${esc(f.path)}"><i class="ph ph-eye"></i> ${esc(tt('git.showAnyway', 'Show first part anyway'))}</button></div>
      <div class="git-fd-body" hidden></div>`;
  } else {
    inner = '<div class="git-fd-body" hidden></div>';
  }
  const headDisabled = bin || big;
  return `<div class="git-fd ${bin ? 'is-binary' : ''} ${big ? 'is-big' : ''}" data-file="${esc(f.path)}" data-index="${i}">
    <button class="git-fd-head" data-action="commit-file-toggle" data-hash="${esc(hash)}" data-file="${esc(f.path)}" data-binary="${headDisabled}" ${headDisabled ? 'disabled' : ''}>
      <i class="ph ph-caret-right git-fd-caret" aria-hidden="true"></i>
      <span class="git-fd-path" title="${esc(f.path)}">${esc(f.path)}</span>
      ${stats}
    </button>
    ${inner}
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
  // Auto-expand the first SMALL text file so there's something visible — never a
  // binary or a too-big file (those would defeat the anti-freeze gate).
  const firstText = body.querySelector('.git-fd:not(.is-binary):not(.is-big) .git-fd-head');
  if (firstText) toggleCommitFile(firstText);
}
async function loadFileDiffInto(body, hash, file) {
  body.innerHTML = `<div class="git-diff-loading"><span class="git-spinner"></span> ${esc(tt('git.loading', 'Loading…'))}</div>`;
  let r;
  try { r = await api().show({ hash, file }); } catch (e) { r = { ok: false, error: e?.message || String(e) }; }
  if (!r || !r.ok) { body.innerHTML = `<div class="git-diff-empty">${esc(r?.error || '')}</div>`; return; }
  body.dataset.loaded = '1';
  requestAnimationFrame(() => { body.innerHTML = diffHtml(r.diff || '', r.truncated); });
}
async function toggleCommitFile(btn) {
  const fd = btn.closest('.git-fd');
  if (!fd) return;
  const body = fd.querySelector('.git-fd-body');
  if (!body) return;
  if (!body.hidden) { body.hidden = true; body.innerHTML = ''; delete body.dataset.loaded; fd.classList.remove('expanded'); return; }
  fd.classList.add('expanded'); body.hidden = false;
  if (body.dataset.loaded) return;
  await loadFileDiffInto(body, btn.dataset.hash, btn.dataset.file);
}
// "Show first part anyway" for a too-big file — loads the capped diff on demand.
async function forceCommitFile(btn) {
  const fd = btn.closest('.git-fd');
  const body = fd && fd.querySelector('.git-fd-body');
  if (!body) return;
  fd.classList.add('expanded'); body.hidden = false; btn.disabled = true;
  if (body.dataset.loaded) return;
  await loadFileDiffInto(body, btn.dataset.hash, btn.dataset.file);
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
      case 'create-repo-files': return createRepoFromFiles();
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
      case 'oauth-login': return oauthLogin();
      case 'oauth-cancel': return oauthCancel();
      case 'toggle-pat': { const c = $('git-connect'); if (c) c.hidden = !c.hidden; const inp = $('git-pat'); if (c && !c.hidden && inp) inp.focus(); return undefined; }
      case 'oauth-copy-code': { copyToClipboard(actEl.dataset.code, tt('git.copied', 'Copied')); flashCopied(actEl); return undefined; }
      case 'disconnect': return disconnectAccount();
      case 'token-help': {
        const help = $('git-token-help');
        if (!help) return undefined;
        if (help.hidden) { renderTokenHelp(); help.hidden = false; }
        else { help.hidden = true; }
        return undefined;
      }
      case 'open-token-page': { try { window.electronAPI?.openExternal?.('https://github.com/settings/tokens/new'); } catch (_) { /* ignore */ } return undefined; }
      case 'cloned-toggle': return toggleCloned();
      case 'cloned-menu': {
        const r = actEl.getBoundingClientRect();
        openClonedMenu(r.left, r.bottom + 2, Number(actEl.dataset.clonedIndex));
        return undefined;
      }
      case 'commit-file-toggle': return toggleCommitFile(actEl);
      case 'commit-file-force': return forceCommitFile(actEl);
      case 'clone-toggle': return toggleClone();
      case 'clone-list-select': return selectCloneRepo(actEl);
      case 'clone-choose-dir': return chooseCloneDir();
      case 'clone-do':   return doClone();
      case 'clone-open-spf': return openClonedSpf(actEl.dataset.spf);
      case 'branch-menu': return toggleBranchMenu();
      case 'checkout-branch': return checkoutBranch(actEl.dataset.branch);
      case 'stash-pop': return run(tt('git.restore', 'Restore'), async () => { const r = await api().stashPop(); if (!r.ok) throw new Error(r.error); const bm = $('git-branch-menu'); if (bm) bm.hidden = true; refresh(); return tt('git.restored', 'Changes restored'); });
      case 'stash-drop': return stashDrop();
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
  const clonedItem = e.target.closest('.git-cloned-item');
  if (clonedItem) {
    return openClonedProject(loadCloned()[Number(clonedItem.dataset.clonedIndex)]);
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

// Turn an opened folder into a git repo WITH its files: init, stage everything,
// and make the initial commit — so the publish-to-GitHub step actually pushes
// the project (not an empty repo). The publish section then offers GitHub.
async function createRepoFromFiles() {
  await run(tt('git.createRepoFiles', 'Create repository'), async () => {
    const ir = await api().init(); if (!ir.ok) throw new Error(ir.error);
    await api().stageAll();
    const c = await api().commit({ message: tt('git.initialCommit', 'Initial commit') });
    if (!c.ok) throw new Error(c.error);
    refresh();
    try { window.showNotification?.(tt('git.initialCommit', 'Initial commit'), 'success', 5000, 'Git'); } catch (_) { /* optional */ }
    return tt('git.initialCommit', 'Initial commit');
  });
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
// The last clone destination is remembered across sessions (localStorage), so
// the user doesn't re-pick the same folder every time.
const CLONE_DIR_STORE = 'aurora-clone-dir';
function rememberedCloneDir() { try { return localStorage.getItem(CLONE_DIR_STORE) || null; } catch (_) { return null; } }
const cloneState = { open: false, repos: [], selUrl: null, selName: null, dir: rememberedCloneDir(), dest: null, spfs: [], myLogin: null };
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
  try { localStorage.setItem(CLONE_DIR_STORE, dir); } catch (_) { /* quota */ }
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
    // Let the 100% bar sit a beat, then fade it out smoothly before hiding.
    cloneProgressHideTimer = setTimeout(() => {
      if (!wrap) return;
      wrap.classList.add('git-fadeout');
      cloneProgressHideTimer = setTimeout(() => {
        if (wrap) { wrap.hidden = true; wrap.classList.remove('git-fadeout'); }
      }, 460);
    }, 1400);
  }
}
function showCloneProgress() {
  const wrap = $('git-clone-progress'); const fill = $('git-clone-progress-fill'); const label = $('git-clone-progress-label');
  if (cloneProgressHideTimer) { clearTimeout(cloneProgressHideTimer); cloneProgressHideTimer = null; }
  if (fill) fill.style.transform = 'scaleX(0)';
  if (label) label.textContent = `${tt('git.cloning', 'Cloning')}… 0%`;
  if (wrap) { wrap.classList.remove('git-fadeout'); wrap.hidden = false; }
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
    // Register the clone so it shows in the "Cloned projects" list (with the
    // repo's GitHub URL, for the "View on GitHub" action).
    const repo = cloneState.repos.find((x) => x.cloneUrl === cloneState.selUrl);
    recordCloned({ name: cloneState.selName, path: r.dest || dest, url: repo && repo.htmlUrl ? repo.htmlUrl : '' });
    if ($('git-cloned') && !$('git-cloned').hidden) renderCloned();
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

// --- cloned projects manager -----------------------------------------------
// A local registry (localStorage) of repositories cloned through this panel.
// GitHub-Desktop-style: a list + a per-item context menu (open, copy name/path,
// view on GitHub, terminal, explorer, remove).
const CLONED_STORE = 'aurora-cloned-repos';
function loadCloned() {
  try { const a = JSON.parse(localStorage.getItem(CLONED_STORE) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}
function saveCloned(list) { try { localStorage.setItem(CLONED_STORE, JSON.stringify(list.slice(0, 100))); } catch (_) { /* quota */ } }
function recordCloned(entry) {
  if (!entry || !entry.path) return;
  const list = loadCloned().filter((r) => r.path !== entry.path);
  list.unshift({ name: entry.name || String(entry.path).split(/[\\/]/).pop(), path: entry.path, url: entry.url || '', clonedAt: new Date().toISOString() });
  saveCloned(list);
}
function toggleCloned() {
  const el = $('git-cloned');
  if (!el) return;
  if (el.hidden) { renderCloned(); el.hidden = false; } else { el.hidden = true; }
}
function renderCloned() {
  const el = $('git-cloned');
  if (!el) return;
  const list = loadCloned();
  const head = `<div class="git-cloned-head"><i class="ph ph-folders"></i> <span>${esc(tt('git.clonedTitle', 'Cloned projects'))}</span>${list.length ? `<span class="git-cloned-count">${list.length}</span>` : ''}</div>`;
  if (!list.length) {
    el.innerHTML = head + `<div class="git-cloned-empty">${esc(tt('git.clonedEmpty', 'No cloned projects yet — clone a repository to see it here.'))}</div>`;
    return;
  }
  el.innerHTML = head + `<ul class="git-cloned-list">${list.map((r, i) => `
    <li class="git-cloned-item" data-cloned-index="${i}" tabindex="0" title="${esc(tt('git.openInSapho', 'Open project in SAPHO'))}">
      <i class="ph ph-folder-notch git-cloned-icon"></i>
      <span class="git-cloned-info">
        <span class="git-cloned-name">${esc(r.name)}</span>
        <span class="git-cloned-path" title="${esc(r.path)}">${esc(r.path)}</span>
      </span>
      <button class="git-cloned-kebab" data-action="cloned-menu" data-cloned-index="${i}" title="${esc(tt('git.actions', 'Actions'))}"><i class="ph ph-dots-three-vertical"></i></button>
    </li>`).join('')}</ul>`;
}

const CLONED_MENU = [
  { action: 'open',          icon: 'ph-rocket-launch',   key: 'git.openInSapho',  fb: 'Open in SAPHO' },
  { sep: true },
  { action: 'copy-name',     icon: 'ph-copy',            key: 'git.copyName',     fb: 'Copy repo name' },
  { action: 'copy-path',     icon: 'ph-copy',            key: 'git.copyPath',     fb: 'Copy repo path' },
  { action: 'view-github',   icon: 'ph-github-logo',     key: 'git.viewGithub',   fb: 'View on GitHub' },
  { action: 'open-cmd',      icon: 'ph-terminal-window', key: 'git.openCmd',      fb: 'Open in command prompt' },
  { action: 'show-explorer', icon: 'ph-folder-open',     key: 'git.showExplorer', fb: 'Show in explorer' },
  { sep: true },
  { action: 'remove',        icon: 'ph-trash',           key: 'git.remove',       fb: 'Remove', danger: true },
];
let clonedMenuEl = null;
function closeClonedMenu() {
  if (!clonedMenuEl) return;
  clonedMenuEl.remove(); clonedMenuEl = null;
  document.removeEventListener('mousedown', onClonedMenuAway, true);
  document.removeEventListener('keydown', onClonedMenuKey, true);
}
function onClonedMenuAway(e) { if (clonedMenuEl && !clonedMenuEl.contains(e.target)) closeClonedMenu(); }
function onClonedMenuKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeClonedMenu(); } }
function openClonedMenu(x, y, idx) {
  closeClonedMenu();
  if (!loadCloned()[idx]) return;
  clonedMenuEl = document.createElement('div');
  clonedMenuEl.className = 'git-ctx-menu';
  clonedMenuEl.innerHTML = CLONED_MENU.map((m) => (m.sep
    ? '<div class="git-ctx-sep"></div>'
    : `<button class="git-ctx-item ${m.danger ? 'danger' : ''}" data-cloned-do="${m.action}"><i class="ph ${m.icon}"></i> ${esc(tt(m.key, m.fb))}</button>`)).join('');
  document.body.appendChild(clonedMenuEl);
  const r = clonedMenuEl.getBoundingClientRect();
  clonedMenuEl.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
  clonedMenuEl.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`;
  clonedMenuEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cloned-do]');
    if (!b) return;
    e.stopPropagation();
    runClonedAction(b.dataset.clonedDo, idx);
  });
  setTimeout(() => {
    document.addEventListener('mousedown', onClonedMenuAway, true);
    document.addEventListener('keydown', onClonedMenuKey, true);
  }, 0);
}
async function copyToClipboard(text, okMsg) {
  try { await navigator.clipboard.writeText(text || ''); flash(okMsg, 'ok'); }
  catch (_) { flash('Clipboard unavailable', 'error'); }
}
// Green check feedback on a copy button: swap the icon to a check + .copied for
// a moment, then restore. Reusable across any copy button.
function flashCopied(btn) {
  if (!btn) return;
  const icon = btn.querySelector('i');
  btn.classList.add('copied');
  const prev = icon ? icon.className : null;
  if (icon) icon.className = 'ph ph-check';
  setTimeout(() => { btn.classList.remove('copied'); if (icon && prev) icon.className = prev; }, 1400);
}
async function runClonedAction(action, idx) {
  const item = loadCloned()[idx];
  closeClonedMenu();
  if (!item) return undefined;
  switch (action) {
    case 'open': return openClonedProject(item);
    case 'copy-name': return copyToClipboard(item.name, tt('git.copied', 'Copied'));
    case 'copy-path': return copyToClipboard(item.path, tt('git.copied', 'Copied'));
    case 'view-github':
      if (item.url) { try { window.electronAPI?.openExternal?.(item.url); } catch (_) { /* ignore */ } }
      else flash(tt('git.noGithubUrl', 'No GitHub URL for this project.'), 'error');
      return undefined;
    case 'open-cmd': try { const r = await window.electronAPI?.openTerminal?.(item.path); if (r && r.success === false) flash(r.error || 'Failed', 'error'); } catch (e) { flash(e?.message || String(e), 'error'); } return undefined;
    case 'show-explorer': try { await window.electronAPI?.openFolder?.(item.path); } catch (e) { flash(e?.message || String(e), 'error'); } return undefined;
    case 'remove': return removeClonedProject(idx);
    default: return undefined;
  }
}
async function openClonedProject(item) {
  if (!item) return;
  try {
    const scan = await api().scanSpf({ dir: item.path });
    const spf = scan && scan.ok && Array.isArray(scan.spfs) && scan.spfs[0];
    if (spf) {
      await window.electronAPI?.openProject(spf);
      // IDE-wide toast confirming the git project opened.
      try { window.showNotification?.(`${tt('git.projectOpened', 'Git project opened')}: ${item.name}`, 'success', 6000, 'Git'); } catch (_) { /* optional */ }
      close();
      return;
    }
    flash(tt('git.noSpfInClone', 'No SAPHO project found — opening the folder.'), 'info');
    await window.electronAPI?.openFolder?.(item.path);
  } catch (e) { flash(e?.message || String(e), 'error'); }
}
async function removeClonedProject(idx) {
  const item = loadCloned()[idx];
  if (!item) return;
  const action = await window.AuroraUI?.dialog?.({
    title: tt('git.remove', 'Remove'),
    message: tt('git.removeClonedMsg', 'Remove <strong>{name}</strong> from the list? You can also delete its folder from disk.').replace('{name}', esc(item.name)),
    variant: 'warning',
    buttons: [
      { label: tt('git.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
      { label: tt('git.removeFromList', 'Remove from list'), action: 'list', type: 'primary' },
      { label: tt('git.deleteFromDisk', 'Delete from disk'), action: 'disk', type: 'danger' },
    ],
  });
  if (!action || action === 'cancel') return;
  if (action === 'disk') {
    try { await window.electronAPI?.deleteFileOrDirectory?.(item.path); } catch (e) { flash(e?.message || String(e), 'error'); return; }
  }
  const list = loadCloned(); list.splice(idx, 1); saveCloned(list);
  renderCloned();
  flash(action === 'disk' ? tt('git.deletedFromDisk', 'Deleted from disk') : tt('git.removedFromList', 'Removed from list'), 'ok');
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
    // Right-click a cloned project → the same context menu as the ⋮ button.
    modal.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.git-cloned-item');
      if (!item) return;
      e.preventDefault();
      openClonedMenu(e.clientX, e.clientY, Number(item.dataset.clonedIndex));
    });
  }
  $('git-commit-btn')?.addEventListener('click', doCommit);
  $('git-commit-desc')?.addEventListener('input', autoGrowDesc);
  try { api()?.onCloneProgress?.((data) => updateCloneProgress(data)); } catch (_) { /* optional */ }
  $('git-diff-close')?.addEventListener('click', hideDiff);
  $('git-history-diff-close')?.addEventListener('click', hideHistoryDiff);
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
