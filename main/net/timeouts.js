// @ts-check
/**
 * timeouts.js: a tabela unica dos prazos de rede e de processo filho fora do
 * subsistema de IA, irma da que vive em main/ai/timeouts.js.
 *
 * Cada valor aqui existe porque, sem ele, alguma coisa pendurava para sempre
 * sem uma linha no log: uma requisicao ao GitHub contra um portal cativo, um
 * git push contra um remoto que aceita a conexao e nao responde, um bsdtar
 * encalhado num arquivo travado pelo antivirus. O levantamento de 22/08/2026
 * (TODO, secao 5) encontrou todos esses sem prazo nenhum.
 *
 * Dois tipos de prazo, e a diferenca importa:
 *
 *   - OCIOSIDADE: conta desde o ultimo byte, e zera a cada byte novo. Serve
 *     para transferencias longas cujo tamanho ninguem sabe de antemao (clone,
 *     download). Um clone de dois gigabytes num link lento nao estoura
 *     enquanto houver bytes chegando.
 *   - ABSOLUTO: conta desde o inicio. Serve para o que tem tamanho conhecido
 *     e resposta curta (uma chamada de API, a extracao de um arquivo).
 *
 * Importe daqui; nunca escreva o numero no ponto de uso.
 */

'use strict';

/** Uma chamada a api.github.com: pedido pequeno, resposta pequena. Absoluto. */
const GITHUB_API_MS = 20_000;

/** Avatar do usuario: e decoracao, entao espera menos que a API. Absoluto. */
const GITHUB_AVATAR_MS = 10_000;

/**
 * Qualquer comando git: ociosidade. O simple-git zera o contador a cada byte
 * em stdout ou stderr, e o git com --progress escreve no stderr o tempo todo
 * durante um clone ou um push, entao um transferencia viva nunca estoura; so
 * estoura a que parou de falar, que e o caso de um remoto que nao responde e
 * de um pedido de senha que ninguem vai digitar.
 */
const GIT_IDLE_MS = 120_000;

/**
 * Extracao com o bsdtar: absoluto. A cadeia de compilacao do MSYS tem dezessete
 * mil arquivos e ja foi medida em bem menos que isso; uma extracao que passe
 * de dez minutos esta encalhada, nao lenta.
 */
const EXTRACT_MS = 10 * 60_000;

/**
 * Subida do servidor do Surfer: o tempo de parse do FST cresce com o dump, e
 * esta base ja mediu dumps de 854 MB. O prazo e proporcional ao arquivo, com
 * piso e teto; a funcao fica ao lado das constantes para ser testavel.
 */
const SURFER_BOOT_BASE_MS = 30_000;
const SURFER_BOOT_PER_MB_MS = 500;
const SURFER_BOOT_MAX_MS = 5 * 60_000;

/**
 * @param {number} fileBytes tamanho do dump em bytes (0 ou NaN valem como 0)
 * @returns {number} prazo em milissegundos
 */
function surferBootDeadlineMs(fileBytes) {
  const mb = Number.isFinite(fileBytes) && fileBytes > 0 ? fileBytes / (1024 * 1024) : 0;
  return Math.min(SURFER_BOOT_MAX_MS, Math.round(SURFER_BOOT_BASE_MS + mb * SURFER_BOOT_PER_MB_MS));
}

// Autoverificacao no carregamento: a ordem e parte do contrato. Um avatar nao
// pode esperar mais que a API que o serve, e o piso do Surfer nao pode passar
// do teto.
if (GITHUB_AVATAR_MS > GITHUB_API_MS) {
  throw new Error('net/timeouts.js: GITHUB_AVATAR_MS nao pode passar de GITHUB_API_MS');
}
if (SURFER_BOOT_BASE_MS > SURFER_BOOT_MAX_MS) {
  throw new Error('net/timeouts.js: o piso do Surfer nao pode passar do teto');
}

module.exports = {
  GITHUB_API_MS,
  GITHUB_AVATAR_MS,
  GIT_IDLE_MS,
  EXTRACT_MS,
  SURFER_BOOT_BASE_MS,
  SURFER_BOOT_PER_MB_MS,
  SURFER_BOOT_MAX_MS,
  surferBootDeadlineMs,
};
