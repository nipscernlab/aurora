// @ts-check
/**
 * git_parse.js: a parte pura do main/ipc/git.js: o que ele faz com o texto que
 * o git devolve, o envelope que atravessa o IPC e o cabecalho de autenticacao.
 *
 * Extraido de main/ipc/git.js em 08/08/2026, sem mudanca de comportamento. O
 * painel Git tinha 25 testes unitarios, e todos do lado do renderer
 * (`js/api/git_ns.js` e `js/tree/git_decorations.js`); o lado do processo
 * principal, que e quem le a saida do git de verdade, nao tinha nenhum, porque
 * tudo aqui vivia dentro de handlers de `ipcMain` e de closures dentro deles.
 *
 * Duas funcoes daqui doem quando erram e nao aparecem em teste manual. O
 * `limitarDiff` corta texto que pode ter megabytes e travava o painel; o
 * `cabecalhoDeToken` monta o header com o token do GitHub, que nunca pode ser
 * escrito na configuracao do repositorio.
 *
 * Quem usa: main/ipc/git.js.
 */

/**
 * Teto do texto de diff que atravessa o IPC.
 *
 * Um commit sozinho pode trazer megabytes quando o projeto versiona `.mif` e
 * `.hex` gerados, ou blob de terceiro. Renderizar isso de uma vez congelava o
 * painel.
 */
const MAX_DIFF_BYTES = 600 * 1024;

/**
 * Corta o diff no teto, sempre numa quebra de linha, e avisa que cortou.
 *
 * Cortar no meio de uma linha produziria uma linha de diff invalida, que o
 * destacador de sintaxe do painel colore errado ate o fim do bloco. Quando nao
 * ha quebra nenhuma dentro do teto, corta no teto mesmo: e um arquivo de uma
 * linha so, gigante, e nao ha ponto melhor.
 *
 * @param {any} texto
 * @param {number} [teto]
 * @returns {{diff: string, truncated: boolean}}
 */
function limitarDiff(texto, teto = MAX_DIFF_BYTES) {
  const s = String(texto == null ? '' : texto);
  if (s.length <= teto) return { diff: s, truncated: false };
  let corte = s.lastIndexOf('\n', teto);
  if (corte < 0) corte = teto;
  return { diff: s.slice(0, corte), truncated: true };
}

/**
 * Acumula uma saida de `git diff --numstat` num mapa por caminho.
 *
 * Acumula em vez de substituir porque o mesmo arquivo pode aparecer nas duas
 * chamadas que o painel faz, a do indice e a da arvore de trabalho, e o que a
 * lista de mudancas mostra e a soma das duas. Arquivo binario vem com `-` nas
 * duas colunas, e nesse caso nao ha o que somar: so a marca de binario.
 *
 * @param {Record<string, {additions: number, deletions: number, binary: boolean}>} mapa
 * @param {any} bruto
 * @returns {Record<string, {additions: number, deletions: number, binary: boolean}>} o proprio mapa
 */
function acumularNumstat(mapa, bruto) {
  for (const linha of String(bruto || '').split('\n')) {
    // O `\r` final aparece quando o git roda com autocrlf no Windows.
    const m = linha.replace(/\r$/, '').match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
    if (!m) continue;
    const binario = m[1] === '-' && m[2] === '-';
    const caminho = m[3];
    const atual = mapa[caminho] || { additions: 0, deletions: 0, binary: false };
    if (binario) {
      atual.binary = true;
    } else {
      atual.additions += Number(m[1]);
      atual.deletions += Number(m[2]);
    }
    mapa[caminho] = atual;
  }
  return mapa;
}

/**
 * Separa a saida de `git ls-files -z`, que vem terminada em NUL.
 *
 * O `-z` existe para caminho com espaco ou com quebra de linha no nome nao
 * partir em dois; separar por `\n` traria de volta exatamente esse defeito.
 *
 * @param {any} bruto
 * @returns {string[]}
 */
function separarCaminhosNUL(bruto) {
  return String(bruto || '').split('\0').filter(Boolean);
}

/**
 * Envelope de resposta que atravessa o IPC do painel Git.
 *
 * O contrato e nunca lancar por cima do IPC: sucesso vira `{ok: true, ...}` com
 * o objeto espalhado, e valor que nao e objeto entra como `value`, para o
 * chamador nao precisar adivinhar a forma.
 *
 * @param {any} dados
 * @returns {any}
 */
function envelopeOk(dados) {
  return { ok: true, ...(dados && typeof dados === 'object' ? dados : { value: dados }) };
}

/**
 * Envelope de falha, com a mensagem ja reduzida a texto.
 *
 * @param {any} erro
 * @returns {{ok: false, error: string}}
 */
function envelopeErro(erro) {
  return { ok: false, error: erro instanceof Error ? erro.message : String(erro) };
}

/**
 * Linha por arquivo que o painel consome, juntando o estado do git com a
 * contagem de linhas do numstat.
 *
 * @param {any} arquivo entrada de `status().files`
 * @param {any} numstat entrada correspondente do mapa do numstat, se houver
 */
function linhaDeArquivo(arquivo, numstat) {
  const ns = numstat || {};
  return {
    path: arquivo.path,
    index: arquivo.index,
    working: arquivo.working_dir,
    additions: ns.additions || 0,
    deletions: ns.deletions || 0,
    binary: !!ns.binary,
  };
}

/**
 * Configuracao de uma so vez que injeta o token do GitHub como cabecalho.
 *
 * Vai por `-c http.extraHeader` justamente para nao ser escrito na
 * configuracao do repositorio: o token e do usuario e a pasta do projeto pode
 * ser compartilhada ou versionada. Sem token, devolve vetor vazio, e o git cai
 * no gerenciador de credenciais do sistema, que e o caminho de sempre.
 *
 * @param {any} token
 * @returns {string[]}
 */
function cabecalhoDeToken(token) {
  if (!token || typeof token !== 'string') return [];
  const basico = Buffer.from(`x-access-token:${token}`).toString('base64');
  return [`http.extraHeader=Authorization: Basic ${basico}`];
}

/**
 * Normaliza o que o renderer manda como lista de arquivos.
 *
 * Os handlers de `stage`, `unstage` e `discard` aceitam um caminho solto ou uma
 * lista, porque o painel chama de um jeito quando e um clique na linha e de
 * outro quando e uma selecao. Entrada vazia vira lista vazia, e nao uma lista
 * com uma string vazia dentro, que o git leria como o diretorio inteiro.
 *
 * @param {any} arquivos
 * @returns {string[]}
 */
function normalizarArquivos(arquivos) {
  const lista = Array.isArray(arquivos) ? arquivos : [arquivos];
  return lista.filter((f) => typeof f === 'string' && f.length > 0);
}

module.exports = {
  MAX_DIFF_BYTES,
  limitarDiff,
  acumularNumstat,
  separarCaminhosNUL,
  envelopeOk,
  envelopeErro,
  linhaDeArquivo,
  cabecalhoDeToken,
  normalizarArquivos,
};
