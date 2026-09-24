/**
 * prism_vcd.ts: a onda da simulacao do PRISM escrita como VCD.
 *
 * O monitor do DigitalJS guarda, para cada fio que a pessoa trouxe para ele,
 * a lista de mudancas no tempo: em que tick o valor mudou e para o que. E o
 * mesmo conteudo de um VCD, so que preso dentro da janela do PRISM, num
 * desenho de 30 px de altura. Aqui ele vira um arquivo que o GTKWave e o
 * Surfer leem, o que poe a simulacao interativa no mesmo lugar em que a
 * pessoa ja olha onda de verdade, com cursor, medida e zoom de sobra.
 *
 * A entrada e um retrato plano do monitor, sem nada do DigitalJS: nome, o
 * caminho de submodulos (vazio no topo), a largura em bits e as mudancas como
 * pares [tick, binario], com o binario escrito do bit mais alto para o mais
 * baixo e `x` onde o valor e indefinido, que e o que o 3vl escreve. Puro,
 * sem disco e sem Electron, para ser testado contra saidas escritas a mao.
 *
 * O tick do DigitalJS nao tem unidade; aqui um tick vale 1 ns, e o cabecalho
 * diz isso, para o tick 412 do PRISM aparecer como 412 ns no visualizador.
 */

export interface SinalDaSimulacao {
  /** o nome do fio (netname, ou um derivado) */
  nome: string;
  /** os submodulos ate ele, do topo para dentro */
  caminho?: string[];
  bits: number;
  /** [tick, binario], em ordem de tick */
  mudancas: Array<[number, string]>;
}

/** Um escopo do VCD: o modulo, os submodulos dentro dele e os fios dele. */
interface Escopo {
  nome: string;
  filhos: Map<string, Escopo>;
  vars: Array<{ nome: string; bits: number; id: string }>;
}

/**
 * O identificador curto que o VCD usa no lugar do nome: um ou mais caracteres
 * imprimiveis, de `!` a `~`, sem espaco. Com 94 simbolos, o 95o sinal ganha
 * dois caracteres, e assim por diante.
 */
export function identificador(indice: number): string {
  const base = 94;
  let n = indice;
  let s = '';
  do {
    s = String.fromCharCode(33 + (n % base)) + s;
    n = Math.floor(n / base) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Um nome como o VCD aceita: sem espaco. O resto passa; o yosys escreve
 * `$`, `\` e `.` em nome de fio e os visualizadores leem.
 */
function nomeSeguro(nome: string | null | undefined): string {
  const s = String(nome == null ? '' : nome).replace(/\s+/g, '_');
  return s || 'fio';
}

/**
 * Um valor no formato do VCD: um bit vai colado ao identificador (`1!`), um
 * barramento vai como `b0101 !`. O binario pode vir mais curto ou mais longo
 * do que a largura; ajusta-se pela direita, que e a ponta do bit zero.
 */
function valor(bin: string, bits: number, id: string): string {
  let b = String(bin == null ? '' : bin).toLowerCase().replace(/[^01xz]/g, 'x');
  if (b.length < bits) b = 'x'.repeat(bits - b.length) + b;
  if (b.length > bits) b = b.slice(b.length - bits);
  return bits === 1 ? `${b}${id}` : `b${b} ${id}`;
}

/** O VCD inteiro, com quebras de linha `\n`. */
export function vcdDaSimulacao(
  entrada: { modulo?: string; presente?: number; sinais?: SinalDaSimulacao[]; data?: Date } | null | undefined,
): string {
  const e = entrada || {};
  const modulo = nomeSeguro(e.modulo || 'simulacao');
  const sinais = Array.isArray(e.sinais) ? e.sinais : [];
  const quando = e.data instanceof Date ? e.data : new Date();

  // A arvore de escopos: o topo e o modulo, e cada segmento do caminho de um
  // sinal abre um escopo dentro dele. Dois sinais com o mesmo nome no mesmo
  // escopo ganham sufixo, para nenhum sumir debaixo do outro.
  const raiz: Escopo = { nome: modulo, filhos: new Map(), vars: [] };
  const canais: Array<{ id: string; bits: number; mudancas: Array<[number, string]> }> = [];
  sinais.forEach((s, i) => {
    if (!s) return;
    const bits = Math.max(1, Math.floor(Number(s.bits) || 1));
    let escopo = raiz;
    for (const seg of Array.isArray(s.caminho) ? s.caminho : []) {
      const nome = nomeSeguro(seg);
      let filho = escopo.filhos.get(nome);
      if (!filho) {
        filho = { nome, filhos: new Map(), vars: [] };
        escopo.filhos.set(nome, filho);
      }
      escopo = filho;
    }
    const usados = new Set(escopo.vars.map((v) => v.nome));
    let nome = nomeSeguro(s.nome);
    let n = 2;
    while (usados.has(nome)) nome = `${nomeSeguro(s.nome)}_${n++}`;
    const id = identificador(i);
    escopo.vars.push({ nome, bits, id });
    const mudancas = (Array.isArray(s.mudancas) ? s.mudancas : [])
      .filter((m) => Array.isArray(m) && Number.isFinite(Number(m[0])))
      .map((m): [number, string] => [Math.max(0, Math.floor(Number(m[0]))), String(m[1])])
      .sort((a, b) => a[0] - b[0]);
    canais.push({ id, bits, mudancas });
  });

  const linhas: string[] = [];
  linhas.push(`$date ${quando.toISOString()} $end`);
  linhas.push('$version AURORA PRISM (DigitalJS) $end');
  linhas.push('$comment 1 tick = 1 ns $end');
  linhas.push('$timescale 1ns $end');
  const escrever = (escopo: Escopo): void => {
    linhas.push(`$scope module ${escopo.nome} $end`);
    for (const v of escopo.vars) {
      const faixa = v.bits > 1 ? ` [${v.bits - 1}:0]` : '';
      linhas.push(`$var wire ${v.bits} ${v.id} ${v.nome}${faixa} $end`);
    }
    for (const filho of escopo.filhos.values()) escrever(filho);
    linhas.push('$upscope $end');
  };
  escrever(raiz);
  linhas.push('$enddefinitions $end');

  // Os valores iniciais: o que o sinal valia no tick zero, ou x quando ele
  // so entrou no monitor depois. As mudancas de tick zero ja ficam aqui, e nao
  // se repetem no bloco #0.
  linhas.push('$dumpvars');
  for (const c of canais) {
    const primeira = c.mudancas.length && c.mudancas[0][0] === 0 ? c.mudancas[0][1] : 'x';
    linhas.push(valor(primeira, c.bits, c.id));
  }
  linhas.push('$end');

  const porTick = new Map<number, string[]>();
  let ultimo = 0;
  for (const c of canais) {
    for (const [t, b] of c.mudancas) {
      if (t === 0) continue;
      let doTick = porTick.get(t);
      if (!doTick) {
        doTick = [];
        porTick.set(t, doTick);
      }
      doTick.push(valor(b, c.bits, c.id));
      if (t > ultimo) ultimo = t;
    }
  }
  for (const [t, valores] of [...porTick].sort((a, b) => a[0] - b[0])) {
    linhas.push(`#${t}`);
    for (const v of valores) linhas.push(v);
  }
  // O presente fecha o arquivo: sem ele o visualizador terminaria na ultima
  // mudanca, e um sinal parado ha 300 ticks pareceria ter parado de existir.
  const presente = Math.max(0, Math.floor(Number(e.presente) || 0));
  if (presente > ultimo) linhas.push(`#${presente}`);

  return `${linhas.join('\n')}\n`;
}
