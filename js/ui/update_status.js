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
 * Aceso, o hover mostra um painel com as versoes (atual e nova) e dois
 * atalhos: a release no GitHub do sapho, que e onde mora o changelog, e o
 * site do NIPSCERN. O painel substitui o tooltip nesse estado; em repouso o
 * tooltip comum continua valendo.
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

const SITE_URL = 'https://www.nipscern.com/';

// O icone do site, o mesmo icon_home_nipscern.svg do nipscernweb, recolorido
// para currentColor (assets/icons/nipscern_site.svg guarda a copia). Inline
// porque <img> nao herda cor, e o painel pinta os atalhos pelo texto.
const SITE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">'
  + '<path d="M660-570q-26 0-43-17t-17-43q0-26 17-43t43-17q26 0 43 17t17 43q0 26-17 43t-43 17Zm-360 0q-26 0-43-17t-17-43q0-26 17-43t43-17q26 0 43 17t17 43q0 26-17 43t-43 17Zm180 110q-26 0-43-17t-17-43q0-26 17-43t43-17q26 0 43 17t17 43q0 26-17 43t-43 17Zm0-220q-26 0-43-17t-17-43q0-26 17-43t43-17q26 0 43 17t17 43q0 26-17 43t-43 17Zm0 520q-19 0-39-3t-39-8v-144q0-35 22-60t56-25q34 0 56 25t22 60v144q-19 5-39 8t-39 3Zm-138-31q-19-8-38-18t-36-22q-28-19-44.5-51T207-351q0-26-5-49.5T182-444q-11-12-38.5-38T93-531q-13-14-13-29.5T93-589q14-14 28-14t28 14l154 145q19 18 29 43t10 51v159Zm276 0v-159q0-26 12.5-51t31.5-43l149-145q12-11 28.5-11t27.5 11q13 13 13 28.5T867-531q-23 23-50.5 48T778-444q-15 20-20 43.5t-5 49.5q0 37-16.5 69T692-231q-17 11-36 21.5T618-191Z"/></svg>';

class UpdateStatus {
  constructor() {
    this.item = document.getElementById('updateStatusItem');
    this.label = document.getElementById('updateStatusLabel');
    this.icon = this.item ? this.item.querySelector('i') : null;
    if (!this.item) return;

    this.estado = { state: 'none', newVersion: '', currentVersion: '', releaseUrl: '' };
    this.checkTimer = null;
    this.panel = null;
    this.hideTimer = null;

    this.item.addEventListener('click', () => this.clique());
    this.item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.clique(); }
    });

    // O painel de hover so existe aceso; o par enter/leave e espelhado no
    // proprio painel para dar tempo de levar o mouse ate os atalhos.
    this.item.addEventListener('mouseenter', () => this.mostrarPainel());
    this.item.addEventListener('mouseleave', () => this.esconderPainel());
    this.item.addEventListener('focus', () => this.mostrarPainel());
    this.item.addEventListener('blur', () => this.esconderPainel());

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
      this.esconderPainel(true);
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

  // ---- painel de hover -----------------------------------------------

  criarPainel() {
    if (this.panel) return this.panel;
    const p = document.createElement('div');
    p.className = 'update-panel';
    p.hidden = true;
    p.addEventListener('mouseenter', () => this.mostrarPainel());
    p.addEventListener('mouseleave', () => this.esconderPainel());
    document.body.appendChild(p);
    this.panel = p;
    return p;
  }

  mostrarPainel() {
    if (!this.temUpdate()) return;
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
    const p = this.criarPainel();

    const de = this.estado.currentVersion ? 'v' + this.estado.currentVersion : '';
    const para = this.estado.newVersion ? 'v' + this.estado.newVersion : '';
    const tam = this.estado.sizeMB ? this.estado.sizeMB + ' MB' : '';

    p.replaceChildren();

    const versoes = document.createElement('div');
    versoes.className = 'up-versions';
    versoes.innerHTML =
      `<span class="up-from">${de}</span><span class="up-arrow">&rarr;</span>`
      + `<span class="up-to">${para}</span>`
      + (tam ? `<span class="up-size">${tam}</span>` : '');
    p.appendChild(versoes);

    const links = document.createElement('div');
    links.className = 'up-links';

    if (this.estado.releaseUrl) {
      const gh = document.createElement('button');
      gh.type = 'button';
      gh.className = 'up-link';
      gh.title = tr('statusBar.updatePanelChangelogTip');
      gh.innerHTML = `<i class="ph ph-github-logo" aria-hidden="true"></i><span>${tr('statusBar.updatePanelChangelog')}</span>`;
      gh.addEventListener('click', () => electronAPI.openExternal?.(this.estado.releaseUrl));
      links.appendChild(gh);
    }

    const site = document.createElement('button');
    site.type = 'button';
    site.className = 'up-link';
    site.title = tr('statusBar.updatePanelSiteTip');
    site.innerHTML = `${SITE_ICON_SVG}<span>nipscern.com</span>`;
    site.addEventListener('click', () => electronAPI.openExternal?.(SITE_URL));
    links.appendChild(site);

    p.appendChild(links);

    // Ancorado acima do botao, encostado a direita, por cima da status bar.
    const r = this.item.getBoundingClientRect();
    p.style.right = Math.max(6, Math.round(window.innerWidth - r.right)) + 'px';
    p.style.bottom = Math.round(window.innerHeight - r.top + 6) + 'px';
    p.hidden = false;
  }

  esconderPainel(agora = false) {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (agora) {
      this.hideTimer = null;
      if (this.panel) this.panel.hidden = true;
      return;
    }
    // O vao entre o botao e o painel: um respiro antes de fechar, senao o
    // mouse nunca chega nos atalhos.
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (this.panel) this.panel.hidden = true;
    }, 160);
  }

  // ---- pintura ---------------------------------------------------------

  pintar() {
    const aceso = this.temUpdate();
    this.item.classList.toggle('has-update', aceso);
    if (!aceso) this.esconderPainel(true);

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

    // Aceso, quem fala no hover e o painel; o tooltip sai para nao brigar
    // com ele. Em repouso o tooltip comum volta.
    if (aceso) {
      this.item.removeAttribute('data-i18n-tooltip');
      this.item.removeAttribute('data-tooltip');
      this.item.setAttribute('data-no-tooltip', 'true');
    } else {
      this.item.removeAttribute('data-no-tooltip');
      this.item.setAttribute('data-i18n-tooltip', 'statusBar.updateCheckTooltip');
      this.item.setAttribute('data-tooltip', tr('statusBar.updateCheckTooltip'));
    }
  }
}

// Singleton: a status bar tem exatamente um botao de atualizacao.
export const updateStatus = new UpdateStatus();
