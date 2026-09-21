// api_surface_probe.cjs: a leitura da superficie da AuroraAPI, num lugar so.
//
// Dois lados usam exatamente esta funcao, e e por isso que ela nao mora em
// nenhum dos dois: o tests/e2e/api-surface.test.js, que compara a superficie
// com o retrato, e o atualizar-api-surface.js, que regrava o retrato. Se cada
// um tivesse a sua copia, uma poderia ler mais (ou menos) que a outra, e o
// teste passaria comparando uma coisa com outra.
//
// O corpo e serializado com toString() e avaliado DENTRO da pagina do
// Electron, entao ele nao pode fechar sobre nada deste arquivo.

'use strict';

/** Os namespaces da AuroraAPI e, em cada um, os nomes de funcao, ordenados. */
function lerSuperficie() {
  const api = window.AuroraAPI;
  const out = {};
  for (const [ns, valor] of Object.entries(api)) {
    if (!valor || typeof valor !== 'object') {
      out[ns] = typeof valor;
      continue;
    }
    out[ns] = Object.entries(valor)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .sort();
  }
  return out;
}

module.exports = { lerSuperficie };
