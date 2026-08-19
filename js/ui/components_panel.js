/**
 * components_panel.js: o painel de componentes, em Configurações.
 *
 * O QUE ESTE PAINEL É, E O QUE ELE NÃO É
 * --------------------------------------
 * Ele mostra e baixa. Ele NÃO é quem impede o uso de um componente ausente:
 * isso acontece no processo principal, no allowlist por onde todo caminho de
 * execução passa (main/components/registry.js explica o porquê). Se este painel
 * mentisse sobre o estado de um componente, ninguém executaria nada indevido,
 * apenas veria um rótulo errado. Essa separação é deliberada, e é o que permite
 * a interface ser simples.
 *
 * A LISTA SE REFAZ A CADA ABERTURA
 * --------------------------------
 * Nada é guardado entre aberturas. O usuário pode ter apagado a pasta por fora,
 * e uma lista guardada continuaria jurando que está tudo lá.
 *
 * REMOVER PEDE CONFIRMAÇÃO, BAIXAR NÃO
 * ------------------------------------
 * Baixar custa tempo e se refaz. Remover apaga, e o que se apaga por engano
 * volta só com outro download, que numa rede de laboratório pode ser a tarde
 * inteira.
 *
 * TEXTO VEM DO i18n, COM RESERVA EM PORTUGUÊS
 * -------------------------------------------
 * O nome e o resumo de cada componente vêm por chave (componentName.*,
 * componentSummary.*) para a lista falar a língua da interface; o catálogo do
 * main continua sendo a fonte do resto.
 */

import { electronAPI } from '../app/electron_api.js';
import { showDialog } from './dialog_manager.js';
import { showCardNotification } from './notification.js';

let baixando = null;

/** Reservas em português para antes de as locales carregarem. */
const RESERVA = {
  'modal.settings.componentsInstalled': 'Instalado',
  'modal.settings.componentsMissing': 'Não instalado',
  'modal.settings.componentsAlways': 'Sempre instalado',
  'modal.settings.componentsNeededToCompile': 'Necessário para compilar',
  'modal.settings.componentsDownload': 'Baixar',
  'modal.settings.componentsRemove': 'Remover',
  'modal.settings.componentsAllInstalled': 'Tudo instalado.',
  'modal.settings.componentsAvailable': '{n} disponíveis para baixar, {mb} no total.',
  'modal.settings.componentsDownloadOf': 'download de {mb}',
  'modal.settings.componentsInstalledOk': 'Componente instalado.',
  'modal.settings.componentsInstallFailed': 'Não foi possível baixar: {erro}',
  'modal.settings.componentsRemoveTitle': 'Remover {nome}',
  'modal.settings.componentsRemoveBody':
    'Os arquivos de {nome} saem do disco. O que depende dele para de funcionar até você '
    + 'baixar de novo, e a AURORA vai avisar quando isso acontecer.\n\nSeus projetos não são tocados.',
  'modal.settings.componentsRemoveConfirm': 'Remover',
  'modal.settings.componentsRemoved': '{nome} removido, {mb} livres.',
  'modal.settings.componentsRemoveFailed': 'Não foi possível remover: {erro}',
  'modal.settings.componentsBusy': 'Já há um download em andamento.',
  'modal.settings.componentsMissingTitle': 'Componente não instalado',
  'modal.settings.componentsNotNow': 'Agora não',
  'modal.settings.componentsDownloadNow': 'Baixar agora',
  'modal.settings.componentsCancel': 'Cancelar',
  'modal.settings.componentsReadFailed': 'Não foi possível ler os componentes: {erro}',
  'modal.settings.componentsCompileMissing':
    'Esta máquina ainda não compila: a cadeia de compilação ({mb} de download) não foi '
    + 'instalada. Abra Configurações, Componentes, para baixá-la.',
  'modal.settings.componentsCompileMissingTitle': 'Cadeia de compilação ausente',
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

/** Nome e resumo traduzidos, com o catálogo como reserva. */
function nomeDe(c) {
  const k = `componentName.${c.chave}`;
  const v = window.t ? window.t(k) : null;
  return v && v !== k ? v : c.nome;
}

function resumoDe(c) {
  const k = `componentSummary.${c.chave}`;
  const v = window.t ? window.t(k) : null;
  return v && v !== k ? v : c.resumo;
}

function elemento(html) {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild;
}

function escapar(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tamanhoLegivel(mb) {
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

function cartao(c) {
  const selos = [];
  if (c.essencial) {
    selos.push(`<span class="componente-selo essencial">${escapar(tr('modal.settings.componentsAlways'))}</span>`);
  } else if (c.instalado) {
    selos.push(`<span class="componente-selo instalado">${escapar(tr('modal.settings.componentsInstalled'))}</span>`);
  } else {
    selos.push(`<span class="componente-selo ausente">${escapar(tr('modal.settings.componentsMissing'))}</span>`);
  }
  // O que compila e nao esta aqui e assunto urgente, nao recurso a menos.
  if (c.requerParaCompilar && !c.instalado) {
    selos.push(`<span class="componente-selo urgente">${escapar(tr('modal.settings.componentsNeededToCompile'))}</span>`);
  }

  // Sem botao de remover, de proposito. Em laboratorio compartilhado, um
  // clique de um aluno deixaria o proximo sem compilar, e re-baixar 272 MB
  // numa rede de universidade custa a tarde. O IPC de remocao existe no main
  // para um futuro modo de administracao; quem precisar hoje usa Abrir a
  // pasta. Disco parado e mais barato que banda de laboratorio.
  const acao = (c.essencial || c.instalado)
    ? ''
    : `<button class="btn btn-primary" type="button" data-instalar="${escapar(c.chave)}">`
      + `<i class="ph ph-download-simple" aria-hidden="true"></i> ${escapar(tr('modal.settings.componentsDownload'))}</button>`;

  // Instalado mostra o que ocupa; ausente mostra o que vai trafegar, que e o
  // numero que responde "quanto vou esperar".
  const tamanho = c.instalado
    ? tamanhoLegivel(c.tamanhoMB)
    : tr('modal.settings.componentsDownloadOf', { mb: tamanhoLegivel(c.downloadMB) });

  return elemento(`
    <div class="componente${c.requerParaCompilar && !c.instalado ? ' componente-urgente' : ''}" data-chave="${escapar(c.chave)}">
      <div class="componente-texto">
        <div class="componente-titulo">
          <span class="componente-nome">${escapar(nomeDe(c))}</span>
          ${selos.join('\n          ')}
          <span class="componente-tamanho">${escapar(tamanho)}</span>
        </div>
        <p class="componente-resumo">${escapar(resumoDe(c))}</p>
        <div class="componente-progresso" hidden>
          <div class="componente-barra"><span></span></div>
          <span class="componente-linha"></span>
        </div>
      </div>
      <div class="componente-acao">${acao}</div>
    </div>
  `);
}

async function desenhar() {
  const caixa = document.getElementById('componentes-lista');
  if (!caixa) return;

  let dados;
  try { dados = await electronAPI.componentesListar(); }
  catch (e) {
    caixa.innerHTML = `<p class="componentes-erro">${escapar(tr('modal.settings.componentsReadFailed', { erro: e?.message || e }))}</p>`;
    return;
  }

  const lista = dados?.componentes || [];
  caixa.innerHTML = '';
  lista.forEach((c) => caixa.appendChild(cartao(c)));

  const ausentes = lista.filter((c) => !c.instalado && !c.essencial);
  const rodape = document.getElementById('componentes-espaco');
  if (rodape) {
    const soma = ausentes.reduce((s, c) => s + (c.downloadMB || 0), 0);
    rodape.textContent = ausentes.length
      ? tr('modal.settings.componentsAvailable', { n: ausentes.length, mb: tamanhoLegivel(soma) })
      : tr('modal.settings.componentsAllInstalled');
  }

  // Um download já em curso quando o painel abriu continua sendo um download:
  // o painel precisa mostrá-lo, e não oferecer um segundo.
  if (dados?.baixando) marcarBaixando(dados.baixando);
}

function marcarBaixando(chave) {
  baixando = chave;
  const cartaoAlvo = document.querySelector(`.componente[data-chave="${chave}"]`);
  if (!cartaoAlvo) return;
  cartaoAlvo.querySelector('.componente-progresso')?.removeAttribute('hidden');
  cartaoAlvo.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  document.querySelectorAll('[data-instalar]').forEach((b) => { b.disabled = true; });
}

function aplicarProgresso(d) {
  const alvo = document.querySelector(`.componente[data-chave="${d.chave}"]`);
  if (!alvo) return;
  const bloco = alvo.querySelector('.componente-progresso');
  const barra = alvo.querySelector('.componente-barra span');
  const linha = alvo.querySelector('.componente-linha');
  if (!bloco) return;
  bloco.hidden = false;
  if (typeof d.percentual === 'number') barra.style.width = `${d.percentual}%`;
  // Sem percentual, a barra fica como estava em vez de voltar a zero: a
  // extracao no fim do download nao reporta progresso, e zerar ali daria a
  // impressao de que tudo recomecou.
  if (linha) linha.textContent = d.linha || '';
}

async function instalar(chave) {
  if (baixando) {
    showCardNotification(tr('modal.settings.componentsBusy'), 'info', 4000, 'Componentes');
    return;
  }
  marcarBaixando(chave);
  const r = await electronAPI.componentesInstalar(chave)
    .catch((e) => ({ ok: false, erro: e?.message }));
  baixando = null;

  if (r?.ok) showCardNotification(tr('modal.settings.componentsInstalledOk'), 'success', 5000, 'Componentes');
  else showCardNotification(tr('modal.settings.componentsInstallFailed', { erro: r?.erro || '?' }),
    'error', 9000, 'Componentes');
  await desenhar();
}

/**
 * O aviso que chega quando o main barrou alguma coisa por falta de componente.
 *
 * Vem de um canal só porque foi barrado num ponto só, e é por isso que ele
 * cobre igualmente o botão, a API de automação, a Aurora Intelligence e o
 * servidor de linguagem. O diálogo oferece o download na hora: mandar a pessoa
 * procurar sozinha em Configurações depois de já ter clicado no que queria é
 * transformar um obstáculo de um clique em três.
 */
async function aoSerBarrado({ chave, mensagem }) {
  const escolha = await showDialog({
    title: tr('modal.settings.componentsMissingTitle'),
    message: mensagem,
    variant: 'warning',
    buttons: [
      { label: tr('modal.settings.componentsNotNow'), action: 'cancel', type: 'cancel' },
      { label: tr('modal.settings.componentsDownloadNow'), action: 'baixar', type: 'primary' },
    ],
  });
  if (escolha !== 'baixar') return;
  await instalar(chave);
}

/**
 * Aviso de boot: instalação nova ainda não compila.
 *
 * Só quando falta algo que compila. Sem isto, a primeira notícia da cadeia
 * ausente seria o primeiro Compilar falhar, e o primeiro contato de um aluno
 * com o SAPHO seria um erro.
 */
async function avisarSeNaoCompila() {
  try {
    const dados = await electronAPI.componentesListar?.();
    const falta = (dados?.componentes || [])
      .find((c) => c.requerParaCompilar && !c.instalado);
    if (!falta) return;
    showCardNotification(
      tr('modal.settings.componentsCompileMissing', { mb: tamanhoLegivel(falta.downloadMB) }),
      'warning', 12000, tr('modal.settings.componentsCompileMissingTitle'));
  } catch (_) { /* cortesia de boot; o portao continua segurando */ }
}

function ligar() {
  // Este ouvinte não depende do painel estar montado: o bloqueio acontece
  // enquanto a pessoa trabalha, com as configurações fechadas.
  electronAPI.onComponenteAusente?.(aoSerBarrado);

  const caixa = document.getElementById('componentes-lista');
  if (!caixa) return;

  // Delegação: a lista se refaz inteira a cada mudança, e ouvintes presos a
  // cada botão morreriam junto com ela.
  caixa.addEventListener('click', (e) => {
    const alvo = e.target instanceof Element ? e.target.closest('[data-instalar]') : null;
    if (!alvo) return;
    const chave = alvo.getAttribute('data-instalar');
    if (chave) instalar(chave);
  });

  document.getElementById('componentes-abrir-pasta')
    ?.addEventListener('click', () => electronAPI.componentesAbrirPasta?.());

  electronAPI.onComponenteProgresso?.(aplicarProgresso);

  // Redesenha ao entrar na aba, e não só ao abrir as configurações: o usuário
  // pode ter baixado algo, saído e voltado.
  document.querySelector('[data-pane="componentes"].settings-nav-item')
    ?.addEventListener('click', () => { desenhar(); });
}

if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    ligar();
    desenhar();
    avisarSeNaoCompila();
  });
}

export { desenhar, tamanhoLegivel };
