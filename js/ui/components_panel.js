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
 */

import { electronAPI } from '../app/electron_api.js';
import { showDialog } from './dialog_manager.js';
import { showCardNotification } from './notification.js';

let baixando = null;

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
  const estado = c.essencial
    ? '<span class="componente-selo essencial">Sempre instalado</span>'
    : c.instalado
      ? '<span class="componente-selo instalado">Instalado</span>'
      : '<span class="componente-selo ausente">Não instalado</span>';

  const acao = c.essencial
    ? ''
    : c.instalado
      ? `<button class="btn" type="button" data-remover="${escapar(c.chave)}">Remover</button>`
      : `<button class="btn btn-primary" type="button" data-instalar="${escapar(c.chave)}">Baixar</button>`;

  return elemento(`
    <div class="componente" data-chave="${escapar(c.chave)}">
      <div class="componente-texto">
        <div class="componente-titulo">
          <span class="componente-nome">${escapar(c.nome)}</span>
          ${estado}
          <span class="componente-tamanho">${tamanhoLegivel(c.tamanhoMB)}</span>
        </div>
        <p class="componente-resumo">${escapar(c.resumo)}</p>
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
    caixa.innerHTML = `<p class="componentes-erro">Não foi possível ler os componentes: ${escapar(e?.message || e)}</p>`;
    return;
  }

  const lista = dados?.componentes || [];
  caixa.innerHTML = '';
  lista.forEach((c) => caixa.appendChild(cartao(c)));

  const ausentes = lista.filter((c) => !c.instalado && !c.essencial);
  const rodape = document.getElementById('componentes-espaco');
  if (rodape) {
    const soma = ausentes.reduce((s, c) => s + c.tamanhoMB, 0);
    rodape.textContent = ausentes.length
      ? `${ausentes.length} disponíveis para baixar, ${tamanhoLegivel(soma)} no total.`
      : 'Tudo instalado.';
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
    showCardNotification('Já há um download em andamento.', 'info', 4000, 'Componentes');
    return;
  }
  marcarBaixando(chave);
  const r = await electronAPI.componentesInstalar(chave)
    .catch((e) => ({ ok: false, erro: e?.message }));
  baixando = null;

  if (r?.ok) showCardNotification('Componente instalado.', 'success', 5000, 'Componentes');
  else showCardNotification(`Não foi possível baixar: ${r?.erro || 'erro desconhecido'}`,
    'error', 9000, 'Componentes');
  await desenhar();
}

async function remover(chave) {
  const alvo = document.querySelector(`.componente[data-chave="${chave}"] .componente-nome`);
  const nome = alvo?.textContent || chave;
  const escolha = await showDialog({
    title: `Remover ${nome}`,
    message:
      `Os arquivos de ${nome} saem do disco. O que depende dele para de funcionar `
      + 'até você baixar de novo, e a AURORA vai avisar quando isso acontecer.\n\n'
      + 'Seus projetos não são tocados.',
    variant: 'warning',
    buttons: [
      { label: 'Cancelar', action: 'cancel', type: 'cancel' },
      { label: 'Remover', action: 'remover', type: 'danger' },
    ],
  });
  if (escolha !== 'remover') return;

  const r = await electronAPI.componentesRemover(chave)
    .catch((e) => ({ ok: false, erro: e?.message }));
  if (r?.ok) {
    showCardNotification(`${nome} removido, ${tamanhoLegivel(r.liberadoMB || 0)} livres.`,
      'success', 5000, 'Componentes');
  } else {
    showCardNotification(`Não foi possível remover: ${r?.erro || 'erro desconhecido'}`,
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
    title: 'Componente não instalado',
    message: mensagem,
    variant: 'warning',
    buttons: [
      { label: 'Agora não', action: 'cancel', type: 'cancel' },
      { label: 'Baixar agora', action: 'baixar', type: 'primary' },
    ],
  });
  if (escolha !== 'baixar') return;
  await instalar(chave);
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
  });
}

export { desenhar, tamanhoLegivel };
