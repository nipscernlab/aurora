/**
 * network_watch.js: avisa quando a internet cai.
 *
 * A AURORA compila e simula sem rede: o toolchain inteiro é local. Mas o
 * updater, o manual online, os provedores de IA e o painel de git dependem
 * dela, e quando ela some esses falham cada um do seu jeito, com mensagem
 * própria e no seu tempo. O aviso aqui existe para o usuário saber a causa
 * comum antes de topar com quatro sintomas separados.
 *
 * COMO A QUEDA É DETECTADA, E POR QUE NÃO BASTA UM SINAL
 * ------------------------------------------------------
 * A primeira versão ouvia só o evento `offline` do navegador, e não funcionava
 * no caso mais comum. Aquele evento reflete `navigator.onLine`, que diz apenas
 * se existe interface de rede ativa, não se existe internet: um cabo ligado num
 * roteador sem uplink continua "online" para o Chromium, e o evento nunca
 * dispara. Testar puxando o cabo da parede não acusava nada.
 *
 * Então há dois gatilhos:
 *
 *   O evento `offline`, que é de graça e cobre o caso óbvio, adaptador caído.
 *
 *   Uma falha de rede relatada por quem de fato usou a rede. Quando o updater,
 *   o manual ou o painel de git levam um erro de DNS ou de conexão, chamam
 *   `reportarFalhaDeRede`. Isso não custa tráfego nenhum, porque a requisição
 *   que falhou já ia acontecer, e acerta justamente o caso que o evento erra.
 *
 * Antes de avisar, uma checagem única confirma. Um `fetch` que falhou pode ser
 * o servidor daquele serviço estando fora, e anunciar "a internet caiu" nesse
 * caso seria mentir. A confirmação é uma requisição só, no momento da suspeita,
 * e não uma sondagem periódica: tráfego de fundo repetido numa máquina de
 * laboratório, para confirmar algo que o próximo uso real já confirmaria, é
 * custo sem retorno.
 */

import { showCardNotification } from './notification.js';

export const CHAVE_AVISO = 'aurora-network-warning-enabled';

/** Erros que indicam rede, e não um serviço específico fora do ar. */
const PADROES_DE_REDE = [
  'err_internet_disconnected', 'err_name_not_resolved', 'err_address_unreachable',
  'err_network_changed', 'err_connection_reset', 'err_connection_refused',
  'err_connection_timed_out', 'err_proxy_connection_failed',
  'enotfound', 'eai_again', 'econnrefused', 'econnreset', 'etimedout',
  'enetunreach', 'ehostunreach', 'getaddrinfo',
  'failed to fetch', 'networkerror', 'network error',
];

/** O aviso está ligado? Padrão ligado; só sai desligado se o usuário desligar. */
export function avisoLigado() {
  try { return localStorage.getItem(CHAVE_AVISO) !== '0'; }
  catch (_) { return true; }
}

export function definirAviso(ligado) {
  try { localStorage.setItem(CHAVE_AVISO, ligado ? '1' : '0'); }
  catch (_) { /* modo privado, sem persistência */ }
}

/** O erro tem cara de rede? Exportado porque é a regra que decide tudo aqui. */
function pareceErroDeRede(erro) {
  if (!erro) return false;
  const t = String(erro.message || erro.code || erro).toLowerCase();
  return PADROES_DE_REDE.some((p) => t.includes(p));
}

const tr = (k, fb) => {
  const v = window.t ? window.t(k) : null;
  return v && v !== k ? v : fb;
};

/** Já há um aviso na tela? Evita empilhar cartão a cada serviço que falha. */
let avisoNaTela = false;
/** Uma confirmação em curso? Duas falhas juntas não pedem duas checagens. */
let confirmando = false;

function mostrar() {
  if (avisoNaTela) return;
  avisoNaTela = true;
  showCardNotification(
    tr('network.offlineMessage',
      'A conexão com a internet caiu. Compilar e simular continuam funcionando, '
      + 'porque o toolchain é local; atualizações, manual online, IA e git ficam '
      + 'indisponíveis até a rede voltar.'),
    'warning',
    0,                                   // pegajoso: sai no clique do usuário
    tr('network.offlineTitle', 'Sem internet'),
  );
  // A trava solta quando a rede volta, para a próxima queda avisar de novo.
  // Rede que oscila é informação diferente de rede que caiu, e calar a segunda
  // queda esconderia exatamente isso.
  const soltar = () => { avisoNaTela = false; window.removeEventListener('online', soltar); };
  window.addEventListener('online', soltar);
}

/**
 * Confirma que é a internet, e não o serviço.
 *
 * Uma requisição, sem cache, com prazo curto. `no-cors` porque não lemos a
 * resposta: só interessa se a conexão se estabeleceu.
 */
async function confirmarQueda() {
  const alvos = [
    'https://www.gstatic.com/generate_204',
    'https://www.cloudflare.com/cdn-cgi/trace',
  ];
  for (const url of alvos) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      return false;      // alcançou alguém: a internet está de pé
    } catch (_) { /* tenta o próximo */ }
  }
  return true;
}

/**
 * Chamado por quem levou um erro ao usar a rede.
 *
 * @param {unknown} erro o erro recebido; só age se parecer de rede
 * @param {string} [origem] quem relatou, para o log
 */
async function reportarFalhaDeRede(erro, origem = '?') {
  if (!avisoLigado() || avisoNaTela || confirmando) return;
  if (!pareceErroDeRede(erro)) return;
  confirmando = true;
  try {
    if (await confirmarQueda()) {
      console.warn(`[rede] queda confirmada (relatado por ${origem})`);
      mostrar();
    }
  } finally {
    confirmando = false;
  }
}

/** Queda óbvia: o adaptador caiu. Não precisa de confirmação. */
function aoFicarOffline() {
  if (!avisoLigado()) return;
  mostrar();
}

function initNetworkWatch() {
  if (typeof window === 'undefined') return;
  // Só a transição interessa. Abrir o aplicativo já sem rede não é uma queda, e
  // avisar no arranque competiria com o que o usuário abriu a AURORA para fazer.
  window.addEventListener('offline', aoFicarOffline);

  // Rede que falha dentro de uma promessa que ninguém pegou é justamente o
  // sintoma de um `fetch` de serviço que morreu sem tratamento. Aproveitamos o
  // sinal em vez de exigir que cada chamador se lembre de relatar.
  window.addEventListener('unhandledrejection', (e) => {
    reportarFalhaDeRede(e?.reason, 'promessa nao tratada');
  });

  // Ponto de entrada para o resto da aplicação, sem precisar importar daqui.
  window.auroraReportarFalhaDeRede = reportarFalhaDeRede;
}

if (typeof window !== 'undefined') {
  initNetworkWatch();
}
