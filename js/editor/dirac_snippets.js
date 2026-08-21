/**
 * dirac_snippets.js: como se digita a notacao de Dirac.
 *
 * O PROBLEMA
 * ----------
 * A notacao de Dirac e a marca do C±, e os simbolos dela nao estao no teclado.
 * O compilador aceita `⟨` (U+27E8) e `⟩` (U+27E9), e so eles: os sinais `<` e
 * `>` do teclado sao comparacao, e nao ha como o analisador lexico distinguir
 * um do outro sem inventar ambiguidade onde hoje nao ha. O resultado pratico
 * era que a funcionalidade mais distintiva da linguagem so estava ao alcance
 * de quem soubesse copiar o caractere de outro lugar.
 *
 * A SAIDA
 * -------
 * O editor completa. Digite `ket` e aceite a sugestao para receber `|⟩` com o
 * cursor no meio; o mesmo para `bra`, para as formas de declaracao e para as
 * quatro operacoes inteiras. Quem prefere o caractere solto tem `>>` e `<<` na
 * lista tambem, com o nome por extenso, porque procurar por "bra" e o que uma
 * pessoa faz quando sabe o nome mas nao acha a tecla.
 *
 * POR QUE COMPLETAR, E NAO SUBSTITUIR AO DIGITAR
 * ---------------------------------------------
 * Trocar `>` por `⟩` sozinho, enquanto a pessoa escreve, quebraria toda
 * comparacao escrita depois. A sugestao pede confirmacao, entao ela nunca
 * decide errado por conta propria.
 *
 * A fonte da verdade dos simbolos e o `resources/sapho_rules.json`, extraido
 * do proprio yanc (secao `diracTokens`); os testes comparam esta lista com a
 * de la, para uma mudanca no compilador nao deixar o editor ensinando um
 * simbolo que nao existe mais.
 */

/** O bra e o ket, na forma que o lexer do yanc reconhece. */
export const KET_ABRE = '⟨';   // ⟨
export const KET_FECHA = '⟩';  // ⟩

/**
 * O que a lista de sugestoes oferece num arquivo .cmm.
 *
 * `insercao` usa a sintaxe de snippet do Monaco: `$1` e onde o cursor para,
 * `$0` e onde ele termina. `gatilhos` sao as palavras que casam com a entrada
 * digitada, alem do rotulo.
 */
export const SUGESTOES_DIRAC = Object.freeze([
  {
    rotulo: 'ket',
    detalhe: `|v${KET_FECHA}  vetor coluna`,
    insercao: `|\${1:v}${KET_FECHA}`,
    gatilhos: ['ket', 'vetor', 'dirac'],
    doc: 'Vetor coluna. O simbolo de fechamento e ⟩ (U+27E9), que nao existe no teclado.',
  },
  {
    rotulo: 'bra',
    detalhe: `${KET_ABRE}v|  vetor linha (transposto)`,
    insercao: `${KET_ABRE}\${1:v}|`,
    gatilhos: ['bra', 'transposto', 'dirac'],
    doc: 'Vetor linha, o transposto do ket. O simbolo de abertura e ⟨ (U+27E8).',
  },
  {
    rotulo: 'braket',
    detalhe: `${KET_ABRE}a|b${KET_FECHA}  produto interno`,
    insercao: `${KET_ABRE}\${1:a}|\${2:b}${KET_FECHA}`,
    gatilhos: ['braket', 'produto', 'interno', 'inner', 'dirac'],
    doc: 'Produto interno de dois vetores. Devolve um escalar.',
  },
  {
    rotulo: 'dirac-matriz-vetor',
    detalhe: `a # |M|b${KET_FECHA};  matriz por vetor`,
    insercao: `\${1:a} # |\${2:M}|\${3:b}${KET_FECHA};`,
    gatilhos: ['mv', 'matriz', 'matvec', 'dirac'],
    doc: 'a recebe M vezes b. O compilador gera os lacos.',
  },
  {
    rotulo: 'dirac-escalar-vetor',
    detalhe: `a # c|b${KET_FECHA};  escalar por vetor`,
    insercao: `\${1:a} # \${2:c}|\${3:b}${KET_FECHA};`,
    gatilhos: ['cv', 'escalar', 'dirac'],
    doc: 'a recebe c vezes b, elemento a elemento. Use para escalar um vetor inteiro numa linha.',
  },
  {
    rotulo: 'dirac-produto-externo',
    detalhe: `A # |a${KET_FECHA}${KET_ABRE}b|;  produto externo`,
    insercao: `\${1:A} # |\${2:a}${KET_FECHA}${KET_ABRE}\${3:b}|;`,
    gatilhos: ['vvt', 'externo', 'outer', 'dirac'],
    doc: 'A recebe a vezes b transposto, uma matriz.',
  },
  {
    rotulo: 'dirac-identidade',
    detalhe: 'A # 1.0|I|;  matriz identidade',
    insercao: '${1:A} # ${2:1.0}|I|;',
    gatilhos: ['identidade', 'eye', 'dirac'],
    doc: 'Preenche A como identidade vezes o escalar. Use antes de operar sobre a matriz.',
  },
  {
    rotulo: 'dirac-zera',
    detalhe: `a # |0${KET_FECHA};  zera o vetor`,
    insercao: `\${1:a} # |0${KET_FECHA};`,
    gatilhos: ['zero', 'zera', 'vzero', 'dirac'],
    doc: 'Zera todos os elementos do vetor. Sem isto a memoria comeca com lixo.',
  },
  {
    rotulo: 'dirac-entrada',
    detalhe: `a # c|in(p)${KET_FECHA};  le da porta de entrada`,
    insercao: `\${1:a} # \${2:0.001}|in(\${3:0})${KET_FECHA};`,
    gatilhos: ['cvin', 'entrada', 'dirac'],
    doc: 'Preenche o vetor a partir da porta de entrada p, escalado por c.',
  },
  // Os dois caracteres soltos, para quem so precisa do simbolo. O gatilho
  // duplicado (`>>`, `<<`) e proposital: e o que a mao tenta primeiro.
  {
    rotulo: KET_FECHA,
    detalhe: 'U+27E9, fecha o ket',
    insercao: KET_FECHA,
    gatilhos: ['>>', 'ket', 'fecha', 'dirac'],
    doc: 'O caractere sozinho. Nao confunda com o sinal de maior do teclado: o compilador so aceita este.',
  },
  {
    rotulo: KET_ABRE,
    detalhe: 'U+27E8, abre o bra',
    insercao: KET_ABRE,
    gatilhos: ['<<', 'bra', 'abre', 'dirac'],
    doc: 'O caractere sozinho. Nao confunda com o sinal de menor do teclado: o compilador so aceita este.',
  },
]);

/**
 * Liga as sugestoes ao editor.
 *
 * @param {any} monaco  o objeto global do Monaco, ja carregado
 * @returns {any} o descartador do provedor, para o teste poder desfazer
 */
export function registrarSnippetsDirac(monaco) {
  if (!monaco?.languages?.registerCompletionItemProvider) return null;
  const Kind = monaco.languages.CompletionItemKind;
  const Regra = monaco.languages.CompletionItemInsertTextRule;

  return monaco.languages.registerCompletionItemProvider('cmm', {
    // Sem `triggerCharacters`: a lista abre com Ctrl+Espaco e enquanto se
    // digita, que e como o resto do editor se comporta. Um gatilho por
    // caractere faria a lista pular na cara de quem esta escrevendo uma
    // comparacao.
    provideCompletionItems(model, position) {
      const palavra = model.getWordUntilPosition(position);
      const intervalo = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: palavra.startColumn,
        endColumn: palavra.endColumn,
      };
      return {
        suggestions: SUGESTOES_DIRAC.map((s) => ({
          label: s.rotulo,
          kind: Kind.Snippet,
          detail: s.detalhe,
          documentation: s.doc,
          insertText: s.insercao,
          insertTextRules: Regra.InsertAsSnippet,
          filterText: [s.rotulo, ...s.gatilhos].join(' '),
          range: intervalo,
        })),
      };
    },
  });
}
