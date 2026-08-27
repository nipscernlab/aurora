/**
 * bug_report.js: relatar um problema por e-mail, em um clique.
 *
 * O usuário escolhe o provedor e a AURORA abre a janela de composição dele no
 * navegador, já com destinatário, assunto e um corpo pronto em português,
 * incluindo o diagnóstico que sempre teríamos de pedir depois: versão, sistema,
 * Electron, Chromium e o que está aberto.
 *
 * Abre no NAVEGADOR de propósito. Um `mailto:` depende de haver cliente de
 * e-mail configurado na máquina, o que numa máquina de laboratório costuma não
 * haver; a janela de composição do webmail funciona em qualquer uma. O
 * `mailto:` fica como última opção, para quem usa Thunderbird ou Outlook
 * instalado.
 *
 * Os nomes e as marcas dos provedores pertencem a eles. Os ícones são os
 * logotipos oficiais, vindos da biblioteca Simple Icons (CC0), e aparecem só
 * para identificar cada serviço na lista.
 */

import { electronAPI } from '../app/electron_api.js';
import { abrirFormulario, diagnosticoEmTexto } from './bug_report_form.js';

const BUG_EMAIL = 'contact@nipscern.com';

/**
 * Provedores oferecidos. `url` recebe os campos já codificados.
 *
 * O limite de tamanho da URL é o que decide o corpo: navegadores param perto de
 * 8 mil caracteres e alguns provedores cortam antes, então o corpo é enxuto de
 * propósito e o usuário anexa o log se precisar.
 */
const PROVEDORES = [
  {
    id: 'gmail',
    nome: 'Gmail',
    url: (p) => 'https://mail.google.com/mail/?view=cm&fs=1'
      + `&to=${p.to}&su=${p.subject}&body=${p.body}`,
  },
  {
    id: 'outlook',
    nome: 'Outlook',
    url: (p) => 'https://outlook.live.com/mail/0/deeplink/compose'
      + `?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'proton',
    nome: 'Proton Mail',
    url: (p) => 'https://mail.proton.me/u/0/inbox'
      + `#action=compose&to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'yandex',
    nome: 'Yandex Mail',
    url: (p) => `https://mail.yandex.com/compose?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'icloud',
    nome: 'iCloud Mail',
    url: (p) => `https://www.icloud.com/mail/?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'zoho',
    nome: 'Zoho Mail',
    url: (p) => 'https://mail.zoho.com/zm/#compose'
      + `?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'gmx',
    nome: 'GMX',
    url: (p) => `https://www.gmx.com/mail/compose/?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'aol',
    nome: 'AOL Mail',
    url: (p) => `https://mail.aol.com/?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'mailru',
    nome: 'Mail.ru',
    url: (p) => `https://e.mail.ru/compose/?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'tutanota',
    nome: 'Tuta',
    url: (p) => `https://app.tuta.com/mailto?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'hey',
    nome: 'HEY',
    url: (p) => `https://app.hey.com/mailto?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    // Thunderbird, Outlook instalado, Apple Mail e afins. Ultima opcao porque
    // depende de haver cliente configurado na maquina.
    id: 'mailto',
    nome: 'Cliente instalado',
    url: (p) => `mailto:${p.to}?subject=${p.subject}&body=${p.body}`,
  },
];

/**
 * Monta o corpo do relatório.
 *
 * Separado do DOM para poder ser testado, e porque é a parte que precisa estar
 * certa: um relatório sem versão e sem sistema custa uma ida e volta que o
 * usuário não deveria ter de fazer.
 *
 * @param {{versao?: string, so?: string, electron?: string, chrome?: string,
 *          node?: string, projeto?: string, arquivo?: string, locale?: string}} d
 */
function montarCorpo(d = {}, texto = {}) {
  const val = (x) => (x === undefined || x === null || x === '' ? 'não informado' : String(x));
  // Quando o formulario ja recolheu o texto, ele vem preenchido; quando o
  // usuario chamou o e-mail direto, ficam os cabecalhos vazios para preencher.
  const ou = (v, vazio) => (String(v || '').trim() || vazio);
  return [
    'Descreva o problema abaixo. Quanto mais concreto, mais rápido de resolver.',
    '',
    'O QUE ACONTECEU',
    ou(texto.oQueAconteceu, ''),
    '',
    'O QUE VOCÊ ESPERAVA QUE ACONTECESSE',
    ou(texto.oQueEsperava, ''),
    '',
    'COMO REPRODUZIR, PASSO A PASSO',
    ou(texto.comoReproduzir, '1. \n2. \n3. '),
    '',
    'Se puder, anexe o arquivo de log. Ele fica em:',
    '%APPDATA%\\SAPHO\\logs\\main.log',
    '',
    '--------------------------------------------------',
    'Diagnóstico preenchido pela AURORA, não precisa mexer:',
    '',
    `AURORA: ${val(d.versao)}`,
    `Sistema: ${val(d.so)}`,
    `Electron: ${val(d.electron)}   Chromium: ${val(d.chrome)}   Node: ${val(d.node)}`,
    `Idioma: ${val(d.locale)}`,
    `Projeto aberto: ${val(d.projeto)}`,
    `Arquivo em foco: ${val(d.arquivo)}`,
    // O recorte do terminal, quando houver, entra aqui também: os dois
    // caminhos de envio precisam levar a mesma coisa, senão o relato que chega
    // por e-mail vale menos do que o que chega pelo painel.
    ...(String(texto.terminal || '').trim()
      ? ['', 'TERMINAL (erros e o que estava em volta)', texto.terminal]
      : []),
  ].join('\n');
}

/** Assunto padrão, com a versão para triagem. */
function montarAssunto(versao) {
  return `[AURORA ${versao || '?'}] Relato de problema`;
}

/**
 * URL de composição do provedor, com tudo codificado.
 * @param {string} id
 * @param {{assunto: string, corpo: string, para?: string}} conteudo
 */
function urlDoProvedor(id, { assunto, corpo, para = BUG_EMAIL }) {
  const p = PROVEDORES.find((x) => x.id === id);
  if (!p) return null;
  return p.url({
    to: encodeURIComponent(para),
    subject: encodeURIComponent(assunto || ''),
    body: encodeURIComponent(corpo || ''),
  });
}

/**
 * Ícones dos provedores.
 *
 * São os logotipos oficiais, vindos da Simple Icons (simpleicons.org), que
 * publica as marcas em SVG sob CC0 e é atualizada pelos próprios serviços. Ficam
 * versionados em assets/icons/.
 *
 * Entram como máscara CSS, e não como <img>: os arquivos da Simple Icons são
 * monocromáticos e viriam pretos, invisíveis no tema escuro. Como máscara, a cor
 * da marca é aplicada por cima e o desenho continua sendo o oficial.
 *
 * As marcas pertencem aos respectivos servicos. Aparecem aqui apenas para
 * identificar cada um na lista.
 */
const ICONES = {
  gmail:    { arquivo: 'mail_gmail.svg', cor: '#EA4335' },
  outlook:  { arquivo: 'mail_microsoftoutlook.svg', cor: '#0078D4' },
  proton:   { arquivo: 'mail_protonmail.svg', cor: '#6D4AFF' },
  yandex:   { arquivo: 'mail_yandex.svg', cor: '#FC3F1D' },
  icloud:   { arquivo: 'mail_icloud.svg', cor: '#3693F3' },
  zoho:     { arquivo: 'mail_zoho.svg', cor: '#E42527' },
  gmx:      { arquivo: 'mail_gmx.svg', cor: '#1C449B' },
  aol:      { arquivo: 'mail_aol.svg', cor: '#3399FF' },
  mailru:   { arquivo: 'mail_maildotru.svg', cor: '#005FF9' },
  tutanota: { arquivo: 'mail_tutanota.svg', cor: '#850122' },
  hey:      { arquivo: 'mail_hey.svg', cor: '#5522FA' },
  mailto:   { arquivo: 'mail_thunderbird.svg', cor: '#0A84FF' },
};

/** Marcação do ícone, como máscara colorida. */
function iconeHtml(id) {
  const it = ICONES[id];
  if (!it) return '<i class="ph ph-envelope-simple" aria-hidden="true"></i>';
  const url = `./assets/icons/${it.arquivo}`;
  return '<span class="mail-provider-icon" aria-hidden="true" style="'
    + `background-color:${it.cor};`
    + `-webkit-mask:url('${url}') center/contain no-repeat;`
    + `mask:url('${url}') center/contain no-repeat;"></span>`;
}

/** Diagnóstico que a interface consegue reunir sem perguntar nada. */
async function coletar() {
  const d = {};
  try { d.versao = await electronAPI.getAppVersion?.(); } catch (_) { /* opcional */ }
  try {
    const s = await electronAPI.getSystemInfo?.();
    if (s) {
      d.so = [s.platform, s.release, s.arch].filter(Boolean).join(' ');
      d.electron = s.electron; d.chrome = s.chrome; d.node = s.node;
    }
  } catch (_) { /* opcional */ }
  if (!d.so) d.so = navigator.userAgent;
  d.locale = window.i18nCurrentLocale || document.documentElement.lang || '—';
  d.projeto = window.currentProjectPath || 'nenhum';
  try { d.arquivo = window.TabManager?.getEditingFilePath?.() || 'nenhum'; }
  catch (_) { d.arquivo = 'nenhum'; }
  return d;
}

/**
 * Abre o webmail escolhido, com o texto do usuário já dentro.
 *
 * É o caminho de reserva do formulário, e também o caminho inteiro quando o
 * envio direto não está configurado. Recebe o texto para o e-mail não sair
 * vazio pedindo que a pessoa escreva tudo de novo.
 */
async function enviarPorEmail(texto = {}, diagDoMain = null) {
  const dados = await coletar();
  if (diagDoMain) {
    // O diagnóstico do main é mais completo (log, memória, núcleos). Quando ele
    // veio, é ele que vale, para o e-mail levar o mesmo que a tela mostrou.
    dados.diagCompleto = diagnosticoEmTexto(diagDoMain);
  }
  const assunto = montarAssunto(dados.versao);
  const corpo = montarCorpo(dados, texto);

  const escolha = await window.AuroraUI?.dialog?.({
    title: 'Enviar por e-mail',
    message: 'A AURORA abre a janela de composição do seu e-mail já preenchida. '
      + 'Escolha por onde enviar.',
    variant: 'info',
    buttons: PROVEDORES.map((p) => ({
      label: p.nome,
      action: p.id,
      type: p.id === 'gmail' ? 'save' : 'cancel',
      iconHtml: iconeHtml(p.id),
    })).concat([{ label: 'Cancelar', action: 'cancel', type: 'cancel' }]),
  });

  if (!escolha || escolha === 'cancel') return;
  const url = urlDoProvedor(escolha, { assunto, corpo });
  if (!url) return;
  try { await electronAPI.openExternal(url); }
  catch (e) { window.showNotification?.(`Não foi possível abrir: ${e?.message || e}`, 'error'); }
}

/** Ponto de entrada do botão: o formulário, com o e-mail como reserva. */
async function abrirRelatorio() {
  await abrirFormulario(enviarPorEmail);
}

if (typeof window !== 'undefined') {
  window.auroraBugReport = abrirRelatorio;
  document.addEventListener('DOMContentLoaded', () => {
    // O botao vive em Geral, entre as outras acoes das configuracoes. Ficava
    // no Sobre, no meio dos links de leitura, onde relatar parecia mais um
    // documento para consultar do que algo para fazer.
    document.getElementById('bug-report-btn')
      ?.addEventListener('click', (e) => { e.preventDefault(); abrirRelatorio(); });
  });
}
