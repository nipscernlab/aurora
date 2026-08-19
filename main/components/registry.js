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
 * O QUE NÃO É COMPONENTE
 * ----------------------
 * O MSYS, com Icarus, Verilator e o Python embarcado, e os compiladores do
 * YANC. Sem eles não se compila, e não compilar não é uma AURORA reduzida, é
 * uma AURORA quebrada. Ficam marcados como `essencial` e viajam no instalador.
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
 * `sentinela` é relativa a components/. `tamanhoMB` é o tamanho instalado, para
 * o painel dizer quanto custa antes de a pessoa aceitar. `essencial` marca o que
 * vem no instalador e não pode ser removido.
 *
 * @type {Array<{
 *   chave: string, nome: string, resumo: string, sentinela: string,
 *   tamanhoMB: number, essencial: boolean, script: string|null,
 * }>}
 */
const COMPONENTES = [
  {
    chave: 'msys',
    nome: 'Cadeia de compilação',
    resumo: 'Icarus Verilog, Verilator, Yosys e o Python embarcado. É o que compila e simula.',
    sentinela: 'Packages/msys/mingw64/bin/verilator_bin.exe',
    tamanhoMB: 955,
    essencial: true,
    script: 'download-toolchain.js',
  },
  {
    chave: 'yanc',
    nome: 'Compiladores do SAPHO',
    resumo: 'cmmcomp, asmcomp, appcomp e comp2gtkw, que traduzem C± em processador.',
    sentinela: 'bin/cppcomp.exe',
    tamanhoMB: 12,
    essencial: true,
    script: 'download-yanc.js',
  },
  {
    chave: 'gtkwave',
    nome: 'GTKWave',
    resumo: 'O visualizador de formas de onda clássico, em janela própria.',
    sentinela: 'Packages/gtkwave-nipscern/gtkwave.exe',
    tamanhoMB: 88,
    essencial: false,
    script: 'download-gtkwave-nipscern.js',
  },
  {
    chave: 'surfer',
    nome: 'Surfer',
    resumo: 'O visualizador de formas de onda embutido, dentro da AURORA.',
    sentinela: 'Packages/surfer/surfer-aurora.exe',
    tamanhoMB: 43,
    essencial: false,
    script: 'download-surfer.js',
  },
  {
    chave: 'verible',
    nome: 'Verible',
    resumo: 'Diagnósticos, formatação e navegação em Verilog, dentro do editor.',
    sentinela: 'Packages/verible/bin/verible-verilog-ls.exe',
    tamanhoMB: 3,
    essencial: false,
    script: 'download-verible.js',
  },
  {
    chave: 'slang',
    nome: 'slang',
    resumo: 'Análise semântica de SystemVerilog, que enxerga o que a sintática não vê.',
    sentinela: 'Packages/slang-server/bin/slang-server.exe',
    tamanhoMB: 8,
    essencial: false,
    script: 'download-slang-server.js',
  },
  {
    chave: 'clang-format',
    nome: 'clang-format',
    resumo: 'Formatação de C, C++ e C± com Shift+Alt+F.',
    sentinela: 'Packages/clang-format/bin/clang-format.exe',
    tamanhoMB: 3,
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
  return `${nome} não está instalado. Abra Configurações, Componentes, e baixe ${nome}`
    + `${c ? ` (${c.tamanhoMB} MB)` : ''} para usar este recurso.`;
}

module.exports = {
  COMPONENTES,
  listar,
  obter,
  estaInstalado,
  caminhoDaSentinela,
  invalidarCache,
  mensagemDeAusencia,
  VALIDADE_MS,
};
