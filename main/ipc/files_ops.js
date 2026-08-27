// @ts-check
/**
 * files_ops.js: a parte pura do que o main/ipc/files.js faz com o disco e com
 * o sistema operacional: a decisao de renomear, a de sobrescrever, a ordem da
 * arvore, o comando que empacota o backup, o terminal nativo de cada
 * plataforma e a allowlist do open-external.
 *
 * Extraido de main/ipc/files.js em 08/08/2026, sem mudanca de comportamento.
 * O files.js e o arquivo de IPC com a maior superficie e o que mais toca
 * disco, e nao tinha um teste sequer, porque toda essa logica vivia dentro de
 * handlers de `ipcMain` num modulo que carrega `electron` no topo. Duas das
 * funcoes daqui sao de seguranca: `urlExternaPermitida` decide o que vai para
 * o `shell.openExternal`, e `aspasPowerShell` monta a linha de comando do
 * backup a partir de um caminho escolhido pelo usuario.
 *
 * Quem usa: main/ipc/files.js.
 */

const path = require('path');

/**
 * Ordem em que os itens de um diretorio aparecem na arvore: pasta antes de
 * arquivo, e dentro de cada grupo em ordem alfabetica local.
 *
 * Sai daqui como comparador em vez de ficar embutido no `readdir` porque a
 * ordem e contrato de interface: ela e o que o usuario ve, e mudar sem querer
 * reordena a arvore inteira.
 *
 * @param {{name: string, isDirectory: () => boolean}} a
 * @param {{name: string, isDirectory: () => boolean}} b
 * @returns {number}
 */
function compararEntradas(a, b) {
  if (a.isDirectory() && !b.isDirectory()) return -1;
  if (!a.isDirectory() && b.isDirectory()) return 1;
  return a.name.localeCompare(b.name);
}

/**
 * Diz qual e o plano para renomear ou mover um caminho.
 *
 * Tres casos, e o do meio e o que existe por causa do Windows. Trocar so a
 * caixa de um nome, `README.md` para `readme.md`, e a mesma entrada para o
 * `fs.stat`, entao a checagem de destino ocupado acusaria conflito com o
 * proprio arquivo e o `rename` direto seria no-op ou erro conforme o sistema
 * de arquivos. Por isso esse caso passa por um nome temporario. Fora dele, com
 * `overwrite` desligado o destino ocupado nao e erro nosso: e uma pergunta
 * para o usuario, e por isso vira `EEXIST` em vez de excecao.
 *
 * @param {string} oldPath
 * @param {string} newPath
 * @param {boolean} overwrite
 * @returns {{via: 'temporario', tmp: string} | {via: 'direto', checarDestino: boolean}}
 */
function planoDeRenomear(oldPath, newPath, overwrite) {
  const soMudaCaixa =
    oldPath.toLowerCase() === newPath.toLowerCase() && oldPath !== newPath;
  if (soMudaCaixa) {
    return { via: 'temporario', tmp: `${oldPath}.__aurora_case_tmp__` };
  }
  return { via: 'direto', checarDestino: !overwrite };
}

/**
 * Escapa uma string para dentro de aspas simples do PowerShell, onde a aspa
 * simples se escapa duplicando.
 *
 * O caminho vem do usuario e vai para a linha de comando do `Compress-Archive`.
 * Como a chamada e por `execFile`, o `-Command` chega como um argv unico e nao
 * ha uma segunda camada de shell para defender; sobra esta.
 *
 * @param {any} s
 * @returns {string}
 */
function aspasPowerShell(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * Linha de `Compress-Archive` que empacota o conteudo da pasta de preparo no
 * zip de destino.
 *
 * O `Compress-Archive` vem em toda instalacao do Windows suportada, e por isso
 * substituiu o `7z`, que quase nunca estava no PATH e deixava a pasta de
 * preparo para tras sem arquivo nenhum ao lado.
 *
 * @param {string} pastaPreparo
 * @param {string} zipDestino
 * @returns {string}
 */
function comandoCompactar(pastaPreparo, zipDestino) {
  return (
    `Compress-Archive -Path ${aspasPowerShell(path.join(pastaPreparo, '*'))} `
    + `-DestinationPath ${aspasPowerShell(zipDestino)} -Force`
  );
}

/**
 * Nomes dos artefatos de um backup a partir da pasta e do carimbo de tempo.
 *
 * @param {string} folderPath
 * @param {string} timestamp
 */
function nomesDoBackup(folderPath, timestamp) {
  const folderName = path.basename(folderPath);
  const pastaBackup = path.join(folderPath, 'Backup');
  const nomePreparo = `backup_${timestamp}`;
  return {
    pastaBackup,
    nomePreparo,
    pastaPreparo: path.join(folderPath, nomePreparo),
    zip: path.join(pastaBackup, `${folderName}_${timestamp}.zip`),
  };
}

/**
 * Diz se uma entrada do diretorio entra no backup.
 *
 * As duas exclusoes existem para o backup nao se comer: `Backup` guarda os zips
 * anteriores, e a pasta de preparo e o destino da copia que esta acontecendo.
 * Sem a segunda, a copia se copiaria recursivamente.
 *
 * @param {string} entrada
 * @param {string} nomePreparo
 * @returns {boolean}
 */
function entraNoBackup(entrada, nomePreparo) {
  return entrada !== 'Backup' && entrada !== nomePreparo;
}

/**
 * Diz se uma URL pode ser entregue ao navegador do sistema.
 *
 * O `shell.openExternal` abre `file://` de bom grado e entrega qualquer outro
 * esquema ao handler de protocolo registrado na maquina. Como a URL pode ter
 * nascido no renderer, inclusive dentro de uma mensagem escrita pelo modelo de
 * IA, so http, https e mailto passam.
 *
 * @param {any} url
 * @returns {boolean}
 */
function urlExternaPermitida(url) {
  if (typeof url !== 'string') return false;
  return /^(https?:|mailto:)/i.test(url);
}

/**
 * Diz se uma URL pode ser aberta como pagina de projeto do painel de
 * bibliotecas Python.
 *
 * Mais estreita que a `urlExternaPermitida` de proposito, e as duas ficam lado
 * a lado para a diferenca ser deliberada e nao acidental. Ali a URL e escolhida
 * por quem escreveu o link; aqui ela vem do catalogo de pacotes, que e dado de
 * fora do projeto, entao nem http sem TLS nem mailto entram.
 *
 * @param {any} url
 * @returns {boolean}
 */
function urlHomepagePermitida(url) {
  if (typeof url !== 'string') return false;
  return /^https:\/\//i.test(url);
}

/**
 * Comando que abre um terminal nativo numa pasta, por plataforma.
 *
 * No Windows o `start ""` abre um console NOVO, e o titulo vazio existe para o
 * caminho nao ser engolido como titulo da janela. O cwd vai na opcao de spawn,
 * nao no argumento, entao caminho com espaco ou acento nao quebra a chamada.
 *
 * @param {string} plataforma valor de `process.platform`
 * @param {string} dirPath
 * @param {string} [terminalPreferido] valor de `process.env.TERMINAL`
 * @returns {{comando: string, args: string[], usaCwd: boolean}}
 */
function comandoTerminalNativo(plataforma, dirPath, terminalPreferido) {
  if (plataforma === 'win32') {
    return { comando: 'cmd.exe', args: ['/c', 'start', '""', 'cmd.exe'], usaCwd: true };
  }
  if (plataforma === 'darwin') {
    return { comando: 'open', args: ['-a', 'Terminal', dirPath], usaCwd: false };
  }
  return { comando: terminalPreferido || 'x-terminal-emulator', args: [], usaCwd: true };
}

/**
 * Diretorio em que o dialogo de escolher pasta abre.
 *
 * Sem um valor explicito o Windows cai no ultimo diretorio usado pelo processo,
 * que acaba sendo a pasta do projeto aberto, e o usuario cria projeto dentro de
 * projeto sem perceber. O renderer manda a ultima pasta de "novo projeto"; na
 * falta dela, Documentos.
 *
 * @param {any} opcoes
 * @param {string} documentos
 * @returns {string}
 */
function pastaInicialDoDialogo(opcoes, documentos) {
  const pedido = opcoes && opcoes.defaultPath;
  return typeof pedido === 'string' && pedido ? pedido : documentos;
}

/**
 * Acha o registro de um watcher por id ou pelo caminho observado.
 *
 * O `stop-watching-file` aceita os dois, porque o renderer guarda ora um ora
 * outro conforme quem abriu o watcher.
 *
 * @param {Map<string, any>} watchers
 * @param {any} idOuCaminho
 * @returns {any}
 */
function acharWatcher(watchers, idOuCaminho) {
  for (const [filePath, info] of watchers.entries()) {
    if (info.id === idOuCaminho || filePath === idOuCaminho) return info;
  }
  return null;
}

/**
 * Diz se a ausencia de um caminho e resposta esperada em vez de falha.
 *
 * Varios chamadores leem arquivo opcional e tratam a ausencia. Registrar isso
 * como erro enchia o log de linha vermelha para condicao normal e escondia a
 * falha de verdade no meio.
 *
 * @param {any} erro
 * @returns {boolean}
 */
function ausenciaEsperada(erro) {
  return !!erro && erro.code === 'ENOENT';
}

module.exports = {
  compararEntradas,
  planoDeRenomear,
  aspasPowerShell,
  comandoCompactar,
  nomesDoBackup,
  entraNoBackup,
  urlExternaPermitida,
  urlHomepagePermitida,
  comandoTerminalNativo,
  pastaInicialDoDialogo,
  acharWatcher,
  ausenciaEsperada,
};
