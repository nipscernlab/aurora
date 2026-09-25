/**
 * bug_report.ts: relatar um problema por e-mail, em um clique.
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
/**
 * O texto traduzido, ou a reserva em ingles.
 *
 * Este arquivo escrevia o rotulo direto em portugues, entao quem usava a AURORA
 * em ingles via uma palavra em portugues no meio da tela.
 */
function tr(chave: string, reserva: string): string {
  const f = typeof window !== 'undefined' ? window.t : null;
  if (typeof f !== 'function') return reserva;
  const v = f(chave);
  return (v && v !== chave) ? v : reserva;
}


import { electronAPI } from '../app/electron_api.js';
import { abrirFormulario } from './bug_report_form.js';
import { showDialog } from './dialog_manager.js';
import { TabManager } from '../tabs/tab_manager.js';
import { ProjectStore } from '../project/project_store.js';

/** Os campos codificados que cada provedor recebe. */
interface CamposDoEmail { to: string; subject: string; body: string }

/** O diagnostico curto que vai no corpo do e-mail. */
interface Diagnostico {
  versao?: string;
  so?: string;
  electron?: string;
  chrome?: string;
  node?: string;
  projeto?: string;
  arquivo?: string;
  locale?: string;
}

/** O texto que o formulario ja recolheu, quando recolheu. */
interface TextoDoRelato {
  oQueAconteceu?: string;
  oQueEsperava?: string;
  comoReproduzir?: string;
  terminal?: string;
}

/** O que o main devolve em bugreport:diagnostico (main/ipc/bug_report.ts). */
interface DiagnosticoDoMain {
  versao?: string;
  sistema?: string;
  electron?: string;
  chrome?: string;
  node?: string;
  [k: string]: unknown;
}

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
    url: (p: CamposDoEmail) => 'https://mail.google.com/mail/?view=cm&fs=1'
      + `&to=${p.to}&su=${p.subject}&body=${p.body}`,
  },
  {
    id: 'outlook',
    nome: 'Outlook',
    url: (p: CamposDoEmail) => 'https://outlook.live.com/mail/0/deeplink/compose'
      + `?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'proton',
    nome: 'Proton Mail',
    url: (p: CamposDoEmail) => 'https://mail.proton.me/u/0/inbox'
      + `#action=compose&to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'yandex',
    nome: 'Yandex Mail',
    url: (p: CamposDoEmail) => `https://mail.yandex.com/compose?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'icloud',
    nome: 'iCloud Mail',
    url: (p: CamposDoEmail) => `https://www.icloud.com/mail/?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'zoho',
    nome: 'Zoho Mail',
    url: (p: CamposDoEmail) => 'https://mail.zoho.com/zm/#compose'
      + `?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'gmx',
    nome: 'GMX',
    url: (p: CamposDoEmail) => `https://www.gmx.com/mail/compose/?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'aol',
    nome: 'AOL Mail',
    url: (p: CamposDoEmail) => `https://mail.aol.com/?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'mailru',
    nome: 'Mail.ru',
    url: (p: CamposDoEmail) => `https://e.mail.ru/compose/?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'tutanota',
    nome: 'Tuta',
    url: (p: CamposDoEmail) => `https://app.tuta.com/mailto?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    id: 'hey',
    nome: 'HEY',
    url: (p: CamposDoEmail) => `https://app.hey.com/mailto?to=${p.to}&subject=${p.subject}&body=${p.body}`,
  },
  {
    // Thunderbird, Outlook instalado, Apple Mail e afins. Ultima opcao porque
    // depende de haver cliente configurado na maquina.
    id: 'mailto',
    nome: 'Cliente instalado',
    url: (p: CamposDoEmail) => `mailto:${p.to}?subject=${p.subject}&body=${p.body}`,
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
function montarCorpo(d: Diagnostico = {}, texto: TextoDoRelato = {}): string {
  const val = (x: unknown) => (x === undefined || x === null || x === '' ? 'não informado' : String(x));
  // Quando o formulario ja recolheu o texto, ele vem preenchido; quando o
  // usuario chamou o e-mail direto, ficam os cabecalhos vazios para preencher.
  const ou = (v: unknown, vazio: string) => (String(v || '').trim() || vazio);
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
function montarAssunto(versao: string | undefined): string {
  return `[AURORA ${versao || '?'}] Relato de problema`;
}

/**
 * URL de composição do provedor, com tudo codificado.
 */
function urlDoProvedor(id: string, { assunto, corpo, para = BUG_EMAIL }: { assunto: string; corpo: string; para?: string }): string | null {
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
const ICONES: Record<string, { arquivo: string; cor: string }> = {
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
function iconeHtml(id: string): string {
  const it = ICONES[id];
  if (!it) return '<i class="ph ph-envelope-simple" aria-hidden="true"></i>';
  const url = `./assets/icons/${it.arquivo}`;
  return '<span class="mail-provider-icon" aria-hidden="true" style="'
    + `background-color:${it.cor};`
    + `-webkit-mask:url('${url}') center/contain no-repeat;`
    + `mask:url('${url}') center/contain no-repeat;"></span>`;
}

/**
 * O diagnostico curto do corpo do e-mail.
 *
 * Sistema, Electron, Chromium e Node vem do diagnostico que o main reuniu para
 * o formulario (bugreport:diagnostico), quando ele veio. Ate 25/09/2026 isto
 * perguntava a um electronAPI.getSystemInfo que nunca existiu, e o e-mail saia
 * sempre com o userAgent no lugar do sistema e "nao informado" nas versoes;
 * o diagnostico do main chegava aqui e era guardado num campo que ninguem lia.
 * O log, que o diagnostico do main tambem traz, continua fora: o corpo vai na
 * URL, e ela tem limite.
 */
async function coletar(diag: DiagnosticoDoMain | null): Promise<Diagnostico> {
  const d: Diagnostico = {};
  try { d.versao = await electronAPI.getAppVersion?.(); } catch (_) { /* opcional */ }
  if (diag) {
    d.versao = d.versao || diag.versao;
    d.so = diag.sistema;
    d.electron = diag.electron; d.chrome = diag.chrome; d.node = diag.node;
  }
  if (!d.so) d.so = navigator.userAgent;
  d.locale = (window as unknown as { i18nCurrentLocale?: string }).i18nCurrentLocale || document.documentElement.lang || '—';
  d.projeto = ProjectStore.getProjectPath() || 'nenhum';
  try { d.arquivo = TabManager.getEditingFilePath?.() || 'nenhum'; }
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
async function enviarPorEmail(texto: TextoDoRelato = {}, diagDoMain: DiagnosticoDoMain | null = null): Promise<void> {
  const dados = await coletar(diagDoMain);
  const assunto = montarAssunto(dados.versao);
  const corpo = montarCorpo(dados, texto);

  const escolha = await showDialog({
    title: tr('bugReport.sendByEmail', 'Send by e-mail'),
    message: 'A AURORA abre a janela de composição do seu e-mail já preenchida. '
      + 'Escolha por onde enviar.',
    variant: 'info',
    buttons: [
      ...PROVEDORES.map((p) => ({
        label: p.nome,
        action: p.id,
        type: p.id === 'gmail' ? 'save' : 'cancel',
        iconHtml: iconeHtml(p.id),
      })),
      { label: 'Cancelar', action: 'cancel', type: 'cancel' },
    ],
  });

  if (!escolha || escolha === 'cancel') return;
  const url = urlDoProvedor(escolha, { assunto, corpo });
  if (!url) return;
  try { await electronAPI.openExternal!(url); }
  catch (e) { window.showNotification?.(`Não foi possível abrir: ${(e as Error | null)?.message || e}`, 'error'); }
}

/** Ponto de entrada do botão: o formulário, com o e-mail como reserva. */
async function abrirRelatorio(): Promise<void> {
  await abrirFormulario(enviarPorEmail);
}

if (typeof window !== 'undefined') {
  (window as unknown as { auroraBugReport?: typeof abrirRelatorio }).auroraBugReport = abrirRelatorio;
  document.addEventListener('DOMContentLoaded', () => {
    // O botao vive na BARRA LATERAL das configuracoes, logo abaixo de
    // Componentes, e nao dentro de um painel. Passou por dois lugares antes:
    // no Sobre, no meio dos links de leitura, onde relatar parecia mais um
    // documento para consultar do que algo para fazer; e depois em Geral, onde
    // so era encontrado por quem ja estivesse naquele painel. Na barra ele
    // aparece em qualquer aba aberta, ao lado de Componentes, que e o outro
    // lugar que se procura quando a AURORA nao esta funcionando.
    document.getElementById('bug-report-btn')
      ?.addEventListener('click', (e) => { e.preventDefault(); abrirRelatorio(); });
  });
}
