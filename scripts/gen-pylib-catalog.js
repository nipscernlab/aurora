#!/usr/bin/env node
// @ts-check
/**
 * gen-pylib-catalog.js — gera resources/pylib-catalog.json a partir da PyPI.
 *
 * O QUE E O CATALOGO
 * ------------------
 * A lista curada de bibliotecas Python que o painel da AURORA oferece. Ele
 * guarda METADADOS (descricao, usos, licenca, icone, versao fixada, hash), nunca
 * os bytes das bibliotecas. Os bytes sao baixados da PyPI na hora da instalacao
 * e conferidos contra o sha256 que este arquivo fixou.
 *
 * A REGRA QUE DECIDE TUDO
 * -----------------------
 * O Python embarcado da AURORA e um build MinGW (mingw_x86_64_msvcrt_gnu), nao
 * o CPython MSVC da python.org. Consequencia medida na pratica:
 *
 *   - Wheel pura (`*-none-any.whl`): FUNCIONA. E so descompactar no lugar certo.
 *   - Wheel com extensao em C (cp312-win_amd64 e afins): NAO CARREGA. O .pyd
 *     procura a python312.dll da Microsoft, que nao existe no nosso build.
 *
 * Por isso este gerador RECUSA qualquer biblioteca sem wheel pura. Nao e uma
 * escolha de gosto: e a unica classe que roda.
 *
 * As bibliotecas compiladas entram no catalogo como entradas informativas
 * (kind: "compiled", sem dist), para o painel poder MOSTRA-LAS e explicar por
 * que ainda nao da, em vez de fingir que nao existem.
 *
 * USO
 *   node scripts/gen-pylib-catalog.js            # regrava o catalogo
 *   node scripts/gen-pylib-catalog.js --check    # so verifica, exit 1 se mudou
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getJson } = require('../main/net/fetcher');

const OUT = path.join(__dirname, '..', 'resources', 'pylib-catalog.json');
const PYPI = (name) => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;

/**
 * As bibliotecas oferecidas. `deps` e o fecho COMPLETO de dependencias, fixado a
 * mao: sem pip no runtime embarcado nao ha resolvedor, entao o catalogo entrega
 * a lista pronta e o instalador so baixa o que esta escrito.
 *
 * @type {Array<{
 *   id:string, pypi:string, deps:string[], category:string, icon:string,
 *   homepage:string, name:string,
 *   summary:{pt:string,en:string}, uses:{pt:string[],en:string[]}
 * }>}
 */
const CURATED = [
  /* ── Verificacao de hardware ────────────────────────────────────────────── */
  {
    id: 'pyuvm',
    pypi: 'pyuvm',
    deps: [], // cocotb ja vem no bundle
    category: 'hdl',
    icon: 'pyuvm',
    name: 'pyUVM',
    homepage: 'https://pyuvm.github.io/pyuvm/',
    summary: {
      pt: 'A metodologia UVM escrita em Python, sobre o cocotb. Organiza o testbench em agentes, sequencias e scoreboard em vez de um roteiro solto.',
      en: 'The UVM methodology written in Python, on top of cocotb. Structures the testbench into agents, sequences and a scoreboard instead of a loose script.',
    },
    uses: {
      pt: [
        'Estruturar a verificacao de um processador SAPHO em agentes e sequencias',
        'Separar o gerador de estimulos, o driver e o scoreboard em classes proprias',
        'Reaproveitar o mesmo ambiente de teste entre projetos do laboratorio',
      ],
      en: [
        'Structure the verification of a SAPHO processor into agents and sequences',
        'Split stimulus generator, driver and scoreboard into their own classes',
        'Reuse the same test environment across lab projects',
      ],
    },
  },
  {
    id: 'cocotb-bus',
    pypi: 'cocotb-bus',
    deps: [],
    category: 'hdl',
    icon: 'cocotb',
    name: 'cocotb-bus',
    homepage: 'https://github.com/cocotb/cocotb-bus',
    summary: {
      pt: 'Drivers e monitores de barramento prontos para cocotb (Avalon, AXI basico, OPB). Evita reescrever o handshake a mao no testbench.',
      en: 'Ready-made bus drivers and monitors for cocotb (Avalon, basic AXI, OPB). Avoids hand-writing the handshake in the testbench.',
    },
    uses: {
      pt: [
        'Dirigir o barramento do DUT sem implementar o protocolo de novo',
        'Monitorar transacoes e comparar contra um modelo de referencia',
        'Emular o front-end de aquisicao que entrega amostras ao processador',
      ],
      en: [
        'Drive the DUT bus without re-implementing the protocol',
        'Monitor transactions and compare against a reference model',
        'Emulate the acquisition front-end that feeds samples to the processor',
      ],
    },
  },
  {
    id: 'vcdvcd',
    pypi: 'vcdvcd',
    deps: [],
    category: 'hdl',
    icon: 'vcd',
    name: 'vcdvcd',
    homepage: 'https://github.com/cirosantilli/vcdvcd',
    summary: {
      pt: 'Le arquivos VCD em Python puro. Permite analisar a forma de onda que a simulacao gerou por codigo, sem abrir o visualizador.',
      en: 'Reads VCD files in pure Python. Lets you analyse the waveform a simulation produced programmatically, without opening a viewer.',
    },
    uses: {
      pt: [
        'Conferir por script se um sinal respeitou um limite ao longo de toda a simulacao',
        'Extrair uma serie temporal do VCD para comparar com o modelo de referencia',
        'Automatizar regressao: rodar, ler a onda e falhar sozinho quando desviar',
      ],
      en: [
        'Script-check whether a signal stayed within bounds across the whole run',
        'Extract a time series from the VCD to compare against the reference model',
        'Automate regression: run, read the wave and fail on its own when it drifts',
      ],
    },
  },
  {
    id: 'pyvcd',
    pypi: 'pyvcd',
    deps: [],
    category: 'hdl',
    icon: 'vcd',
    name: 'PyVCD',
    homepage: 'https://github.com/westerndigitalcorporation/pyvcd',
    summary: {
      pt: 'Escreve arquivos VCD a partir do Python. O caminho inverso do vcdvcd: transforma dados calculados em forma de onda.',
      en: 'Writes VCD files from Python. The reverse of vcdvcd: turns computed data into a waveform.',
    },
    uses: {
      pt: [
        'Despejar o modelo de referencia como onda para abrir no GTKWave ou no Surfer',
        'Ver lado a lado, no mesmo visualizador, o esperado e o que o SAPHO produziu',
      ],
      en: [
        'Dump the reference model as a wave to open in GTKWave or Surfer',
        'View expected and actual SAPHO output side by side in the same viewer',
      ],
    },
  },

  /* ── Matematica ─────────────────────────────────────────────────────────── */
  {
    id: 'mpmath',
    pypi: 'mpmath',
    deps: [],
    category: 'math',
    icon: 'mpmath',
    name: 'mpmath',
    homepage: 'https://mpmath.org/',
    summary: {
      pt: 'Aritmetica de ponto flutuante com precisao arbitraria. Da para fixar quantos bits de mantissa usar, o que casa com o float proprio do SAPHO.',
      en: 'Arbitrary-precision floating-point arithmetic. You choose how many mantissa bits to use, which lines up with SAPHO\'s own float format.',
    },
    uses: {
      pt: [
        'Modelar a aritmetica de 24 ou 32 bits do SAPHO (mantissa e expoente proprios, fora do IEEE 754)',
        'Separar o erro do metodo do erro do arredondamento do processador',
        'Produzir a referencia de alta precisao contra a qual o hardware e medido',
      ],
      en: [
        'Model SAPHO\'s 24- or 32-bit arithmetic (its own mantissa and exponent, outside IEEE 754)',
        'Separate method error from the processor\'s rounding error',
        'Produce the high-precision reference the hardware is measured against',
      ],
    },
  },
  {
    id: 'sympy',
    pypi: 'sympy',
    deps: ['mpmath'],
    category: 'math',
    icon: 'sympy',
    name: 'SymPy',
    homepage: 'https://www.sympy.org/',
    summary: {
      pt: 'Matematica simbolica: resolve, deriva, simplifica e gera codigo a partir de expressoes exatas, sem depender do NumPy.',
      en: 'Symbolic mathematics: solves, differentiates, simplifies and generates code from exact expressions, with no NumPy dependency.',
    },
    uses: {
      pt: [
        'Deduzir os coeficientes de um filtro IIR biquadratico de forma exata',
        'Verificar algebricamente a transformada que o algoritmo em C+- implementa',
        'Gerar a expressao de referencia e so entao arredonda-la para o formato do SAPHO',
      ],
      en: [
        'Derive biquad IIR filter coefficients exactly',
        'Algebraically check the transform the C+- algorithm implements',
        'Generate the reference expression and only then round it to SAPHO\'s format',
      ],
    },
  },

  /* ── Visualizacao ───────────────────────────────────────────────────────── */
  {
    id: 'plotly',
    pypi: 'plotly',
    deps: ['narwhals', 'packaging'],
    category: 'viz',
    icon: 'plotly',
    name: 'Plotly',
    homepage: 'https://plotly.com/python/',
    summary: {
      pt: 'Graficos interativos em HTML, com zoom e leitura de valor ponto a ponto. Gera arquivo que a propria AURORA abre.',
      en: 'Interactive HTML charts with zoom and point-by-point readout. Produces a file AURORA itself can open.',
    },
    uses: {
      pt: [
        'Plotar a saida do processador contra o modelo de referencia no mesmo grafico',
        'Mostrar o erro em escala logaritmica ao longo das amostras do ensaio',
        'Gerar relatorio de verificacao em HTML para anexar ao projeto',
      ],
      en: [
        'Plot processor output against the reference model on one chart',
        'Show error on a log scale across the run\'s samples',
        'Generate an HTML verification report to attach to the project',
      ],
    },
  },

  /* ── Testes e terminal ──────────────────────────────────────────────────── */
  {
    id: 'pytest',
    pypi: 'pytest',
    deps: ['iniconfig', 'packaging', 'pluggy', 'pygments', 'colorama'],
    category: 'test',
    icon: 'pytest',
    name: 'pytest',
    homepage: 'https://docs.pytest.org/',
    summary: {
      pt: 'Framework de testes do Python. Cobre o codigo de apoio dos testbenches e organiza casos com fixtures.',
      en: 'Python testing framework. Covers the testbenches\' supporting code and organises cases with fixtures.',
    },
    uses: {
      pt: [
        'Testar o gerador de estimulos e o modelo de referencia antes de rodar a simulacao',
        'Parametrizar um mesmo ensaio para varias frequencias ou configuracoes',
        'Escrever asserts legiveis com mensagem de falha detalhada',
      ],
      en: [
        'Test the stimulus generator and reference model before running the simulation',
        'Parameterise one test across several frequencies or configurations',
        'Write readable asserts with detailed failure messages',
      ],
    },
  },
  {
    id: 'rich',
    pypi: 'rich',
    deps: ['markdown-it-py', 'mdurl', 'pygments'],
    category: 'cli',
    icon: 'rich',
    name: 'Rich',
    homepage: 'https://rich.readthedocs.io/',
    summary: {
      pt: 'Saida formatada no terminal: tabelas, cores, barras de progresso e arvores. Aparece direto no terminal da AURORA.',
      en: 'Formatted terminal output: tables, colours, progress bars and trees. Shows up directly in AURORA\'s terminal.',
    },
    uses: {
      pt: [
        'Imprimir a tabela de metricas do ensaio no terminal, ja alinhada e colorida',
        'Destacar em vermelho a amostra que estourou o limite',
        'Mostrar o progresso de um ensaio longo de milhares de amostras',
      ],
      en: [
        'Print the run\'s metrics table in the terminal, aligned and coloured',
        'Highlight in red the sample that broke the limit',
        'Show progress of a long run over thousands of samples',
      ],
    },
  },
  {
    id: 'tabulate',
    pypi: 'tabulate',
    deps: [],
    category: 'cli',
    icon: 'tabulate',
    name: 'Tabulate',
    homepage: 'https://github.com/astanin/python-tabulate',
    summary: {
      pt: 'Tabelas de texto a partir de listas, sem nenhuma dependencia. Exporta tambem em Markdown e LaTeX.',
      en: 'Text tables from lists, with no dependencies. Also exports Markdown and LaTeX.',
    },
    uses: {
      pt: [
        'Formatar o resumo do ensaio em tabela alinhada',
        'Exportar a tabela de resultados em LaTeX direto para o artigo',
      ],
      en: [
        'Format the run summary as an aligned table',
        'Export the results table as LaTeX straight into the paper',
      ],
    },
  },
  // Fora da lista de proposito, com o motivo:
  //  - cocotb-coverage: depende de python-constraint (so publica sdist, sem
  //    wheel) e de PyYAML (so wheel compilada). Sem pip, nenhuma das duas entra.
  //  - Jinja2 / edalize / fusesoc: dependem de MarkupSafe ou PyYAML, mesma
  //    barreira. Fixar versao antiga para contornar trocaria um problema de
  //    compatibilidade por um de seguranca.
];

/**
 * As bibliotecas que o trabalho do laboratorio realmente pede e que HOJE nao
 * instalam, porque tem extensao em C.
 *
 * Nao e uma lista aleatoria de pacotes populares: e exatamente o ferramental
 * citado na metodologia publicada do grupo. O artigo de integracao do cocotb
 * descreve o testbench da PMU (norma IEC/IEEE 60255-118-1) com gerador de
 * estimulos, modelo de referencia em dupla precisao, filtro FIR classe M e
 * analise estatistica de TVE, FE e ROCOF — tudo apoiado em NumPy, SciPy e
 * Matplotlib. O artigo da CNN do TileCal compara a saida do SAPHO com a
 * referencia em Python por erro medio absoluto e R^2, mesma dependencia.
 *
 * Elas entram no catalogo justamente para o painel MOSTRAR isso e explicar o
 * motivo, em vez de fingir que nao existem. Sem `wheels`, o instalador nunca
 * tenta baixa-las.
 */
const COMPILED = [
  {
    id: 'numpy', name: 'NumPy', pypi: 'numpy', category: 'sci', icon: 'numpy',
    homepage: 'https://numpy.org/',
    summary: {
      pt: 'Vetores e matrizes numericas. E a base sobre a qual quase toda a analise numerica do laboratorio e escrita.',
      en: 'Numeric arrays and matrices. The base on which nearly all of the lab\'s numerical analysis is written.',
    },
    uses: {
      pt: [
        'Gerar o sinal de estimulo amostrado do ensaio (harmonico, ruido, degrau)',
        'Escrever o modelo de referencia em dupla precisao contra o qual o SAPHO e medido',
        'Calcular FFT, erro medio absoluto e R^2 sobre a saida da simulacao',
      ],
      en: [
        'Generate the run\'s sampled stimulus signal (harmonic, noise, step)',
        'Write the double-precision reference model SAPHO is measured against',
        'Compute FFT, mean absolute error and R^2 over the simulation output',
      ],
    },
  },
  {
    id: 'scipy', name: 'SciPy', pypi: 'scipy', category: 'sci', icon: 'scipy',
    homepage: 'https://scipy.org/',
    summary: {
      pt: 'Algoritmos cientificos sobre o NumPy: projeto de filtros, otimizacao, algebra linear e processamento de sinais.',
      en: 'Scientific algorithms on top of NumPy: filter design, optimisation, linear algebra and signal processing.',
    },
    uses: {
      pt: [
        'Projetar o filtro FIR classe M e os biquadrados IIR usados nos processadores',
        'Alinhar series temporais por DTW, como no detector de novidade',
        'Validar blocos de DSP embarcados contra a implementacao de referencia',
      ],
      en: [
        'Design the class-M FIR filter and the IIR biquads used in the processors',
        'Align time series by DTW, as in the novelty detector',
        'Validate embedded DSP blocks against the reference implementation',
      ],
    },
  },
  {
    id: 'matplotlib', name: 'Matplotlib', pypi: 'matplotlib', category: 'viz', icon: 'matplotlib',
    homepage: 'https://matplotlib.org/',
    summary: {
      pt: 'Graficos estaticos com qualidade de publicacao. Gera PNG, PDF e SVG, e e o que produz as figuras dos artigos do grupo.',
      en: 'Publication-quality static plots. Outputs PNG, PDF and SVG, and is what produces the group\'s paper figures.',
    },
    uses: {
      pt: [
        'Montar a figura de varios paineis com frequencia, TVE e desvio em escala log',
        'Gerar as figuras em PDF que vao direto para o artigo',
      ],
      en: [
        'Build the multi-panel figure with frequency, TVE and log-scale deviation',
        'Generate the PDF figures that go straight into the paper',
      ],
    },
  },
  {
    id: 'pandas', name: 'pandas', pypi: 'pandas', category: 'sci', icon: 'pandas',
    homepage: 'https://pandas.pydata.org/',
    summary: {
      pt: 'Tabelas de dados com indice, filtro e agregacao. Util quando a regressao acumula log de muitas execucoes.',
      en: 'Indexed data tables with filtering and aggregation. Useful once regression accumulates logs from many runs.',
    },
    uses: {
      pt: [
        'Cruzar os resultados de varias execucoes do mesmo ensaio',
        'Consolidar metricas por configuracao de processador e exportar em CSV',
      ],
      en: [
        'Cross-reference results from many runs of the same test',
        'Consolidate metrics per processor configuration and export to CSV',
      ],
    },
  },
];

/**
 * O que torna uma wheel instalavel no Python embarcado.
 *
 * O nome de uma wheel e `<dist>-<versao>(-<build>)?-<python>-<abi>-<plataforma>.whl`.
 * O que importa sao os DOIS ultimos campos: ABI `none` e plataforma `any`
 * significam "sem nada compilado dentro", e ai roda em qualquer interpretador.
 *
 * Testar so por 'py3-none-any' seria estreito demais: `colorama` publica
 * `py2.py3-none-any`, que e igualmente pura. O criterio certo e o sufixo
 * `-none-any.whl`, que cobre as duas formas.
 */
const PURE_SUFFIX = '-none-any.whl';

/** Escolhe a wheel pura de um release da PyPI. Retorna null se nao houver. */
function pickPureWheel(urls) {
  return (urls || []).find((u) => u.packagetype === 'bdist_wheel'
    && typeof u.filename === 'string'
    && u.filename.endsWith(PURE_SUFFIX)) || null;
}

async function resolvePackage(pypiName) {
  const meta = await getJson(PYPI(pypiName));
  const version = meta.info.version;
  const wheel = pickPureWheel(meta.urls);
  if (!wheel) {
    const tags = (meta.urls || []).filter((u) => u.packagetype === 'bdist_wheel')
      .map((u) => u.filename).slice(0, 3);
    throw new Error(
      `${pypiName} ${version} nao publica wheel pura (*${PURE_SUFFIX}) (tem: ${tags.join(', ') || 'nenhuma wheel'}) `
      + '— tem extensao em C, nao roda no Python embarcado',
    );
  }
  return {
    name: meta.info.name,
    version,
    filename: wheel.filename,
    url: wheel.url,
    sha256: wheel.digests.sha256,
    size: wheel.size,
    license: meta.info.license_expression || meta.info.license || null,
    requiresPython: meta.info.requires_python || null,
  };
}

async function main() {
  const check = process.argv.includes('--check');
  const libraries = [];
  const problems = [];

  for (const lib of CURATED) {
    try {
      const main_ = await resolvePackage(lib.pypi);
      const deps = [];
      for (const dep of lib.deps) deps.push(await resolvePackage(dep));

      const wheels = [main_, ...deps].map((w) => ({
        name: w.name, version: w.version, filename: w.filename, url: w.url,
        sha256: w.sha256, size: w.size,
      }));

      libraries.push({
        id: lib.id,
        name: lib.name,
        version: main_.version,
        kind: 'pure',
        category: lib.category,
        icon: lib.icon,
        homepage: lib.homepage,
        license: main_.license,
        requiresPython: main_.requiresPython,
        summary: lib.summary,
        uses: lib.uses,
        // Tamanho total baixado (a lib + o fecho de dependencias).
        downloadSize: wheels.reduce((n, w) => n + (w.size || 0), 0),
        wheels,
      });
      process.stdout.write(`[catalogo] ${lib.id} ${main_.version} (+${deps.length} deps)\n`);
    } catch (e) {
      problems.push(`${lib.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const lib of COMPILED) {
    libraries.push({
      id: lib.id,
      name: lib.name,
      version: null,
      kind: 'compiled',
      category: lib.category,
      icon: lib.icon,
      homepage: lib.homepage,
      license: null,
      requiresPython: null,
      summary: lib.summary,
      uses: lib.uses,
      downloadSize: 0,
      wheels: [],
      // Motivo exibido no painel, para o usuario entender em vez de so ver
      // um botao desabilitado.
      unavailable: 'compiled-abi',
    });
    process.stdout.write(`[catalogo] ${lib.id} (compilada — informativa)\n`);
  }

  const catalog = {
    schemaVersion: 1,
    // Sem data de geracao: o arquivo e commitado e uma data faria o --check
    // acusar diferenca a cada execucao.
    python: { validatedAgainst: '3.12', abiTag: 'cp312', platform: 'mingw_x86_64_msvcrt_gnu' },
    categories: {
      hdl:  { pt: 'Verificacao',   en: 'Verification' },
      math: { pt: 'Matematica',    en: 'Mathematics' },
      viz:  { pt: 'Visualizacao',  en: 'Visualisation' },
      test: { pt: 'Testes',        en: 'Testing' },
      cli:  { pt: 'Terminal',      en: 'Terminal' },
      sci:  { pt: 'Cientificas',   en: 'Scientific' },
    },
    libraries,
  };

  const json = `${JSON.stringify(catalog, null, 2)}\n`;

  if (problems.length) {
    process.stderr.write(`\n[catalogo] ${problems.length} entrada(s) recusada(s):\n`);
    for (const p of problems) process.stderr.write(`  - ${p}\n`);
  }

  if (check) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== json) {
      process.stderr.write('\n[catalogo] desatualizado — rode: node scripts/gen-pylib-catalog.js\n');
      process.exit(1);
    }
    process.stdout.write('[catalogo] em dia.\n');
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);
  process.stdout.write(`\n[catalogo] ${libraries.length} bibliotecas -> ${path.relative(process.cwd(), OUT)}\n`);
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`[catalogo] ERRO: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}

module.exports = { pickPureWheel, CURATED, COMPILED, PURE_SUFFIX };
