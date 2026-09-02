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
 * O fundo do botao aceso ganha um ceu proprio: meia duzia de estrelas
 * roxas cintilando em senoide lenta, cada uma com fase e periodo seus.
 * E o unico movimento do botao (o sublinhado e fixo), e o laco de desenho
 * so roda enquanto ha update, a aba esta visivel e a pessoa nao pediu
 * reducao de movimento; fora disso o ceu fica parado ou nem existe.
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

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Tons do ceu do botao: o roxo da marca, o violeta primario e um lavanda
   quase branco para as estrelas mais vivas. */
const STAR_COLORS = [
  [185, 138, 224],
  [142, 131, 232],
  [230, 217, 245],
];

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
    this.ceu = null;        // canvas das estrelas, so enquanto aceso
    this.estrelas = [];
    this.raf = 0;
    this.ro = null;         // o rotulo muda de largura; o ceu acompanha

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

  // ---- o ceu do botao --------------------------------------------------

  ligarCeu() {
    if (this.ceu) return;
    const c = document.createElement('canvas');
    c.className = 'update-stars';
    this.item.insertBefore(c, this.item.firstChild);
    this.ceu = c;
    this.semear();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => { this.semear(); if (REDUCED) this.desenhar(0); });
      this.ro.observe(this.item);
    }
    if (REDUCED) { this.desenhar(0); return; } // um quadro, parado
    const passo = (ts) => {
      if (!this.ceu) return;
      if (!document.hidden) this.desenhar(ts / 1000);
      this.raf = requestAnimationFrame(passo);
    };
    this.raf = requestAnimationFrame(passo);
  }

  desligarCeu() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.ceu) { this.ceu.remove(); this.ceu = null; }
    this.estrelas = [];
  }

  /** Sorteia o campo para a largura atual do botao. */
  semear() {
    if (!this.ceu) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.item.clientWidth;
    const h = this.item.clientHeight;
    this.ceu.width = Math.max(1, Math.round(w * dpr));
    this.ceu.height = Math.max(1, Math.round(h * dpr));
    const n = Math.max(6, Math.round(w / 16));
    this.estrelas = Array.from({ length: n }, () => ({
      x: Math.random(),
      y: 0.12 + Math.random() * 0.76,
      r: 0.5 + Math.random() * 0.9,
      // Periodos de 3 a 6 s: cintilo que se percebe, sem estroboscopio.
      w: (Math.PI * 2) / (3 + Math.random() * 3),
      ph: Math.random() * Math.PI * 2,
      base: 0.25 + Math.random() * 0.5,
      cor: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
    }));
  }

  desenhar(t) {
    const c = this.ceu;
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = c.width / dpr;
    const h = c.height / dpr;
    ctx.clearRect(0, 0, w, h);
    for (const e of this.estrelas) {
      // Senoide pura entre 25% e 100% do brilho base: suave nos dois extremos.
      const nivel = REDUCED ? 0.6 : 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(e.w * t + e.ph));
      const a = e.base * nivel;
      const [r, g, b] = e.cor;
      ctx.beginPath();
      // O halo e a propria sombra do arco: barato e ja da o brilho macio.
      ctx.shadowColor = 'rgba(' + r + ',' + g + ',' + b + ',' + (a * 0.8).toFixed(3) + ')';
      ctx.shadowBlur = e.r * 3;
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
      ctx.arc(e.x * w, e.y * h, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // ---- pintura ---------------------------------------------------------

  pintar() {
    const aceso = this.temUpdate();
    this.item.classList.toggle('has-update', aceso);
    if (aceso) this.ligarCeu(); else this.desligarCeu();
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
