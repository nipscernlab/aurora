/**
 * bug_report.js — relatar um problema por e-mail, em um clique.
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
 * para identificar o serviço na lista.
 */

import { electronAPI } from '../app/electron_api.js';

export const BUG_EMAIL = 'contact@nipscern.com';

/**
 * Provedores oferecidos. `url` recebe os campos já codificados.
 *
 * O limite de tamanho da URL é o que decide o corpo: navegadores param perto de
 * 8 mil caracteres e alguns provedores cortam antes, então o corpo é enxuto de
 * propósito e o usuário anexa o log se precisar.
 */
export const PROVEDORES = [
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
export function montarCorpo(d = {}) {
  const val = (x) => (x === undefined || x === null || x === '' ? 'não informado' : String(x));
  return [
    'Descreva o problema abaixo. Quanto mais concreto, mais rápido de resolver.',
    '',
    'O QUE ACONTECEU',
    '',
    '',
    'O QUE VOCÊ ESPERAVA QUE ACONTECESSE',
    '',
    '',
    'COMO REPRODUZIR, PASSO A PASSO',
    '1. ',
    '2. ',
    '3. ',
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
  ].join('\n');
}

/** Assunto padrão, com a versão para triagem. */
export function montarAssunto(versao) {
  return `[AURORA ${versao || '?'}] Relato de problema`;
}

/**
 * URL de composição do provedor, com tudo codificado.
 * @param {string} id
 * @param {{assunto: string, corpo: string, para?: string}} conteudo
 */
export function urlDoProvedor(id, { assunto, corpo, para = BUG_EMAIL }) {
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
 * As marcas pertencem a Google, Microsoft, Proton AG e Yandex. Aparecem aqui
 * apenas para identificar o serviço na lista.
 */
const ICONES = {
  gmail:   { arquivo: 'mail_gmail.svg', cor: '#EA4335' },
  outlook: { arquivo: 'mail_microsoftoutlook.svg', cor: '#0078D4' },
  proton:  { arquivo: 'mail_protonmail.svg', cor: '#6D4AFF' },
  yandex:  { arquivo: 'mail_yandex.svg', cor: '#FC3F1D' },
  mailto:  null,
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

/** Abre o seletor de provedor e manda para o navegador. */
export async function abrirRelatorio() {
  const dados = await coletar();
  const assunto = montarAssunto(dados.versao);
  const corpo = montarCorpo(dados);

  const escolha = await window.AuroraUI?.dialog?.({
    title: 'Relatar um problema',
    message: 'A AURORA abre a janela de composição do seu e-mail já preenchida, '
      + 'com o diagnóstico incluído. Escolha por onde enviar.',
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

if (typeof window !== 'undefined') {
  window.auroraBugReport = abrirRelatorio;
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('about-bug-report')
      ?.addEventListener('click', (e) => { e.preventDefault(); abrirRelatorio(); });
  });
}
