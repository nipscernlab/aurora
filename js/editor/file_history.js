/**
 * file_history.js: a linha do tempo do arquivo aberto, com diff de verdade.
 *
 * O deposito (main/ipc/history.js) guarda cada gravacao; esta tela e o que
 * torna isso util. Ela responde duas perguntas, e a segunda e a que importa:
 * "que versoes existem" e "o que mudou entre aquela e a de agora".
 *
 * O DIFF E O DiffEditor DO MONACO, e nao um HTML colorido nosso. O painel do
 * git ja desenha diff por conta propria (git_panel.js, diffHtml), e aquilo
 * serve porque le a saida ja pronta do `git diff`. Aqui as duas pontas sao
 * texto puro, e o Monaco ja sabe alinhar, colorir por linguagem, dobrar o que
 * nao mudou e navegar entre as diferencas. Reescrever isso a mao daria menos,
 * com mais codigo.
 *
 * RESTAURAR NAO GRAVA POR CIMA DO DISCO. A versao escolhida entra no MODELO
 * aberto, como uma edicao: fica suja, desfaz com Ctrl+Z, salva com Ctrl+S. E
 * mais seguro e mais honesto do que escrever no arquivo, porque a pessoa ve o
 * que aconteceu antes de virar definitivo, e porque gravar no disco por baixo
 * de um editor com alteracoes nao salvas seria trocar uma perda por outra.
 */

import { electronAPI } from '../app/electron_api.js';

const $ = (id) => document.getElementById(id);

/** Chave faltando no locale nao vaza para a tela. */
function tt(key, fallback) {
  const fn = window.t;
  if (typeof fn !== 'function') return fallback;
  const v = fn(key);
  return (v && v !== key) ? v : fallback;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** `13/09 14:22`, o mesmo formato curto do historico de compilacoes. */
function quando(ms) {
  const d = new Date(ms);
  const dois = (n) => String(n).padStart(2, '0');
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

function tamanho(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/** De onde a versao veio, em palavras. */
function origemEmPalavras(origem) {
  const mapa = {
    inicial: tt('history.originInitial', 'before the first edit'),
    salvar: tt('history.originSave', 'saved'),
    apagar: tt('history.originDelete', 'before deleting'),
    ia: tt('history.originAi', 'Aurora Intelligence'),
  };
  return mapa[origem] || origem || '';
}

let modal = null;
let versoes = [];
let arquivoAtual = null;
let diffEditor = null;
let modeloEsquerda = null;
let modeloDireita = null;
let selecionada = null;

/** O arquivo que a tela esta olhando: o da aba ativa. */
function arquivoDaAba() {
  try { return window.TabManager?.getEditingFilePath?.() || null; } catch { return null; }
}

// ── a lista ──────────────────────────────────────────────────────────────────

function renderLista() {
  const wrap = $('history-list');
  if (!wrap) return;

  if (!versoes.length) {
    wrap.innerHTML = `<p class="history-vazio">${esc(tt('history.empty',
      'No earlier version yet. The next save of this file starts the history.'))}</p>`;
    return;
  }

  wrap.innerHTML = versoes.map((v, i) => `
    <button class="history-item${i === selecionada ? ' selecionada' : ''}" data-i="${i}">
      <span class="history-quando">${esc(quando(v.quando))}</span>
      <span class="history-origem">${esc(origemEmPalavras(v.origem))}</span>
      <span class="history-tamanho">${esc(tamanho(v.bytes))}</span>
      <span class="history-linhas">${esc(String(v.linhas))}</span>
    </button>`).join('');
}

// ── o diff ───────────────────────────────────────────────────────────────────

/** A linguagem do arquivo, para o diff colorir como o editor colore. */
function linguagemDe(caminho) {
  try { return window.EditorManager?.getLanguageFromPath?.(caminho) || 'plaintext'; }
  catch { return 'plaintext'; }
}

/** O conteudo de agora: o do EDITOR, que pode ter alteracoes nao salvas. */
function conteudoDeAgora(caminho) {
  try {
    const ed = window.EditorManager?.getEditorForFile?.(caminho);
    const m = ed && ed.getModel();
    if (m) return m.getValue();
  } catch { /* sem editor aberto */ }
  return null;
}

function descartarDiff() {
  try { diffEditor?.dispose?.(); } catch { /* ja foi */ }
  try { modeloEsquerda?.dispose?.(); } catch { /* ja foi */ }
  try { modeloDireita?.dispose?.(); } catch { /* ja foi */ }
  diffEditor = null;
  modeloEsquerda = null;
  modeloDireita = null;
}

async function mostrarDiff(i) {
  const alvo = $('history-diff');
  const v = versoes[i];
  if (!alvo || !v || !arquivoAtual || typeof monaco === 'undefined') return;
  selecionada = i;
  renderLista();

  const r = await electronAPI.historicoLer?.(arquivoAtual, v.id);
  if (!r?.ok) {
    alvo.innerHTML = `<p class="history-vazio">${esc(tt('history.readFailed', 'Could not read that version.'))}</p>`;
    return;
  }
  const agora = conteudoDeAgora(arquivoAtual);
  const lang = linguagemDe(arquivoAtual);

  // Modelos SEM uri: um modelo com a uri do arquivo colidiria com o do editor
  // aberto, e o Monaco recusa duas com a mesma. Estes vivem so enquanto a
  // tela esta aberta e sao descartados ao fechar.
  descartarDiff();
  alvo.innerHTML = '';
  modeloEsquerda = monaco.editor.createModel(r.conteudo, lang);
  modeloDireita = monaco.editor.createModel(agora == null ? '' : agora, lang);
  diffEditor = monaco.editor.createDiffEditor(alvo, {
    automaticLayout: true,
    readOnly: true,
    // Lado a lado quando ha largura; empilhado quando nao ha. O padrao do
    // Monaco ja faz isso, mas so se o limiar for declarado.
    renderSideBySide: true,
    renderSideBySideInlineBreakpoint: 700,
    renderOverviewRuler: false,
    scrollBeyondLastLine: false,
    fontSize: 12,
    minimap: { enabled: false },
    // O que nao mudou fica dobrado: num arquivo de trezentas linhas com uma
    // alteracao, o resto so afasta a pessoa do que ela veio ver.
    hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 6 },
  });
  diffEditor.setModel({ original: modeloEsquerda, modified: modeloDireita });

  const btn = $('history-restore');
  if (btn) btn.disabled = false;
}

// ── restaurar ────────────────────────────────────────────────────────────────

/**
 * Poe a versao escolhida no editor, como edicao desfazivel.
 *
 * `pushEditOperations` e nao `setValue`: o mesmo caminho que o vigia de
 * arquivo usa para trocar conteudo por baixo do editor, e o que faz o Ctrl+Z
 * devolver o que estava. Com `setValue` a pilha de desfazer seria perdida, e
 * uma restauracao errada nao teria volta.
 */
async function restaurar() {
  if (selecionada == null || !arquivoAtual) return;
  const v = versoes[selecionada];
  const r = await electronAPI.historicoLer?.(arquivoAtual, v.id);
  if (!r?.ok) return;

  const ed = window.EditorManager?.getEditorForFile?.(arquivoAtual);
  const model = ed && ed.getModel();
  if (!model) return;

  model.pushStackElement();
  model.pushEditOperations(
    [],
    [{ range: model.getFullModelRange(), text: r.conteudo, forceMoveMarkers: true }],
    () => null,
  );
  model.pushStackElement();

  try {
    window.showNotification?.(
      tt('history.restored', 'Version restored into the editor. Save to keep it, Ctrl+Z to undo.'),
      'success', 5000, 'history-restore',
    );
  } catch { /* sem notificacao, sem problema */ }
  fechar();
}

// ── abrir e fechar ───────────────────────────────────────────────────────────

async function abrir() {
  modal = modal || $('historyModal');
  if (!modal) return;
  arquivoAtual = arquivoDaAba();
  selecionada = null;
  versoes = [];
  descartarDiff();

  const titulo = $('history-file');
  const alvo = $('history-diff');
  const btn = $('history-restore');
  if (btn) btn.disabled = true;
  if (alvo) {
    alvo.innerHTML = `<p class="history-vazio">${esc(tt('history.pick', 'Pick a version to see what changed.'))}</p>`;
  }

  if (!arquivoAtual) {
    if (titulo) titulo.textContent = '';
    const wrap = $('history-list');
    if (wrap) {
      wrap.innerHTML = `<p class="history-vazio">${esc(tt('history.noFile', 'Open a file to see its history.'))}</p>`;
    }
  } else {
    if (titulo) titulo.textContent = arquivoAtual.split(/[/\\]/).pop() || '';
    const r = await electronAPI.historicoListar?.(arquivoAtual);
    versoes = (r?.ok && Array.isArray(r.versoes)) ? r.versoes : [];
    renderLista();
  }

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

function fechar() {
  if (!modal) return;
  descartarDiff();
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

export function initFileHistory() {
  modal = $('historyModal');
  $('file-history')?.addEventListener('click', abrir);
  modal?.addEventListener('aurora-modal-close', fechar);
  $('history-list')?.addEventListener('click', (e) => {
    const item = e.target.closest('.history-item');
    if (item) mostrarDiff(Number(item.dataset.i));
  });
  $('history-restore')?.addEventListener('click', restaurar);
  window.openFileHistory = abrir;
}

export { abrir, fechar, quando, tamanho, origemEmPalavras };

// Os dois botoes da barra nasciam sem ouvinte: este modulo exportava a funcao
// de ligar e NINGUEM a chamava. O `<script type="module">` do index carregava o
// arquivo, o codigo avaliava, e nada acontecia ao clicar. O rewind ja tinha
// esta auto-ligacao; estes dois nao.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFileHistory);
  else initFileHistory();
}
