// @ts-check
/**
 * pastas_ocultas.js: as pastas que sao da AURORA e nao do usuario nascem
 * ocultas no Windows.
 *
 * Sao duas, `.aurora` e `.slang`, e as duas ja sao escondidas DENTRO da
 * arvore do aplicativo (main/ipc/files_ops.entradaOcultaNaArvore). O que
 * faltava era o Explorer: no Windows o ponto no comeco do nome nao esconde
 * nada, ao contrario do que acontece nos outros sistemas, entao o aluno abria
 * a pasta do projeto dele e via duas pastas nossas no meio dos arquivos
 * dele, sem saber se podia apagar.
 *
 * Marcar na ABERTURA do projeto nao bastava, e foi assim que isto comecou:
 * qualquer um dos tres caminhos que criam `.aurora` (a Temp da compilacao, o
 * registro de execucoes, a memoria de projeto da Aurora Intelligence) podia
 * cria-la antes, e ela ficava a vista ate a proxima abertura. Agora quem
 * cria marca, e a abertura continua valendo como rede para o projeto que ja
 * existia sem a marca.
 *
 * Tudo aqui e melhor esforco e nada lanca: nao conseguir esconder uma pasta
 * nunca pode impedir uma compilacao. Mas o aviso sai em `warn`, e nao em
 * `debug`, porque uma falha silenciosa aqui e exatamente o que fez a pasta
 * aparecer.
 */

const path = require('path');
const { execFile } = require('child_process');
const log = require('electron-log');

/** Os nomes que escondemos. Um `Set` para a checagem por segmento ser barata. */
const NOMES_OCULTOS = new Set(['.aurora', '.slang']);

/**
 * Pastas ja marcadas nesta sessao, para nao nascer um `attrib` por arquivo
 * gravado. A marca e do sistema de arquivos e sobrevive ao processo; repetir
 * so custaria.
 * @type {Set<string>}
 */
const jaMarcadas = new Set();

/**
 * Marca a pasta como oculta no Windows.
 *
 * Fora do Windows nao faz nada: ali o ponto no nome ja basta, e e o que os
 * gerenciadores de arquivo respeitam.
 *
 * @param {string} dir caminho ABSOLUTO da pasta
 * @returns {Promise<boolean>} true se mandou marcar (nao garante que pegou)
 */
function ocultarPasta(dir) {
  if (process.platform !== 'win32') return Promise.resolve(false);
  if (!dir || !path.isAbsolute(dir)) return Promise.resolve(false);
  const chave = path.resolve(dir).toLowerCase();
  if (jaMarcadas.has(chave)) return Promise.resolve(true);
  jaMarcadas.add(chave);
  return new Promise((resolve) => {
    execFile('attrib', ['+h', path.resolve(dir)], { windowsHide: true, timeout: 5000 }, (err) => {
      if (err) {
        // Tira do registro: uma falha agora nao pode calar a proxima tentativa.
        jaMarcadas.delete(chave);
        log.warn('[pastas-ocultas] nao consegui esconder', dir, err.message);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

/**
 * Dado um caminho que acabou de ser criado, esconde a pasta nossa que houver
 * nele.
 *
 * Recebe o caminho INTEIRO porque quem cria normalmente cria um neto
 * (`<projeto>/.aurora/Temp/obj_dir_x`): o que precisa da marca e o ancestral
 * `.aurora`, e e ele que esta no meio do caminho. Marca o ancestral MAIS
 * ALTO que tenha um nome nosso, que e o que o Explorer mostra.
 *
 * @param {string} caminho arquivo ou pasta recem-criada, absoluto
 * @returns {Promise<boolean>}
 */
function ocultarPastaDeSistemaEm(caminho) {
  if (!caminho || typeof caminho !== 'string') return Promise.resolve(false);
  const resolvido = path.resolve(caminho);
  const partes = resolvido.split(path.sep);
  const i = partes.findIndex((p) => NOMES_OCULTOS.has(p.toLowerCase()));
  if (i <= 0) return Promise.resolve(false);
  return ocultarPasta(partes.slice(0, i + 1).join(path.sep));
}

/** Esquece o que foi marcado. So para o teste, que troca de pasta a cada caso. */
function esquecerMarcadas() {
  jaMarcadas.clear();
}

module.exports = { NOMES_OCULTOS, ocultarPasta, ocultarPastaDeSistemaEm, esquecerMarcadas };
