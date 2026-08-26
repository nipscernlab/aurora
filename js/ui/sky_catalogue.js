/**
 * The naked-eye sky, unpacked.
 *
 * 5.044 estrelas reais ate a magnitude 6, que e o que um olho sem instrumento
 * alcanca numa noite escura, cada uma na posicao catalogada, com o brilho
 * catalogado e a cor derivada do indice B-V. Os dados sao o HYG, Hipparcos
 * mais Yale mais Gliese, na forma compactada que o d3-celestial distribui,
 * cortada na magnitude 6 e espremida em seis bytes por estrela: ascensao
 * reta, declinacao, magnitude e indice de cor. 30 KB para o ceu inteiro.
 * CC BY-SA 4.0, creditado em THIRD_PARTY_NOTICES.md.
 *
 * Isto veio do site institucional (nipscernweb, assets/js/sky.js), que trocou
 * o campo aleatorio pelo ceu de verdade e deixou a splash da AURORA para tras
 * com a versao antiga. A decodificacao mora aqui, separada do desenho, por um
 * motivo pratico: e a unica parte que da para conferir sem tela e sem
 * empacotador, e um catalogo truncado ou reempacotado errado nao aparece como
 * erro, aparece como um ceu plausivel e falso. tests/unit/sky_catalogue.test.js
 * le o .bin do disco e passa por aqui.
 */

/* Formula de Ballesteros: indice de cor para temperatura efetiva. Publicada em
   "New insights into black bodies" (EPL 97, 2012), com alguns por cento de
   erro na faixa que o catalogo cobre. */
export function bvToKelvin(bv) {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/* Temperatura de corpo negro para sRGB, o ajuste por partes do lugar
   planckiano que e padrao para isto. Dessaturado de proposito no fim: estrela
   de verdade chega quase branca ao olho e so os extremos mostram cor, entao
   forcar a saturacao seria mais bonito e errado. */
export function kelvinToRGB(k) {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  /* Puxado 55% na direcao do branco. */
  const mix = (v) => c(v + (255 - v) * 0.55);
  return [mix(c(r)), mix(c(g)), mix(c(b))];
}

/* Vetor unitario a partir de ascensao reta e declinacao, ambas em graus. */
export function toVec(raDeg, decDeg) {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

/**
 * Desempacota o catalogo. Seis bytes por estrela, little-endian:
 *
 *   0..1  ascensao reta, uint16, fracao de 360 graus
 *   2..3  declinacao, int16, fracao de 90 graus
 *   4     magnitude, uint8, (v / 20) - 2, entao de -2 a +10.75
 *   5     indice de cor B-V, uint8, (v / 64) - 0.5
 *
 * @param {ArrayBuffer} buffer
 * @returns {{x:number,y:number,z:number,mag:number,rgb:number[]}[]}
 */
export function decodeCatalogue(buffer) {
  const dv = new DataView(buffer);
  const n = Math.floor(dv.byteLength / 6);
  const stars = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const ra = (dv.getUint16(o, true) / 65535) * 360;
    const dec = (dv.getInt16(o + 2, true) / 32767) * 90;
    const mag = dv.getUint8(o + 4) / 20 - 2;
    const bv = dv.getUint8(o + 5) / 64 - 0.5;
    const [x, y, z] = toVec(ra, dec);
    stars[i] = { x, y, z, mag, rgb: kelvinToRGB(bvToKelvin(bv)) };
  }
  return stars;
}
