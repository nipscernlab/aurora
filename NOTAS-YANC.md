# Notas sobre o compilador YANC

Achados de uma leitura do repositório `nipscernlab/yanc`, feita a partir da
AURORA em 21/08/2026, com o yanc em `332959f` (release v5.3).

Nada aqui foi aplicado. O repositório do yanc não foi tocado: está em
`332959f`, com a árvore limpa. Este arquivo existe porque os achados são do
compilador e não da AURORA, e o TODO.md é o guia de implementação da AURORA;
misturar os dois faria a lista de lá deixar de responder pelo que promete.

O que motivou a leitura foi uma pergunta prática: como é que uma pessoa digita
a notação de Dirac. A varredura foi atrás de todo caractere que o compilador
exige e o teclado não tem, e cobriu os lexers e as gramáticas dos quatro
compiladores, CMMComp, APPComp, ASMComp e CPPComp.

O lado da AURORA já foi resolvido e está em produção: o editor completa os
símbolos (`js/editor/dirac_snippets.js`), e o manual ganhou a seção que explica
a digitação (`docs_aurora`, `source/avancado/dirac.md`). Os itens abaixo são o
que sobra, do lado do compilador.

## 1. Dois caracteres obrigatórios que não estão no teclado

`Compilers/CMMComp/Sources/CMMComp.l`, linhas 151 a 154.

O lexer reconhece `⟩` (U+27E9) e `⟨` (U+27E8), e mais as formas compostas
`|I|` e `|0⟩`. Só esses. Os sinais `<` e `>` do teclado são comparação na
linguagem, e não são aceitos no papel de bra e ket em lugar nenhum.

A varredura confirma que estes são os únicos: todo o resto de caractere fora do
ASCII nos quatro compiladores está dentro de comentário, e ninguém precisa
digitar comentário para compilar. Então o problema é pequeno e delimitado, o
que é uma boa notícia: são dois caracteres, num recurso só.

A gravidade não está no número. A notação de Dirac é a coisa mais distintiva
do C±, é o que diferencia a linguagem de escrever os mesmos laços em C, e é
justamente ela que exige um caractere que a pessoa não consegue produzir sem
sair do editor. O recurso de vitrine é o recurso trancado.

## 2. O erro de sintaxe não diz que o problema é o caractere

`Compilers/CMMComp/Sources/CMMComp.y`, linha 516.

O `yyerror` imprime `MSG_ERR_SYNTAX` com o número da linha, e sai. Quem escreve
`a # |M|b>;` recebe "Erro de sintaxe na linha N" e vai olhar uma linha que, na
tela, parece certa: `>` e `⟩` se parecem o bastante para a pessoa reler três
vezes sem ver diferença. O tempo perdido aí é desproporcional ao tamanho do
engano.

O conserto é barato e não muda o que compila. Quando o token que travou a
análise for um `<` ou um `>` sozinho, e a linha tiver uma barra vertical, que é
a assinatura da notação, imprimir um parágrafo a mais nomeando os dois símbolos
com o código Unicode. É informação acrescentada a um erro que já aconteceu; o
código de saída e o que passa a compilar continuam os mesmos.

Cheguei a escrever isso e a verificar num arnês em C, compilado com `-Wall
-Wextra`, cobrindo a expansão da mensagem nas duas línguas e os casos em que a
dica não deve sair: `>=`, `>>`, identificador, token vazio e linha sem barra.
Os dezessete casos passaram. O compilador inteiro não chegou a ser construído
porque esta máquina não tem `flex` nem `bison` e o `lex.yy.c` não é versionado;
o CI do yanc instala os dois. A mudança foi desfeita a pedido, e o repositório
está intacto.

## 3. A mensagem de erro xinga quem está aprendendo

`Compilers/CMMComp/Headers/messages.h`, linha 27.

O texto é "Erro de sintaxe na linha %d. Você é uma pessoa confusa!", e em inglês
"Syntax error on line %d. You're a confused soul!".

A pessoa que mais vê essa frase é a que está aprendendo, errando e sozinha na
frente do terminal. O tom funciona entre quem escreveu o compilador e não
funciona com um calouro que não sabe se o problema é ele ou a ferramenta. Vale
uma revisão do catálogo inteiro de mensagens com esse critério, e não só desta;
ela é a mais visível porque é a que mais dispara.

## 4. O `yyerror` joga fora a informação que recebe

`Compilers/CMMComp/Sources/CMMComp.y`, linha 516.

A assinatura é `void yyerror (char const *s)`, e o `s` nunca é usado. Esse
parâmetro é o texto que o bison monta dizendo o que ele esperava encontrar
naquele ponto, que é a informação mais útil que existe num erro de sintaxe, e
ela já está na mão, de graça.

Imprimir junto custa uma linha. Vale conferir antes se o bison está configurado
para produzir a mensagem detalhada, porque sem `%define parse.error verbose` o
texto que chega é só "syntax error" e o ganho seria nenhum.

## 5. Aceitar `<` e `>` como bra e ket não dá em todo lugar, e isso merece ficar escrito

Nas formas de statement daria: o operador `#` abre um contexto que só existe na
notação de Dirac, então um estado próprio do lexer, aberto no `#` e fechado no
`;`, resolveria as linhas 203, 204 e 398 a 407 da gramática sem ambiguidade
nenhuma.

Em `out(p, c|v⟩)` não dá. `out(0, a|b)` é ou-bit-a-bit perfeitamente válido, e a
única diferença entre os dois é o `>` no fim; um lexer sem contexto não separa
isso. O produto interno `⟨a|b⟩` fica no meio do caminho: um `<` em posição de
prefixo nunca é comparação, então seria decidível, mas ao custo de o lexer
passar a lembrar o token anterior.

Registrar essa análise perto do código evita que alguém tente de novo e
descubra o buraco tarde, com o `out` já quebrado em algum projeto. E, se um dia
for feito, a decisão de projeto é escolher entre a notação ficar meio ASCII e
meio Unicode, que confunde de outro jeito, ou continuar como está.

## 6. Travessões em comentário no CPPComp

`Compilers/CPPComp/Sources/CPPComp.l`, oito ocorrências, e
`Compilers/CPPComp/Sources/CPPComp.y`, trinta e seis.

Cosmético e contra o padrão de escrita do laboratório. Fica anotado para quando
alguém passar por esses arquivos por outro motivo; não vale um commit próprio.

## Ordem que eu sugeriria

O item 4 junto com o 2, porque os dois mexem na mesma função, nenhum muda o que
compila, e juntos transformam o erro mais comum de quem está começando num erro
que se resolve sozinho. Depois o 3, que é revisão de texto e não de código. O
item 5 é documentação de uma decisão. O 1 se resolve pelo editor, e já está
resolvido. O 6 é para pegar carona.
