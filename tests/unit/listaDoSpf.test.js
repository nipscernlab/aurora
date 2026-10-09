// js/project/lista_do_spf.ts: gravar uma lista do .spf sem reordenar.
//
// O hits (08/10/2026) depende do simulacao.v, so de `define, ser o primeiro da
// lista: o iverilog le na ordem e as macros so valem para o que vem depois. A
// arvore regravava a lista em ordem alfabetica e o mandava para o fim, sem
// erro nenhum.

import { describe, it, expect } from 'vitest';
import { manterOrdem } from '../../js/project/lista_do_spf.ts';

const e = (path, extra = {}) => ({ name: path.split('/').pop(), path, ...extra });
const chave = (p) => p.toLowerCase();

describe('manterOrdem', () => {
    it('quem ja estava fica onde estava, com os dados novos; quem chegou vai para o fim', () => {
        const gravada = [e('C:/p/simulacao.v'), e('C:/p/z.v'), e('C:/p/a.v')];
        const desejada = [e('C:/p/a.v', { isTopLevel: true }), e('C:/p/novo.v'), e('C:/p/simulacao.v'), e('C:/p/z.v')];
        expect(manterOrdem(gravada, desejada, chave).map((x) => [x.name, !!x.isTopLevel])).toEqual([
            ['simulacao.v', false], ['z.v', false], ['a.v', true], ['novo.v', false],
        ]);
    });

    it('quem saiu some do lugar onde estava; caminho com outra caixa e o mesmo', () => {
        const gravada = [e('C:/p/A.v'), e('C:/p/sai.v'), e('C:/p/b.v')];
        expect(manterOrdem(gravada, [e('C:/p/b.v'), e('C:/p/a.v')], chave).map((x) => x.path))
            .toEqual(['C:/p/a.v', 'C:/p/b.v']);
    });

    it('lista gravada ausente, estranha ou com entradas quebradas: vale a ordem desejada', () => {
        const desejada = [e('C:/p/b.v'), e('C:/p/a.v')];
        expect(manterOrdem(undefined, desejada, chave)).toEqual(desejada);
        expect(manterOrdem('nao e lista', desejada, chave)).toEqual(desejada);
        expect(manterOrdem([null, { name: 'sem caminho' }, e('C:/p/a.v')], desejada, chave).map((x) => x.name))
            .toEqual(['a.v', 'b.v']);
    });

    it('entrada repetida na lista gravada nao duplica', () => {
        const gravada = [e('C:/p/a.v'), e('C:/p/a.v')];
        expect(manterOrdem(gravada, [e('C:/p/a.v')], chave)).toHaveLength(1);
    });
});
