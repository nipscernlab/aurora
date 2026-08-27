import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { SYSTEM_PROMPT } from '../../js/ai/system_prompt.js';

/** Lê uma constante de tag de um script de download, que é onde a versão é fixada. */
function tagDe(script, constante) {
  const fonte = readFileSync(new URL(`../../components/Scripts/${script}`, import.meta.url), 'utf8');
  const m = fonte.match(new RegExp(`${constante}\\s*=\\s*['"]([^'"]+)['"]`));
  return m ? m[1] : null;
}

// Smoke guards for the extracted Aurora Intelligence system prompt: it must
// stay a single non-empty string and keep the project's load-bearing invariants
// (AURORA is feminine; the group works on ATLAS, NEVER LHCb) so an accidental
// edit/corruption fails loudly here instead of silently in a live chat turn.
describe('SYSTEM_PROMPT', () => {
    it('is one non-empty joined string (not an array)', () => {
        expect(typeof SYSTEM_PROMPT).toBe('string');
        expect(SYSTEM_PROMPT.length).toBeGreaterThan(1000);
    });

    it('preserves the core identity invariants', () => {
        expect(SYSTEM_PROMPT).toContain('AURORA INTELLIGENCE');
        expect(SYSTEM_PROMPT).toContain('NIPS-CERN');
        expect(SYSTEM_PROMPT).toContain('ATLAS');
        expect(SYSTEM_PROMPT).toContain('NEVER LHCb');
    });
});

// O inventario do toolchain envelhece calado. O prompt dizia YANC v5.2 durante
// todo o tempo em que o bundle ja trazia a 5.3, e nao ha como o modelo saber:
// ele nao ve os binarios, so este texto. Onde o repositorio fixa a versao, e
// contra o repositorio que conferimos; o que vive dentro do bundle msys
// (iverilog, verilator, yosys, python, cocotb) foi medido nos proprios binarios
// e nao tem fonte de verdade aqui, entao fica de fora deste bloco de proposito.
describe('o inventario do toolchain bate com o que o instalador baixa', () => {
    it('a versao do YANC citada e a tag que o download fixa', () => {
        const tag = tagDe('download-yanc.js', 'YANC_TAG');
        expect(tag, 'YANC_TAG saiu do download-yanc.js').toBeTruthy();
        // A tag e `v5.3`; o prompt escreve `v5.3` no ecossistema e `YANC 5.3`
        // no inventario, entao as duas grafias tem que acompanhar a tag.
        const numero = tag.replace(/^v/, '');
        expect(SYSTEM_PROMPT).toContain(`YANC ${numero}`);
        expect(SYSTEM_PROMPT).toContain(`Yet Another Compiler (v${numero}`);
    });

    it('a versao do slang-server citada e a tag que o download fixa', () => {
        const tag = tagDe('download-slang-server.js', 'SLANG_SERVER_TAG');
        expect(tag).toBeTruthy();
        expect(SYSTEM_PROMPT).toContain(`slang-server ${tag.replace(/^v/, '')}`);
    });

    it('a versao do Surfer citada e a do artefato do fork', () => {
        const fonte = readFileSync(
            new URL('../../components/Scripts/download-surfer.js', import.meta.url), 'utf8');
        // A tag do fork tem a forma `v<upstream>-nips.<n>`; o que o prompt cita e
        // a versao do Surfer de origem, que e o prefixo dela. O sufixo `-nips.<n>`
        // anda sozinho a cada build do fork, entao NAO se escreve ele aqui: e o
        // regex que extrai o prefixo, e so um bump de upstream mexe no prompt.
        const m = fonte.match(/tag:\s*'v?([0-9]+\.[0-9]+\.[0-9]+)/);
        expect(m, 'a tag do fork saiu do download-surfer.js').toBeTruthy();
        expect(SYSTEM_PROMPT).toContain(`Surfer ${m[1]}`);
    });

    it('diz o limite de cada ferramenta, e nao so a versao', () => {
        // O limite e o que muda a resposta: sem ele o modelo promete visibilidade
        // interna sob Verilator, ou manda instalar coisa que ja vem no pacote.
        expect(SYSTEM_PROMPT).toContain('only top-level user signals');
        expect(SYSTEM_PROMPT).toContain('NOT a synthesis flow');
        expect(SYSTEM_PROMPT).toContain('never tell the user to install a toolchain component');
        // E o unico formatador que pode faltar precisa aparecer como podendo faltar.
        expect(SYSTEM_PROMPT).toContain('pip install black');
    });
});

// As tres afirmacoes abaixo estavam erradas no prompt, e cada uma faz o modelo
// dar um conselho errado. Conferidas contra o codigo do yanc em 08/08/2026.
describe('as restricoes do SAPHO estao contadas como o yanc realmente se comporta', () => {
    it('nao promete que o yanc rejeita NUGAIN fora de potencia de 2', () => {
        // Nada em yanc checa isso: o valor vai direto para o Verilog e o ula.v faz
        // `out = in/NUGAIN`. Potencia de 2 e o que faz a divisao virar um shift de
        // graca na sintese; o resto infere um divisor de verdade. E custo de
        // hardware, e nao erro de compilacao.
        expect(SYSTEM_PROMPT).toContain('Nothing in yanc checks this');
        expect(SYSTEM_PROMPT).toContain('REAL DIVIDER');
        expect(SYSTEM_PROMPT).not.toContain('non-power-of-2 values are rejected');
    });

    it('nao promete erro de build quando falta diretiva', () => {
        // asmcomp tem default para todas, e os defaults sao consistentes entre si,
        // entao um .cmm sem o bloco compila limpo num processador de 23 bits.
        expect(SYSTEM_PROMPT).toContain('does\n' + '   NOT fail the build');
        expect(SYSTEM_PROMPT).toContain('23-bit processor the user never asked for');
        expect(SYSTEM_PROMPT).not.toContain('Missing even one of the nine directives = build error');
    });

    it('diz em que etapa a equacao da largura estoura', () => {
        // A checagem existe, mas mora no asmcomp: o header ruim passa pela etapa
        // CMM e so morre na etapa ASM, com uma mensagem que nomeia a equacao e nao
        // o arquivo.
        expect(SYSTEM_PROMPT).toContain('in asmcomp, not cmmcomp');
    });
});
