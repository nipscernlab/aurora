/**
 * A aurora da splash.
 *
 * Eram tres faixas em SVG, cada uma um caminho borrado com um `animate` de vinte
 * segundos interpolando entre duas formas. Lia como fita de cetim: o brilho
 * atravessava a tela inteira sem estrutura interna, e a forma voltava ao inicio
 * exatamente igual. Aurora de verdade nao tem contorno, tem RAIOS, e e por eles
 * que ela se reconhece.
 *
 * O que este desenha, e por que:
 *
 * Aurora e emissao pura, sem superficie. O que se ve sao eletrons descendo pelas
 * linhas do campo magnetico e excitando o ar, entao a luz nasce em COLUNAS
 * verticais, alinhadas com o campo, e nao numa faixa horizontal. Por isso o
 * desenho aqui e coluna a coluna: cada uma e um raio, com o mesmo perfil
 * vertical de cor, e o que muda de uma para a outra e o brilho e a altura.
 *
 * A estrutura vem de duas camadas de ruido que rolam em sentidos opostos, e o
 * brilho de cada coluna sai do quanto as duas concordam ali. Onde concordam,
 * raio; onde discordam, o vao escuro entre cortinas. Uma camada so daria uma
 * ondulacao regular, que e o que a versao em SVG tinha; sao as duas em oposicao
 * que produzem as falhas e os feixes estreitos que fazem parecer aurora. A
 * tecnica esta descrita no estudo de Roy Theunissen, "Aurora Borealis: A
 * Breakdown" (2022); o codigo aqui e proprio, e nao ha nada copiado de shader
 * de terceiro, que costuma vir sob licenca nao comercial e nao poderia viajar
 * dentro do instalador.
 *
 * A rampa de cor e a fisica da atmosfera, de baixo para cima:
 *
 *   borda inferior   nitrogenio ionizado, o debrum rosa-violeta, e a unica
 *                    parte com contorno nitido, porque marca onde os eletrons
 *                    param;
 *   100 a 150 km     oxigenio a 557,7 nm, o verde, que e o corpo da cortina e
 *                    responde por quase todo o brilho;
 *   acima de 200 km  oxigenio a 630,0 nm, o vermelho, que aparece esmaecido
 *                    porque o ar rarefeito demora a desexcitar; aqui ele entra
 *                    puxado para o violeta, que e como a camera o registra e
 *                    como o resto desta tela ja fala.
 *
 * O perfil vertical e o que o mesmo estudo recomenda: comeco abrupto embaixo e
 * uma cauda longa para cima. Uma aurora que desbota igual nas duas pontas
 * parece nevoa.
 *
 * O quadro sai em duas passagens sobre o mesmo desenho, e e a segunda que
 * separa uma aurora de uma fita colorida: primeiro a NUVEM, o mesmo desenho
 * borrado e somado por baixo, que e o ar em volta da cortina brilhando fraco, e
 * depois a cortina com um fio de desfoque, so o bastante para apagar a emenda
 * entre colunas vizinhas. Sem a nuvem os raios flutuam recortados no preto, que
 * e o aspecto sintetico que se quer evitar.
 *
 * Tres armadilhas custaram uma versao cada, e ficam registradas porque todas
 * voltam sozinhas se alguem mexer nos numeros:
 *
 *   somar tres cortinas com alfa alto estoura tudo para o branco, e o verde
 *   vira neon;
 *
 *   comprimento de raio variando depressa demais transforma a cortina em
 *   blocos, tipo grafico de barras;
 *
 *   e uma curvatura em arco ampla, com a borda de baixo acesa por cima, le como
 *   SILHUETA DE MONTANHA antes de ler como aurora. O arco desta janela e quase
 *   horizontal de proposito, e a base leva um serrilhado fino para os raios nao
 *   terminarem todos na mesma altura.
 *
 * Cada abertura sorteia uma fase por cortina, entao a aurora nunca e a mesma
 * duas vezes, como o ceu ja fazia com a direcao do olhar.
 *
 * Custo: o quadro e desenhado em resolucao reduzida e ampliado na tela, o que
 * alem de baratear entrega de graca parte do borrao que a emissao precisa. Sao
 * poucas centenas de drawImage por quadro, todas do mesmo bitmap, e nenhum
 * gradiente e criado depois da partida. Medido em 25/08/2026 numa janela de
 * 720x480: a pagina inteira, ceu e aurora juntos, sustenta o vsync de uma tela
 * de 144 Hz. A splash divide a CPU com a inicializacao da IDE, entao isso
 * importa mais aqui do que importaria numa pagina.
 */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Ruido de valor em uma dimensao, com interpolacao suave. Nao ha dependencia
   aqui de proposito: e uma funcao de dez linhas e um `import` a mais na splash
   custa mais do que ela. */
function hash(i, seed) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  /* Smootherstep, 6t^5-15t^4+10t^3: a primeira e a segunda derivadas zeram nos
     extremos, entao o movimento nao mostra o passo da grade. */
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u;
}
/* Duas oitavas bastam para a dobra da cortina: a primeira da o arco, a segunda
   o amassado. Uma terceira nao aparece depois da ampliacao. */
function fbm(x, seed) {
  return noise1(x, seed) * 0.65 + noise1(x * 2.3, seed + 17) * 0.35;
}

/* O raio: uma tira vertical de um pixel de largura com o perfil de emissao
   inteiro. Desenhada uma vez na partida e reaproveitada em cada coluna de cada
   quadro, que e o que mantem o custo baixo, porque criar gradiente e a parte
   cara e ela deixa de existir no laco. */
function tiraDeRaio(altura, tom) {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = altura;
  const g = c.getContext('2d');
  /* De baixo (1) para cima (0), na ordem em que a fisica acontece. */
  const grad = g.createLinearGradient(0, altura, 0, 0);
  for (const [p, cor] of tom) grad.addColorStop(p, cor);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, altura);
  return c;
}

/* O debrum, em tira propria e por um motivo de desenho.
 *
 * Quando o rosa morava dentro da rampa do corpo, ele aparecia em TODA coluna, e
 * o resultado era um traco continuo costurando a base da cortina de ponta a
 * ponta, como se alguem tivesse desenhado o contorno. Na foto ele nao e assim:
 * o nitrogenio so acende onde a precipitacao e forte, entao o debrum vem em
 * manchas, nos trechos mais brilhantes, e some no resto.
 *
 * Separado, ele passa a ser desenhado so acima de um limiar de brilho, e a
 * mancha nasce sozinha do proprio ruido que ja governa a cortina. */
function tiraDeDebrum(altura, cor) {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = altura;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, altura, 0, 0);
  /* A borda de baixo e a unica parte nitida de uma aurora, porque marca onde os
     eletrons pararam; ainda assim nao e uma linha, entao a primeira parada nao
     esta no cheio. */
  grad.addColorStop(0.00, cor + '0.62)');
  grad.addColorStop(0.12, cor + '0.95)');
  grad.addColorStop(0.45, cor + '0.30)');
  grad.addColorStop(1.00, cor + '0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, altura);
  return c;
}

/* As tres cortinas. A de tras e mais fria, mais baixa e mais lenta, o que da
   profundidade sem custar nada; a da frente carrega o verde e o debrum. */
const CORTINAS = [
  {
    // A do fundo: fria, baixa, lenta, e sem debrum. Distância tira o rosa
    // primeiro, porque a borda inferior é a parte mais fraca do espectro.
    semente: 3, freq: 5.5, deriva: 0.019, vao: 0.86, corrida: 0.65,
    base: 0.60, dobra: 0.06, curva: 0.022, altura: 0.46, alfa: 0.20, largura: 3,
    corte: [0.22, 0.66],
    debrum: null,
    tom: [
      [0.00, 'rgba(92,135,225,0.14)'],
      [0.13, 'rgba(70,185,205,0.36)'],
      [0.34, 'rgba(58,175,205,0.28)'],
      [0.60, 'rgba(72,140,215,0.09)'],
      [0.82, 'rgba(90,110,210,0)'],
    ],
  },
  {
    // A principal. É dela o verde e o debrum, e é a que dobra mais.
    semente: 11, freq: 9.8, deriva: -0.031, vao: 1.18, corrida: 1.15,
    base: 0.545, dobra: 0.135, curva: 0.032, altura: 0.66, alfa: 0.40, largura: 2,
    corte: [0.24, 0.70],
    debrum: 'rgba(238,96,178,',
    tom: [
      [0.00, 'rgba(120,215,175,0.30)'],
      [0.07, 'rgba(96,232,176,0.72)'],
      [0.17, 'rgba(74,232,168,0.92)'],
      [0.38, 'rgba(47,214,196,0.44)'],
      [0.60, 'rgba(86,150,232,0.14)'],
      [0.85, 'rgba(142,131,232,0)'],
    ],
  },
  {
    // A da frente: estreita, rápida, quase toda verde, e passa por cima da
    // principal em pedaços curtos. É o que dá a sensação de haver mais de uma
    // cortina em profundidades diferentes.
    semente: 29, freq: 15.8, deriva: 0.042, vao: 1.42, corrida: 1.70,
    base: 0.50, dobra: 0.11, curva: 0.026, altura: 0.52, alfa: 0.19, largura: 2,
    corte: [0.32, 0.76],
    debrum: 'rgba(246,108,192,',
    tom: [
      [0.00, 'rgba(140,240,182,0.34)'],
      [0.12, 'rgba(120,240,178,0.80)'],
      [0.32, 'rgba(60,205,222,0.24)'],
      [0.74, 'rgba(120,140,235,0)'],
    ],
  },
];

/* Interpolação suave entre dois limiares, que é como os vãos entre cortinas
   deixam de ser um corte seco. */
function suave(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function aurora(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  /* Uma fase por cortina, sorteada na partida. */
  const fases = CORTINAS.map(() => Math.random() * 500);

  /* A resolucao de trabalho. Em 0,38 da tela, a ampliacao seguinte suaviza os
     degraus das colunas e faz o papel do desfoque; o filtro de verdade custaria
     um passe por quadro para chegar ao mesmo lugar. */
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
    /* As tiras sao redesenhadas junto porque a altura delas e a do buffer. */
    tiras = CORTINAS.map((c) => tiraDeRaio(Math.max(8, Math.round(bh * c.altura)), c.tom));
    debruns = CORTINAS.map((c) => (c.debrum ? tiraDeDebrum(Math.max(4, Math.round(bh * 0.085)), c.debrum) : null));
    return true;
  }

  function quadro(t) {
    bctx.clearRect(0, 0, bw, bh);
    /* Emissao soma, nao cobre: duas cortinas sobrepostas sao mais claras que
       cada uma, e nenhuma esconde a outra. */
    bctx.globalCompositeOperation = 'lighter';

    for (let k = 0; k < CORTINAS.length; k++) {
      const c = CORTINAS[k];
      const tira = tiras[k];
      const passo = c.largura;
      const desl = fases[k] + t * c.deriva * 100;

      for (let x = -passo; x < bw + passo; x += passo) {
        const u = x / bw;
        /* Onde HÁ cortina. Sem isto a luz atravessa a tela de ponta a ponta,
           que é o defeito que fazia a versão anterior parecer uma parede: o
           limiar aqui abre vãos largos e escuros e deixa dois ou três trechos
           acesos, que é como uma aurora se distribui no céu. */
        const env = 0.30 + 0.82 * suave(c.corte[0], c.corte[1], fbm(u * c.freq * 0.11 + desl * 0.30, c.semente + 31));

        /* As duas camadas em oposição. O quanto elas concordam vira o brilho da
           coluna: acordo total é um raio, desacordo é o vão entre raios. */
        const a = noise1(u * c.freq + desl, c.semente);
        const b = noise1(u * c.freq * c.vao - desl * 0.8, c.semente + 5);
        const acordo = 1 - Math.abs(a - b) * 1.62;
        if (acordo <= 0) continue;
        /* Elevado ao quadrado para separar raio de penumbra, e com ganho para
           devolver o brilho que a potência tira. Linear dava um pente regular,
           com todas as colunas parecidas; sem o ganho, some tudo. */
        const brilho = Math.pow(acordo, 1.7) * 2.15 * env;
        if (brilho <= 0.015) continue;

        /* A borda de baixo. Duas coisas somadas: a curvatura do arco, lenta e
           larga, e a dobra da cortina, que é o amassado por cima dela. Uma
           borda reta lê como silhueta de montanha, não como cortina. */
        const arco = Math.sin((x / bw) * Math.PI * 1.1 + c.semente) * c.curva;
        const dobra = (fbm(u * c.freq * 0.34 + desl * 0.55, c.semente + 61) - 0.5) * 2 * c.dobra;
        /* E um serrilhado fino por cima das duas. Sem ele a base e uma curva
           contínua e limpa, e uma curva contínua e limpa contra o céu escuro
           não lê como cortina, lê como silhueta de montanha, que foi
           exatamente o que apareceu na primeira tentativa desta versão. */
        const franja = (noise1(u * c.freq * 15 + desl * 2.2, c.semente + 131) - 0.5) * 0.034;
        const base = bh * (c.base + arco + dobra + franja);

        /* O comprimento do raio varia coluna a coluna, senão o topo vira uma
           linha reta e o olho acha a régua na hora. */
        const alt = tira.height * (0.34 + 0.95 * fbm(u * c.freq * 0.42 - desl * 0.6, c.semente + 97));

        /* O cintilar que corre pela cortina. É o movimento que mais identifica
           uma aurora e o que nenhuma das versões anteriores tinha: além de a
           forma mudar devagar, o brilho VIAJA de lado ao longo dela, rápido,
           como se alguém passasse a mão. Uma onda só, rasa, porque em cima do
           resto ela já se lê; funda, viraria pisca-pisca. */
        const corrida = 1 + 0.22 * Math.sin(u * 20 - t * c.corrida + c.semente);
        const forca = Math.min(0.80, brilho * corrida);

        bctx.globalAlpha = forca * c.alfa;
        bctx.drawImage(tira, 0, 0, 1, tira.height, x - passo * 0.4, base - alt, passo * 1.5, alt);

        /* O filete: onde a coluna já está forte, um núcleo mais estreito e mais
           claro por dentro dela. É o que dá o fio de luz nítido no meio do
           brilho difuso, e sai de graça porque é a mesma tira em menos largura.
           Abaixo do limiar não desenha nada, então o custo fica nos poucos. */
        if (forca > 0.70) {
          bctx.globalAlpha = (forca - 0.70) * 1.1 * c.alfa;
          bctx.drawImage(tira, 0, 0, 1, tira.height, x + passo * 0.25, base - alt * 0.96, passo * 0.55, alt * 0.96);
        }

        /* O debrum, em manchas, só onde a precipitação é forte.
           O limiar sozinho não bastava: depois que a cortina ficou mais suave,
           trechos inteiros passaram a cruzá-lo juntos e o rosa voltou a ser um
           traço contínuo costurando a base, que é o que faz a tela parecer uma
           serra nevada em vez de uma aurora. O ruído rápido abaixo apaga e
           acende o debrum ao longo da borda, em pedaços curtos. */
        const deb = debruns[k];
        const mancha = noise1(u * c.freq * 6.5 + desl * 1.6, c.semente + 173);
        if (deb && forca > 0.5 && mancha > 0.42) {
          bctx.globalAlpha = Math.min(0.55, (forca - 0.5) * 1.5 * (mancha - 0.42) * 2.4);
          bctx.drawImage(deb, 0, 0, 1, deb.height, x - passo * 0.4, base - deb.height, passo * 1.5, deb.height);
        }
      }
    }

    bctx.globalAlpha = 1;
    bctx.globalCompositeOperation = 'source-over';

    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    /* Duas passagens do mesmo quadro, e é isto que separa uma aurora de uma
       fita colorida.
       A primeira é a NUVEM: o mesmo desenho borrado e somado por baixo, que é o
       ar inteiro em volta da cortina brilhando fraco. Sem ela os raios flutuam
       recortados no preto, que é o aspecto sintético que se quer evitar.
       A segunda é a cortina em si, com um desfoque mínimo, só o bastante para
       apagar a emenda entre colunas vizinhas. */
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(' + (H * 0.045).toFixed(1) + 'px)';
    ctx.globalAlpha = 0.30;
    ctx.drawImage(buf, 0, 0, bw, bh, 0, 0, W, H);

    ctx.filter = 'blur(' + (H * 0.0058).toFixed(2) + 'px)';
    ctx.globalAlpha = 1;
    ctx.drawImage(buf, 0, 0, bw, bh, 0, 0, W, H);

    ctx.filter = 'none';
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
