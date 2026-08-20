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
 *
 * TEXTO VEM DO i18n, COM RESERVA
 * ------------------------------
 * Toda frase resolve por window.t e cai no português se as locales ainda não
 * carregaram. O consentimento é a frase com mais peso do painel e é por isso
 * que a reserva existe: um usuário não pode ver uma chave crua no lugar do
 * texto que explica o que ele está aceitando.
 */

import { electronAPI } from '../app/electron_api.js';
import { showCardNotification } from './notification.js';
import { recorteEmTexto } from '../terminal/terminal_excerpt.js';

const CHAVE_RASCUNHO = 'aurora-bugreport-rascunho';

/** Reservas em português para antes de as locales carregarem. */
const RESERVA = {
  'bugReport.title': 'Relatar um problema',
  'bugReport.close': 'Fechar',
  'bugReport.whatHappened': 'O que aconteceu',
  'bugReport.whatHappenedHint': 'Ex.: ao compilar um .cmm com matriz, o terminal para em 40% e nada acontece.',
  'bugReport.expected': 'O que você esperava',
  'bugReport.expectedHint': 'Ex.: que a compilação terminasse e abrisse a forma de onda.',
  'bugReport.reproduce': 'Como reproduzir',
  'bugReport.reproduceHint': '1. Abrir o projeto\n2. Clicar em Compilar\n3. Esperar',
  'bugReport.diagTitle': 'Ver o diagnóstico que vai junto',
  // A reserva PRECISA ser identica a locales/pt.json: e o texto juridico do
  // consentimento, e duas versoes dele seriam duas promessas diferentes.
  'bugReport.consent':
    'Ao enviar, você concorda em compartilhar com o NIPS-CERN o texto que escreveu acima '
    + 'e o diagnóstico abaixo. Não coletamos o conteúdo dos seus arquivos, senhas ou credenciais, '
    + 'nem conversas com a Aurora Intelligence, e o seu nome de usuário é removido dos caminhos '
    + 'antes do envio. Ainda assim, algum trecho do log pode, indiretamente, identificar você ou '
    + 'a máquina. O NIPS-CERN trata esses dados conforme a LGPD (Lei 13.709/2018): eles servem '
    + 'apenas para investigar o problema relatado e são apagados a seu pedido. Se você informar '
    + 'um e-mail, ele é usado somente para falar com você sobre este relato.',
  'bugReport.email': 'Seu e-mail (opcional)',
  'bugReport.emailHint': 'Para avisarmos quando corrigirmos, ou pedirmos um detalhe.',
  'bugReport.sendEmail': 'Enviar por e-mail',
  'bugReport.cancel': 'Cancelar',
  'bugReport.send': 'Enviar relato',
  'bugReport.sent': 'Relato enviado. Obrigado: é assim que os problemas chegam até nós.',
  'bugReport.sentTitle': 'Problema relatado',
  'bugReport.noEndpoint': 'O envio direto ainda não está configurado nesta versão.',
  'bugReport.failed': 'Não foi possível enviar ({erro}).',
  'bugReport.fallbackEmail': '{motivo} Abrindo o e-mail com o seu texto.',
  'bugReport.diagUnavailable': '(não foi possível reunir o diagnóstico)',
  'bugReport.tooMany': 'Você já enviou alguns relatos seguidos. Aguarde {tempo} para enviar outro. O que você escreveu ficou salvo.',
  'bugReport.waitSeconds': '{n} segundos',
  'bugReport.waitOneSecond': '1 segundo',
  'bugReport.waitOneMinute': '1 minuto',
  'bugReport.waitMinutes': '{n} minutos',
};

/** t() com reserva e {placeholders}. */
function tr(chave, valores) {
  const cru = window.t ? window.t(chave) : null;
  let texto = cru && cru !== chave ? cru : (RESERVA[chave] || chave);
  for (const [k, v] of Object.entries(valores || {})) {
    texto = texto.split(`{${k}}`).join(String(v));
  }
  return texto;
}

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

/**
 * Segundos viram um prazo que se lê.
 *
 * Arredonda para cima: dizer "1 minuto" e a pessoa voltar aos 61 segundos e
 * ser barrada de novo é pior do que ter pedido 2 desde o começo.
 */
export function emMinutos(segundos) {
  const s = Math.max(1, Math.ceil(Number(segundos) || 0));
  if (s === 1) return tr('bugReport.waitOneSecond');
  if (s < 60) return tr('bugReport.waitSeconds', { n: s });
  const m = Math.ceil(s / 60);
  return m === 1 ? tr('bugReport.waitOneMinute') : tr('bugReport.waitMinutes', { n: m });
}

/** Placeholder multilinha vira &#10; para sobreviver dentro do atributo. */
function escaparAtributo(s) {
  return escapar(s).replace(/\n/g, '&#10;');
}

/** O diagnóstico como texto, na mesma ordem em que é mostrado e enviado. */
export function diagnosticoEmTexto(d, terminal) {
  if (!d) return tr('bugReport.diagUnavailable');
  const linhasDeLog = String(d.log || '').split('\n').length;
  const disco = d.discoLivreGB == null ? '?' : `${d.discoLivreGB} GB livres`;
  const partes = [
    `AURORA: ${d.versao}${d.empacotado ? '' : ' (dev)'}`,
    `Sistema: ${d.sistema}`,
    `Máquina: ${d.nucleos} núcleos, ${d.memoriaGB} GB, ${disco}`,
    `Electron ${d.electron} · Chromium ${d.chrome} · Node ${d.node}`,
  ];
  if (d.componentes) partes.push(`Componentes: ${d.componentes}`);

  // O terminal vem primeiro porque é o que explica a falha; o log do
  // aplicativo é contexto de segunda ordem.
  if (terminal) partes.push('', 'Terminal (erros e o que estava em volta):', terminal);

  partes.push('', `Últimas ${linhasDeLog} linhas do log do aplicativo:`, d.log || '(sem log)');
  return partes.join('\n');
}

function montar(diag, terminal) {
  const rascunho = rascunhoSalvo();
  const overlay = document.createElement('div');
  overlay.className = 'bug-report-overlay';

  const corpo = document.createElement('div');
  corpo.className = 'bug-report';
  corpo.setAttribute('role', 'dialog');
  corpo.setAttribute('aria-modal', 'true');
  corpo.innerHTML = [
    '<header class="bug-report-head">',
    '  <span class="bug-report-emblema"><i class="ph ph-bug-beetle" aria-hidden="true"></i></span>',
    `  <h2>${escapar(tr('bugReport.title'))}</h2>`,
    `  <button class="bug-report-x" type="button" aria-label="${escapar(tr('bugReport.close'))}">`,
    '    <i class="ph ph-x" aria-hidden="true"></i></button>',
    '</header>',
    '<div class="bug-report-corpo">',
    `  <label class="bug-report-campo"><span>${escapar(tr('bugReport.whatHappened'))} <b>*</b></span>`,
    `    <textarea id="bug-o-que" rows="3" placeholder="${escaparAtributo(tr('bugReport.whatHappenedHint'))}"></textarea></label>`,
    `  <label class="bug-report-campo"><span>${escapar(tr('bugReport.expected'))}</span>`,
    `    <textarea id="bug-esperava" rows="2" placeholder="${escaparAtributo(tr('bugReport.expectedHint'))}"></textarea></label>`,
    `  <label class="bug-report-campo"><span>${escapar(tr('bugReport.reproduce'))}</span>`,
    `    <textarea id="bug-reproduzir" rows="3" placeholder="${escaparAtributo(tr('bugReport.reproduceHint'))}"></textarea></label>`,
    `  <label class="bug-report-campo"><span>${escapar(tr('bugReport.email'))}</span>`,
    `    <input id="bug-email" type="email" autocomplete="email" placeholder="${escaparAtributo(tr('bugReport.emailHint'))}"></label>`,
    '  <details class="bug-report-diag">',
    `    <summary><i class="ph ph-caret-right" aria-hidden="true"></i>${escapar(tr('bugReport.diagTitle'))}</summary>`,
    `    <pre>${escapar(diagnosticoEmTexto(diag, terminal))}</pre></details>`,
    '  <p class="bug-report-consentimento">',
    '    <i class="ph ph-shield-check" aria-hidden="true"></i>',
    `    <span>${escapar(tr('bugReport.consent'))}</span></p>`,
    '</div>',
    '<footer class="bug-report-pe">',
    '  <button class="btn btn-secondary" type="button" data-acao="email">',
    `    <i class="ph ph-envelope-simple" aria-hidden="true"></i> ${escapar(tr('bugReport.sendEmail'))}</button>`,
    '  <span class="bug-report-espaco"></span>',
    `  <button class="btn btn-secondary" type="button" data-acao="cancelar">${escapar(tr('bugReport.cancel'))}</button>`,
    '  <button class="btn btn-primary" type="button" data-acao="enviar" disabled>',
    `    <i class="ph ph-paper-plane-tilt" aria-hidden="true"></i> ${escapar(tr('bugReport.send'))}</button>`,
    '</footer>',
  ].join('\n');
  overlay.appendChild(corpo);

  const campo = (id) => overlay.querySelector('#' + id);
  campo('bug-o-que').value = rascunho.oQueAconteceu || '';
  campo('bug-esperava').value = rascunho.oQueEsperava || '';
  campo('bug-reproduzir').value = rascunho.comoReproduzir || '';
  campo('bug-email').value = rascunho.email || '';

  const ler = () => ({
    oQueAconteceu: campo('bug-o-que').value,
    oQueEsperava: campo('bug-esperava').value,
    comoReproduzir: campo('bug-reproduzir').value,
    email: campo('bug-email').value,
  });

  const btEnviar = overlay.querySelector('[data-acao="enviar"]');
  const sincronizar = () => {
    const d = ler();
    // Sem descrição não há relato, e uma issue vazia custa mais a quem recebe
    // do que não receber nada.
    btEnviar.disabled = !d.oQueAconteceu.trim();
    salvarRascunho(d);
  };
  overlay.querySelectorAll('textarea, input').forEach((t) => t.addEventListener('input', sincronizar));
  sincronizar();

  return { overlay, ler };
}

/** Abre o painel e resolve com a ação escolhida e o texto escrito. */
function perguntar(diag, terminal) {
  return new Promise((resolve) => {
    const { overlay, ler } = montar(diag, terminal);
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

  // Colhido do DOM AGORA, antes de a pessoa começar a escrever: o terminal
  // continua recebendo linhas enquanto o painel está aberto, e o que interessa
  // é o estado do momento em que ela decidiu relatar.
  let terminal = '';
  try { terminal = recorteEmTexto(); } catch (_) { /* relato sem terminal ainda vale */ }

  const { acao, texto } = await perguntar(diag, terminal);
  // O recorte viaja junto com o que a pessoa escreveu, pelos dois caminhos.
  texto.terminal = terminal;
  if (acao === 'cancelar') return;

  if (acao === 'email') {
    // O rascunho NAO e limpo aqui. Abrir o webmail nao e prova de envio: a
    // pessoa pode fechar a aba, o cliente pode nem abrir, e apagar o texto
    // nesse ponto seria destruir o relato exatamente de quem teve mais
    // trabalho para faze-lo chegar.
    await porEmail?.(texto, diag);
    return;
  }

  const r = await electronAPI.bugReportEnviar?.(texto)
    .catch((e) => ({ ok: false, erro: e?.message }));

  // O UNICO ponto que apaga o que a pessoa escreveu, e so com o envio
  // confirmado pelo servidor. Cancelar, fechar clicando fora, bater no limite
  // de frequencia ou cair a rede preservam tudo: o rascunho e a rede de
  // seguranca de quem escreveu, e apaga-lo sem certeza de entrega custaria
  // justamente o relato.
  if (r?.ok) {
    limparRascunho();
    showCardNotification(tr('bugReport.sent'), 'success', 7000, tr('bugReport.sentTitle'));
    return;
  }

  // Limite de frequência não é falha, é "ainda não", e por isso não cai no
  // e-mail: quem chegou aqui já mandou três relatos, e abrir o webmail seria
  // insistir num caminho que a pessoa não pediu. O rascunho fica salvo (não
  // chamamos limparRascunho), então o texto espera junto.
  if (r?.erro === 'muitos-relatos') {
    showCardNotification(
      tr('bugReport.tooMany', { tempo: emMinutos(r.esperar) }),
      'warning', 10000, tr('bugReport.title'));
    return;
  }

  // Sem canal configurado, ou canal fora do ar. O e-mail continua valendo, e o
  // texto que a pessoa escreveu não pode se perder por causa disso.
  const motivo = r?.erro === 'sem-endpoint'
    ? tr('bugReport.noEndpoint')
    : tr('bugReport.failed', { erro: r?.erro || '?' });
  showCardNotification(
    tr('bugReport.fallbackEmail', { motivo }), 'warning', 8000, tr('bugReport.title'));
  await porEmail?.(texto, diag);
}
