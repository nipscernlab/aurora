/**
 * progress_line.js: reconhece uma linha de progresso no meio da saida de uma
 * ferramenta.
 *
 * POR QUE EXISTE
 * --------------
 * Um contador que sobe imprime uma linha por atualizacao. Numa simulacao longa
 * sao centenas ou milhares de cartoes no terminal, todos dizendo a mesma coisa
 * com um numero diferente, e o que interessa (o aviso, o erro, o resultado)
 * some no meio. A AURORA ja tinha a resposta certa para isso, a barra do
 * `renderHardwareProgress`, mas cada caminho reconhecia o seu formato: o teste
 * de hardware entendia `@@AURORA_PROG`, o cocotb entendia "N/M samples
 * processed", e todo o resto (Icarus, Verilator, e qualquer `$display` que o
 * aluno escreva no testbench) continuava enchendo o terminal de linhas.
 *
 * Aqui os formatos ficam num lugar so, e os caminhos de saida perguntam a
 * mesma funcao. Formato novo se acrescenta uma vez e vale para todos.
 *
 * O QUE E, E O QUE NAO E, LINHA DE PROGRESSO
 * ------------------------------------------
 * Duvida se resolve a favor de ECOAR. Uma linha de progresso engolida por
 * engano some da tela, e o usuario perde informacao sem nunca saber que
 * existiu; uma linha comum ecoada por engano e apenas uma linha a mais. Por
 * isso nao basta ter um numero e um sinal de porcentagem: a linha precisa
 * declarar progresso, e o que sobra dela depois do padrao precisa ser curto.
 * "50% dos casos falharam" nao e progresso, e resultado.
 *
 * Modulo puro: nao toca DOM, nao importa nada. E onde os formatos sao testados.
 */

/**
 * @typedef {{
 *   pct: number, cyc: number|null, total: number|null,
 *   reads: number|null, label: string, done: boolean,
 * }} Progresso
 */

/** Quanto texto pode sobrar em volta do padrao antes de a linha virar outra coisa. */
const SOBRA_MAXIMA = 24;

/**
 * O prefixo que o cocotb carimba em cada linha: tempo de simulacao, nivel e
 * nome do logger. E metadado, nao conteudo, entao sai antes de a linha ser
 * medida; deixa-lo dentro fazia a sobra estourar sozinha e nenhuma linha do
 * cocotb virar barra.
 *
 * So INFO e DEBUG sao removidos. Numa linha de WARNING ou ERROR o prefixo
 * fica, a sobra estoura, e a linha e ecoada inteira, que e exatamente o que se
 * quer: um erro nunca deve virar barra de progresso.
 */
const PREFIXO_LOG = /^\s*[\d.]+\s*(?:ns|us|ms|ps|fs|s)\s+(?:INFO|DEBUG)\s+\S*\s*/i;

/** Percentual inteiro entre 0 e 100, ou null quando nao da para calcular. */
function percentual(feito, total) {
  if (!Number.isFinite(feito) || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((feito / total) * 100)));
}

/**
 * O rotulo que vai na barra, limpo do que nao ajuda a ler.
 *
 * Os prefixos de log do cocotb ("1250000.00ns INFO cocotb.dut") entram na
 * captura e nao dizem nada ao aluno, entao caem aqui em vez de ocuparem a
 * unica linha de texto da barra.
 */
function limparRotulo(bruto, reserva) {
  const texto = String(bruto || '')
    .replace(/^\s*[\d.]+\s*(ns|us|ms|ps|fs|s)\b/i, '')
    .replace(/\b(INFO|DEBUG|WARNING)\b/gi, '')
    .replace(/\bcocotb(\.\w+)*/gi, '')
    .replace(/[[\]|]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:,-]+|[\s:,-]+$/g, '');
  return texto || reserva;
}

/**
 * Formatos reconhecidos, em ordem de confianca.
 *
 * Cada um traz o que extrair e quanto de sobra tolera. `@@AURORA_PROG` e o
 * unico com sobra zero, porque e uma linha que a propria AURORA manda o
 * harness imprimir: qualquer coisa depois dela e sinal de que o formato mudou,
 * e a linha deve ser ecoada para alguem ver.
 */
const FORMATOS = [
  {
    // O harness do teste de hardware: "@@AURORA_PROG <ciclo> <total> <leituras>".
    re: /^@@AURORA_PROG\s+(\d+)\s+(\d+)\s+(\d+)\s*$/,
    ler: (m) => ({ cyc: +m[1], total: +m[2], reads: +m[3] }),
    sobra: 0,
  },
  {
    // cocotb, via dut._log.info: "<nome>: 128/512 samples processed".
    re: /(?:^|\s)([\w.]+):\s*(\d+)\s*\/\s*(\d+)\s+samples\s+processed/i,
    ler: (m) => ({ cyc: +m[2], total: +m[3], rotulo: m[1] }),
    sobra: SOBRA_MAXIMA,
  },
  {
    // Contador declarado: "progress: 128/512", "progresso 3 / 10 amostras".
    re: /(?:^|\s)(progress|progresso|processing|processando)\b[\s:]*(\d+)\s*\/\s*(\d+)/i,
    ler: (m) => ({ cyc: +m[2], total: +m[3], rotulo: m[1] }),
    sobra: SOBRA_MAXIMA,
  },
  {
    // Percentual declarado: "progress: 42%", "progresso 42 %".
    re: /(?:^|\s)(progress|progresso|processing|processando)\b[\s:]*(\d{1,3})\s*%/i,
    ler: (m) => ({ pct: +m[2], rotulo: m[1] }),
    sobra: SOBRA_MAXIMA,
  },
  {
    // Percentual entre colchetes, formato do make e de varios geradores:
    // "[ 42%] building". O colchete e o que distingue de um numero solto.
    re: /^\[\s*(\d{1,3})\s*%\s*\]\s*(.*)$/,
    ler: (m) => ({ pct: +m[1], rotulo: m[2] }),
    sobra: SOBRA_MAXIMA,
  },
];

/**
 * Le uma linha e devolve o progresso que ela anuncia, ou null se ela for
 * conteudo comum, que o chamador deve ecoar.
 *
 * @param {string} linha
 * @param {{rotuloPadrao?: string}} [opcoes]
 * @returns {Progresso|null}
 */
export function lerProgresso(linha, opcoes = {}) {
  const bruto = String(linha == null ? '' : linha);
  if (!bruto.trim()) return null;
  const texto = bruto.replace(PREFIXO_LOG, '');

  for (const formato of FORMATOS) {
    const m = texto.match(formato.re);
    if (!m) continue;

    // O que sobra da linha fora do padrao. Muito texto em volta significa que
    // o numero e parte de uma frase, e nao um contador: "50% of tests failed"
    // tem que chegar ao terminal inteiro.
    const resto = (texto.slice(0, m.index) + texto.slice(m.index + m[0].length)).trim();
    if (resto.length > formato.sobra) continue;

    const dados = formato.ler(m);
    const pct = dados.pct != null
      ? Math.max(0, Math.min(100, dados.pct))
      : percentual(dados.cyc, dados.total);
    if (pct == null) continue;

    const cyc = dados.cyc != null ? dados.cyc : null;
    const total = dados.total != null ? dados.total : null;
    return {
      pct,
      cyc,
      total,
      reads: dados.reads != null ? dados.reads : null,
      label: limparRotulo(dados.rotulo, opcoes.rotuloPadrao || 'progresso'),
      // Concluido pelo contador quando ele existe, e pelo percentual quando
      // so ha percentual. Um contador que chegou ao total e o sinal mais
      // confiavel: ha ferramenta que imprime 100% e continua trabalhando.
      done: cyc != null && total != null ? cyc >= total : pct >= 100,
    };
  }
  return null;
}
