/**
 * Todo passo da toolchain tem nome legivel no historico de execucoes.
 *
 * O defeito que estes casos fecham: a tabela de `js/compilation/run_history.js`
 * tinha 16 passos e o `STEP_IDS` de `js/compilation/command_spec.ts` tem 18.
 * Os dois que faltavam eram justamente os do C++, `cpp-pp` e `cpp`, entao
 * compilar um processador C++ enchia a tela de historico com os ids crus
 * enquanto todos os outros passos apareciam traduzidos.
 *
 * Em vez de so acrescentar os dois, o que se trava aqui e a RELACAO: qualquer
 * passo novo no `STEP_IDS` precisa de rotulo, e o rotulo precisa existir nas
 * duas linguagens. Assim o proximo passo nao entra calado.
 *
 * A tabela so pode ser conferida porque saiu da tela para o
 * js/compilation/run_history_labels.ts: importar a tela sobe o gerenciador de
 * abas e o modulo de compilacao inteiros, e foi por isso que ela passou tanto
 * tempo sem teste.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { STEP_IDS } from '../../js/compilation/command_spec.ts';
import { nomeDoPasso } from '../../js/compilation/run_history_labels.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function traducoes(lingua) {
    const bruto = fs.readFileSync(path.join(RAIZ, 'locales', `${lingua}.json`), 'utf8');
    return JSON.parse(bruto).runHistory.step;
}

/** `runHistory.step.cppPp` -> `cppPp`. */
function folha(chave) {
    return String(chave).split('.').pop();
}

describe('nomeDoPasso: todo passo da toolchain tem rotulo', () => {
    it('nenhum dos 18 passos sai como o id cru', () => {
        // Sem `window.t`, o shim devolve a CHAVE de traducao. O que se afirma
        // e que a tabela conhece o passo, e nao que a traducao ja subiu.
        const semRotulo = STEP_IDS.filter((id) => nomeDoPasso(id) === id);
        expect(semRotulo, `sem rotulo: ${semRotulo.join(', ')}`).toEqual([]);
    });

    it('os dois passos do C++ estao entre eles', () => {
        expect(nomeDoPasso('cpp-pp')).toBe('runHistory.step.cppPp');
        expect(nomeDoPasso('cpp')).toBe('runHistory.step.cpp');
    });

    it('um passo desconhecido ainda sai como veio, que e melhor que escondido', () => {
        expect(nomeDoPasso('ferramenta-que-nao-existe')).toBe('ferramenta-que-nao-existe');
        expect(nomeDoPasso(null)).toBe('?');
    });
});

describe('as duas linguagens acompanham a tabela', () => {
    for (const lingua of ['en', 'pt']) {
        it(`${lingua}.json traduz todos os 18 passos`, () => {
            const t = traducoes(lingua);
            const faltando = STEP_IDS
                .map((id) => folha(nomeDoPasso(id)))
                .filter((chave) => !(chave in t));
            expect(faltando, `sem traducao em ${lingua}: ${faltando.join(', ')}`).toEqual([]);
        });

        it(`${lingua}.json nao guarda rotulo de passo que nao existe mais`, () => {
            const usadas = new Set(STEP_IDS.map((id) => folha(nomeDoPasso(id))));
            const sobrando = Object.keys(traducoes(lingua)).filter((k) => !usadas.has(k));
            expect(sobrando, `orfas em ${lingua}: ${sobrando.join(', ')}`).toEqual([]);
        });
    }
});
