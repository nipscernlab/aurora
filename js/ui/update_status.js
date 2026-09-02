/**
 * update_status.js: o botao fixo de atualizacao na status bar.
 *
 * A janela de atualizacao abria sozinha quando o verificador achava uma
 * versao nova, no meio do que quer que a pessoa estivesse fazendo. Agora o
 * caminho e o contrario: o main so acende este botao ('updates:available'),
 * que fica roxo claro, chamativo de proposito, ate a pessoa clicar, na hora
 * que ela quiser. O clique abre a janela de atualizacao, e dali em diante o
 * fluxo e o de sempre: baixar, e reiniciar quando quiser.
 *
 * Em repouso o botao continua na tela, discreto: um clique dispara a
 * verificacao manual, que responde por toast (nada novo, ou falhou). E o
 * mesmo "Check now" das configuracoes, so que a mao.
 *
 * Tres estados, dirigidos pelo main (resumoParaBotao em main/updater.js):
 *   none        icone apagado, tooltip de verificar agora;
 *   available   roxo, "v1.2.3 disponivel", o clique abre a janela;
 *   downloaded  roxo, "reiniciar para atualizar", o clique abre a janela.
 *
 * O estado e perguntado no boot (getUpdateState) porque um reload do
 * renderer nao pode apagar um update ja encontrado.
 */

import { electronAPI } from '../app/electron_api.js';

function tr(key, params) { return window.t ? window.t(key, params) : key; }

class UpdateStatus {
  constructor() {
    this.item = document.getElementById('updateStatusItem');
    this.label = document.getElementById('updateStatusLabel');
    this.icon = this.item ? this.item.querySelector('i') : null;
    if (!this.item) return;

    this.estado = { state: 'none', newVersion: '' };
    this.checkTimer = null;

    this.item.addEventListener('click', () => this.clique());
    this.item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.clique(); }
    });

    // O main acende (ou promove para "baixada") a qualquer momento.
    electronAPI.onUpdateAvailable?.((resumo) => {
      if (resumo && resumo.state) this.estado = resumo;
      this.pararGiro();
      this.pintar();
    });

    // Toda verificacao manual termina num toast ou no botao aceso; nos dois
    // casos o giro de "verificando" ja disse o que tinha para dizer.
    electronAPI.onUpdateNotice?.(() => this.pararGiro());

    window.addEventListener('aurora:locale-changed', () => this.pintar());

    electronAPI.getUpdateState?.()
      .then((resumo) => {
        if (resumo && resumo.state) this.estado = resumo;
        this.pintar();
      })
      .catch(() => this.pintar());

    this.pintar();
  }

  temUpdate() {
    return this.estado.state === 'available' || this.estado.state === 'downloaded';
  }

  clique() {
    if (this.temUpdate()) {
      electronAPI.openUpdateWindow?.();
      return;
    }
    // Verificacao manual: o icone gira enquanto ela corre, e para quando o
    // main responde (toast ou botao aceso). O teto cobre a resposta que nao
    // veio, para o giro nao ficar eterno numa rede morta.
    this.item.classList.add('checking');
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => this.pararGiro(), 30_000);
    electronAPI.checkForUpdates?.();
  }

  pararGiro() {
    if (this.checkTimer) { clearTimeout(this.checkTimer); this.checkTimer = null; }
    this.item.classList.remove('checking');
  }

  pintar() {
    const aceso = this.temUpdate();
    this.item.classList.toggle('has-update', aceso);

    if (this.label) {
      this.label.hidden = !aceso;
      if (aceso) {
        this.label.textContent = this.estado.state === 'downloaded'
          ? tr('statusBar.updateReady')
          : tr('statusBar.updateAvailable', { version: this.estado.newVersion });
      }
    }

    if (this.icon) {
      this.icon.className = this.estado.state === 'downloaded'
        ? 'ph ph-arrow-clockwise'
        : (aceso ? 'ph ph-download-simple' : 'ph ph-arrows-clockwise');
    }

    // Aceso, o tooltip vira o convite de abrir a janela; o data-i18n-tooltip
    // sai de cena para o i18n nao repor o texto de repouso por cima.
    if (aceso) {
      this.item.removeAttribute('data-i18n-tooltip');
      this.item.setAttribute('data-tooltip', tr('statusBar.updateTooltip'));
    } else {
      this.item.setAttribute('data-i18n-tooltip', 'statusBar.updateCheckTooltip');
      this.item.setAttribute('data-tooltip', tr('statusBar.updateCheckTooltip'));
    }
  }
}

// Singleton: a status bar tem exatamente um botao de atualizacao.
export const updateStatus = new UpdateStatus();
