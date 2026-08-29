/**
 * pylib_panel.js: o painel de bibliotecas Python da AURORA.
 *
 * Estrutura, seguindo o git_panel: o markup vive no index.html, este módulo
 * preenche a lista a partir do catálogo e trata os cliques por delegação (um
 * listener no contêiner, não um por botão, a lista é redesenhada a cada
 * mudança de estado e handlers presos a nós antigos vazariam).
 *
 * Feedback ao usuário usa o que a AURORA já tem, sem inventar superfície nova:
 *   - progresso real: o evento `pylibs:progress` do processo principal alimenta
 *     o anel do próprio botão, com a porcentagem de bytes já baixados;
 *   - conclusão e falha: `notify.*` (js/ui/notification.js), a superfície
 *     canônica de toast;
 *   - confirmação de desinstalar: `showDialog` (js/ui/dialog_manager.js), a
 *     outra superfície canônica, `confirm()` é proibido no projeto;
 *   - a linha de status do rodapé conta o que está acontecendo agora.
 */

import { notify } from '../ui/notification.js';
import { showConfirm } from '../ui/dialog_manager.js';
import { motivoDe } from '../app/api_reply.js';

const $ = (id) => document.getElementById(id);
const api = () => window.pyLibsAPI;

/** Escapa texto que vai para innerHTML. O catálogo é nosso, mas o nome de um
 *  pacote da PyPI vem de fora e não pode virar markup. */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** i18n com fallback: window.t devolve a própria chave quando falta a string. */
function tt(key, fallback, params) {
  const fn = window.t;
  if (typeof fn !== 'function') return fallback;
  const v = fn(key, params);
  return (v && v !== key) ? v : fallback;
}

/** Idioma ativo, para escolher o campo pt/en do catálogo. */
function lang() {
  const l = typeof window.getLocale === 'function' ? window.getLocale() : 'pt';
  return l === 'en' ? 'en' : 'pt';
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/* ── Estado do módulo ─────────────────────────────────────────────────────── */

let modal = null;
let state = null;          // último retorno de pylibs:state
let externalList = [];     // libs trazidas pelo usuário
let filterText = '';
let filterCat = 'all';
/** Ultimo veredito do vigia (main/python/pylib_watch.js). */
let health = null;
/**
 * Ids de simbolo que o sprite desta versao possui (assets/icons/pylibs.json,
 * gerado junto com o SVG).
 *
 * Existe por causa do catalogo remoto: a lista pode citar um icone que so vai
 * existir numa AURORA futura, e um <use> apontando para simbolo inexistente nao
 * desenha nada nem reclama, vira um buraco silencioso na linha. Com o indice em
 * maos, o desconhecido cai no generico.
 */
let knownIcons = null;

async function loadIconIndex() {
  if (knownIcons) return knownIcons;
  try {
    const res = await fetch('./assets/icons/pylibs.json');
    knownIcons = new Set((await res.json()).ids || []);
  } catch (_) {
    knownIcons = new Set(); // sem indice, tudo vira generico: feio, nunca vazio
  }
  return knownIcons;
}

/** O simbolo a usar para uma biblioteca, com recuo para o generico. */
function iconId(lib) {
  const id = lib.icon || 'generic';
  if (!knownIcons || knownIcons.has(id)) return id;
  return 'generic';
}
/** Operações em curso, por id: { phase, pct }. Sobrevive ao redesenho da lista. */
const busy = new Map();

/* ── Ciclo de vida ────────────────────────────────────────────────────────── */

function open() {
  modal = modal || $('pylibsModal');
  if (!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  refresh();
  // Busca a lista no repositorio publico DEPOIS de desenhar. O painel nunca
  // espera a rede: abre com o que tem e se atualiza sozinho se vier algo novo.
  api()?.refreshCatalog().then((r) => {
    if (r?.ok && r.data?.changed) refresh();
  });
}

function close() {
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

async function refresh() {
  await loadIconIndex();
  const res = await api().state();
  if (!res?.ok) {
    setStatus(motivoDe(res, 'Falha ao ler o catálogo.'), 'error');
    return;
  }
  state = res.data;
  const ext = await api().listExternal();
  externalList = ext?.ok ? ext.data : [];
  const doc = await api().doctor();
  if (doc?.ok) health = doc.data;
  renderRuntime();
  renderChips();
  renderList();
  renderExternalList();
  updateBadge();
}

/* ── Faixa de runtime ─────────────────────────────────────────────────────── */

function renderRuntime() {
  const el = $('pylib-runtime');
  if (!el || !state) return;
  const py = state.python || {};

  const parts = [
    `<span class="pylib-runtime-item">
       <i class="ph ph-terminal-window" aria-hidden="true"></i>
       ${esc(tt('pylibs.runtime.python', 'Python embarcado'))}
       <b>${esc(py.validatedAgainst || '?')}</b>
     </span>`,
    `<span class="pylib-runtime-item">
       <i class="ph ph-cpu" aria-hidden="true"></i>
       ${esc(tt('pylibs.runtime.abi', 'ABI'))}
       <b>${esc(py.abiTag || '?')}</b>
     </span>`,
    `<span class="pylib-runtime-item pylib-runtime-path" title="${esc(state.site)}">
       ${esc(state.site)}
     </span>`,
  ];

  // De onde a lista veio. Sem isso, uma lista velha por falha de rede seria
  // indistinguivel de uma lista atual.
  const remote = state.catalogSource === 'remote';
  parts.push(`<span class="pylib-runtime-item" title="${esc(remote
    ? tt('pylibs.catalog.remoteHint', 'Lista baixada de nipscernlab/aurora-pylibs')
    : tt('pylibs.catalog.localHint', 'Lista que veio junto com esta versao da AURORA'))}">
     <i class="ph ${remote ? 'ph-cloud-check' : 'ph-hard-drives'}" aria-hidden="true"></i>
     ${esc(remote ? tt('pylibs.catalog.remote', 'lista atualizada') : tt('pylibs.catalog.local', 'lista local'))}
   </span>`);

  parts.push(`<button class="pylib-btn pylib-btn-ghost pylib-verify-btn" id="pylib-verify-deep">
       <i class="ph ph-shield-check" aria-hidden="true"></i>
       <span>${esc(tt('pylibs.verify.deep', 'Verificacao completa'))}</span>
     </button>`);

  // Veredito do vigia. So aparece quando ha problema, quando esta tudo bem, a
  // ausencia de aviso ja e a mensagem.
  if (health && !health.ok && health.issues?.length) {
    const lines = health.issues.map((i) => esc(i.message)).join('<br>');
    parts.push(`<span class="pylib-runtime-warn">
      <i class="ph ph-warning-octagon" aria-hidden="true"></i>
      <span>${lines}</span>
    </span>`);
  }

  if (!py.present) {
    parts.push(`<span class="pylib-runtime-warn">
      <i class="ph ph-warning" aria-hidden="true"></i>
      <span>${esc(tt('pylibs.runtime.missing',
        'O Python embarcado não foi encontrado. Abra Configurações, Componentes, e baixe a Cadeia de compilação.'))}</span>
    </span>`);
  }

  el.innerHTML = parts.join('');
}

/* ── Filtros ──────────────────────────────────────────────────────────────── */

function renderChips() {
  const el = $('pylib-chips');
  if (!el || !state) return;
  const cats = state.categories || {};
  const used = new Set(state.libraries.map((l) => l.category));
  // "Instaladas" vem logo depois de "Todas" e leva a contagem junto. Com 29
  // bibliotecas na lista, "quais eu tenho?" e a pergunta mais frequente, e ela
  // so tinha resposta rolando tudo procurando a etiqueta verde. A contagem no
  // proprio chip ja responde a metade dela sem nem clicar.
  const quantasInstaladas = state.libraries.filter((l) => l.installed).length;
  const chips = [
    `<button class="pylib-chip ${filterCat === 'all' ? 'active' : ''}" data-cat="all">
       ${esc(tt('pylibs.filter.all', 'Todas'))}</button>`,
    `<button class="pylib-chip ${filterCat === 'installed' ? 'active' : ''}" data-cat="installed">
       ${esc(tt('pylibs.filter.installed', 'Instaladas'))} ${quantasInstaladas}</button>`,
  ];
  for (const [key, label] of Object.entries(cats)) {
    if (!used.has(key)) continue;
    chips.push(`<button class="pylib-chip ${filterCat === key ? 'active' : ''}" data-cat="${esc(key)}">
      ${esc(label[lang()] || key)}</button>`);
  }
  el.innerHTML = chips.join('');
}

function visibleLibraries() {
  if (!state) return [];
  const q = filterText.trim().toLowerCase();
  return state.libraries.filter((lib) => {
    // 'installed' nao e categoria do catalogo, e um recorte por estado, entao
    // vem antes da comparacao por categoria.
    if (filterCat === 'installed') { if (!lib.installed) return false; }
    else if (filterCat !== 'all' && lib.category !== filterCat) return false;
    if (!q) return true;
    const hay = `${lib.id} ${lib.name} ${lib.summary?.[lang()] || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

/* ── A lista ──────────────────────────────────────────────────────────────── */

function cardState(lib) {
  if (lib.kind === 'compiled') return 'unavailable';
  if (lib.broken) return 'broken';
  if (lib.installed) return 'installed';
  return 'available';
}

function renderList() {
  const el = $('pylib-list');
  if (!el) return;
  const libs = visibleLibraries();

  if (!libs.length) {
    el.innerHTML = `<div class="pylib-empty">${esc(tt('pylibs.empty', 'Nenhuma biblioteca corresponde ao filtro.'))}</div>`;
    return;
  }

  el.innerHTML = libs.map((lib) => renderCard(lib)).join('');
  // Reaplica o progresso das operações que continuavam correndo durante o
  // redesenho (trocar de filtro no meio de uma instalação, por exemplo).
  for (const [id, p] of busy) paintProgress(id, p);
}

/**
 * Abre ou fecha os detalhes de um cartão.
 *
 * A animação é toda do CSS (`.pylib-detalhe`, com grid-template-rows indo de
 * 0fr a 1fr). Aqui só cai a classe e o estado acessível da seta, que precisa
 * acompanhar: sem `aria-expanded` correto, um leitor de tela anuncia "recolhido"
 * num cartão aberto.
 */
function alternarDetalhe(card) {
  const aberto = card.classList.toggle('expanded');
  card.querySelector('[data-action="toggle"]')?.setAttribute('aria-expanded', String(aberto));
}

function renderCard(lib) {
  const st = cardState(lib);
  const l = lang();
  const uses = (lib.uses?.[l] || []).map((u) => `<li>${esc(u)}</li>`).join('');

  const tags = [];
  if (st === 'installed') {
    tags.push(`<span class="pylib-tag pylib-tag-installed">${esc(tt('pylibs.tag.installed', 'instalada'))}</span>`);
  }
  if (st === 'broken') {
    tags.push(`<span class="pylib-tag pylib-tag-broken">${esc(tt('pylibs.tag.broken', 'quebrada'))}</span>`);
  }
  if (st === 'unavailable') {
    tags.push(`<span class="pylib-tag pylib-tag-compiled">${esc(tt('pylibs.tag.compiled', 'compilada'))}</span>`);
  }

  // O tamanho SAI da meta e sobe para a linha do nome: é o único número que
  // decide sem abrir nada ("cabe no meu tempo de rede?"). O resto da meta só
  // interessa a quem já parou naquela biblioteca, e vive na expansão.
  const meta = [];
  if (lib.license) meta.push(esc(lib.license));
  if (lib.wheels?.length > 1) {
    meta.push(esc(tt('pylibs.meta.deps', '{{n}} pacotes', { n: lib.wheels.length })));
  }
  if (lib.homepage) {
    meta.push(`<a href="#" data-action="homepage" data-url="${esc(lib.homepage)}">${esc(tt('pylibs.meta.site', 'site do projeto'))}</a>`);
  }

  const why = st === 'unavailable'
    ? `<div class="pylib-why">${esc(tt('pylibs.why.compiled',
        'Esta biblioteca tem código compilado em C. O Python embarcado da AURORA é um build MinGW e não carrega esse formato — o import falha com "DLL load failed". Para usá-la, abra o terminal TCMD e rode com o seu próprio Python.'))}</div>`
    : '';

  return `
    <div class="pylib-card" role="listitem" data-id="${esc(lib.id)}" data-state="${st}">
      <svg class="pylib-icon" aria-hidden="true" viewBox="0 0 32 32">
        <use href="./assets/icons/pylibs.svg#pylib-${esc(iconId(lib))}"></use>
      </svg>
      <div class="pylib-info">
        <div class="pylib-head">
          <span class="pylib-lib-name">${esc(lib.name)}</span>
          <span class="pylib-version">${lib.version ? esc(lib.installedVersion || lib.version) : ''}</span>
          ${tags.length ? tags[0] : '<span class="pylib-vazio"></span>'}
          <span class="pylib-size">${lib.downloadSize ? esc(fmtSize(lib.downloadSize)) : ''}</span>
        </div>
        <div class="pylib-detalhe"><div class="pylib-detalhe-interno">
          <p class="pylib-summary">${esc(lib.summary?.[l] || '')}</p>
          ${uses ? `<ul class="pylib-uses">${uses}</ul>` : ''}
          ${meta.length ? `<div class="pylib-meta">${meta.join('<span>·</span>')}</div>` : ''}
          ${why}
        </div></div>
      </div>
      <div class="pylib-actions">${renderActions(lib, st)}</div>
    </div>`;
}

function renderActions(lib, st) {
  if (st === 'unavailable') {
    return `<button class="pylib-btn pylib-btn-ghost" disabled>
      <i class="ph ph-prohibit" aria-hidden="true"></i>
      <span>${esc(tt('pylibs.action.unavailable', 'Indisponível'))}</span></button>`;
  }

  const detail = `<button class="pylib-btn pylib-btn-ghost pylib-btn-icon" data-action="toggle"
      aria-expanded="false"
      title="${esc(tt('pylibs.action.details', 'Ver usos'))}">
      <i class="ph ph-caret-down" aria-hidden="true"></i></button>`;

  if (st === 'installed' || st === 'broken') {
    const repair = `<button class="pylib-btn pylib-btn-ghost" data-action="repair">
        <i class="ph ph-wrench" aria-hidden="true"></i>
        <span>${esc(tt('pylibs.action.repair', 'Reparar'))}</span></button>`;
    const remove = `<button class="pylib-btn pylib-btn-ghost pylib-btn-danger pylib-btn-icon"
        data-action="uninstall" title="${esc(tt('pylibs.action.uninstall', 'Desinstalar'))}">
        <i class="ph ph-trash" aria-hidden="true"></i></button>`;
    return `${detail}${repair}${remove}`;
  }

  return `${detail}<button class="pylib-btn" data-action="install">
    <i class="ph ph-download-simple" aria-hidden="true"></i>
    <span>${esc(tt('pylibs.action.install', 'Instalar'))}</span></button>`;
}

/* ── Progresso ────────────────────────────────────────────────────────────── */

const PHASE_LABEL = {
  download: () => tt('pylibs.phase.download', 'baixando'),
  verify:   () => tt('pylibs.phase.verify', 'conferindo'),
  extract:  () => tt('pylibs.phase.extract', 'instalando'),
  done:     () => tt('pylibs.phase.done', 'pronto'),
};

/**
 * Pinta o anel no botão da linha. Só a fase `download` tem porcentagem real (é
 * a única que conhece o total de bytes); conferir hash e extrair são rápidas e
 * sem medida, então o anel gira em vez de mentir um número.
 */
function paintProgress(id, p) {
  const card = document.querySelector(`.pylib-card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const btn = card.querySelector('[data-action="install"], [data-action="repair"]');
  if (!btn) return;

  if (!p || p.phase === 'done') {
    btn.removeAttribute('data-busy');
    btn.removeAttribute('data-spin');
    btn.removeAttribute('data-pct');
    btn.disabled = false;
    card.querySelector('.pylib-phase')?.remove();
    return;
  }

  btn.disabled = true;
  btn.setAttribute('data-busy', '1');
  if (p.phase === 'download') {
    btn.removeAttribute('data-spin');
    btn.style.setProperty('--pct', String(p.pct || 0));
    btn.setAttribute('data-pct', `${p.pct || 0}`);
  } else {
    btn.setAttribute('data-spin', '1');
    btn.setAttribute('data-pct', '');
  }

  let phase = card.querySelector('.pylib-phase');
  if (!phase) {
    phase = document.createElement('span');
    phase.className = 'pylib-phase';
    btn.parentElement.insertBefore(phase, btn);
  }
  phase.textContent = (PHASE_LABEL[p.phase] || (() => p.phase))();
}

function onProgress(p) {
  if (!p?.id) return;
  if (p.phase === 'done') busy.delete(p.id);
  else busy.set(p.id, p);
  paintProgress(p.id, p.phase === 'done' ? null : p);
  if (p.detail) setStatus(`${(PHASE_LABEL[p.phase] || (() => p.phase))()} ${p.detail}`, 'working');
}

/* ── Ações ────────────────────────────────────────────────────────────────── */

async function doInstall(id, lib) {
  setStatus(tt('pylibs.status.installing', 'Instalando {{name}}…', { name: lib.name }), 'working');
  const res = await api().install(id);
  busy.delete(id);
  if (res?.ok) {
    notify.success(tt('pylibs.toast.installed', '{{name}} instalada.', { name: lib.name }));
    setStatus('', '');
  } else {
    notify.error(motivoDe(res, 'Falha na instalação.'));
    setStatus(motivoDe(res, ''), 'error');
  }
  await refresh();
}

async function doRepair(id, lib) {
  setStatus(tt('pylibs.status.repairing', 'Reparando {{name}}…', { name: lib.name }), 'working');
  const res = await api().repair(id);
  busy.delete(id);
  if (res?.ok) notify.success(tt('pylibs.toast.repaired', '{{name}} reparada.', { name: lib.name }));
  else notify.error(motivoDe(res, 'Falha no reparo.'));
  setStatus('', '');
  await refresh();
}

/**
 * Confirmação de remoção. `showConfirm` injeta a mensagem via innerHTML, então o
 * nome vai escapado, no caso de uma lib externa, ele veio da PyPI.
 */
function confirmRemoval(name) {
  return showConfirm(
    tt('pylibs.confirm.title', 'Desinstalar biblioteca'),
    tt('pylibs.confirm.message',
      'Remover {{name}} de components/PyLibs? Dependências ainda usadas por outra biblioteca instalada são preservadas.',
      { name: esc(name) }),
    {
      variant: 'warning',
      danger: true,
      confirmLabel: tt('pylibs.action.uninstall', 'Desinstalar'),
      cancelLabel: tt('common.cancel', 'Cancelar'),
    },
  );
}

async function doUninstall(id, lib) {
  if (!await confirmRemoval(lib.name)) return;

  const res = await api().uninstall(id);
  if (res?.ok) {
    const d = res.data || {};
    notify.success(tt('pylibs.toast.uninstalled', '{{name}} removida ({{n}} arquivos).',
      { name: lib.name, n: d.removed ?? 0 }));
  } else {
    notify.error(motivoDe(res, 'Falha ao desinstalar.'));
  }
  await refresh();
}

/* ── Biblioteca fora do catálogo ──────────────────────────────────────────── */

async function checkExternal() {
  const input = $('pylib-external-name');
  const out = $('pylib-external-result');
  const name = (input?.value || '').trim();
  if (!name || !out) return;

  out.hidden = false;
  out.dataset.kind = '';
  out.innerHTML = `<em>${esc(tt('pylibs.external.checking', 'Consultando a PyPI…'))}</em>`;

  const res = await api().resolveExternal(name);
  if (!res?.ok) {
    out.dataset.kind = 'err';
    out.textContent = motivoDe(res, 'Falha na consulta.');
    return;
  }

  const d = res.data;
  if (!d.ok) {
    out.dataset.kind = d.reason === 'compiled' ? 'no' : 'err';
    out.innerHTML = `
      <div class="pylib-res-head"><span class="pylib-res-name">${esc(d.name || name)}${d.version ? ` ${esc(d.version)}` : ''}</span></div>
      <div>${esc(d.message)}</div>`;
    return;
  }

  out.dataset.kind = 'ok';
  const depsNote = (d.requiresDist || []).length
    ? `<div style="margin-top:6px">${esc(tt('pylibs.external.deps',
        'Atenção: sem pip não há resolvedor de dependências. Se esta biblioteca importar outra que não esteja instalada, instale-a também aqui.'))}</div>`
    : '';
  out.innerHTML = `
    <div class="pylib-res-head">
      <span class="pylib-res-name">${esc(d.name)} ${esc(d.version)}</span>
      <button class="pylib-btn" data-action="install-external" data-name="${esc(d.name)}">
        <i class="ph ph-download-simple" aria-hidden="true"></i>
        <span>${esc(tt('pylibs.action.install', 'Instalar'))}</span>
      </button>
    </div>
    <div>${esc(d.summary || '')}</div>
    <div style="margin-top:6px;color:var(--text-faint)">
      ${esc(tt('pylibs.external.pure', 'Biblioteca Python pura'))} · ${esc(fmtSize(d.wheel?.size))}
      ${d.license ? ` · ${esc(d.license)}` : ''}
    </div>
    ${depsNote}`;
}

async function installExternal(name) {
  setStatus(tt('pylibs.status.installing', 'Instalando {{name}}…', { name }), 'working');
  const res = await api().installExternal(name);
  if (res?.ok) {
    notify.success(tt('pylibs.toast.installed', '{{name}} instalada.', { name }));
    const out = $('pylib-external-result');
    if (out) out.hidden = true;
    const input = $('pylib-external-name');
    if (input) input.value = '';
  } else {
    notify.error(motivoDe(res, 'Falha na instalação.'));
  }
  setStatus('', '');
  await refresh();
}

function renderExternalList() {
  const el = $('pylib-external-list');
  if (!el) return;
  if (!externalList.length) { el.innerHTML = ''; return; }
  el.innerHTML = externalList.map((x) => `
    <div class="pylib-ext-item" data-ext-id="${esc(x.id)}">
      <span><b>${esc(x.name)}</b> ${esc(x.version)}${x.broken ? ` — ${esc(tt('pylibs.tag.broken', 'quebrada'))}` : ''}</span>
      <button class="pylib-btn pylib-btn-ghost pylib-btn-danger pylib-btn-icon"
              data-action="uninstall-external" data-id="${esc(x.id)}" data-name="${esc(x.name)}"
              title="${esc(tt('pylibs.action.uninstall', 'Desinstalar'))}">
        <i class="ph ph-trash" aria-hidden="true"></i>
      </button>
    </div>`).join('');
}

/* ── Rodapé e emblema ─────────────────────────────────────────────────────── */

function setStatus(text, kind) {
  const el = $('pylib-status');
  if (!el) return;
  el.textContent = text || '';
  el.dataset.kind = kind || '';
}

/** Ponto no botão da toolbar quando alguma biblioteca está quebrada. */
function updateBadge() {
  const badge = $('pylib-badge');
  if (!badge) return;
  // O emblema acende por QUALQUER sinal de problema: o estado do catalogo, as
  // externas, ou o veredito do vigia, que e o unico que chega sozinho, sem o
  // painel estar aberto.
  const broken = (state?.libraries || []).some((l) => l.broken)
    || externalList.some((x) => x.broken)
    || !!(health && health.ok === false && health.issues?.length);
  badge.hidden = !broken;
}

/* ── Eventos ──────────────────────────────────────────────────────────────── */

function wire() {
  $('pylibsButton')?.addEventListener('click', open);

  $('pylib-filter')?.addEventListener('input', (e) => {
    filterText = e.target.value || '';
    renderList();
  });

  $('pylib-chips')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.pylib-chip');
    if (!chip) return;
    filterCat = chip.dataset.cat || 'all';
    renderChips();
    renderList();
  });

  // Delegação: a lista é redesenhada inteira a cada mudança, então prender
  // handler em cada botão vazaria listeners em nós já descartados.
  $('pylib-list')?.addEventListener('click', async (e) => {
    const card = e.target.closest('.pylib-card');
    if (!card) return;
    const id = card.dataset.id;
    const lib = state?.libraries.find((l) => l.id === id);
    if (!lib) return;

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'homepage') {
      e.preventDefault();
      await api().openHomepage(e.target.closest('[data-url]').dataset.url);
      return;
    }
    if (action === 'install') { await doInstall(id, lib); return; }
    if (action === 'repair') { await doRepair(id, lib); return; }
    if (action === 'uninstall') { await doUninstall(id, lib); return; }

    // Abrir e fechar: a seta continua funcionando, mas o CARTAO INTEIRO virou
    // alvo. A seta tem 28px de lado numa linha de 50; mirar nela para ler uma
    // descricao e trabalho a toa, e ninguem descobre que ela existe sem tentar.
    // Qualquer clique que nao tenha caido num controle (botao, link) alterna.
    if (!action) alternarDetalhe(card);
  });

  $('pylib-external-check')?.addEventListener('click', checkExternal);
  $('pylib-external-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkExternal();
  });

  $('pylib-external-result')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="install-external"]');
    if (btn) await installExternal(btn.dataset.name);
  });

  $('pylib-external-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="uninstall-external"]');
    if (!btn) return;
    if (!await confirmRemoval(btn.dataset.name)) return;
    const res = await api().uninstall(btn.dataset.id);
    if (res?.ok) notify.success(tt('pylibs.toast.uninstalled', '{{name}} removida ({{n}} arquivos).',
      { name: btn.dataset.name, n: res.data?.removed ?? 0 }));
    else notify.error(motivoDe(res, 'Falha ao desinstalar.'));
    await refresh();
  });

  // Redesenha os textos quando o idioma muda: o catálogo tem pt e en, e o
  // applyDOM do i18n só alcança o markup estático, não o que este módulo gera.
  window.addEventListener('aurora:locale-changed', () => {
    if (!state) return;
    renderChips();
    renderList();
    renderRuntime();
  });

  // O painel vive enquanto a janela viver, entao a inscricao nunca e desfeita:
  // o retorno de onProgress (a funcao de desinscricao) e descartado de proposito.
  api()?.onProgress(onProgress);

  // Veredito do vigia. Chega sem o painel pedir e mesmo com ele fechado: e o
  // que acende o aviso na toolbar quando um arquivo some com o app ja aberto.
  api()?.onHealth((h) => {
    health = h;
    updateBadge();
    if (modal?.classList.contains('show')) renderRuntime();
    if (h && h.ok === false && h.issues?.length && h.reason !== 'startup') {
      notify.warning(tt('pylibs.toast.broken',
        'Alguma biblioteca Python foi alterada no disco. Abra o painel e use Reparar.'));
    }
  });

  // Verificacao completa: le todos os arquivos e compara com o sha256 do
  // RECORD. Fica na faixa de runtime, que e redesenhada, entao o clique e
  // capturado por delegacao no container.
  $('pylib-runtime')?.addEventListener('click', async (e) => {
    if (!e.target.closest('#pylib-verify-deep')) return;
    setStatus(tt('pylibs.verify.running', 'Conferindo todos os arquivos...'), 'working');
    const res = await api().verifyDeep();
    if (res?.ok) {
      health = res.data;
      renderRuntime();
      updateBadge();
      if (health.ok) notify.success(tt('pylibs.verify.clean', 'Todas as bibliotecas estao integras.'));
      else notify.error(tt('pylibs.verify.dirty', '{{n}} biblioteca(s) com problema.', { n: health.issues.length }));
    } else {
      notify.error(motivoDe(res, 'Falha na verificacao.'));
    }
    setStatus('', '');
  });
}

if (typeof window !== 'undefined' && window.pyLibsAPI) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }
}

export { open, close, refresh, visibleLibraries, cardState, fmtSize };
