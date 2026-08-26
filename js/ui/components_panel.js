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
  'modal.settings.componentsUpdate': 'Atualizar',
  'modal.settings.componentsUpdatesAvailable': '{n} com atualização disponível ({mb} de download).',
  'modal.settings.componentsAlways': 'Vem no instalador',
  'modal.settings.componentsNeededToCompile': 'Necessário para compilar',
  'modal.settings.componentsSelectOne': 'Selecionar {nome} para baixar em lote',
  'modal.settings.componentsQueueSummary': '{n} selecionados, {mb} no total.',
  'modal.settings.componentsQueueGo': 'Baixar selecionados',
  'modal.settings.componentsQueueClear': 'Limpar seleção',
  'modal.settings.componentsQueueDone': '{n} componente(s) instalado(s).',
  'modal.settings.componentsQueuePartial': '{ok} de {total} instalados. Não entraram: {lista}. Marque de novo para tentar só esses.',
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
  // As aspas tambem, porque o resultado entra em atributos (`src`, `data-*`)
  // e nao so em texto: uma aspa no valor fecharia o atributo no meio.
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function tamanhoLegivel(mb) {
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

/**
 * Quais selos um componente merece. Pura, exportada e testada
 * (tests/unit/componentSelos.test.js), porque a regra abaixo é fácil de
 * quebrar sem ninguém notar: os estados que ela separa quase nunca aparecem
 * todos na mesma máquina, e numa máquina com tudo instalado a interface fica
 * igual esteja a regra certa ou errada.
 *
 * A REGRA: um selo só existe se disser o que o resto do cartão não diz. Eram
 * cinco, e três não passavam nesse teste.
 *
 *   "Instalado" ficava ao lado de um botão Remover. Remover só aparece no que
 *   está instalado, então o selo repetia o botão.
 *   "Não instalado" ficava ao lado de um botão Baixar E de um tamanho escrito
 *   "download de 12 MB". Dois sinais já diziam a mesma coisa.
 *   "Atualização disponível" ficava ao lado de um botão Atualizar, e a
 *   contagem no topo do painel já anuncia quantos têm atualização.
 *
 * Sobraram os dois que carregam informação própria. O do essencial explica por
 * que aquele cartão NÃO tem botão nenhum, que sem ele parece cartão quebrado.
 * O de "necessário para compilar" é o único com urgência: sem ele, um
 * componente que impede o aluno de compilar fica com a mesma cara de um
 * opcional que ele nunca vai querer.
 *
 * O efeito colateral é o que se queria: como quase todo cartão fica sem selo,
 * o único que tem um passa a saltar aos olhos.
 *
 * @param {{essencial?:boolean, instalado?:boolean, estado?:string, requerParaCompilar?:boolean}} c
 * @returns {Array<'essencial'|'urgente'>}
 */
/**
 * Acende ou apaga o ponto de aviso na engrenagem da toolbar.
 *
 * Existe porque o aviso de boot é um DIÁLOGO, e diálogo se fecha: quem clica
 * "Agora não" fica com uma máquina que não compila e nenhum sinal na tela até
 * o próximo boot. O ponto fica, e é o mesmo desenho do aviso do PyLibs ao
 * lado, que o usuário já sabe ler.
 *
 * Só acende para o que impede de compilar. Componente opcional ausente é
 * escolha, não defeito, e um ponto permanente por causa dele seria um aviso
 * que ninguém pode desligar.
 */
function marcarFaltaNaToolbar(lista) {
  const ponto = document.getElementById('settings-badge');
  if (!ponto) return;
  const falta = (lista || []).some((c) => c.requerParaCompilar && !c.instalado);
  ponto.hidden = !falta;
}

export function selosDe(c) {
  if (!c) return [];
  if (c.essencial) return ['essencial'];
  const desatualizado = c.estado === 'desatualizado';
  if (!c.instalado && !desatualizado && c.requerParaCompilar) return ['urgente'];
  return [];
}

/**
 * Este componente pode entrar numa fila de download?
 *
 * A regra é exatamente "o cartão dele tem botão Baixar ou Atualizar", e está
 * escrita aqui em vez de deduzida do DOM para não sair de sincronia com a
 * montagem do cartão. Essencial em dia não entra porque não tem botão nenhum:
 * ele vem no instalador e não sai. Essencial DESATUALIZADO entra, porque
 * atualizar é a única coisa que se faz com ele.
 *
 * @param {{essencial?:boolean, instalado?:boolean, estado?:string}} c
 */
export function selecionavel(c) {
  if (!c) return false;
  if (c.estado === 'desatualizado') return true;
  return !c.essencial && !c.instalado;
}

/**
 * O que a fila responde no fim.
 *
 * Separado do laço de propósito: a mensagem é o único registro que sobra
 * depois de uma fila longa, e é o que a pessoa lê para saber se pode fechar a
 * janela. Uma fila de sete itens onde o quinto falhou não pode terminar com um
 * "pronto" genérico.
 *
 * @param {Array<{nome:string, ok:boolean}>} resultados
 * @returns {{tudoBem:boolean, instalados:number, total:number, falharam:string[]}}
 */
export function resumoDaFila(resultados) {
  const lista = resultados || [];
  const falharam = lista.filter((r) => !r.ok).map((r) => r.nome);
  return {
    tudoBem: falharam.length === 0,
    instalados: lista.length - falharam.length,
    total: lista.length,
    falharam,
  };
}

/** Texto de cada selo, na ordem em que `selosDe` os devolve. */
const TEXTO_DO_SELO = {
  essencial: 'modal.settings.componentsAlways',
  urgente: 'modal.settings.componentsNeededToCompile',
};

/**
 * Onde cada selo mora, e são lugares diferentes porque os papéis são
 * diferentes.
 *
 * O do essencial existe para explicar por que aquele cartão NÃO tem botão,
 * então ele vai para a coluna da AÇÃO, ocupando exatamente o lugar onde o
 * Remover ou o Baixar apareceriam nos outros. Ali ele é lido como "aqui não há
 * o que fazer, e este é o motivo", que é o recado. Ao lado do nome, em cápsula
 * de caixa alta, ele virava o elemento mais forte da tela para dizer a coisa
 * mais mansa dela.
 *
 * O de urgência é o contrário: é alerta, fica junto do nome e continua
 * chamando atenção.
 *
 * O selo da ação só sai quando NÃO há botão, e a condição é essa mesma, não
 * "é essencial": um essencial DESATUALIZADO tem botão Atualizar, e ali o selo
 * apareceria ao lado dele dizendo que não há o que fazer, contradizendo o
 * botão que está logo à esquerda.
 */
const LUGAR_DO_SELO = { essencial: 'acao', urgente: 'nome' };

function cartao(c) {
  const marcar = (tipo) => (
    `<span class="componente-selo ${tipo}">${escapar(tr(TEXTO_DO_SELO[tipo]))}</span>`
  );
  const tipos = selosDe(c);
  const selos = tipos.filter((t) => LUGAR_DO_SELO[t] === 'nome').map(marcar);
  const seloDaAcao = tipos.filter((t) => LUGAR_DO_SELO[t] === 'acao').map(marcar).join('');
  // Instalado, inteiro, mas de outra versao: a sentinela esta la, e e por isso
  // que so o carimbo do instalador enxerga. E o unico estado em que o cartao
  // oferece baixar E remover ao mesmo tempo, porque a pessoa tem o componente
  // e a AURORA instalada espera outro.
  const desatualizado = c.estado === 'desatualizado';

  // Remover existe, mas com a cara de acao destrutiva (contorno vermelho, o
  // mesmo desenho do botao de limpar credenciais) e confirmacao que avisa o
  // custo: em laboratorio compartilhado, apagar a cadeia deixa o proximo
  // aluno re-baixando 272 MB.
  const botaoRemover = `<button class="btn danger" type="button" data-remover="${escapar(c.chave)}">`
    + `<i class="ph ph-trash-simple" aria-hidden="true"></i> ${escapar(tr('modal.settings.componentsRemove'))}</button>`;
  const botaoBaixar = `<button class="btn btn-primary" type="button" data-instalar="${escapar(c.chave)}">`
    + `<i class="ph ph-download-simple" aria-hidden="true"></i> ${escapar(tr('modal.settings.componentsDownload'))}</button>`;
  // Atualizar e um download com --force: sem a flag o instalador veria a
  // sentinela da versao antiga e sairia dizendo que esta tudo la.
  const botaoAtualizar = `<button class="btn btn-primary" type="button" data-instalar="${escapar(c.chave)}" data-forcar="1">`
    + `<i class="ph ph-arrow-circle-up" aria-hidden="true"></i> ${escapar(tr('modal.settings.componentsUpdate'))}</button>`;
  const acao = desatualizado
    ? botaoAtualizar + (c.essencial ? '' : botaoRemover)
    : c.essencial
      ? ''
      : c.instalado ? botaoRemover : botaoBaixar;

  // Presente mostra o que ocupa em disco; ausente (ou por atualizar) mostra o
  // que vai trafegar, que e o numero que responde "quanto vou esperar".
  // Essencial conta sempre pelo disco: ele nunca sera baixado pelo painel.
  const tamanho = (c.essencial || c.instalado) && !desatualizado
    ? tamanhoLegivel(c.tamanhoMB)
    : tr('modal.settings.componentsDownloadOf', { mb: tamanhoLegivel(c.downloadMB) });

  // Coluna propria e de tamanho fixo para o icone. Todo componente declara
  // a sua marca em assets/icons, e o teste de icones garante que o arquivo
  // existe; nao ha reserva, porque um componente sem marca e um componente
  // mal cadastrado, e o teste acusa antes de chegar ao painel. O que alinha a
  // lista e o quadro, nao a arte. Sem `loading="lazy"`: sao nove imagens
  // locais de poucos KB numa lista curta, e a lista e montada com o painel
  // fechado, onde uma imagem preguicosa nao tem caixa e so e buscada ao abrir
  // a aba, um quadro depois do texto. O que o lazy evitaria (banda em pagina
  // longa) nao existe aqui.
  const marca = `<img src="./assets/icons/${escapar(c.icone)}" alt="" decoding="async">`;

  // A caixa de selecao so existe onde ha o que baixar. Num cartao ja em dia ela
  // seria uma caixa que nao faz nada, e a pessoa marcaria esperando alguma
  // coisa. O rotulo acessivel cita o nome, senao um leitor de tela anuncia sete
  // caixas identicas.
  const caixa = selecionavel(c)
    ? `<input type="checkbox" class="componente-marcar" data-marcar="${escapar(c.chave)}"`
      + ` aria-label="${escapar(tr('modal.settings.componentsSelectOne', { nome: nomeDe(c) }))}">`
    : '';

  return elemento(`
    <div class="componente${c.requerParaCompilar && !c.instalado && !c.essencial ? ' componente-urgente' : ''}" data-chave="${escapar(c.chave)}">
      <div class="componente-marca">${marca}</div>
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
      <div class="componente-acao">${caixa}${acao}${acao ? '' : seloDaAcao}</div>
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

  marcarFaltaNaToolbar(lista);
  // A lista acabou de ser refeita, entao nenhuma caixa esta marcada; a barra
  // some junto, senao ficaria falando de uma selecao que nao existe mais.
  atualizarBarraDaFila();

  const ausentes = lista.filter((c) => !c.instalado && !c.essencial);
  const desatualizados = lista.filter((c) => c.estado === 'desatualizado');
  const rodape = document.getElementById('componentes-espaco');
  if (rodape) {
    const somaMB = (xs) => tamanhoLegivel(xs.reduce((s, c) => s + (c.downloadMB || 0), 0));
    const frases = [];
    if (ausentes.length) {
      frases.push(tr('modal.settings.componentsAvailable', { n: ausentes.length, mb: somaMB(ausentes) }));
    }
    if (desatualizados.length) {
      frases.push(tr('modal.settings.componentsUpdatesAvailable', { n: desatualizados.length, mb: somaMB(desatualizados) }));
    }
    rodape.textContent = frases.length ? frases.join(' ') : tr('modal.settings.componentsAllInstalled');
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

/** As chaves marcadas agora, na ordem em que aparecem na lista. */
function marcados() {
  return [...document.querySelectorAll('.componente-marcar:checked')]
    .map((e) => e.getAttribute('data-marcar'))
    .filter(Boolean);
}

/**
 * Mostra (ou esconde) a barra da fila conforme o que está marcado, com a conta
 * do download somado. A soma é a informação que decide: baixar quatro coisas
 * numa rede de laboratório é uma decisão diferente de baixar uma.
 */
function atualizarBarraDaFila() {
  const barra = document.getElementById('componentes-fila');
  if (!barra) return;
  const chaves = marcados();
  barra.hidden = chaves.length === 0;
  const resumo = document.getElementById('componentes-fila-resumo');
  if (!resumo) return;
  const somaMB = chaves.reduce((s, k) => s + (catalogo.get(k)?.downloadMB || 0), 0);
  resumo.textContent = tr('modal.settings.componentsQueueSummary', {
    n: chaves.length, mb: tamanhoLegivel(somaMB),
  });
}

/**
 * Baixa a fila inteira, um de cada vez.
 *
 * UM DE CADA VEZ, e não em paralelo: são downloads de dezenas a centenas de
 * megabytes que terminam extraindo milhares de arquivos, e o gargalo é a rede
 * do laboratório e o disco, não a espera. Em paralelo, quatro barras andam
 * juntas e todas terminam mais tarde do que teriam terminado em sequência.
 *
 * NÃO PARA NO PRIMEIRO ERRO. Quem marcou quatro componentes e foi tomar café
 * espera encontrar o que deu para instalar, não a fila interrompida no
 * segundo. O que falhou é dito no fim, pelo nome, para a pessoa saber o que
 * repetir.
 */
async function baixarFila() {
  if (baixando) {
    showCardNotification(tr('modal.settings.componentsBusy'), 'info', 4000, 'Componentes');
    return;
  }
  const chaves = marcados();
  if (!chaves.length) return;

  const botao = document.getElementById('componentes-fila-baixar');
  if (botao) botao.disabled = true;

  const resultados = [];
  for (const chave of chaves) {
    const c = catalogo.get(chave);
    marcarBaixando(chave);
    // `forcar` para quem está desatualizado: sem a flag o instalador vê a
    // sentinela da versão antiga e sai dizendo que está tudo lá.
    const r = await electronAPI.componentesInstalar(chave, { forcar: c?.estado === 'desatualizado' })
      .catch((e) => ({ ok: false, erro: e?.message }));
    baixando = null;
    resultados.push({ nome: c ? nomeDe(c) : chave, ok: Boolean(r?.ok) });
  }

  if (botao) botao.disabled = false;

  const resumo = resumoDaFila(resultados);
  if (resumo.tudoBem) {
    showCardNotification(
      tr('modal.settings.componentsQueueDone', { n: resumo.instalados }),
      'success', 6000, 'Componentes',
    );
  } else {
    showCardNotification(
      tr('modal.settings.componentsQueuePartial', {
        ok: resumo.instalados, total: resumo.total, lista: resumo.falharam.join(', '),
      }),
      'error', 12000, 'Componentes',
    );
  }
  // Redesenha depois da fila inteira, e não a cada item: cada `desenhar`
  // refaz a lista e apagaria as marcas dos que ainda não foram baixados.
  await desenhar();
}

async function instalar(chave, forcar = false) {
  if (baixando) {
    showCardNotification(tr('modal.settings.componentsBusy'), 'info', 4000, 'Componentes');
    return;
  }
  marcarBaixando(chave);
  const r = await electronAPI.componentesInstalar(chave, { forcar: Boolean(forcar) })
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
    // Sob automacao o aviso nao aparece. Ele e um modal, e um modal que nasce
    // sozinho no boot rouba os cliques de quem estiver dirigindo a janela: foi
    // exatamente assim que ele derrubou a suite e2e inteira, que roda num
    // runner onde nenhum componente foi baixado. Quem decide e o main, que e
    // quem enxerga o ambiente.
    // O ponto acende ANTES do portao do aviso: quem esta sob automacao, ou
    // quem ja disse "Agora nao" antes, continua precisando ver que falta algo.
    marcarFaltaNaToolbar(dados?.componentes || []);
    if (dados?.avisoDeBootPermitido === false) return;
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
    // A caixa de selecao passa pelo mesmo ouvinte: a lista se refaz inteira a
    // cada mudanca, e um ouvinte por caixa morreria junto com ela.
    if (e.target instanceof Element && e.target.matches('[data-marcar]')) {
      atualizarBarraDaFila();
      return;
    }
    const alvo = e.target instanceof Element ? e.target.closest('[data-instalar], [data-remover]') : null;
    if (!alvo) return;
    const paraInstalar = alvo.getAttribute('data-instalar');
    if (paraInstalar) { instalar(paraInstalar, alvo.hasAttribute('data-forcar')); return; }
    const paraRemover = alvo.getAttribute('data-remover');
    if (paraRemover) remover(paraRemover);
  });

  document.getElementById('componentes-fila-baixar')
    ?.addEventListener('click', () => baixarFila());

  document.getElementById('componentes-fila-limpar')
    ?.addEventListener('click', () => {
      document.querySelectorAll('.componente-marcar:checked').forEach((e) => { e.checked = false; });
      atualizarBarraDaFila();
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

// `ligar` sai daqui para o teste poder prender os ouvintes DEPOIS de montar o
// DOM: no aplicativo quem chama e o DOMContentLoaded acima, uma vez so.
export { desenhar, ligar };
