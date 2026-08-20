// @ts-check
/**
 * registry.js: o catálogo de componentes e a resposta para "isto está aqui?".
 *
 * POR QUE EXISTE
 * --------------
 * O instalador passou de meio gigabyte porque carrega tudo. A saída é o usuário
 * baixar depois o que for usar, e aí nasce um estado que antes não existia: uma
 * AURORA instalada onde o GTKWave pode não estar. Tudo que chama ferramenta
 * precisa saber disso, e "tudo" aqui inclui os botões, as APIs de automação, a
 * Aurora Intelligence e os servidores de linguagem.
 *
 * A REGRA QUE SUSTENTA O RESTO
 * ----------------------------
 * A verificação NÃO é espalhada por quem chama. Ela mora onde já existe um
 * ponto obrigatório de passagem: `main/compile/binary_allowlist.js`. Todo
 * caminho que executa uma ferramenta já pede licença ali antes de nascer o
 * processo, e todo caminho já sabe lidar com licença negada. Ligando a ausência
 * de componente a esse mesmo veredito, um caminho novo criado amanhã fica
 * protegido sem ninguém lembrar de protegê-lo. O contrário, uma checagem por
 * chamador, é a forma conhecida de aparecer o furo: basta um chamador novo.
 *
 * PRESENÇA SE LÊ DO DISCO, NÃO SE GUARDA
 * --------------------------------------
 * Cada componente tem uma sentinela, o mesmo arquivo que o instalador dele usa
 * como prova de instalação. A presença é lida do disco, com uma memória de
 * poucos segundos apenas para não repetir `existsSync` dentro de um mesmo laço
 * de compilação. Guardar um booleano no boot seria errado nos dois sentidos: o
 * componente baixado durante a sessão continuaria invisível, e o componente
 * apagado com o aplicativo aberto continuaria "presente" até fechar.
 *
 * O QUE FICA NO INSTALADOR, E O QUE NÃO FICA
 * ------------------------------------------
 * Só os compiladores do YANC, que são doze megabytes e são o SAPHO em si.
 *
 * A cadeia de compilação NÃO fica, e essa é a decisão que sustenta a ideia
 * inteira: ela sozinha são 272 MB de download e 955 MB em disco, mais da
 * metade do instalador. Mantê-la dentro seria o mesmo que não ter
 * componentizado nada.
 *
 * O preço disso é honesto e precisa ser dito: numa máquina recém-instalada não
 * se compila até esse download terminar. Quem tenta é barrado pelo portão, com
 * a frase que diz o que baixar, e não com um erro de ferramenta não encontrada.
 *
 * `essencial` marca o que não pode ser removido. `requerParaCompilar` marca o
 * que a AURORA precisa para compilar qualquer coisa, e é o que faz a interface
 * tratar a ausência dele como assunto urgente em vez de recurso a menos. As
 * duas coisas eram uma só antes, e confundi-las foi o que quase deixou 955 MB
 * presos dentro do instalador.
 *
 * O PRÓXIMO CORTE
 * ---------------
 * A cadeia é hoje um pacote só, e não precisaria ser. Icarus, que é o que
 * simula, é pequeno; o volume está no mingw (g++, perl, cabeçalhos) que só o
 * Verilator usa, e no Python do cocotb. Separá-los faria o primeiro download
 * cair de 272 MB para algumas dezenas. Depende de publicar artefatos separados
 * no aurora-toolchain, que é fora deste repositório.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolvido na hora, e nao no import.
 *
 * `main/paths` pergunta o caminho ao `app`, que so responde dentro do Electron.
 * Amarrar isso ao import tornaria este catalogo impossivel de testar e o
 * quebraria se algum dia ele fosse carregado antes do app estar pronto. O
 * caminho nao muda durante a execucao, entao a resolucao fica guardada.
 */
let raizGuardada = null;
function raiz() {
  if (raizGuardada === null) raizGuardada = require('../paths').componentsPath;
  return raizGuardada;
}

/** Quanto tempo a leitura do disco vale antes de ser refeita. */
const VALIDADE_MS = 3000;

/**
 * O catálogo.
 *
 * `sentinela` é relativa a components/. `tamanhoMB` é o tamanho em disco e
 * `downloadMB` o que trafega, que são números bem diferentes e os dois
 * importam: um é o espaço que a pessoa cede, o outro é o tempo que ela espera.
 * `essencial` marca o que não pode ser removido. `requerParaCompilar` marca o
 * que a AURORA precisa para compilar qualquer coisa.
 *
 * @type {Array<{
 *   chave: string, nome: string, resumo: string, sentinela: string,
 *   tamanhoMB: number, downloadMB: number, essencial: boolean,
 *   requerParaCompilar?: boolean, script: string|null, arquivosChave: string[],
 * }>}
 */
const COMPONENTES = [
  {
    chave: 'msys',
    nome: 'MSYS Toolchain',
    resumo: 'A cadeia de compilação: Icarus Verilog, Verilator, Yosys e o Python embarcado.',
    sentinela: 'Packages/msys/mingw64/bin/verilator_bin.exe',
    arquivosChave: [
      'Packages/msys/mingw64/bin/iverilog.exe',
      'Packages/msys/mingw64/bin/vvp.exe',
      'Packages/msys/mingw64/bin/g++.exe',
      'Packages/msys/mingw64/bin/perl.exe',
    ],
    tamanhoMB: 955,
    downloadMB: 272,
    // Fora do instalador de propósito. É mais da metade dele, e mantê-la
    // dentro seria não ter componentizado nada. Removível como qualquer outro:
    // quem só edita e lê código não precisa de 955 MB parados no disco.
    essencial: false,
    requerParaCompilar: true,
    script: 'download-toolchain.js',
  },
  {
    chave: 'yanc',
    nome: 'YANC',
    resumo: 'O compilador do SAPHO: cmmcomp, asmcomp, appcomp e comp2gtkw, que traduzem C± em processador.',
    sentinela: 'bin/cppcomp.exe',
    arquivosChave: ['bin/cmmcomp.exe', 'bin/asmcomp.exe', 'bin/appcomp.exe'],
    tamanhoMB: 12,
    downloadMB: 5,
    // O único que fica no instalador. São doze megabytes, e é o SAPHO em si.
    essencial: true,
    requerParaCompilar: true,
    script: 'download-yanc.js',
  },
  {
    chave: 'gtkwave',
    nome: 'GTKWave',
    resumo: 'O visualizador de formas de onda clássico, em janela própria.',
    sentinela: 'Packages/gtkwave-nipscern/gtkwave.exe',
    arquivosChave: ['Packages/gtkwave-nipscern/fst2vcd.exe'],
    tamanhoMB: 88,
    downloadMB: 30,
    essencial: false,
    script: 'download-gtkwave-nipscern.js',
  },
  {
    chave: 'surfer',
    nome: 'Surfer',
    resumo: 'O visualizador de formas de onda embutido, dentro da AURORA.',
    sentinela: 'Packages/surfer/surfer-aurora.exe',
    arquivosChave: [],
    tamanhoMB: 43,
    downloadMB: 16,
    essencial: false,
    script: 'download-surfer.js',
  },
  {
    chave: 'verible',
    nome: 'Verible',
    resumo: 'Diagnósticos, formatação e navegação em Verilog, dentro do editor.',
    sentinela: 'Packages/verible/bin/verible-verilog-ls.exe',
    arquivosChave: [],
    tamanhoMB: 3,
    downloadMB: 2,
    essencial: false,
    script: 'download-verible.js',
  },
  {
    chave: 'slang',
    nome: 'slang',
    resumo: 'Análise semântica de SystemVerilog, que enxerga o que a sintática não vê.',
    sentinela: 'Packages/slang-server/bin/slang-server.exe',
    arquivosChave: [],
    tamanhoMB: 8,
    downloadMB: 3,
    essencial: false,
    script: 'download-slang-server.js',
  },
  {
    chave: 'clang-format',
    nome: 'clang-format',
    resumo: 'Formatação de C, C++ e C± com Shift+Alt+F.',
    sentinela: 'Packages/clang-format/bin/clang-format.exe',
    arquivosChave: [],
    tamanhoMB: 3,
    downloadMB: 2,
    essencial: false,
    script: 'download-clang-format.js',
  },
];

/** Índice por chave, montado uma vez. */
const PORCHAVE = new Map(COMPONENTES.map((c) => [c.chave, c]));

/** @type {Map<string, {quando: number, presente: boolean}>} */
const memoria = new Map();

/** Descarta a memória. Chamado ao instalar ou remover um componente. */
function invalidarCache(chave) {
  if (chave) memoria.delete(chave);
  else memoria.clear();
}

/** O componente, ou undefined. */
function obter(chave) {
  return PORCHAVE.get(chave);
}

/** O caminho absoluto da sentinela. */
function caminhoDaSentinela(chave) {
  const c = PORCHAVE.get(chave);
  if (!c) return null;
  return path.join(raiz(), ...c.sentinela.split('/'));
}

/**
 * O componente está instalado nesta máquina?
 *
 * Chave desconhecida devolve `true` de propósito. Isto aqui é uma cortesia, não
 * a fronteira de segurança: quem barra binário fora do lugar é o allowlist, e
 * ele continua barrando. Se um binário novo entrar no allowlist sem dono neste
 * catálogo, o certo é ele continuar funcionando e o teste de integridade
 * acusar a falta de dono, e não a ferramenta parar de funcionar em produção por
 * uma linha esquecida aqui.
 */
function estaInstalado(chave) {
  if (!PORCHAVE.has(chave)) return true;

  const agora = Date.now();
  const lembrado = memoria.get(chave);
  if (lembrado && agora - lembrado.quando < VALIDADE_MS) return lembrado.presente;

  let presente = false;
  try { presente = fs.existsSync(caminhoDaSentinela(chave)); }
  catch (_) { presente = false; }

  memoria.set(chave, { quando: agora, presente });
  return presente;
}

/**
 * Diagnostica um componente com mais rigor do que `estaInstalado`.
 *
 * A sentinela responde "a instalação terminou?". Ela não responde "a
 * instalação terminou INTEIRA?", e a diferença aparece justamente no caso que
 * mais acontece: download interrompido, zip truncado, extração pela metade.
 * Por isso o diagnóstico olha também os arquivos-chave, que são os binários
 * sem os quais o componente não serve para nada.
 *
 * Não executa nada. Rodar cada binário para ver se responde custaria segundos
 * por componente e dispararia antivírus em máquina de laboratório; a presença
 * dos arquivos pega o defeito real sem esse preço.
 *
 * @returns {{chave: string, estado: 'ok'|'ausente'|'incompleto', faltando: string[]}}
 */
function diagnosticar(chave) {
  const c = PORCHAVE.get(chave);
  if (!c) return { chave, estado: 'ausente', faltando: [] };

  if (!estaInstalado(chave)) return { chave, estado: 'ausente', faltando: [c.sentinela] };

  const faltando = (c.arquivosChave || []).filter((rel) => {
    try { return !fs.existsSync(path.join(raiz(), ...rel.split('/'))); }
    catch (_) { return true; }
  });
  return {
    chave,
    estado: faltando.length ? 'incompleto' : 'ok',
    faltando,
  };
}

/** O diagnóstico de todos, na ordem do catálogo. */
function diagnosticarTudo() {
  return COMPONENTES.map((c) => ({ ...diagnosticar(c.chave), essencial: c.essencial, nome: c.nome }));
}

/** O catálogo com o estado de cada um, para o painel. */
function listar() {
  return COMPONENTES.map((c) => ({
    ...c,
    instalado: estaInstalado(c.chave),
    caminho: caminhoDaSentinela(c.chave),
  }));
}

/**
 * A frase que o usuário lê quando pede algo que não está instalado.
 *
 * Uma função só, porque a mesma frase precisa aparecer igual no terminal, na
 * notificação, no retorno da API e no que a Aurora Intelligence recebe. Frases
 * diferentes para a mesma causa é o que faz um usuário achar que são problemas
 * diferentes.
 */
function mensagemDeAusencia(chave) {
  const c = PORCHAVE.get(chave);
  const nome = c ? c.nome : chave;
  // O numero citado e o do download, nao o do disco: neste momento a pessoa
  // quer saber quanto vai esperar, nao quanto vai ceder.
  return `${nome} não está instalado. Abra Configurações, Componentes, e baixe ${nome}`
    + `${c ? ` (${c.downloadMB} MB)` : ''} para usar este recurso.`;
}

module.exports = {
  COMPONENTES,
  listar,
  obter,
  estaInstalado,
  diagnosticar,
  diagnosticarTudo,
  caminhoDaSentinela,
  invalidarCache,
  mensagemDeAusencia,
  VALIDADE_MS,
};
