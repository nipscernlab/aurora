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

/** A ultima leitura do catalogo, por chave. */
const catalogo = new Map();

/**
 * O ultimo progresso recebido, por chave.
 *
 * A lista se redesenha inteira ao trocar de aba, e o cartao novo nasce com a
 * barra zerada e escondida. Durante o download os eventos chegam e repovoam
 * em segundos, mas durante a EXTRACAO nao chega nada por minutos, e a barra
 * simplesmente sumia para quem saiu e voltou. Guardar o ultimo evento e
 * reaplicar no redesenho e o que mantem a barra viva.
 */
const ultimoProgresso = new Map();

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
    'Os arquivos de {nome} saem do disco, e o que depende dele para de funcionar. '
    + 'Para ter {nome} de volta é preciso baixar de novo ({mb} de download), e numa '
    + 'rede lenta isso custa tempo.\n\nSeus projetos não são tocados.',
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
    'Esta máquina ainda não compila: falta baixar {nome} ({mb} de download). '
    + 'Sem ele, os botões de compilar e simular não funcionam. Você encontra '
    + 'tudo em Configurações, Componentes.',
  'modal.settings.componentsCompileMissingTitle': 'Cadeia de compilação ausente',
  'modal.settings.componentsDoctor': 'Verificar e consertar',
  'modal.settings.componentsDoctorTitle': 'Verificar os componentes',
  'modal.settings.componentsDoctorBody':
    'A AURORA vai limpar os caches de compilação, conferir os arquivos de cada '
    + 'componente e re-baixar o que estiver incompleto ou quebrado. Componente '
    + 'saudável não é tocado, e componente opcional que você nunca baixou continua '
    + 'de fora.\n\nSe algo estiver quebrado, o conserto pode ser um download grande.',
  'modal.settings.componentsDoctorGo': 'Verificar agora',
  'modal.settings.componentsDoctorHealthy': 'Tudo em ordem: caches limpos e todos os componentes íntegros.',
  'modal.settings.componentsDoctorFixed': 'Verificação concluída: {n} componente(s) consertado(s).',
  'modal.settings.componentsDoctorFailed': 'A verificação não conseguiu consertar: {lista}. Confira a internet e tente de novo.',
  'modal.settings.componentsDoctorNoScripts': 'A pasta de instaladores (components/Scripts) não está nesta máquina, e sem ela o doctor não consegue consertar nada. Reinstale o SAPHO pelo instalador do site.',
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
    // Essencial vem no instalador e nao sai. Um cartao assim nao mostra estado
    // de instalacao nem tamanho de download, porque nao ha decisao a tomar: a
    // tela estava dizendo "sempre instalado" e oferecendo um download ao mesmo
    // tempo, que e contraditorio e nao ajuda ninguem.
    selos.push(`<span class="componente-selo essencial">${escapar(tr('modal.settings.componentsAlways'))}</span>`);
  } else if (c.instalado) {
    selos.push(`<span class="componente-selo instalado">${escapar(tr('modal.settings.componentsInstalled'))}</span>`);
  } else {
    selos.push(`<span class="componente-selo ausente">${escapar(tr('modal.settings.componentsMissing'))}</span>`);
    // O que compila e nao esta aqui e assunto urgente, nao recurso a menos.
    if (c.requerParaCompilar) {
      selos.push(`<span class="componente-selo urgente">${escapar(tr('modal.settings.componentsNeededToCompile'))}</span>`);
    }
  }

  // Remover existe, mas com a cara de acao destrutiva (contorno vermelho, o
  // mesmo desenho do botao de limpar credenciais) e confirmacao que avisa o
  // custo: em laboratorio compartilhado, apagar a cadeia deixa o proximo
  // aluno re-baixando 272 MB.
  const acao = c.essencial
    ? ''
    : c.instalado
      ? `<button class="btn danger" type="button" data-remover="${escapar(c.chave)}">`
        + `<i class="ph ph-trash-simple" aria-hidden="true"></i> ${escapar(tr('modal.settings.componentsRemove'))}</button>`
      : `<button class="btn btn-primary" type="button" data-instalar="${escapar(c.chave)}">`
        + `<i class="ph ph-download-simple" aria-hidden="true"></i> ${escapar(tr('modal.settings.componentsDownload'))}</button>`;

  // Presente mostra o que ocupa em disco; ausente mostra o que vai trafegar,
  // que e o numero que responde "quanto vou esperar". Essencial conta sempre
  // pelo disco: ele nunca sera baixado pelo painel.
  const tamanho = (c.essencial || c.instalado)
    ? tamanhoLegivel(c.tamanhoMB)
    : tr('modal.settings.componentsDownloadOf', { mb: tamanhoLegivel(c.downloadMB) });

  return elemento(`
    <div class="componente${c.requerParaCompilar && !c.instalado && !c.essencial ? ' componente-urgente' : ''}" data-chave="${escapar(c.chave)}">
      <div class="componente-texto">
        <div class="componente-titulo">
          <span class="componente-nome">${escapar(nomeDe(c))}</span>
          <span class="componente-selos">${selos.join('')}</span>
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
  // O catalogo da ultima leitura fica guardado para os dialogos poderem citar
  // nome e tamanho de download sem outra ida ao main.
  lista.forEach((c) => catalogo.set(c.chave, c));
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
  // o painel precisa mostrá-lo, e não oferecer um segundo. O último progresso
  // volta para a barra, senão sair e voltar de aba a zeraria.
  if (dados?.baixando) {
    marcarBaixando(dados.baixando);
    const p = ultimoProgresso.get(dados.baixando);
    if (p) aplicarProgresso(p);
  }
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
  const acabou = d.estado === 'pronto' || d.estado === 'erro';
  if (acabou) ultimoProgresso.delete(d.chave);
  else ultimoProgresso.set(d.chave, d);
  const alvo = document.querySelector(`.componente[data-chave="${d.chave}"]`);
  if (!alvo) return;
  const bloco = alvo.querySelector('.componente-progresso');
  const barra = alvo.querySelector('.componente-barra span');
  const linha = alvo.querySelector('.componente-linha');
  if (!bloco) return;
  // Terminou: a barra sai de cena. O desfecho quem conta e a notificacao e o
  // selo do cartao; uma barra parada em 100% parece download travado. O
  // evento final pode chegar DEPOIS do redesenho, entao esconder aqui e o que
  // impede a barra de reaparecer num cartao ja pronto.
  if (acabou) { bloco.hidden = true; return; }
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
 * Remove um componente, com o preco dito antes.
 *
 * O botao existe porque nem toda maquina e de laboratorio: em casa, 955 MB
 * parados sao da pessoa. A protecao contra o clique errado nao e esconder o
 * botao, e a confirmacao dizer exatamente o que se perde e quanto custa
 * voltar atras.
 */
async function remover(chave) {
  const c = catalogo.get(chave);
  const nome = c ? nomeDe(c) : chave;
  const escolha = await showDialog({
    title: tr('modal.settings.componentsRemoveTitle', { nome }),
    message: tr('modal.settings.componentsRemoveBody',
      { nome, mb: tamanhoLegivel(c?.downloadMB || 0) }),
    variant: 'warning',
    buttons: [
      { label: tr('modal.settings.componentsCancel'), action: 'cancel', type: 'cancel' },
      { label: tr('modal.settings.componentsRemoveConfirm'), action: 'remover', type: 'danger' },
    ],
  });
  if (escolha !== 'remover') return;

  const r = await electronAPI.componentesRemover(chave)
    .catch((e) => ({ ok: false, erro: e?.message }));
  if (r?.ok) {
    showCardNotification(
      tr('modal.settings.componentsRemoved', { nome, mb: tamanhoLegivel(r.liberadoMB || 0) }),
      'success', 5000, 'Componentes');
  } else {
    showCardNotification(tr('modal.settings.componentsRemoveFailed', { erro: r?.erro || '?' }),
      'error', 8000, 'Componentes');
  }
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
    (dados?.componentes || []).forEach((c) => catalogo.set(c.chave, c));
    const falta = (dados?.componentes || [])
      .find((c) => c.requerParaCompilar && !c.instalado);
    if (!falta) return;
    // Dialogo, e nao toast: um aviso que some sozinho em segundos e um aviso
    // que da para nao ver, e sem este componente a maquina nao compila NADA.
    // Reaparece a cada boot ate o download acontecer, de proposito.
    const escolha = await showDialog({
      title: tr('modal.settings.componentsCompileMissingTitle'),
      message: tr('modal.settings.componentsCompileMissing',
        { nome: nomeDe(falta), mb: tamanhoLegivel(falta.downloadMB) }),
      variant: 'warning',
      buttons: [
        { label: tr('modal.settings.componentsNotNow'), action: 'cancel', type: 'cancel' },
        { label: tr('modal.settings.componentsDownloadNow'), action: 'baixar', type: 'primary' },
      ],
    });
    if (escolha !== 'baixar') return;
    // Abre o painel antes de baixar, para a barra de progresso ter onde
    // aparecer e a pessoa ver que algo esta acontecendo.
    window.auroraAbrirConfiguracoes?.('componentes');
    await instalar(falta.chave);
  } catch (_) { /* cortesia de boot; o portao continua segurando */ }
}

/**
 * O doctor: verifica tudo e conserta o que estiver quebrado.
 *
 * A confirmação diz o que ele vai fazer ANTES, porque o conserto pode custar
 * um download grande, e ninguém deve entrar num download de 272 MB por ter
 * clicado num botão que parecia só verificar.
 */
async function rodarDoctor() {
  if (baixando) {
    showCardNotification(tr('modal.settings.componentsBusy'), 'info', 4000, 'Componentes');
    return;
  }
  const escolha = await showDialog({
    title: tr('modal.settings.componentsDoctorTitle'),
    message: tr('modal.settings.componentsDoctorBody'),
    variant: 'info',
    buttons: [
      { label: tr('modal.settings.componentsCancel'), action: 'cancel', type: 'cancel' },
      { label: tr('modal.settings.componentsDoctorGo'), action: 'rodar', type: 'primary' },
    ],
  });
  if (escolha !== 'rodar') return;

  const botao = document.getElementById('componentes-doctor');
  if (botao) botao.disabled = true;
  const r = await electronAPI.componentesDoctor?.()
    .catch((e) => ({ ok: false, falharam: [], erro: e?.message }));
  if (botao) botao.disabled = false;

  if (r?.erro === 'ja-ha-download') {
    showCardNotification(tr('modal.settings.componentsBusy'), 'info', 4000, 'Componentes');
    return;
  }
  if (r?.erro === 'sem-scripts') {
    showCardNotification(
      tr('modal.settings.componentsDoctorNoScripts'), 'error', 12000, 'Componentes');
    return;
  }

  const consertados = r?.consertados?.length || 0;
  if (r?.ok && consertados === 0) {
    showCardNotification(tr('modal.settings.componentsDoctorHealthy'), 'success', 6000, 'Componentes');
  } else if (r?.ok) {
    showCardNotification(
      tr('modal.settings.componentsDoctorFixed', { n: consertados }), 'success', 8000, 'Componentes');
  } else {
    showCardNotification(
      tr('modal.settings.componentsDoctorFailed', { lista: (r?.falharam || []).join(', ') || '?' }),
      'error', 10000, 'Componentes');
  }
  await desenhar();
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
    const alvo = e.target instanceof Element ? e.target.closest('[data-instalar], [data-remover]') : null;
    if (!alvo) return;
    const paraInstalar = alvo.getAttribute('data-instalar');
    if (paraInstalar) { instalar(paraInstalar); return; }
    const paraRemover = alvo.getAttribute('data-remover');
    if (paraRemover) remover(paraRemover);
  });

  document.getElementById('componentes-abrir-pasta')
    ?.addEventListener('click', () => electronAPI.componentesAbrirPasta?.());

  document.getElementById('componentes-doctor')
    ?.addEventListener('click', () => rodarDoctor());

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
