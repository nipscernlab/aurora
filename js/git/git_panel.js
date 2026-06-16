// git_panel.js — the Source Control modal, driven entirely by window.gitAPI
// (main/ipc/git.js, simple-git) + GitHub account connection. Self-initialising:
// wires the toolbar #gitButton, opens the #gitModal, and renders status / diffs /
// commit / push-pull. The on-disk truth is `git`, so .gitignore, diffs and merges
// behave exactly as on the command line.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const notify = (msg, type) => { try { window.showNotification?.(msg, type || 'info'); } catch (_) { /* noop */ } };
const api = () => window.gitAPI;

let modal = null;
let busy = false;

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

// --- a small busy guard so double-clicks don't race git ---------------------
async function run(label, fn) {
  if (busy) return;
  busy = true;
  try { await fn(); }
  catch (e) { notify(`${label}: ${e?.message || e}`, 'error'); }
  finally { busy = false; }
}

// --- rendering -------------------------------------------------------------
const STATUS_LABEL = {
  M: 'modificado', A: 'adicionado', D: 'deletado', R: 'renomeado',
  C: 'copiado', U: 'conflito', '?': 'novo', '!': 'ignorado', ' ': '',
};

function fileRow(file, group) {
  // group: 'staged' | 'unstaged'
  const flag = group === 'staged' ? file.index : file.working;
  const letter = (flag && flag.trim()) || (file.index && file.index.trim()) || (file.working && file.working.trim()) || '?';
  const actions = group === 'staged'
    ? `<button class="git-act" data-action="unstage" data-file="${esc(file.path)}" title="Unstage"><i class="ph ph-minus"></i></button>`
    : `<button class="git-act" data-action="stage" data-file="${esc(file.path)}" title="Stage"><i class="ph ph-plus"></i></button>`
      + `<button class="git-act git-act-danger" data-action="discard" data-file="${esc(file.path)}" title="Descartar"><i class="ph ph-arrow-counter-clockwise"></i></button>`;
  return `<li class="git-file" data-file="${esc(file.path)}" data-staged="${group === 'staged'}">
    <span class="git-file-flag git-flag-${esc(letter)}" title="${esc(STATUS_LABEL[letter] || '')}">${esc(letter)}</span>
    <span class="git-file-path">${esc(file.path)}</span>
    <span class="git-file-actions">${actions}</span>
  </li>`;
}

function renderChanges(st) {
  const wrap = $('git-changes');
  if (!wrap) return;
  const staged = st.files.filter((f) => f.index && f.index !== ' ' && f.index !== '?');
  const unstaged = st.files.filter((f) => (f.working && f.working !== ' ') || f.index === '?');
  if (!staged.length && !unstaged.length) {
    wrap.innerHTML = `<div class="git-clean"><i class="ph ph-check-circle"></i> Nenhuma alteração — árvore limpa.</div>`;
    return;
  }
  wrap.innerHTML = `
    ${staged.length ? `<div class="git-section">
      <div class="git-section-head"><span>Staged (${staged.length})</span>
        <button class="git-mini" data-action="unstage-all">Unstage all</button></div>
      <ul class="git-file-list">${staged.map((f) => fileRow(f, 'staged')).join('')}</ul>
    </div>` : ''}
    ${unstaged.length ? `<div class="git-section">
      <div class="git-section-head"><span>Changes (${unstaged.length})</span>
        <button class="git-mini" data-action="stage-all">Stage all</button></div>
      <ul class="git-file-list">${unstaged.map((f) => fileRow(f, 'unstaged')).join('')}</ul>
    </div>` : ''}`;
}

function renderRepoHeader(st) {
  const repo = $('git-repo');
  if (!repo) return;
  const ahead = st.ahead ? `<span class="git-ahead" title="commits à frente">↑${st.ahead}</span>` : '';
  const behind = st.behind ? `<span class="git-behind" title="commits atrás">↓${st.behind}</span>` : '';
  repo.innerHTML = `
    <span class="git-branch-chip"><i class="ph ph-git-branch"></i> ${esc(st.branch || '—')} ${ahead}${behind}</span>
    <span class="git-repo-actions">
      <button class="git-mini" data-action="fetch" title="Fetch"><i class="ph ph-arrows-clockwise"></i> Fetch</button>
      <button class="git-mini" data-action="pull" title="Pull"><i class="ph ph-arrow-down"></i> Pull</button>
      <button class="git-mini git-mini-primary" data-action="push" title="Push"><i class="ph ph-arrow-up"></i> Push</button>
    </span>`;
}

async function renderAccount() {
  const el = $('git-account');
  if (!el) return;
  let s;
  try { s = await api().githubStatus(); } catch (_) { s = { connected: false }; }
  if (s && s.connected && s.user) {
    el.innerHTML = `<span class="git-user">
        <img class="git-avatar" src="${esc(s.user.avatarUrl)}" alt="" />
        <span class="git-user-name">@${esc(s.user.login)}</span>
      </span>
      <button class="git-mini" data-action="disconnect">Desconectar</button>`;
  } else {
    el.innerHTML = `
      <div class="git-connect">
        <input type="password" id="git-pat" class="git-pat-input" placeholder="GitHub Personal Access Token (repo)" autocomplete="off" />
        <button class="git-mini git-mini-primary" data-action="connect"><i class="ph ph-github-logo"></i> Conectar conta</button>
      </div>`;
  }
}

async function refresh() {
  await renderAccount();
  const repo = $('git-repo');
  const changes = $('git-changes');
  let isRepo;
  try { isRepo = await api().isRepo(); } catch (e) { isRepo = { ok: false, error: e?.message }; }
  if (!isRepo || isRepo.ok === false) {
    if (repo) repo.innerHTML = '';
    if (changes) changes.innerHTML = `<div class="git-empty">Abra um projeto para usar o controle de versão.</div>`;
    return;
  }
  if (!isRepo.isRepo) {
    if (repo) repo.innerHTML = '';
    if (changes) changes.innerHTML = `<div class="git-empty">
      <p>Este projeto ainda não é um repositório Git.</p>
      <button class="git-mini git-mini-primary" data-action="init"><i class="ph ph-git-merge"></i> Inicializar repositório</button>
    </div>`;
    return;
  }
  const st = await api().status();
  if (!st.ok) { if (changes) changes.innerHTML = `<div class="git-empty">${esc(st.error)}</div>`; return; }
  renderRepoHeader(st);
  renderChanges(st);
  hideDiff();
}

// --- diff ------------------------------------------------------------------
function hideDiff() { const d = $('git-diff'); if (d) d.hidden = true; }
async function showDiff(file, staged) {
  const d = $('git-diff');
  const pre = $('git-diff-pre');
  if (!d || !pre) return;
  const r = await api().diff({ file, staged });
  if (!r.ok) { notify(`diff: ${r.error}`, 'error'); return; }
  const text = r.diff || '(sem diferenças textuais)';
  pre.innerHTML = text.split('\n').map((line) => {
    let cls = '';
    if (line.startsWith('+') && !line.startsWith('+++')) cls = 'git-add';
    else if (line.startsWith('-') && !line.startsWith('---')) cls = 'git-del';
    else if (line.startsWith('@@')) cls = 'git-hunk';
    else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) cls = 'git-meta';
    return `<span class="${cls}">${esc(line)}</span>`;
  }).join('\n');
  $('git-diff-title').textContent = `${file}${staged ? '  (staged)' : ''}`;
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
      case 'stage':      return run('Stage', async () => { await api().stage(file); refresh(); });
      case 'unstage':    return run('Unstage', async () => { await api().unstage(file); refresh(); });
      case 'stage-all':  return run('Stage all', async () => { await api().stageAll(); refresh(); });
      case 'unstage-all':return run('Unstage all', async () => { const st = await api().status(); await api().unstage(st.files.map((f) => f.path)); refresh(); });
      case 'discard':    return run('Descartar', async () => {
        if (!window.confirm(`Descartar alterações de "${file}"? Isto não pode ser desfeito.`)) return;
        const r = await api().discard(file); if (!r.ok) throw new Error(r.error); refresh();
      });
      case 'init':       return run('Init', async () => { const r = await api().init(); if (!r.ok) throw new Error(r.error); notify('Repositório inicializado.', 'success'); refresh(); });
      case 'fetch':      return run('Fetch', async () => { const r = await api().fetch(); if (!r.ok) throw new Error(r.error); notify('Fetch concluído.', 'success'); refresh(); });
      case 'pull':       return run('Pull', async () => { const r = await api().pull(); if (!r.ok) throw new Error(r.error); notify('Pull concluído.', 'success'); refresh(); });
      case 'push':       return run('Push', async () => {
        const r = await api().push({ setUpstream: true }); if (!r.ok) throw new Error(r.error);
        notify('Push concluído.', 'success'); refresh();
      });
      case 'connect':    return run('Conectar', async () => {
        const token = $('git-pat')?.value?.trim();
        if (!token) { notify('Cole um token primeiro.', 'warning'); return; }
        const r = await api().githubConnect(token); if (!r.ok) throw new Error(r.error);
        notify(`Conectado como @${r.user.login}.`, 'success'); refresh();
      });
      case 'disconnect': return run('Desconectar', async () => { await api().githubDisconnect(); notify('Conta desconectada.', 'info'); refresh(); });
      default: return undefined;
    }
  }
  // Click on a file row (not an action) → show its diff.
  const row = e.target.closest('.git-file');
  if (row) {
    document.querySelectorAll('.git-file.selected').forEach((n) => n.classList.remove('selected'));
    row.classList.add('selected');
    showDiff(row.dataset.file, row.dataset.staged === 'true');
  }
}

async function doCommit() {
  const ta = $('git-commit-msg');
  const message = (ta?.value || '').trim();
  if (!message) { notify('Escreva uma mensagem de commit.', 'warning'); return; }
  await run('Commit', async () => {
    const st = await api().status();
    const hasStaged = st.ok && st.files.some((f) => f.index && f.index !== ' ' && f.index !== '?');
    if (!hasStaged) { await api().stageAll(); } // nothing staged → stage all (VS Code-style)
    const r = await api().commit({ message });
    if (!r.ok) throw new Error(r.error);
    if (ta) ta.value = '';
    notify(`Commit ${r.commit ? r.commit.slice(0, 7) : ''} criado.`, 'success');
    refresh();
  });
}

// --- init ------------------------------------------------------------------
function init() {
  const btn = $('gitButton');
  if (btn) btn.addEventListener('click', open);
  modal = $('gitModal');
  if (modal) {
    modal.addEventListener('aurora-modal-close', close);
    modal.addEventListener('click', onClick);
  }
  const commitBtn = $('git-commit-btn');
  if (commitBtn) commitBtn.addEventListener('click', doCommit);
  $('git-diff-close')?.addEventListener('click', hideDiff);
  // Expose a tiny hook so the command palette / AI can open it.
  window.openGitPanel = open;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { open, close };
