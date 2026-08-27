/**
 * A aurora da splash.
 *
 * Eram tres faixas em SVG, cada uma um caminho borrado interpolando entre duas
 * formas num `animate` de vinte segundos. Lia como fita de cetim: brilho
 * atravessando a tela sem estrutura interna, e a forma voltando ao inicio
 * exatamente igual. Aurora nao tem contorno, tem RAIOS, e e por eles que ela se
 * reconhece.
 *
 * O DESENHO
 *
 * Aurora e emissao pura, sem superficie: eletrons descem pelas linhas do campo
 * magnetico e acendem o ar em colunas verticais alinhadas com o campo. Por isso
 * aqui tudo e coluna. Cada uma e um raio, com o mesmo perfil vertical de cor, e
 * o que muda de uma para a outra e o brilho, a altura e onde ela comeca.
 *
 * O que da a FORMA sao fitas, e nao uma faixa. Cada fita tem um trecho proprio
 * da largura, com as pontas afinando ate sumir, e a borda de baixo dela e uma
 * curva de duas senoides de periodos diferentes. Isso e deliberado, e foi a
 * quarta tentativa: com ruido governando a forma grande, a borda vira uma
 * crista irregular e o olho le SILHUETA DE MONTANHA antes de ler aurora; com
 * senoides, sai a curva em S que qualquer fotografia de aurora tem, e o ruido
 * fica so onde ele e bom, que e a textura fina dos raios.
 *
 * O relevo interno de cada fita vem de duas camadas de ruido rolando em
 * sentidos opostos: o brilho de uma coluna sai do quanto as duas concordam ali.
 * Onde concordam, raio; onde discordam, o vao escuro entre raios. Uma camada so
 * daria uma ondulacao regular, que e o que a versao em SVG tinha. A tecnica
 * esta descrita no estudo de Roy Theunissen, "Aurora Borealis: A Breakdown"
 * (2022); o codigo aqui e proprio, porque shader de terceiro costuma vir sob
 * licenca nao comercial e nao poderia viajar dentro do instalador.
 *
 * A COR e a atmosfera, de baixo para cima:
 *
 *   borda inferior   nitrogenio ionizado, o debrum rosa-violeta, a unica parte
 *                    com contorno nitido, porque marca onde os eletrons param;
 *   100 a 150 km     oxigenio a 557,7 nm, o verde, corpo da cortina e quase
 *                    todo o brilho;
 *   acima de 200 km  oxigenio a 630,0 nm, esmaecido porque o ar rarefeito
 *                    demora a desexcitar, aqui puxado para o violeta, que e
 *                    como a camera o registra e como o resto da tela ja fala.
 *
 * O perfil vertical tem comeco abrupto embaixo e cauda longa para cima. Uma
 * aurora que desbota igual nas duas pontas parece nevoa.
 *
 * O BRILHO sai de tres passagens sobre o mesmo desenho, e nao de uma: um halo
 * largo e fraco, um brilho medio, e a cortina com um fio de desfoque para
 * apagar a emenda entre colunas. E a escada de desfoques que faz a luz PARECER
 * luz; com uma passagem so, os raios flutuam recortados no preto.
 *
 * O RITMO e lento de proposito. A forma se refaz em dezenas de segundos, e o
 * que se percebe de imediato e o cintilar correndo de lado ao longo da fita, que
 * e o movimento que identifica uma aurora. Depressa, vira fogo de artificio.
 *
 * Cada abertura sorteia as fases, entao a aurora nunca e a mesma duas vezes,
 * como o ceu ja fazia com a direcao do olhar. As frequencias sao contadas em
 * ciclos ao longo da largura, e nao por pixel, entao mudar a resolucao de
 * trabalho ou a densidade da tela nao muda o desenho.
 *
 * Custo: o quadro sai em resolucao reduzida e e ampliado na tela, o que alem de
 * baratear ja entrega parte do borrao. Sao poucas centenas de drawImage por
 * quadro, todas do mesmo bitmap, e nenhum gradiente e criado depois da partida.
 * A splash divide a CPU com a inicializacao da IDE, entao isso importa mais
 * aqui do que importaria numa pagina.
 */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TAU = Math.PI * 2;

/* Ruido de valor em uma dimensao, com interpolacao suave. Sem dependencia de
   proposito: sao dez linhas, e um `import` a mais na splash custa mais. */
function hash(i, seed) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  /* Smootherstep, 6t^5-15t^4+10t^3: primeira e segunda derivadas zeram nos
     extremos, entao o movimento nao mostra o passo da grade. */
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u;
}
function fbm(x, seed) {
  return noise1(x, seed) * 0.65 + noise1(x * 2.3, seed + 17) * 0.35;
}
function suave(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* O raio: uma tira vertical de um pixel com o perfil de emissao inteiro.
   Desenhada uma vez na partida e reaproveitada em cada coluna de cada quadro, o
   que tira do laco a parte cara, que e criar gradiente. */
function tiraDeRaio(altura, tom) {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = altura;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, altura, 0, 0);   // de baixo para cima
  for (const [p, cor] of tom) grad.addColorStop(p, cor);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, altura);
  return c;
}

/* O debrum, em tira propria e por um motivo de desenho: quando o rosa morava
   dentro da rampa do corpo ele saia em TODA coluna, e o resultado era um traco
   continuo costurando a base de ponta a ponta, como se alguem tivesse
   desenhado o contorno. Na foto o nitrogenio so acende onde a precipitacao e
   forte, entao o debrum vem em manchas curtas. Separado, ele passa a ser
   desenhado so acima de um limiar, e a mancha nasce do proprio ruido. */
function tiraDeDebrum(altura, cor) {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = altura;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, altura, 0, 0);
  grad.addColorStop(0.00, cor + '0.55)');
  grad.addColorStop(0.14, cor + '0.92)');
  grad.addColorStop(0.48, cor + '0.26)');
  grad.addColorStop(1.00, cor + '0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, altura);
  return c;
}

/* As fitas. Cinco, em profundidades diferentes: as de tras sao frias, longas e
 * quase sem relevo, e as da frente sao mais curtas, mais verdes e mais vivas.
 *
 * Eram tres, e a cortina toda vivia mais baixa. Duas mudancas aqui, e as duas
 * sao de composicao. As bases subiram cerca de um decimo da altura, o que abre
 * o terco de baixo: e ali que ficam o letreiro e a barra, e e ali que as
 * estrelas apareciam menos porque a luz passava por cima delas. E entraram uma
 * camada bem ao fundo e uma bem a frente.
 *
 * As duas novas nao sao mais do mesmo. A do fundo e larga, fria e quase plana,
 * e existe para as outras estarem na frente de ALGUMA COISA em vez de flutuarem
 * no preto; ela usa passo 3, um terco das colunas, porque naquele contraste
 * ninguem distingue uma coluna da vizinha e pagar por ela seria desperdicio. A
 * da frente cobre so um trecho estreito da largura e e a mais viva das cinco,
 * para o olho ter UM lugar mais aceso onde pousar: cortina pareja de ponta a
 * ponta e o que faz um ceu desenhado parecer papel de parede.
 *
 * `trecho` e onde a fita existe na largura, em fracao da tela, e as pontas
 * afinam sozinhas. Fitas curtas e sobrepostas sao o que faz o ceu parecer ter
 * varias cortinas, em vez de uma parede so.
 *
 * `onda` sao as duas senoides da borda de baixo: amplitude em fracao da altura,
 * numero de ciclos ao longo da tela inteira, e velocidade da fase em radianos
 * por segundo. A segunda, mais curta e mais rapida, e o que tira a curva da
 * cara de senoide unica.
 *
 * `corrida` e a velocidade do cintilar que corre de lado, e ela foi medida em
 * vez de sentida: em 0,28 rad/s com 5 ciclos na largura, a onda andava 6,4
 * pixels por segundo e levava CENTO E DOZE SEGUNDOS para atravessar a tela. A
 * splash vive por volta de oito. O movimento que o texto acima chama de "o que
 * mais identifica uma aurora" existia no codigo e nao chegava aos olhos de
 * ninguem: em toda a vida da tela ele andava meia dezena de pixels. Os valores
 * de hoje atravessam em uns quarenta segundos, entao numa abertura tipica a
 * onda percorre perto de um quinto da largura, que se ve sem esperar e ainda
 * assim nao tem pressa.
 *
 * `pulso` e `velPulso` sao o brilho da fita subindo e descendo devagar, com
 * periodo de vinte a trinta segundos e fase propria por fita. Aurora de verdade
 * nao tem brilho constante: a precipitacao de eletrons vai e volta, e por isso
 * uma cortina acende e esmaece enquanto a vizinha faz o contrario. Amplitude
 * baixa de proposito. O que se quer e que a luz pareca viva, nao que a tela
 * pisque enquanto alguem espera a IDE abrir.
 */
const FITAS = [
  {
    /* A mais distante. Quase sem relevo, fria e alta: e o brilho de fundo que
       poe as outras a frente de alguma coisa, em vez de flutuarem no preto.
       Passo 3 de proposito, um terco das colunas das da frente: nesta faixa de
       contraste ninguem distingue a coluna individual, entao pagar por ela e
       desperdicio. */
    semente: 47,
    trecho: [-0.24, 1.10], afina: 0.34,
    base: 0.50, inclina: -0.04, onda: [[0.040, 0.55, 0.038], [0.016, 1.35, -0.062]],
    freq: 22, deriva: 0.0025, corrida: 0.52, ondaCorrida: 4,
    pulso: 0.08, velPulso: 0.17,
    altura: 0.34, alfa: 0.13, largura: 4, contraste: 0.92,
    debrum: null,
    tom: [
      [0.00, 'rgba(74,104,190,0.14)'],
      [0.18, 'rgba(66,150,196,0.22)'],
      [0.46, 'rgba(72,126,200,0.12)'],
      [0.80, 'rgba(96,110,205,0)'],
    ],
  },
  {
    semente: 3,
    trecho: [-0.18, 0.92], afina: 0.30,
    base: 0.465, inclina: 0.07, onda: [[0.055, 0.75, 0.055], [0.022, 1.9, 0.085]],
    freq: 34, deriva: 0.004, corrida: 0.78, ondaCorrida: 5,
    pulso: 0.10, velPulso: 0.29,
    altura: 0.42, alfa: 0.20, largura: 2, contraste: 1.12,
    debrum: null,
    tom: [
      [0.00, 'rgba(92,140,225,0.16)'],
      [0.14, 'rgba(72,186,208,0.34)'],
      [0.38, 'rgba(60,170,208,0.24)'],
      [0.66, 'rgba(74,140,214,0.08)'],
      [0.85, 'rgba(92,112,210,0)'],
    ],
  },
  {
    semente: 11,
    trecho: [0.06, 1.14], afina: 0.24,
    base: 0.405, inclina: -0.11, onda: [[0.085, 0.62, -0.075], [0.030, 1.55, 0.11]],
    freq: 52, deriva: -0.006, corrida: 1.15, ondaCorrida: 7,
    pulso: 0.13, velPulso: 0.22,
    altura: 0.60, alfa: 0.40, largura: 1, contraste: 1.30,
    debrum: 'rgba(238,96,178,',
    tom: [
      [0.00, 'rgba(124,216,176,0.30)'],
      [0.07, 'rgba(96,234,176,0.74)'],
      [0.18, 'rgba(74,236,166,0.94)'],
      [0.40, 'rgba(48,216,196,0.42)'],
      [0.64, 'rgba(88,150,232,0.13)'],
      [0.88, 'rgba(142,131,232,0)'],
    ],
  },
  {
    semente: 29,
    trecho: [-0.10, 0.62], afina: 0.28,
    base: 0.36, inclina: 0.09, onda: [[0.065, 0.9, 0.10], [0.026, 2.3, -0.13]],
    freq: 68, deriva: 0.009, corrida: 1.50, ondaCorrida: 9,
    pulso: 0.11, velPulso: 0.35,
    altura: 0.50, alfa: 0.26, largura: 1, contraste: 1.45,
    debrum: 'rgba(246,108,192,',
    tom: [
      [0.00, 'rgba(140,240,182,0.32)'],
      [0.10, 'rgba(122,242,178,0.82)'],
      [0.34, 'rgba(62,208,222,0.24)'],
      [0.78, 'rgba(120,140,235,0)'],
    ],
  },
  {
    /* A da frente, e a mais curta das cinco: um trecho estreito da largura, bem
       a direita de onde a segunda esta mais forte. Serve para o olho achar UM
       lugar mais aceso em vez de uma cortina pareja, que e como uma aurora de
       verdade se apresenta. Curta e cara por coluna (passo 1, contraste alto),
       mas cobre pouco mais de um terco da tela. */
    semente: 71,
    trecho: [0.44, 1.06], afina: 0.32,
    base: 0.345, inclina: -0.06, onda: [[0.052, 1.15, -0.115], [0.020, 2.7, 0.145]],
    freq: 84, deriva: -0.011, corrida: 1.85, ondaCorrida: 11,
    pulso: 0.14, velPulso: 0.41,
    altura: 0.46, alfa: 0.22, largura: 2, contraste: 1.55,
    debrum: 'rgba(240,120,200,',
    tom: [
      [0.00, 'rgba(152,246,190,0.26)'],
      [0.09, 'rgba(134,248,184,0.70)'],
      [0.30, 'rgba(78,220,214,0.30)'],
      [0.62, 'rgba(110,152,238,0.09)'],
      [0.86, 'rgba(150,138,236,0)'],
    ],
  },
];

export function aurora(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  /* Uma fase por fita e por senoide, sorteadas na partida. Sem isto os ruidos
     partem sempre do mesmo lugar e a mesma aurora se repete em toda abertura,
     o que denuncia o desenho. */
  const fases = FITAS.map(() => ({
    ruido: Math.random() * 500,
    onda: [Math.random() * TAU, Math.random() * TAU],
    corrida: Math.random() * TAU,
    /* A fase do pulso tambem e sorteada, e e o que impede as tres fitas de
       acenderem e apagarem juntas. Em fase, o quadro inteiro respiraria como um
       so, que le como a tela mudando de brilho e nao como cortinas
       independentes. */
    pulso: Math.random() * TAU,
  }));

  /* Resolucao de trabalho. A ampliacao seguinte suaviza o degrau das colunas e
     ja faz parte do borrao; abaixo de meia tela, a borda de baixo mostra a
     grade onde ela desce depressa. */
  const ESCALA = 0.54;
  const buf = document.createElement('canvas');
  const bctx = buf.getContext('2d');

  let W = 0, H = 0, bw = 0, bh = 0;
  let tiras = [], debruns = [];

  function medir() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bw = Math.max(64, Math.round(W * ESCALA));
    bh = Math.max(48, Math.round(H * ESCALA));
    buf.width = bw; buf.height = bh;
    tiras = FITAS.map((f) => tiraDeRaio(Math.max(8, Math.round(bh * f.altura)), f.tom));
    debruns = FITAS.map((f) => (f.debrum ? tiraDeDebrum(Math.max(4, Math.round(bh * 0.075)), f.debrum) : null));
    return true;
  }

  function quadro(t) {
    bctx.clearRect(0, 0, bw, bh);
    /* Emissao soma, nao cobre: duas fitas sobrepostas sao mais claras que cada
       uma, e nenhuma esconde a outra. */
    bctx.globalCompositeOperation = 'lighter';

    for (let k = 0; k < FITAS.length; k++) {
      const f = FITAS[k];
      const fase = fases[k];
      const tira = tiras[k];
      const deb = debruns[k];
      const passo = f.largura;
      const desl = fase.ruido + t * f.deriva * 100;
      const [u0, u1] = f.trecho;

      /* O brilho da fita inteira, subindo e descendo devagar. Fora do laco das
         colunas de proposito: e uma propriedade da cortina, nao de cada raio. */
      const respira = 1 + f.pulso * Math.sin(t * f.velPulso + fase.pulso);

      const xIni = Math.max(-passo, Math.floor(u0 * bw));
      const xFim = Math.min(bw + passo, Math.ceil(u1 * bw));

      for (let x = xIni; x < xFim; x += passo) {
        const u = x / bw;

        /* As pontas afinam. Uma fita que termina em corte seco entrega o
           desenho na hora, e e o que fazia a versao anterior parecer uma parede
           recortada. */
        const dentro = (u - u0) / (u1 - u0);
        const ponta = suave(0, f.afina, dentro) * suave(1, 1 - f.afina, dentro);
        if (ponta <= 0.01) continue;

        /* O relevo: duas camadas de ruido em oposicao. */
        const a = noise1(u * f.freq + desl, f.semente);
        const b = noise1(u * f.freq * 1.27 - desl * 0.8, f.semente + 5);
        const acordo = 1 - Math.abs(a - b) * f.contraste;
        if (acordo <= 0) continue;

        /* O cintilar que corre de lado ao longo da fita. E o movimento que mais
           identifica uma aurora, e o unico rapido o bastante para se perceber
           sem esperar. Raso: fundo, viraria pisca-pisca. */
        const corrida = 1 + 0.26 * Math.sin(u * f.ondaCorrida * TAU - t * f.corrida + fase.corrida);

        /* Trechos acesos e trechos fracos ao longo da fita, para o brilho nao
           ser parelho de ponta a ponta. */
        const env = 0.42 + 0.72 * fbm(u * f.freq * 0.09 + desl * 0.3, f.semente + 31);

        const forca = Math.min(0.85, Math.pow(acordo, 1.6) * 2.0 * env * ponta * corrida * respira);
        if (forca <= 0.02) continue;

        /* A borda de baixo: duas senoides de periodos diferentes, mais um
           serrilhado fino para os raios nao terminarem todos na mesma altura.
           A curva grande e senoidal e nao ruidosa de proposito: e o que separa
           a curva em S de uma cordilheira. */
        let y = f.base + f.inclina * (u - 0.5);
        for (let o = 0; o < f.onda.length; o++) {
          const [amp, ciclos, vel] = f.onda[o];
          y += amp * Math.sin(u * ciclos * TAU + t * vel + fase.onda[o]);
        }
        y += 0.014 * Math.sin(u * 3.7 * TAU + t * 0.16 + fase.onda[0] * 1.7);
        y += (noise1(u * f.freq * 0.45 + desl * 1.6, f.semente + 131) - 0.5) * 0.028;
        const base = bh * y;

        /* O comprimento do raio varia devagar ao longo da fita. Depressa, as
           colunas vizinhas discordam demais e a fita vira grafico de barras. */
        const alt = tira.height * (0.34 + 0.95 * fbm(u * f.freq * 0.16 - desl * 0.6, f.semente + 97));

        bctx.globalAlpha = forca * f.alfa;
        bctx.drawImage(tira, 0, 0, 1, tira.height, x - passo * 0.4, base - alt, passo * 1.5, alt);

        /* O filete: onde a coluna ja esta forte, um nucleo mais estreito e mais
           claro por dentro dela, que e o fio nitido no meio do brilho difuso.
           Sai de graca, porque e a mesma tira em menos largura. */
        if (forca > 0.62) {
          bctx.globalAlpha = (forca - 0.62) * 1.3 * f.alfa;
          bctx.drawImage(tira, 0, 0, 1, tira.height, x + passo * 0.2, base - alt * 0.96, passo * 0.6, alt * 0.96);
        }

        /* O debrum, so onde a precipitacao e forte E o ruido rapido deixa. O
           limiar sozinho nao basta: trechos inteiros cruzam junto e o rosa
           volta a ser um traco continuo. */
        if (deb && forca > 0.46) {
          const mancha = noise1(u * f.freq * 0.55 + desl * 1.4, f.semente + 173);
          if (mancha > 0.44) {
            bctx.globalAlpha = Math.min(0.6, (forca - 0.46) * 1.7 * (mancha - 0.44) * 2.6);
            bctx.drawImage(deb, 0, 0, 1, deb.height, x - passo * 0.4, base - deb.height, passo * 1.5, deb.height);
          }
        }
      }
    }

    bctx.globalAlpha = 1;
    bctx.globalCompositeOperation = 'source-over';

    /* A escada de desfoques. Tres passagens do mesmo quadro, da mais larga e
       fraca para a mais nitida, e e ela que faz a luz parecer luz: o halo e o ar
       inteiro em volta brilhando, o medio e o corpo da cortina, e o ultimo
       devolve o desenho dos raios sem trazer de volta a emenda entre colunas. */
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'lighter';

    const passagens = [[0.055, 0.46], [0.020, 0.40], [0.0055, 1]];
    for (const [raio, alfa] of passagens) {
      ctx.filter = 'blur(' + (H * raio).toFixed(2) + 'px)';
      ctx.globalAlpha = alfa;
      ctx.drawImage(buf, 0, 0, bw, bh, 0, 0, W, H);
    }

    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  let inicio = 0;
  function laco(ts) {
    if (!inicio) inicio = ts;
    quadro((ts - inicio) * 0.001);
    if (!REDUCED) requestAnimationFrame(laco);
  }

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (medir()) quadro(performance.now() * 0.001); }).observe(canvas);
  } else {
    addEventListener('resize', () => { if (medir()) quadro(performance.now() * 0.001); });
  }

  if (!medir()) return;
  requestAnimationFrame(laco);
}
