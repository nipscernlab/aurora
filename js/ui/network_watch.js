/**
 * network_watch.js — avisa quando a internet cai.
 *
 * A AURORA compila e simula sem rede: o toolchain inteiro é local. Mas o
 * updater, o manual online, os provedores de IA e o painel de git dependem
 * dela, e quando ela some esses falham cada um do seu jeito, com mensagem
 * própria e no seu tempo. O aviso aqui existe para o usuário saber a causa
 * comum antes de topar com quatro sintomas separados.
 *
 * O aviso é pegajoso, sem fechar sozinho: ficar oito segundos na tela e sumir
 * transformaria "a rede caiu" em algo que se perde ao olhar para o lado. Quem
 * decide quando o aviso sai é o usuário, clicando.
 *
 * Avisa a cada queda, e não uma vez por sessão. Uma rede que oscila é uma
 * informação diferente de uma rede que caiu, e silenciar a segunda queda
 * esconderia justamente isso. Quem se incomodar desliga nas configurações, que
 * é a saída honesta para um aviso repetido.
 *
 * `navigator.onLine` diz apenas se há interface de rede ativa, não se há
 * internet: um cabo ligado num roteador sem uplink continua "online". É o que o
 * navegador oferece de graça, e resolve o caso comum (Wi-Fi caiu, cabo saiu).
 * Não sondamos servidor externo de propósito, porque isso é tráfego periódico
 * de fundo numa máquina de laboratório, para confirmar algo que o próximo uso
 * real da rede já confirmaria.
 */

import { showCardNotification } from './notification.js';

export const CHAVE_AVISO = 'aurora-network-warning-enabled';

/** O aviso está ligado? Padrão ligado; só sai desligado se o usuário desligar. */
export function avisoLigado() {
  try { return localStorage.getItem(CHAVE_AVISO) !== '0'; }
  catch (_) { return true; }
}

export function definirAviso(ligado) {
  try { localStorage.setItem(CHAVE_AVISO, ligado ? '1' : '0'); }
  catch (_) { /* modo privado, sem persistência */ }
}

const tr = (k, fb) => {
  const v = window.t ? window.t(k) : null;
  return v && v !== k ? v : fb;
};

function avisarQueda() {
  if (!avisoLigado()) return;
  showCardNotification(
    tr('network.offlineMessage',
      'A conexão com a internet caiu. Compilar e simular continuam funcionando, '
      + 'porque o toolchain é local; atualizações, manual online, IA e git ficam '
      + 'indisponíveis até a rede voltar.'),
    'warning',
    0,                                   // pegajoso: sai no clique do usuário
    tr('network.offlineTitle', 'Sem internet'),
  );
}

export function initNetworkWatch() {
  if (typeof window === 'undefined') return;
  // Só a transição interessa. Abrir o aplicativo já sem rede não é uma queda, e
  // avisar no arranque competiria com o que o usuário abriu a AURORA para fazer.
  window.addEventListener('offline', avisarQueda);
}

if (typeof window !== 'undefined') {
  initNetworkWatch();
}
