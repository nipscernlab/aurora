/**
 * bug_report_form.js: o painel onde a pessoa escreve o relato.
 *
 * POR QUE UM PAINEL, E NAO UM ENVIO DIRETO
 * ----------------------------------------
 * Um botão que envia sozinho manda telemetria, e não um relato. O que faz um
 * defeito ser corrigível é a frase que descreve o que a pessoa esperava e o que
 * aconteceu, e isso só ela sabe. Por isso o envio só acontece depois de haver
 * texto escrito.
 *
 * O DIAGNÓSTICO FICA À VISTA
 * --------------------------
 * O bloco recolhível mostra exatamente o que acompanha o relato, com o mesmo
 * conteúdo que será enviado, porque veio da mesma função que o envio usa. Uma
 * tela que diz "coletamos dados de diagnóstico" sem mostrar quais pede
 * confiança; mostrando, a pessoa decide sabendo.
 *
 * O RASCUNHO É SALVO
 * ------------------
 * Enquanto se digita. Quem relata um travamento pode travar de novo no meio da
 * escrita, e perder o texto é a forma mais rápida de alguém desistir de relatar.
 */

import { electronAPI } from '../app/electron_api.js';
import { showCardNotification } from './notification.js';

const CHAVE_RASCUNHO = 'aurora-bugreport-rascunho';

/** O que o usuário lê antes de enviar. Precisa casar com main/ipc/bug_report.js. */
const TEXTO_CONSENTIMENTO =
  'Ao enviar, você concorda em compartilhar com o NIPS-CERN o texto que escreveu '
  + 'acima e o diagnóstico abaixo. Nada além disso é lido: nem o conteúdo dos seus '
  + 'arquivos, nem senhas ou credenciais, nem suas conversas com a Aurora '
  + 'Intelligence, nem nada que identifique você ou a máquina.';

function rascunhoSalvo() {
  try { return JSON.parse(localStorage.getItem(CHAVE_RASCUNHO) || '{}'); }
  catch (_) { return {}; }
}

function salvarRascunho(d) {
  try { localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(d)); }
  catch (_) { /* modo privado */ }
}

function limparRascunho() {
  try { localStorage.removeItem(CHAVE_RASCUNHO); } catch (_) { /* ignore */ }
}

function escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** O diagnóstico como texto, na mesma ordem em que é mostrado e enviado. */
export function diagnosticoEmTexto(d) {
  if (!d) return '(não foi possível reunir o diagnóstico)';
  const linhasDeLog = String(d.log || '').split('\n').length;
  return [
    `AURORA: ${d.versao}${d.empacotado ? '' : ' (dev)'}`,
    `Sistema: ${d.sistema}`,
    `Máquina: ${d.nucleos} núcleos, ${d.memoriaGB} GB`,
    `Electron ${d.electron} · Chromium ${d.chrome} · Node ${d.node}`,
    '',
    `Últimas ${linhasDeLog} linhas do log:`,
    d.log || '(sem log)',
  ].join('\n');
}

function montar(diag) {
  const rascunho = rascunhoSalvo();
  const overlay = document.createElement('div');
  overlay.className = 'bug-report-overlay';

  const corpo = document.createElement('div');
  corpo.className = 'bug-report';
  corpo.setAttribute('role', 'dialog');
  corpo.setAttribute('aria-modal', 'true');
  corpo.innerHTML = [
    '<header class="bug-report-head">',
    '  <i class="ph ph-bug-beetle" aria-hidden="true"></i>',
    '  <h2>Relatar um problema</h2>',
    '  <button class="bug-report-x" type="button" aria-label="Fechar">',
    '    <i class="ph ph-x" aria-hidden="true"></i></button>',
    '</header>',
    '<div class="bug-report-corpo">',
    '  <label class="bug-report-campo"><span>O que aconteceu <b>*</b></span>',
    '    <textarea id="bug-o-que" rows="3" placeholder="Ex.: ao compilar um .cmm com matriz, o terminal para em 40% e nada acontece."></textarea></label>',
    '  <label class="bug-report-campo"><span>O que você esperava</span>',
    '    <textarea id="bug-esperava" rows="2" placeholder="Ex.: que a compilação terminasse e abrisse a forma de onda."></textarea></label>',
    '  <label class="bug-report-campo"><span>Como reproduzir</span>',
    '    <textarea id="bug-reproduzir" rows="3" placeholder="1. Abrir o projeto&#10;2. Clicar em Compilar&#10;3. Esperar"></textarea></label>',
    '  <details class="bug-report-diag"><summary>Ver o diagnóstico que vai junto</summary>',
    `    <pre>${escapar(diagnosticoEmTexto(diag))}</pre></details>`,
    `  <p class="bug-report-consentimento">${escapar(TEXTO_CONSENTIMENTO)}</p>`,
    '</div>',
    '<footer class="bug-report-pe">',
    '  <button class="btn" type="button" data-acao="email">',
    '    <i class="ph ph-envelope-simple" aria-hidden="true"></i> Enviar por e-mail</button>',
    '  <span class="bug-report-espaco"></span>',
    '  <button class="btn" type="button" data-acao="cancelar">Cancelar</button>',
    '  <button class="btn btn-primary" type="button" data-acao="enviar" disabled>Enviar relato</button>',
    '</footer>',
  ].join('\n');
  overlay.appendChild(corpo);

  const campo = (id) => overlay.querySelector('#' + id);
  campo('bug-o-que').value = rascunho.oQueAconteceu || '';
  campo('bug-esperava').value = rascunho.oQueEsperava || '';
  campo('bug-reproduzir').value = rascunho.comoReproduzir || '';

  const ler = () => ({
    oQueAconteceu: campo('bug-o-que').value,
    oQueEsperava: campo('bug-esperava').value,
    comoReproduzir: campo('bug-reproduzir').value,
  });

  const btEnviar = overlay.querySelector('[data-acao="enviar"]');
  const sincronizar = () => {
    const d = ler();
    // Sem descrição não há relato, e uma issue vazia custa mais a quem recebe
    // do que não receber nada.
    btEnviar.disabled = !d.oQueAconteceu.trim();
    salvarRascunho(d);
  };
  overlay.querySelectorAll('textarea').forEach((t) => t.addEventListener('input', sincronizar));
  sincronizar();

  return { overlay, ler };
}

/** Abre o painel e resolve com a ação escolhida e o texto escrito. */
function perguntar(diag) {
  return new Promise((resolve) => {
    const { overlay, ler } = montar(diag);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visivel'));
    overlay.querySelector('#bug-o-que')?.focus();

    const fechar = (acao) => {
      document.removeEventListener('keydown', aoTeclar);
      overlay.classList.remove('visivel');
      setTimeout(() => overlay.remove(), 180);
      resolve({ acao, texto: ler() });
    };
    const aoTeclar = (e) => { if (e.key === 'Escape') fechar('cancelar'); };
    document.addEventListener('keydown', aoTeclar);

    overlay.querySelector('.bug-report-x').addEventListener('click', () => fechar('cancelar'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar('cancelar'); });
    overlay.querySelectorAll('[data-acao]').forEach((b) => {
      b.addEventListener('click', () => fechar(b.dataset.acao));
    });
  });
}

/**
 * Fluxo completo: reúne, pergunta, envia.
 *
 * @param {(texto: object, diag: object) => Promise<void>} porEmail caminho de
 *   reserva, que abre o webmail já preenchido com o mesmo texto.
 */
export async function abrirFormulario(porEmail) {
  let diag = null;
  try { diag = await electronAPI.bugReportDiagnostico?.(); } catch (_) { /* segue sem */ }

  const { acao, texto } = await perguntar(diag);
  if (acao === 'cancelar') return;

  if (acao === 'email') {
    await porEmail?.(texto, diag);
    limparRascunho();
    return;
  }

  const r = await electronAPI.bugReportEnviar?.(texto)
    .catch((e) => ({ ok: false, erro: e?.message }));

  if (r?.ok) {
    limparRascunho();
    showCardNotification(
      'Relato enviado. Obrigado: é assim que os problemas chegam até nós.',
      'success', 7000, 'Problema relatado');
    return;
  }

  // Sem canal configurado, ou canal fora do ar. O e-mail continua valendo, e o
  // texto que a pessoa escreveu não pode se perder por causa disso.
  const motivo = r?.erro === 'sem-endpoint'
    ? 'O envio direto ainda não está configurado nesta versão.'
    : `Não foi possível enviar (${r?.erro || 'erro desconhecido'}).`;
  showCardNotification(`${motivo} Abrindo o e-mail com o seu texto.`, 'warning', 8000, 'Relato');
  await porEmail?.(texto, diag);
}

export { TEXTO_CONSENTIMENTO };
