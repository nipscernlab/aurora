// @ts-check
/**
 * citacoes.js: a pagina do manual vira documento citavel, e a citacao que volta
 * vira algo que a interface consegue mostrar.
 *
 * O QUE MUDA PARA QUEM USA. A Aurora Intelligence responde sobre o C+- e sobre
 * o SAPHO, e nenhum dos dois existe fora daqui: modelo generico inventa sintaxe
 * com toda a confianca do mundo. Ate agora a resposta vinha e a pessoa
 * acreditava. Com citations, cada afirmacao vem acompanhada do TRECHO REAL da
 * pagina do manual que a sustenta, com o indice do caractere onde ele comeca.
 * Nao e o modelo dizendo de onde acha que tirou: e o pedaco do texto.
 *
 * ONDE ISTO NAO ENTRA, e sao dois lugares.
 *
 * O primeiro: quando a assistente OPERA a IDE. Compilar, abrir onda, criar
 * arquivo: nao ha documento a citar, e enfiar um so para ter citacao seria
 * encenacao.
 *
 * O segundo, e este pega quem for testar: SO O CAMINHO DE API CITA. Os
 * provedores de assinatura (Claude Code e Codex) falam com a API por dentro da
 * propria CLI; a AURORA entrega a eles um system prompt e um servidor MCP
 * (main/ai/aurora_mcp_server.js), e nao monta o corpo do pedido. Nao ha onde
 * por o bloco de documento. Numa conversa por assinatura a mesma pergunta sobre
 * o manual e respondida igual, com search_manual e read_manual_page, e nenhuma
 * citacao aparece: nao esta quebrado, esta fora do alcance. O sinal na tela sao
 * os nomes de ferramenta, que pela assinatura chegam como
 * `mcp__aurora__read_manual_page` e pela API chegam sem prefixo.
 *
 * O CAMINHO, E POR QUE E ESTE. A API da Anthropic so aceita citacao em bloco de
 * documento dentro de mensagem de USUARIO. Resultado de ferramenta nao serve:
 * o `extractCitationDocuments` do provedor varre `role === 'user'` e mais nada
 * (conferido em @ai-sdk/anthropic 4.0.49, index.js:4343). Entao a pagina que o
 * modelo abriu com `read_manual_page` e reapresentada a ele como documento, numa
 * mensagem de usuario acrescentada pelo `prepareStep`, e e dali que a citacao
 * sai. O provedor junta mensagens `tool` e `user` seguidas num bloco so
 * (index.js:3449), entao isso nao quebra a alternancia de papeis que a API exige.
 *
 * GRANULARIDADE: TEXTO PURO, POR FRASE. Nao e preferencia, e o que da para
 * entregar. O formato de conteudo customizado, que deixaria escolher onde a
 * citacao pode cortar, produz citacao do tipo `content_block_location`, e o
 * `createCitationSource` do provedor devolve `undefined` para esse tipo
 * (index.js:3752): a citacao voltaria da API e seria descartada antes de virar
 * parte `source`. Sobram `char_location` (texto puro) e `page_location` (PDF).
 * E frase e a unidade certa de qualquer forma: as paginas do manual tem 5.550
 * caracteres em media, entao citar por secao citaria um terco de pagina, que
 * ninguem confere de relance.
 *
 * AS PAGINAS QUE NAO DEVEM SER CITADAS, e por que a decisao e por pagina. As de
 * referencia (`referencia/diretivas.html`, `referencia/biblioteca.html`) sao
 * tabela, e corte por frase numa tabela da lixo. Essas perguntas ja tem resposta
 * exata em `resources/sapho_rules.json`, pelas ferramentas `get_directive`,
 * `list_directives` e `list_opcodes`. Citar ali seria pior do que a ferramenta
 * que ja existe.
 *
 * O DOCUMENTO NAO LEVA MARCA DE CACHE, e isso e decisao, nao esquecimento. O
 * raciocinio inteiro esta em prompt_cache.js, no fim do arquivo: em duas linhas,
 * uma pagina custa uns 1.500 tokens, e cachea-la obrigaria a tirar o contexto
 * variavel de dentro do system para o fluxo de mensagens, porque o cache e por
 * prefixo e o que muda a cada turno invalidaria qualquer marca atras dele.
 * Reestruturar o que o modelo ve por 1.500 tokens nao se paga.
 *
 * Puro: monta e traduz objetos, nao chama nada. Os testes cobrem a forma exata
 * que o provedor espera, porque uma marca no lugar errado nao da erro, so deixa
 * de valer.
 */

'use strict';

/** Quantas paginas do manual acompanham um turno, no maximo. */
const MAX_PAGINAS = 4;

/**
 * Teto de caracteres somados. Quatro paginas medias dao uns 22 mil; o teto
 * existe para a pagina de 10.693 caracteres, a maior do manual, nao arrastar
 * tres irmas grandes junto.
 */
const MAX_CHARS = 40000;

/**
 * As paginas de tabela, que NAO viram documento citavel.
 * O motivo esta no cabecalho: corte por frase em tabela da lixo, e estas
 * perguntas ja tem ferramenta estruturada que responde exato.
 */
const PAGINAS_DE_TABELA = new Set([
  'referencia/diretivas.html',
  'referencia/biblioteca.html',
]);

/**
 * Esta chamada de ferramenta trouxe uma pagina do manual que vale citar?
 * Devolve a pagina, ou null.
 *
 * @param {string} ferramenta
 * @param {any} resultado o que o tool_bridge devolveu
 * @returns {{caminho: string, titulo: string, texto: string} | null}
 */
function paginaDoResultado(ferramenta, resultado) {
  if (ferramenta !== 'read_manual_page') return null;
  const d = resultado && resultado.ok !== false ? (resultado.data || resultado) : null;
  if (!d || typeof d.text !== 'string' || !d.text.trim()) return null;
  const caminho = String(d.path || '');
  if (PAGINAS_DE_TABELA.has(caminho)) return null;
  return { caminho, titulo: String(d.title || caminho), texto: d.text };
}

/**
 * Acrescenta a pagina a colecao do turno, sem repetir e sem estourar o teto.
 * Devolve true quando entrou.
 *
 * @param {Array<{caminho: string, titulo: string, texto: string}>} colecao
 * @param {{caminho: string, titulo: string, texto: string}} pagina
 */
function guardar(colecao, pagina) {
  if (!pagina) return false;
  if (colecao.length >= MAX_PAGINAS) return false;
  if (colecao.some((p) => p.caminho === pagina.caminho)) return false;
  const somados = colecao.reduce((n, p) => n + p.texto.length, 0);
  if (somados + pagina.texto.length > MAX_CHARS) return false;
  colecao.push(pagina);
  return true;
}

/**
 * A mensagem de usuario que carrega as paginas como documentos citaveis.
 *
 * A forma nao e escolha: `data: { type: 'text', text }` com
 * `mediaType: 'text/plain'` e o unico caminho que o provedor converte em bloco
 * `document` com `citations: { enabled: true }`. `filename` vira o caminho da
 * pagina, que e o que a interface usa depois para abrir o manual ali;
 * `title` vira o titulo, que e o que a citacao devolve.
 *
 * A linha de texto no fim existe para o modelo nao ler esta mensagem como uma
 * pergunta nova da pessoa. Ela e curta de proposito: e token de entrada pago
 * em todo passo seguinte do turno.
 *
 * @param {Array<{caminho: string, titulo: string, texto: string}>} paginas
 * @returns {any|null}
 */
function mensagemDeDocumentos(paginas) {
  if (!paginas || !paginas.length) return null;
  const content = paginas.map((p) => ({
    type: 'file',
    mediaType: 'text/plain',
    filename: p.caminho,
    data: { type: 'text', text: p.texto },
    providerOptions: {
      anthropic: {
        citations: { enabled: true },
        title: p.titulo,
        // `context` chega ao modelo mas nao entra no texto citavel.
        context: `Pagina do manual do SAPHO: ${p.caminho}`,
      },
    },
  }));
  content.push({
    type: 'text',
    text: 'Paginas do manual do SAPHO que voce acabou de abrir, anexadas para citacao. '
      + 'Responda a partir delas e nomeie a pagina na prosa; nao reproduza o texto literal, '
      + 'a citacao ja o traz.',
  });
  return { role: 'user', content };
}

/**
 * Esta mensagem foi montada aqui?
 *
 * Serve para nao duplicar: o `prepareStep` do AI SDK diz que a troca de
 * mensagens CARREGA para os passos seguintes, entao sem isto a mensagem de
 * documentos entraria de novo a cada passo e a pagina seria reenviada N vezes.
 * Reconhecida pela forma, sem campo extra: mensagem de usuario cujo primeiro
 * pedaco e um documento de texto com citacao ligada.
 *
 * @param {any} m
 */
function ehMensagemDeDocumentos(m) {
  if (!m || m.role !== 'user' || !Array.isArray(m.content) || !m.content.length) return false;
  const p = m.content[0];
  return !!(p && p.type === 'file' && p.mediaType === 'text/plain'
    && p.providerOptions && p.providerOptions.anthropic
    && p.providerOptions.anthropic.citations
    && p.providerOptions.anthropic.citations.enabled);
}

/**
 * As mensagens do passo com as paginas anexadas no fim, e sem a anexacao
 * anterior. Devolve a MESMA lista quando nao ha nada a anexar, para quem chama
 * poder devolver `undefined` ao SDK e nao mexer no passo.
 *
 * @param {Array<any>} messages
 * @param {Array<{caminho: string, titulo: string, texto: string}>} paginas
 */
function comDocumentos(messages, paginas) {
  const msgs = Array.isArray(messages) ? messages : [];
  const doc = mensagemDeDocumentos(paginas);
  if (!doc) return msgs;
  return msgs.filter((m) => !ehMensagemDeDocumentos(m)).concat([doc]);
}

/**
 * A parte `source` do fluxo vira o que a interface mostra, ou null quando nao
 * e citacao de documento nosso.
 *
 * O provedor entrega `citedText`, `startCharIndex` e `endCharIndex` em
 * `providerMetadata.anthropic`, o titulo em `title` e o caminho da pagina em
 * `filename`, que e o que ele carregou do `filename` que mandamos.
 *
 * @param {any} part
 */
function citacaoDaFonte(part) {
  if (!part || part.sourceType !== 'document') return null;
  const meta = (part.providerMetadata && part.providerMetadata.anthropic) || {};
  const trecho = String(meta.citedText || '').trim();
  if (!trecho) return null;
  return {
    id: String(part.id || ''),
    pagina: String(part.filename || ''),
    titulo: String(part.title || part.filename || ''),
    trecho,
    inicio: Number.isFinite(meta.startCharIndex) ? Number(meta.startCharIndex) : null,
    fim: Number.isFinite(meta.endCharIndex) ? Number(meta.endCharIndex) : null,
  };
}

module.exports = {
  MAX_PAGINAS,
  MAX_CHARS,
  PAGINAS_DE_TABELA,
  paginaDoResultado,
  guardar,
  mensagemDeDocumentos,
  ehMensagemDeDocumentos,
  comDocumentos,
  citacaoDaFonte,
};
