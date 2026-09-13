/**
 * rewind.js: voltar o projeto a um instante anterior.
 *
 * O QUE E UM PONTO. Um instante com nome, e nao uma copia do projeto. Quem
 * guarda conteudo e o historico por arquivo (main/ipc/history.js), que ja grava
 * toda gravacao; o ponto so registra QUANDO foi e quais arquivos existiam.
 * Voltar a ele e devolver cada arquivo a versao mais recente daquele instante
 * ou antes. Por isso um ponto custa quase nada e da para marcar varios por
 * hora sem encher o disco.
 *
 * POR QUE PONTO E NAO SO O HISTORICO. O historico por arquivo ja tem todo
 * salvar, mas "14:32" nao diz nada a ninguem. O ponto existe para dar NOME a um
 * instante que a pessoa reconheceria depois: "antes de eu pedir para a IA
 * refatorar o contador", "antes da compilacao que funcionou". Os gatilhos sao
 * os momentos que ela mesma nomearia.
 *
 * NAO E SO DO CHAT. O pedido comecou como um botao por mensagem da Aurora
 * Intelligence, mas a maquina e a mesma para qualquer gatilho, entao o rewind
 * tambem vive na interface: a paleta abre a lista completa, venha o ponto de
 * onde vier.
 *
 * SEMPRE COM CONFIRMACAO, e a confirmacao traz NUMEROS. "Isto vai mexer em 4
 * arquivos e mandar 1 para a Lixeira" e uma frase que deixa desistir; "tem
 * certeza?" nao e.
 */

import { electronAPI } from '../app/electron_api.js';
import { showDialog } from '../ui/dialog_manager.js';

/** Chave faltando no locale nao vaza para a tela. */
function tt(key, fallback) {
  const fn = window.t;
  if (typeof fn !== 'function') return fallback;
  const v = fn(key);
  return (v && v !== key) ? v : fallback;
}

/** `13/09 14:22`, o mesmo formato curto do resto da interface. */
export function quando(ms) {
  const d = new Date(ms);
  const dois = (n) => String(n).padStart(2, '0');
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/**
 * O rotulo de um ponto vindo de uma mensagem: o comeco do que a pessoa pediu.
 *
 * O texto inteiro nao cabe numa linha de lista, e o comeco e o que ela
 * reconhece. Quebra em palavra, nao em caractere: cortar no meio de uma
 * palavra faz o rotulo parecer defeito.
 */
export function rotuloDoPedido(texto, max = 60) {
  const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (limpo.length <= max) return limpo;
  const corte = limpo.slice(0, max);
  const espaco = corte.lastIndexOf(' ');
  return `${(espaco > max * 0.6 ? corte.slice(0, espaco) : corte).trim()}…`;
}

/**
 * Abre um ponto. Melhor esforco: marcar o instante nao pode atrapalhar o que a
 * pessoa mandou fazer, entao uma falha aqui some no console.
 *
 * @param {{ rotulo?: string|null, mensagemId?: string|null }} [meta]
 */
export async function marcarPonto(meta = {}) {
  try {
    const r = await electronAPI.historicoPontoCriar?.(meta);
    return r?.ok ? r : null;
  } catch (e) {
    console.warn('[rewind] nao consegui marcar o ponto:', e);
    return null;
  }
}

/** Os pontos gravados, do mais recente para o mais antigo. */
export async function listarPontos() {
  try {
    const r = await electronAPI.historicoPontoListar?.();
    return (r?.ok && Array.isArray(r.pontos)) ? r.pontos : [];
  } catch {
    return [];
  }
}

/**
 * Volta o projeto a um ponto, perguntando antes com os numeros na mao.
 *
 * A previa e calculada ANTES de qualquer escrita: e ela que permite dizer
 * quantos arquivos mudam e quantos vao para a Lixeira. Se nada mudou desde o
 * ponto, isso tambem e dito, e nao ha o que fazer.
 *
 * @param {string} id
 * @returns {Promise<boolean>} se voltou
 */
export async function voltarAoPonto(id) {
  let previa;
  try { previa = await electronAPI.historicoPontoPrevia?.(id); }
  catch (e) { previa = { ok: false, erro: e?.message || String(e) }; }

  if (!previa?.ok) {
    try {
      window.showNotification?.(
        tt('rewind.previewFailed', 'Could not read that restore point.'), 'error', 4000, 'rewind');
    } catch { /* sem notificacao */ }
    return false;
  }

  const mudam = previa.restaurar.length;
  const novos = previa.novos.length;

  if (!mudam && !novos) {
    try {
      window.showNotification?.(
        tt('rewind.nothing', 'Nothing changed since that point.'), 'info', 4000, 'rewind');
    } catch { /* sem notificacao */ }
    return false;
  }

  const corpo = [
    tt('rewind.confirmFiles', '{{files}} files go back to how they were.')
      .replace('{{files}}', String(mudam)),
    novos
      ? tt('rewind.confirmNew', '{{new}} files created after that point go to the Recycle Bin.')
        .replace('{{new}}', String(novos))
      : '',
    tt('rewind.confirmUndo', 'The current state is saved as a new point first, so this can be undone.'),
  ].filter(Boolean).join(' ');

  const escolha = await showDialog({
    title: tt('rewind.confirmTitle', 'Rewind code'),
    message: corpo,
    variant: 'warning',
    buttons: [
      { label: tt('dialog.common.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
      { label: tt('rewind.confirmYes', 'Rewind'), action: 'voltar', type: 'primary' },
    ],
  });
  // O dialogo resolve com o `action` do botao; Escape e clique fora resolvem
  // 'cancel'. Qualquer coisa que nao seja o sim explicito e nao.
  if (escolha !== 'voltar') return false;

  let r;
  try { r = await electronAPI.historicoPontoVoltar?.(id); }
  catch (e) { r = { ok: false, erro: e?.message || String(e) }; }

  if (!r?.ok) {
    try {
      window.showNotification?.(
        tt('rewind.failed', 'The rewind failed.'), 'error', 5000, 'rewind');
    } catch { /* sem notificacao */ }
    return false;
  }

  try {
    window.showNotification?.(
      tt('rewind.done', '{{files}} files restored.').replace('{{files}}', String(r.restaurados)),
      'success', 5000, 'rewind');
    // Falha parcial nao pode passar batida no meio de uma mensagem de sucesso:
    // o projeto ficou metade voltado e a pessoa precisa saber agora.
    if (Array.isArray(r.falhas) && r.falhas.length) {
      window.showNotification?.(
        tt('rewind.partial', 'Could not touch {{files}} files.').replace('{{files}}', String(r.falhas.length)),
        'warning', 6000, 'rewind');
    }
  } catch { /* sem notificacao */ }

  return true;
}

// ── a porta geral: escolher um ponto pela interface ──────────────────────────

/**
 * A lista de pontos, para a pessoa escolher um.
 *
 * Reusa o dialogo comum em vez de um modal proprio: a escolha e curta (uma
 * lista de instantes com nome) e o passo seguinte ja e um dialogo de
 * confirmacao. Dois modais em sequencia para uma escolha e um "tem certeza"
 * seria cerimonia demais.
 *
 * So os dez mais recentes: a lista existe para achar "aquele momento de agora
 * ha pouco", e alem disso a pessoa nao reconhece mais qual era qual.
 */
export async function escolherPonto() {
  const pontos = await listarPontos();
  if (!pontos.length) {
    try {
      window.showNotification?.(
        tt('rewind.pickEmpty', 'No restore point yet.'), 'info', 6000, 'rewind');
    } catch { /* sem notificacao */ }
    return false;
  }

  const escolha = await showDialog({
    title: tt('rewind.pickTitle', 'Rewind code to a restore point'),
    message: '',
    variant: 'info',
    buttons: [
      ...pontos.slice(0, 10).map((p) => ({
        label: `${quando(p.quando)}${p.rotulo ? `  ${p.rotulo}` : ''}`,
        // O id do ponto viaja como `action`: e o que o dialogo devolve.
        action: `ponto:${p.id}`,
        type: 'cancel',
      })),
      { label: tt('dialog.common.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
    ],
  });
  if (typeof escolha !== 'string' || !escolha.startsWith('ponto:')) return false;
  return voltarAoPonto(escolha.slice('ponto:'.length));
}

/** Marca um ponto a pedido da pessoa, pela paleta. */
export async function marcarPontoManual() {
  const r = await marcarPonto({ rotulo: tt('rewind.manual', 'marked by hand') });
  try {
    window.showNotification?.(
      r ? tt('rewind.marked', 'Restore point marked.') : tt('rewind.failed', 'Could not mark it.'),
      r ? 'success' : 'error', 4000, 'rewind');
  } catch { /* sem notificacao */ }
  return !!r;
}

/** Os botoes da barra do terminal: marcar um ponto, voltar a um. */
export function initRewindButtons() {
  document.getElementById('mark-point')?.addEventListener('click', () => { marcarPontoManual(); });
  document.getElementById('rewind-code')?.addEventListener('click', () => { escolherPonto(); });
}

// A paleta chama por aqui: ela nao importa modulos, clica em coisas do window.
if (typeof window !== 'undefined') {
  window.auroraRewind = { marcar: marcarPontoManual, escolher: escolherPonto };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRewindButtons);
  else initRewindButtons();
}
