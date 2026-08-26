/**
 * O ceu da splash.
 *
 * Eram cento e trinta pontos em posicoes aleatorias, todos da mesma cor,
 * cintilando numa senoide. Este desenha o ceu de verdade: as estrelas do
 * catalogo HYG ate a magnitude 6, cada uma na posicao catalogada, com o brilho
 * catalogado e a cor catalogada. Ver js/ui/sky_catalogue.js para o formato e o
 * credito.
 *
 * O codigo veio do site institucional (nipscernweb, assets/js/sky.js). As duas
 * telas ja foram a mesma coisa: o comentario do campo antigo da splash dizia
 * que ele fora adaptado de la, e o site seguiu em frente sozinho quando trocou
 * os pontos pelo catalogo. Isto reconverge as duas.
 *
 * O que continua sorteado e para onde se olha. Cada abertura escolhe uma
 * direcao na esfera celeste e um angulo de rotacao, entao duas inicializacoes
 * nao mostram o mesmo pedaco de ceu. A diferenca e que agora o pedaco e real,
 * com constelacoes de verdade dentro.
 *
 * Duas diferencas em relacao ao original, e as duas sao da casa:
 *
 * O catalogo entra EMBUTIDO, como data URL, e nao por um caminho de arquivo.
 * Em producao a splash carrega de dist/html/splash.html por file://, e o
 * Chromium recusa fetch nesse esquema. Como este modulo tem um fallback para o
 * campo aleatorio, buscar por caminho falharia calado e a splash continuaria
 * mostrando os pontos antigos, com todo mundo achando que o ceu tinha entrado.
 * O `?inline` do Vite resolve o import para uma data URL, que fetch aceita sob
 * file://, e sao 40 KB no bundle da splash.
 *
 * E nao ha IntersectionObserver. No site ele existe porque o heroi sai da tela
 * quando se rola a pagina; a splash nao rola, dura poucos segundos e fecha
 * inteira. Codigo que nunca dispara e pior do que codigo ausente.
 */

import HYG_URL from '../../assets/data/hyg-mag6.bin?inline';
import { decodeCatalogue, toVec } from './sky_catalogue.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function loadCatalogue() {
  const res = await fetch(HYG_URL);
  if (!res.ok) throw new Error('catalogue ' + res.status);
  return decodeCatalogue(await res.arrayBuffer());
}

/* Uma rotacao que leva um ponto aleatorio da esfera ao eixo de visada, com uma
   rotacao aleatoria por cima para o campo nao sair sempre do mesmo lado. */
function randomView() {
  const a = Math.random() * Math.PI * 2;            // ascensao reta do centro
  const d = Math.asin(Math.random() * 2 - 1);       // declinacao, uniforme em area
  const r = Math.random() * Math.PI * 2;            // rotacao
  const ca = Math.cos(a), sa = Math.sin(a);
  const cd = Math.cos(d), sd = Math.sin(d);
  const cr = Math.cos(r), sr = Math.sin(r);
  /* Rz(-a) e depois Ry(-d) poem o centro em +x, e Rx(rotacao) gira o campo.
     Composta uma vez aqui para o laco quente ser nove multiplicacoes e nenhuma
     trigonometria. */
  return [
    [cd * ca, cd * sa, sd],
    [-sa * cr - sd * ca * sr, ca * cr - sd * sa * sr, cd * sr],
    [sa * sr - sd * ca * cr, -ca * sr - sd * sa * cr, cd * cr],
  ];
}

export function sky(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0, statik = null, twinklers = [], shooting = null, shootTimer = 2.5;
  let stars = null;
  const view = randomView();

  /* Projecao estereografica. Ela preserva a forma das constelacoes ate os
     cantos, o que uma perspectiva plana nao faz, e o campo aqui e largo:
     noventa graus no lado curto. */
  const THETA_MAX = (45 * Math.PI) / 180;
  const K = () => (Math.min(W, H) / 2) / (2 * Math.tan(THETA_MAX / 2));

  function project(s) {
    const m = view;
    const z = m[0][0] * s.x + m[0][1] * s.y + m[0][2] * s.z;   // na direcao do olho
    if (z <= 0.05) return null;                                 // atras, ou na borda
    const x = m[1][0] * s.x + m[1][1] * s.y + m[1][2] * s.z;
    const y = m[2][0] * s.x + m[2][1] * s.y + m[2][2] * s.z;
    const k = (2 / (1 + z)) * K();
    return [W / 2 + x * k, H / 2 - y * k];
  }

  /* Tamanho e opacidade a partir da magnitude.

     A primeira versao tirava a opacidade do fluxo, 10^(-0.4m), que e o que o
     olho recebe e exatamente a coisa errada de desenhar. O fluxo neste catalogo
     varia por um fator de 1500, entao tudo da magnitude 3 para baixo caia no
     piso de 0,16 de alfa com um terco de pixel de raio: numa tela densa isso e
     um ponto abaixo do pixel a um sexto de opacidade, que e nada. Quatro mil
     estrelas eram desenhadas e uma aparecia.

     Um campo de estrelas tem que ser escalado como o olho escala, e o olho e
     logaritmico: o numero da magnitude ja e o logaritmo. Por isso tamanho e
     opacidade sao lineares na magnitude aqui, e o piso fica alto o bastante
     para a mais fraca ainda registrar. */
  /* Ate onde a atmosfera pode chegar. Em 3,6 so quatrocentas de cinco mil se
     mexiam e o campo parecia uma fotografia; cintilancia e o que faz um ceu
     parecer vivo, entao vai ate a magnitude 5,5. O resto fica parado, o que
     tambem e verdade: as mais fracas estao no limite de serem vistas. */
  const TWINKLE_MAG = 5.5;

  const radiusFor = (mag) => Math.max(0.55, 0.55 + (6 - mag) * 0.27);
  const alphaFor = (mag) => Math.max(0.42, Math.min(1, 0.42 + (6 - mag) * 0.105));

  function build() {
    twinklers = [];
    statik = document.createElement('canvas');
    statik.width = Math.round(W * DPR);
    statik.height = Math.round(H * DPR);
    const c = statik.getContext('2d');
    c.setTransform(DPR, 0, 0, DPR, 0, 0);

    if (!stars) return;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const p = project(s);
      if (!p) continue;
      const [px, py] = p;
      if (px < -8 || py < -8 || px > W + 8 || py > H + 8) continue;
      /* As brilhantes sao redesenhadas a cada quadro para poderem escurecer
         tambem, e nao so clarear, entao ficam fora da camada parada. */
      if (s.mag < TWINKLE_MAG) {
        twinklers.push({
          px, py, mag: s.mag, rgb: s.rgb,
          /* Duas taxas, e nao uma. Uma senoide sozinha le como pulso, que e um
             farol; cintilancia e a atmosfera embaralhando uma frente de onda, e
             ela bate irregular. Duas fora de fase dao isso sem sortear um
             numero novo por quadro. */
          f1: 0.55 + Math.random() * 1.5,
          f2: 1.7 + Math.random() * 2.6,
          p1: Math.random() * 6.283,
          p2: Math.random() * 6.283,
          /* Estrela fraca cintila mais. Fonte pontual e o que a atmosfera
             consegue empurrar; as brilhantes ficam mais firmes, que e a velha
             regra para distinguir um planeta de uma estrela. */
          amp: 0.19 + (s.mag / 6) * 0.42,
        });
        continue;
      }
      drawStar(c, px, py, s.mag, s.rgb, alphaFor(s.mag));
    }
  }

  /* Uma estrela nao e um ponto.

     Tres partes, e cada uma e algo que um sistema optico de fato faz. O nucleo
     e o disco. Em volta fica o brilho, que e espalhamento, e e o que faz uma
     estrela brilhante ler como brilhante em vez de ler como um ponto maior. Das
     brilhantes saem quatro espiculas, que sao difracao: a cruz que aparece numa
     estrela em qualquer fotografia tirada por um instrumento com aranha na
     frente do espelho. Nenhuma das tres e enfeite e nenhuma e inventada, e por
     isso a forma tem direito de ser esta e nao um circulo.

     Quem ganha o que segue a magnitude, entao o ceu se ordena sozinho: abaixo
     da magnitude 4 so ha nucleo, em 2,4 entra o brilho, e as espiculas comecam
     em 1,8 com o comprimento vindo do proprio brilho da estrela. */
  /* A cor do nucleo, montada uma vez por cor. TWINKLE_MAG deixa cerca de mil e
     seiscentas estrelas sendo redesenhadas a cada quadro, e cada uma montava um
     'rgba(...)' com toFixed(3) para pintar um ponto cuja cor nunca muda. O alfa
     passou para o globalAlpha e a string virou constante; na pratica o catalogo
     inteiro usa uma cor so, entao este Map tem uma entrada. */
  const NUCLEOS = new Map();
  function corDoNucleo(rgb) {
    const chave = rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
    let s = NUCLEOS.get(chave);
    if (s === undefined) {
      s = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      NUCLEOS.set(chave, s);
    }
    return s;
  }

  function drawStar(c, px, py, mag, rgb, a, grow) {
    const r = radiusFor(mag) * (grow || 1);
    const [rr, gg, bb] = rgb;
    const col = (al) => 'rgba(' + rr + ',' + gg + ',' + bb + ',' + al.toFixed(3) + ')';

    /* O brilho e as espiculas mantem o alfa embutido em cada parada do
       gradiente. Passar os dois para globalAlpha foi medido e desfeito: o
       rasterizador monta o gradiente numa tabela de 256 entradas, e quantizar
       uma tabela que vai ate 0,42a nao da o mesmo que quantizar uma que vai ate
       0,42 e depois multiplicar por a. */
    if (mag < 2.4) {
      const gr = r * (mag < 1.0 ? 6.5 : 4.4);
      const gl = c.createRadialGradient(px, py, 0, px, py, gr);
      gl.addColorStop(0, col(a * 0.42));
      gl.addColorStop(0.45, col(a * 0.10));
      gl.addColorStop(1, col(0));
      c.fillStyle = gl;
      c.beginPath(); c.arc(px, py, gr, 0, 6.283185); c.fill();
    }

    if (mag < 1.8) {
      const len = r * (3.4 + (1.8 - mag) * 2.6);
      c.lineCap = 'round';
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const g2 = c.createLinearGradient(px - dx * len, py - dy * len, px + dx * len, py + dy * len);
        g2.addColorStop(0, col(0));
        g2.addColorStop(0.5, col(a * 0.55));
        g2.addColorStop(1, col(0));
        c.strokeStyle = g2;
        c.lineWidth = Math.max(0.6, r * 0.30);
        c.beginPath();
        c.moveTo(px - dx * len, py - dy * len);
        c.lineTo(px + dx * len, py + dy * len);
        c.stroke();
      }
    }

    /* O nucleo, que TODA estrela desenha, e onde estava o laco. Um preenchimento
       liso nao passa por tabela nenhuma: o alfa da origem e multiplicado pelo
       globalAlpha, entao 'rgb(...)' com globalAlpha da exatamente o mesmo pixel
       que 'rgba(...,a)'. Arredondado a tres casas porque a string que ele
       substitui passava por toFixed(3). */
    c.globalAlpha = Math.round(a * 1000) / 1000;
    c.fillStyle = corDoNucleo(rgb);
    c.beginPath(); c.arc(px, py, r, 0, 6.283185); c.fill();
    /* Devolvido: a camada estatica e o rastro do meteoro desenham depois e
       contam com o valor cheio. */
    c.globalAlpha = 1;
  }

  function twinkle(c, t) {
    for (let i = 0; i < twinklers.length; i++) {
      const s = twinklers[i];
      const w = REDUCED ? 1 : 1 + s.amp * (Math.sin(t * s.f1 + s.p1) * 0.62 + Math.sin(t * s.f2 + s.p2) * 0.38);
      const a = Math.max(0.08, Math.min(1, alphaFor(s.mag) * w));
      /* As espiculas respiram junto. A cintilancia move o tamanho aparente
         alem do brilho, e nas poucas estrelas que tem espiculas sao elas que
         mostram isso. Mantido pequeno: e um tremor, nao um batimento. */
      drawStar(c, s.px, s.py, s.mag, s.rgb, a, REDUCED ? 1 : 1 + (w - 1) * 0.35);
    }
  }

  function newShooter() {
    const edge = Math.random() < 0.5;
    return {
      x: edge ? Math.random() * W * 0.6 : W * 0.3 + Math.random() * W * 0.4,
      y: Math.random() * H * 0.5,
      a: ((25 + Math.random() * 30) * Math.PI) / 180,
      sp: 380 + Math.random() * 260,
      life: 1, tail: [],
    };
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }

  let last = 0;
  function frame(ts) {
    const dt = Math.min((ts - last) / 1000, 0.05);
    last = ts;
    const t = ts * 0.001;
    ctx.clearRect(0, 0, W, H);
    if (statik) ctx.drawImage(statik, 0, 0, W, H);
    twinkle(ctx, t);

    if (!REDUCED) {
      shootTimer -= dt;
      if (shootTimer <= 0 && !shooting) { shooting = newShooter(); shootTimer = 6 + Math.random() * 9; }
      if (shooting) {
        shooting.x += Math.cos(shooting.a) * shooting.sp * dt;
        shooting.y += Math.sin(shooting.a) * shooting.sp * dt;
        shooting.life -= dt * 1.3;
        shooting.tail.push({ x: shooting.x, y: shooting.y });
        if (shooting.tail.length > 18) shooting.tail.shift();
        ctx.lineCap = 'round';
        for (let j = 1; j < shooting.tail.length; j++) {
          const p0 = shooting.tail[j - 1], p1 = shooting.tail[j];
          const a = (j / shooting.tail.length) * Math.max(0, shooting.life) * 0.75;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
          ctx.strokeStyle = 'rgba(220,235,255,' + a.toFixed(2) + ')';
          ctx.lineWidth = 1.5 * (j / shooting.tail.length);
          ctx.stroke();
        }
        if (shooting.life <= 0 || shooting.x > W + 40 || shooting.y > H + 40) shooting = null;
      }
    }
    requestAnimationFrame(frame);
  }

  /* O campo aleatorio que o catalogo substitui, guardado como a forma de
     falhar. Uma splash sem ceu nenhum e o unico desfecho contra o qual vale
     projetar. */
  function fallback(why) {
    console.warn('[sky] caiu para o campo aleatorio:', why);
    stars = new Array(130);
    for (let i = 0; i < 130; i++) {
      const v = toVec(Math.random() * 360, Math.asin(Math.random() * 2 - 1) * 57.2958);
      stars[i] = { x: v[0], y: v[1], z: v[2], mag: 1 + Math.random() * 5, rgb: [210, 225, 255] };
    }
    resize();
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
  else addEventListener('resize', resize);

  requestAnimationFrame(frame);

  loadCatalogue()
    .then((s) => { stars = s; resize(); })
    .catch(fallback);
}
