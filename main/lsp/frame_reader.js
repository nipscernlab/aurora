// @ts-check
/**
 * frame_reader.js: le os quadros `Content-Length` do stdout de um servidor de
 * linguagem em tempo linear.
 *
 * As duas pontes (verible_lsp.js e slang_lsp.js) faziam
 * `stdoutBuf = Buffer.concat([stdoutBuf, chunk])` a cada pedaco que chegava.
 * Numa resposta grande (o slang publica diagnosticos de um projeto inteiro de
 * uma vez, centenas de KB), cada pedaco de 64 KB copiava tudo o que ja tinha
 * chegado: custo quadratico no tamanho da resposta, no thread principal.
 *
 * Aqui os pedacos ficam numa lista. Enquanto o cabecalho do quadro atual ja
 * foi lido e o corpo ainda nao chegou inteiro, nada e copiado: so se soma o
 * tamanho. A consolidacao acontece uma vez por quadro, quando ele esta
 * completo, e o que sobra depois dele (o comeco do proximo) e pequeno.
 *
 * O protocolo e o do LSP: `Content-Length: N\r\n\r\n` seguido de N bytes de
 * JSON em UTF-8. Cabecalho sem tamanho e descartado; JSON invalido e
 * reportado e o leitor segue para o proximo quadro.
 */

'use strict';

const SEPARADOR = '\r\n\r\n';
const RE_TAMANHO = /content-length:\s*(\d+)/i;

/**
 * @param {(msg: any) => void} aoQuadro chamado com cada mensagem JSON decodificada.
 * @param {(erro: unknown) => void} [aoErro] chamado quando um corpo nao e JSON.
 */
function criarLeitorDeQuadros(aoQuadro, aoErro) {
  /** @type {Buffer[]} */
  let pedacos = [];
  let total = 0;
  /** Cabecalho do quadro em curso, quando ja lido: onde o corpo comeca e quanto tem. */
  /** @type {{ inicio: number, tamanho: number } | null} */
  let esperado = null;

  /** Junta a lista num Buffer so. Nao copia quando ja ha um unico pedaco. */
  const consolidar = () => {
    if (pedacos.length > 1) pedacos = [Buffer.concat(pedacos, total)];
    return pedacos[0] || Buffer.alloc(0);
  };

  /** Substitui a lista pelo que sobrou depois de `fim` bytes de `buf`. */
  const guardarResto = (/** @type {Buffer} */ buf, /** @type {number} */ fim) => {
    const resto = buf.subarray(fim);
    pedacos = resto.length ? [resto] : [];
    total = resto.length;
  };

  return {
    /** @param {Buffer} chunk */
    push(chunk) {
      if (!chunk || !chunk.length) return;
      pedacos.push(chunk);
      total += chunk.length;
      for (;;) {
        if (!esperado) {
          // Procurando o fim do cabecalho. Consolidar aqui e barato: entre um
          // quadro e o proximo o que ha na lista e o resto do anterior mais o
          // comeco deste, e cabecalho tem umas dezenas de bytes.
          const buf = consolidar();
          const sep = buf.indexOf(SEPARADOR);
          if (sep < 0) return;
          const cabecalho = buf.subarray(0, sep).toString('ascii');
          const m = RE_TAMANHO.exec(cabecalho);
          if (!m) {
            guardarResto(buf, sep + SEPARADOR.length);
            continue;
          }
          esperado = { inicio: sep + SEPARADOR.length, tamanho: parseInt(m[1], 10) };
        }
        const fim = esperado.inicio + esperado.tamanho;
        // Corpo ainda incompleto: acumula sem copiar. E isto que tira o custo
        // quadratico, porque e aqui que uma resposta grande passa o tempo.
        if (total < fim) return;
        const buf = consolidar();
        const corpo = buf.subarray(esperado.inicio, fim).toString('utf8');
        guardarResto(buf, fim);
        esperado = null;
        let msg;
        try {
          msg = JSON.parse(corpo);
        } catch (e) {
          if (aoErro) aoErro(e);
          continue;
        }
        aoQuadro(msg);
      }
    },

    /** Esquece tudo que estava acumulado. Usado quando o processo morre. */
    reset() {
      pedacos = [];
      total = 0;
      esperado = null;
    },

    /** Bytes acumulados ainda sem quadro completo. Para teste e diagnostico. */
    get pendente() {
      return total;
    },
  };
}

module.exports = { criarLeitorDeQuadros };
