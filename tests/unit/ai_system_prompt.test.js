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

    // Ter a ferramenta e saber que ela existe sao coisas diferentes: o modelo
    // so ve este texto. Sem a secao do Simular ele conhece o PRISM como
    // desenho, e responde "nao consigo ver a onda" a uma pergunta que agora
    // tem resposta, com as doze ferramentas paradas no manifesto.
    it('teaches the PRISM simulation, the only simulation whose values it can read', () => {
        expect(SYSTEM_PROMPT).toContain('PRISM SIMULATE');
        for (const t of ['prism_sim_status', 'prism_sim_enter', 'prism_sim_set_input', 'prism_sim_run_until']) {
            expect(SYSTEM_PROMPT, `o prompt precisa citar ${t}`).toContain(t);
        }
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

// Cada afirmacao abaixo ja esteve errada no prompt, e cada uma faz o modelo dar
// um conselho errado. Conferidas contra o codigo do yanc em 08/08/2026, e de
// novo contra o v5.6 em 03/10/2026.
describe('as restricoes do SAPHO estao contadas como o yanc realmente se comporta', () => {
    it('diz que o yanc recusa NUGAIN fora de potencia de 2', () => {
        // Ate o v5.5 nada checava, e o prompt dizia isso. O yanc 2612bc59
        // (18/09/2026, no v5.6) passou a recusar no cmmcomp e no asmcomp
        // (MSG_ERR_NUGAIN_POW2), porque o divisor de verdade que o ula.v
        // inferia estourava o caminho critico.
        expect(SYSTEM_PROMPT).toContain('refused by cmmcomp and asmcomp');
        expect(SYSTEM_PROMPT).not.toContain('Nothing in yanc checks this');
        expect(SYSTEM_PROMPT).not.toContain('never tell the user yanc will reject it');
    });

    it('nao promete erro de build quando falta diretiva', () => {
        // asmcomp tem default para todas, e os defaults sao consistentes entre si,
        // entao um .cmm sem o bloco compila limpo num processador de 32 bits
        // (23 + 8 + 1 no v5.6; o prompt dizia 23 bits, de um yanc antigo).
        expect(SYSTEM_PROMPT).toContain('does\n' + '   NOT fail the build');
        expect(SYSTEM_PROMPT).toContain('32-bit processor the user never asked for');
        expect(SYSTEM_PROMPT).not.toContain('Missing even one of the nine directives = build error');
    });

    it('diz em que etapa a equacao da largura estoura', () => {
        // A checagem existe, mas mora no asmcomp: o header ruim passa pela etapa
        // CMM e so morre na etapa ASM, com uma mensagem que nomeia a equacao e nao
        // o arquivo.
        expect(SYSTEM_PROMPT).toContain('in asmcomp, not cmmcomp');
    });
});

// O modelo planeja otimizacao de assembly por este texto, e o numero de
// opcodes e as instrucoes de ponteiro mudaram no yanc v5.5 (LDA e STA sairam,
// LDI/STI ganharam base numerica). O resumo tem de bater com a tabela que o
// sync-sapho-rules gera do proprio yanc.
describe('o resumo do ISA bate com o sapho_rules.json', () => {
    const regras = JSON.parse(readFileSync(new URL('../../resources/sapho_rules.json', import.meta.url), 'utf8'));
    const ops = regras.asm.opcodes;

    it('as contagens de opcodes e mnemonicos sao as da tabela', () => {
        const opcodes = new Set(ops.map((o) => o.opcode)).size;
        expect(SYSTEM_PROMPT).toContain(`The ISA has ${opcodes} opcodes (0 to ${opcodes - 1}) and ${ops.length} mnemonics`);
    });

    it('ponteiro se le com LDI 0 e se grava com STI 0, sem LDA/STA', () => {
        expect(ops.some((o) => o.mnemonic === 'LDA' || o.mnemonic === 'STA')).toBe(false);
        expect(SYSTEM_PROMPT).toContain('read with LDI 0 and written with STI 0');
        expect(SYSTEM_PROMPT).not.toMatch(/\bLDA \(|\bSTA \(/);
    });
});

// A Aurora deixou de escrever #NDSTAC e #SDEPTH num processador novo: sem elas
// o yanc calcula a profundidade de cada pilha pelo programa. O prompt mandava o
// modelo exigir as nove diretivas e escrever todas sempre, o que poria as duas
// de volta em todo arquivo que ele tocasse.
describe('as pilhas ficam com o compilador', () => {
    it('NDSTAC e SDEPTH sao opcionais, e o modelo nao as acrescenta por conta propria', () => {
        expect(SYSTEM_PROMPT).toContain('#NDSTAC and #SDEPTH are OPTIONAL');
        expect(SYSTEM_PROMPT).not.toMatch(/Write all\s+nine/);
        expect(SYSTEM_PROMPT).not.toContain('All 9 core directives');
        expect(SYSTEM_PROMPT).not.toContain('#NDSTAC, #SDEPTH, #NUIOIN');
    });

    it('os padroes citados sao os do yanc que o instalador baixa', () => {
        // Numeros de Compilers/ASMComp/Sources/eval.c, iguais do v5.6 ao
        // v6.0. Quando o YANC_TAG mudar, este caso cai de proposito: reconfira
        // os padroes e o que uma pilha omitida vale, e atualize o prompt, o
        // docs/gabarito-ia.md e este teste juntos.
        expect(tagDe('download-yanc.js', 'YANC_TAG')).toBe('v6.0');
        expect(SYSTEM_PROMPT).toContain('NUBITS 32, NBMANT 23, NBEXPO 8');
        expect(SYSTEM_PROMPT).toContain('NUGAIN 128, FFTSIZ 3');
        // v5.7: omitida, a profundidade sai do programa (pico + 1, minimo 2).
        expect(SYSTEM_PROMPT).toContain('an omitted stack depth is worked out from the program');
        expect(SYSTEM_PROMPT).not.toContain('an omitted stack depth is 128');
    });

    it('diz quando ainda vale declarar a pilha: recursao em C++ e #PRACA', () => {
        // Com recursao em C++ a conta nao fecha e fica 128, com aviso; com
        // #PRACA a conta soma o pico da interrupcao ao do programa.
        expect(SYSTEM_PROMPT).toContain('recursion in C++ keeps 128');
        expect(SYSTEM_PROMPT).toContain('#PRACA');
        expect(SYSTEM_PROMPT).toMatch(/2 x peak \+ 1/);
    });
});

describe('quem mantem a Aurora', () => {
    it('e o Prof. Luciano; o Arthur nao mexe mais nela', () => {
        expect(SYSTEM_PROMPT).toContain('maintained by Prof. Luciano');
        expect(SYSTEM_PROMPT).not.toContain('Arthur Araujo Martins');
    });
});

// O que o yanc v5.7 mudou no que o modelo deve dizer (yanc/CHANGELOG, v5.7).
describe('o yanc v5.7', () => {
    it('recursao em C+- e erro de compilacao, e o caminho e o C++', () => {
        // Antes compilava e dava resultado errado: cada variavel local tem
        // endereco fixo. A mensagem real: "Erro na linha N: a funcao 'fact'
        // chama ela mesma (fact -> fact). Recursao nao rola em C+-. ..."
        expect(SYSTEM_PROMPT).toContain('Recursion is a COMPILE ERROR in C±');
        expect(SYSTEM_PROMPT).toContain('chama ela mesma');
    });

    it('codigo morto sai do .asm e do hardware, com uma linha Info', () => {
        expect(SYSTEM_PROMPT).toContain('unreachable instructions removed');
    });

    it('no C++, memcpy e memset contam palavras, e ponteiro de funcao compila', () => {
        expect(SYSTEM_PROMPT).toContain('memcpy/memset count WORDS');
        expect(SYSTEM_PROMPT).toContain('int (*fp)(int) = f;');
    });
});

// O que o yanc v6.0 mudou no que o modelo deve dizer (yanc/CHANGELOG, v6.0).
describe('o yanc v6.0', () => {
    it('toda divisao vira tres palavras, e o .asm feito a mao tem de escreve-las', () => {
        // O modelo escreve .asm no _aurora_opt; sem a sequencia o asmcomp recusa.
        // Mensagens de Compilers/ASMComp/Headers/messages.h na tag v6.0.
        expect(SYSTEM_PROMPT).toContain('DIV x; NOP; QUO      MOD x; NOP; REM      F_DIV x; NOP; F_QUO');
        expect(SYSTEM_PROMPT).toContain('S_DIV, S_MOD, SF_DIV');
        expect(SYSTEM_PROMPT).toContain('DIV leva três palavras');
        expect(SYSTEM_PROMPT).toContain('o programa termina no meio da sequência de DIV');
        expect(SYSTEM_PROMPT).toContain('Never drop the NOP');
        expect(SYSTEM_PROMPT).toContain('117 mnemonics');
    });

    it('cita o ganho medido e que SAPHO/ e asmcomp vem da mesma release', () => {
        expect(SYSTEM_PROMPT).toMatch(/9\.43 MHz in\s+v5\.7, 21\.9 MHz in v6\.0/);
        expect(SYSTEM_PROMPT).toContain('8.80 MHz in v5.7, 23.98 MHz');
        expect(SYSTEM_PROMPT).toContain('must come from the same yanc release');
    });
});
