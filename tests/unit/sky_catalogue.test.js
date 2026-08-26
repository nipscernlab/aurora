import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeCatalogue, bvToKelvin, kelvinToRGB } from '../../js/ui/sky_catalogue.js';

// O catálogo de estrelas da splash é um binário de 30 KB empacotado fora deste
// repositório, seis bytes por estrela. Nada no caminho normal reclama se ele
// chegar truncado, reempacotado com outro formato ou com os campos trocados: o
// desenho aceita qualquer número e a splash mostra um céu plausível e falso,
// que ninguém tem como distinguir de olho. Estes testes são a única coisa entre
// as duas situações.
//
// Por isso as asserções são sobre o céu, e não sobre o decodificador: quantas
// estrelas o olho nu alcança, até onde vai a magnitude, se os vetores são
// unitários, se as duas metades da esfera aparecem. Um arquivo errado erra
// alguma dessas.

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOGO = path.join(raiz, 'assets', 'data', 'hyg-mag6.bin');

describe('catálogo HYG da splash', () => {
  /** @type {ReturnType<typeof decodeCatalogue>} */
  let estrelas;

  beforeAll(() => {
    const buf = fs.readFileSync(CATALOGO);
    estrelas = decodeCatalogue(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  });

  it('tem as 5.044 estrelas do céu a olho nu, e o arquivo fecha em seis bytes por estrela', () => {
    expect(fs.statSync(CATALOGO).size).toBe(5044 * 6);
    expect(estrelas).toHaveLength(5044);
  });

  it('vai até a magnitude 6 e começa em Sirius', () => {
    const mags = estrelas.map((e) => e.mag);
    // O corte do catálogo. Uma folga de 0,05 absorve a quantização do uint8.
    expect(Math.max(...mags)).toBeLessThanOrEqual(6.05);
    // A mais brilhante do céu, magnitude -1,46. Se este número subir, o corte
    // veio de outro catálogo ou a escala do byte mudou.
    expect(Math.min(...mags)).toBeLessThan(-1.4);
    expect(Math.min(...mags)).toBeGreaterThan(-1.6);
  });

  it('põe cada estrela na esfera unitária', () => {
    for (const e of estrelas) {
      const n = Math.hypot(e.x, e.y, e.z);
      expect(n).toBeGreaterThan(0.999);
      expect(n).toBeLessThan(1.001);
    }
  });

  it('cobre os dois hemisférios', () => {
    // z é o seno da declinação: as duas metades têm que aparecer, e nenhuma
    // pode dominar. Um arquivo cortado pela metade falha exatamente aqui.
    const norte = estrelas.filter((e) => e.z > 0).length;
    expect(norte / estrelas.length).toBeGreaterThan(0.4);
    expect(norte / estrelas.length).toBeLessThan(0.6);
  });

  it('devolve cores que existem, puxadas para o branco', () => {
    for (const e of estrelas) {
      expect(e.rgb).toHaveLength(3);
      for (const c of e.rgb) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
        // A mistura de 55% com o branco é o que impede um céu de arco-íris.
        // Sem ela, canal zero é possível; com ela, o piso é 140.
        expect(c).toBeGreaterThanOrEqual(140);
      }
    }
  });
});

describe('cor por temperatura', () => {
  it('segue Ballesteros nos dois extremos que o catálogo alcança', () => {
    // B-V 0,00 é uma A0 como Vega, por definição da escala: perto de 10.000 K.
    expect(bvToKelvin(0)).toBeGreaterThan(9000);
    expect(bvToKelvin(0)).toBeLessThan(11000);
    // B-V 1,50 é uma M avermelhada, abaixo de 4.000 K.
    expect(bvToKelvin(1.5)).toBeLessThan(4000);
  });

  it('deixa a quente mais azul que a fria, e a fria mais vermelha que a quente', () => {
    const quente = kelvinToRGB(bvToKelvin(-0.3));
    const fria = kelvinToRGB(bvToKelvin(1.5));
    expect(quente[2]).toBeGreaterThan(fria[2]);
    expect(fria[0]).toBeGreaterThanOrEqual(quente[0]);
  });
});
