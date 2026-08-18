/**
 * github_forget.js: o botão que apaga a conta GitHub desta máquina.
 *
 * A limpeza mesmo é do processo principal (main/ipc/github_forget.js), que é
 * quem alcança o Gerenciador de Credenciais do Windows. Aqui fica só a
 * confirmação e o relatório.
 *
 * A confirmação é obrigatória e nomeia o que sai. Uma ação destrutiva que se
 * explica depois de acontecer não deu escolha nenhuma a ninguém, e nesta o
 * usuário pode estar apagando o acesso da própria conta no meio de uma entrega.
 *
 * O relatório mostra passo a passo o que foi removido. Numa limpeza de
 * segurança, "pronto" não serve: quem está deixando o computador precisa poder
 * conferir que o que importava saiu, e ver qual passo falhou se algum falhou.
 */

import { electronAPI } from '../app/electron_api.js';
import { showDialog } from './dialog_manager.js';
import { showCardNotification } from './notification.js';

const ROTULOS = {
  'cofre-aurora': 'Acesso salvo pela AURORA',
  'git-credential-reject': 'Credencial pedida ao git',
  'arquivo-git-credentials': 'Arquivo .git-credentials',
  'gerenciador-windows': 'Gerenciador de Credenciais do Windows',
};

export async function limparGitHub() {
  const escolha = await showDialog({
    title: 'Sair do GitHub e limpar esta máquina',
    message:
      'Isto remove o acesso à sua conta GitHub deste computador, em quatro lugares: '
      + 'o que a AURORA guardou, o que o git guardou pelo helper configurado, o arquivo '
      + '.git-credentials e as entradas do GitHub no Gerenciador de Credenciais do Windows.\n\n'
      + 'Depois disso, enviar para o GitHub vai pedir login de novo. Seu nome e e-mail de '
      + 'autoria no git continuam configurados, porque não são credenciais.\n\n'
      + 'Não dá para desfazer.',
    variant: 'warning',
    buttons: [
      { label: 'Cancelar', action: 'cancel', type: 'cancel' },
      { label: 'Limpar agora', action: 'limpar', type: 'danger' },
    ],
  });
  if (escolha !== 'limpar') return;

  let r;
  try {
    r = await electronAPI.githubForgetEverything();
  } catch (e) {
    showCardNotification(
      `Não foi possível limpar: ${e?.message || e}`, 'error', 8000, 'GitHub');
    return;
  }

  const linhas = (r?.passos || []).map((p) => {
    const marca = p.ok ? 'OK' : 'FALHOU';
    return `${marca} — ${ROTULOS[p.passo] || p.passo}: ${p.detalhe}`;
  });

  await showDialog({
    title: r?.ok ? 'Máquina limpa' : 'Limpeza incompleta',
    message: (r?.ok
      ? 'A conta GitHub não está mais salva neste computador.\n\n'
      : 'Parte da limpeza não foi possível. O que falhou está marcado abaixo, e '
        + 'convém conferir à mão antes de deixar a máquina.\n\n')
      + linhas.join('\n'),
    variant: r?.ok ? 'success' : 'warning',
    buttons: [{ label: 'Fechar', action: 'ok', type: 'cancel' }],
  });

  // O painel de git precisa refletir que não há mais conta conectada.
  try { window.dispatchEvent(new CustomEvent('aurora:github-disconnected')); } catch (_) { /* opcional */ }
}

/**
 * O toggle de limpar ao fechar.
 *
 * A preferencia mora do lado do main, e nao no localStorage, porque quem limpa
 * no encerramento e o processo principal, quando o renderer ja pode ter ido
 * embora. Aqui so lemos e escrevemos por IPC.
 *
 * Fora do ciclo de Salvar, como os outros toggles de efeito imediato: uma
 * preferencia de seguranca que so vale depois de clicar em Salvar seria uma
 * armadilha justamente para quem esta com pressa de sair.
 */
async function ligarToggleAoSair() {
  const el = document.getElementById('github-forget-on-exit');
  if (!el) return;
  try { el.checked = !!(await electronAPI.githubForgetOnExitGet?.()); }
  catch (_) { el.checked = false; }
  el.addEventListener('change', async () => {
    try { await electronAPI.githubForgetOnExitSet?.(el.checked); }
    catch (e) {
      el.checked = !el.checked;
      showCardNotification(
        `Nao foi possivel gravar a preferencia: ${e?.message || e}`, 'error', 6000, 'GitHub');
    }
  });
}

if (typeof window !== 'undefined') {
  window.auroraLimparGitHub = limparGitHub;
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('github-forget-btn')
      ?.addEventListener('click', (e) => { e.preventDefault(); limparGitHub(); });
    ligarToggleAoSair();
  });
}
