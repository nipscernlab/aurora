import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ATALHOS, PADROES, ROTULOS, textoDoAtalho } from '../../js/utils/shortcut_table.js';

// A tabela existe porque havia DUAS listas de atalhos gravando na mesma chave
// do localStorage, e elas discordavam: a tela de configuracoes oferecia acoes
// que o gestor nao conhecia, e escondia uma que ele conhecia. Estes testes
// guardam as invariantes que aquele estado violava.

const pt = JSON.parse(readFileSync(new URL('../../locales/pt.json', import.meta.url), 'utf8'));
const en = JSON.parse(readFileSync(new URL('../../locales/en.json', import.meta.url), 'utf8'));

const porChave = (dic, caminho) => caminho.split('.').reduce((o, k) => (o ? o[k] : undefined), dic);

describe('tabela de atalhos', () => {
    it('toda acao tem rotulo nos dois idiomas', () => {
        const semRotulo = ATALHOS.filter((a) => !porChave(pt, a.rotulo) || !porChave(en, a.rotulo));
        expect(semRotulo.map((a) => a.acao)).toEqual([]);
    });

    it('toda acao sabe executar alguma coisa', () => {
        for (const a of ATALHOS) expect(typeof a.executar).toBe('function');
    });

    it('nenhuma combinacao de teclas serve a duas acoes', () => {
        const vistos = new Map();
        for (const a of ATALHOS) {
            const chave = textoDoAtalho(a.padrao);
            expect(vistos.has(chave), `${chave} em ${vistos.get(chave)} e ${a.acao}`).toBe(false);
            vistos.set(chave, a.acao);
        }
    });

    it('nenhuma acao aparece duas vezes', () => {
        const nomes = ATALHOS.map((a) => a.acao);
        expect(new Set(nomes).size).toBe(nomes.length);
    });

    it('PADROES e ROTULOS cobrem exatamente as mesmas acoes', () => {
        expect(Object.keys(PADROES).sort()).toEqual(Object.keys(ROTULOS).sort());
        expect(Object.keys(PADROES).sort()).toEqual(ATALHOS.map((a) => a.acao).sort());
    });

    it('as acoes de compilacao usam tecla de funcao, que sobrevive ao editor', () => {
        // Sem Ctrl, um atalho e engolido em campo de texto, e o Monaco e um
        // campo de texto. Compilar precisa disparar com o cursor no codigo.
        const compilar = ATALHOS.filter((a) => /^(compile|openPrism|cancelCompilation)/.test(a.acao));
        expect(compilar.length).toBeGreaterThan(4);
        for (const a of compilar) expect(a.padrao.key).toMatch(/^F([1-9]|1[0-2])$/);
    });

    it('textoDoAtalho escreve a combinacao na ordem de sempre', () => {
        expect(textoDoAtalho({ ctrlKey: true, shiftKey: true, altKey: false, key: 'S' })).toBe('Ctrl + Shift + S');
        expect(textoDoAtalho({ ctrlKey: false, shiftKey: false, altKey: false, key: 'F5' })).toBe('F5');
        expect(textoDoAtalho({ ctrlKey: false, shiftKey: true, altKey: false, key: 'F5' })).toBe('Shift + F5');
        expect(textoDoAtalho({})).toBe('');
    });
});
