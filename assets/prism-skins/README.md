# PRISM custom skins

Esta pasta contém os símbolos SVG customizados usados pelo PRISM, o visualizador
RTL do Aurora. Cada arquivo `.svg` define uma ou mais skins para células do
`@silimate/netlistsvg`.

O merge com a skin padrão acontece em `main/ipc/prism.js`, dentro de
`getDefaultSkinData`. Isso significa que as skins desta pasta sobrevivem a
`npm install` e são recarregadas a cada recompilação do PRISM.

## Ideia Central

Um SVG de skin não é uma ilustração isolada. Ele é um símbolo técnico que precisa
ser bonito, legível e roteável.

Cada bloco principal deve responder a quatro perguntas:

1. Qual célula ele representa? Use `s:type`.
2. Quais nomes alternativos ele cobre? Use `<s:alias>`.
3. Qual espaço lógico ele ocupa no layout? Use `s:width` e `s:height`.
4. Onde os fios conectam? Use uma âncora `<g s:pid="...">` por porta.

## Anatomia Mínima

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:s="https://github.com/nturley/netlistsvg">

  <g s:type="ula" transform="translate(0, 0)" s:width="70" s:height="60">
    <s:alias val="ula"/>

    <path d="M 0,0 L 48,0 L 70,30 L 48,60 L 0,60 L 14,30 Z"
          class="$cell_id"
          style="fill: var(--prism-module-fill);
                 stroke: var(--prism-module-stroke);
                 stroke-width: 1;"/>

    <text x="38" y="35"
          class="nodelabel $cell_id"
          s:attribute=""
          style="text-anchor: middle;
                 font-weight: 700;
                 font-size: 12px;
                 fill: var(--prism-module-glyph);">ULA</text>

    <text x="35" y="-4"
          class="$cell_id"
          s:attribute="ref"
          style="text-anchor: middle;
                 font-size: 7px;
                 font-style: italic;
                 fill: var(--prism-module-accent);
                 opacity: 0.75;">u</text>

    <g s:x="18" s:y="0"  s:pid="op"/>
    <g s:x="0"  s:y="22" s:pid="in1"/>
    <g s:x="0"  s:y="42" s:pid="in2"/>
    <g s:x="70" s:y="30" s:pid="out"/>
  </g>

</svg>
```

## Regras do PRISM

### `s:type`

`s:type` é a chave de match. Ele deve casar com o tipo gerado pelo Yosys ou com
o nome do módulo Verilog depois da normalização feita pelo PRISM.

Exemplos:

```xml
<g s:type="ula">
<g s:type="processor">
<g s:type="and">
<g s:type="dff">
```

### `s:alias`

Use aliases para cobrir variantes do Yosys ou nomes equivalentes.

```xml
<s:alias val="$and"/>
<s:alias val="$logic_and"/>
<s:alias val="$_AND_"/>
<s:alias val="$reduce_and"/>
```

### `s:width` e `s:height`

Esses valores definem a caixa lógica usada pelo roteador. Eles não são apenas
aparência. Um símbolo visualmente pequeno com `s:width` enorme cria espaços
vazios no diagrama; um símbolo grande com caixa pequena causa sobreposição.

Tamanhos recomendados:

| Categoria | Tamanho típico |
|---|---:|
| Gates simples | `30 x 25` |
| Operadores aritméticos | `25 x 25` a `35 x 30` |
| Comparadores | `32 x 26` |
| MUX/DEMUX | `35 x 45` |
| DFF/latch | `45 x 35` |
| ULA | `70 x 60` |
| FIFO/core | `100 x 80` |
| Processor | `140 x 120` |

### Portas

Cada porta Verilog precisa ter exatamente uma âncora:

```xml
<g s:x="0"  s:y="10" s:pid="in1"/>
<g s:x="42" s:y="16" s:pid="out"/>
```

`s:pid` é case-sensitive. Se o Verilog usa `io_in`, não use `IO_IN`, `input` ou
`in`.

Convenção recomendada:

| Tipo de sinal | Posição |
|---|---|
| Entradas de dados | esquerda |
| Saídas de dados | direita |
| Clock | esquerda superior ou topo |
| Reset/clear | esquerda superior, perto do clock |
| Select/opcode/control | topo ou base |
| Status/flags | direita inferior |

## Linguagem Visual

O PRISM deve parecer um instrumento técnico, não uma coleção de logos. O símbolo
ideal é discreto quando visto no diagrama inteiro e reconhecível quando o usuário
aproxima o zoom.

Prioridade visual:

1. Silhueta do componente.
2. Posição e direção das portas.
3. Glifo funcional pequeno, quando necessário.
4. Detalhes internos sutis.
5. Nome do componente somente quando a forma não bastar.

A paleta atual vem de `html/prism/prism.css`:

```css
--prism-wire:          var(--accent);
--prism-wire-hover:    var(--accent-hover);
--prism-wire-hi:       var(--aurora-mint);
--prism-module-fill:   rgba(95, 224, 176, 0.08);
--prism-module-stroke: var(--aurora-mint);
--prism-module-accent: var(--aurora-mint);
--prism-module-glyph:  rgba(255, 255, 255, 0.82);
```

Isso cria uma separação importante:

- Fios usam o acento principal do Aurora.
- Módulos usam mint com preenchimento fraco.
- Glifos usam branco suave.
- Detalhes internos usam mint com baixa opacidade.

Essa escolha evita que o diagrama vire uma massa de uma cor só. Ainda assim, a
skin não deve depender de cor forte para funcionar: se remover a cor, a forma
precisa continuar comunicando a função.

### Regra anti-slop

Evite qualquer coisa que pareça uma peça promocional:

- Texto grande no centro do componente.
- Nome do projeto como decoração recorrente.
- Glow, gradiente pesado ou sombra dramática.
- Paleta neon em área grande.
- Detalhes internos com o mesmo peso do contorno.
- Labels de porta em todo componente pequeno.
- Formas genéricas sem relação com a função.

O padrão PRISM deve ser mais próximo de instrumentação, CAD e esquemático
profissional: baixo ruído, alta leitura, poucos acentos.

## Padrões por Categoria

### Gates lógicos

Use formas clássicas:

- `and`: D-shape.
- `or`: forma curva de OR.
- `xor`: OR com curva extra na entrada.
- `not`: triângulo.
- `nand`, `nor`, `xnor`: mesma forma + bolha de inversão.

Labels devem ser opcionais e discretos. A silhueta precisa comunicar a função.
Em gates pequenos, prefira nenhum texto ou um glifo mínimo.

### Aritmética

Use formas compactas e glifos fortes, mas pequenos:

- `add`: `+`
- `sub` / `neg`: `-`
- `mul`: `x`
- `div`: `/` ou `÷`
- `mod`: `%`

Operadores binários normalmente têm `A`, `B` à esquerda e `Y` à direita.
Operadores unários têm uma entrada central à esquerda e uma saída central à
direita.

### Comparadores

Hexágonos funcionam bem porque parecem operadores de decisão.

Use glifos:

- `=`
- `!=`
- `<`
- `<=`
- `>`
- `>=`

### Sequenciais

Registradores e latches devem parecer elementos de estado:

- Corpo retangular.
- `D` à esquerda.
- `Q` à direita.
- Clock marcado por triângulo.
- Bolha para clock negativo.
- Reset/clear perto do topo.

### Módulos grandes

Módulos como `processor`, `core`, `instr_dec`, `addr_dec`, `myFIFO` e `ula`
podem ter mais personalidade, mas ainda devem obedecer à mesma gramática. Eles
podem carregar uma assinatura visual, não uma ilustração.

Boas ideias:

- `processor`: chip com pinos, pin-1 marker e marca SAPHO/PRISM sutil.
- `core`: bloco de controle/datapath com divisões internas finas.
- `ula`: silhueta clássica de ALU.
- `myFIFO`: células internas e seta de fluxo.
- `instr_dec`: lookup/decoder com linhas internas.
- `addr_dec`: demux/decoder trapezoidal.

## Como Personalizar um Componente

1. Abra o Verilog e liste as portas do módulo.
2. Decida a categoria visual do símbolo.
3. Escolha `s:width` e `s:height`.
4. Desenhe a silhueta principal.
5. Posicione as portas na borda da caixa lógica.
6. Adicione um glifo ou label interno.
7. Adicione `s:attribute="ref"` para o nome da instância.
8. Recompile no PRISM e veja o símbolo com fios reais.
9. Ajuste espaçamento e legibilidade.

## Checklist de Qualidade

Antes de considerar uma skin pronta:

```txt
[ ] O arquivo usa UTF-8.
[ ] O SVG raiz declara xmlns:s.
[ ] Cada bloco principal tem s:type.
[ ] Cada bloco tem s:width e s:height coerentes.
[ ] Aliases importantes foram incluídos.
[ ] Cada porta Verilog aparece como um s:pid.
[ ] Entradas e saídas seguem lados previsíveis.
[ ] Elementos visuais usam class="$cell_id".
[ ] Não há id fixo em elementos internos.
[ ] Cores vêm de variáveis CSS.
[ ] Textos cabem no corpo do símbolo.
[ ] O símbolo funciona pequeno.
[ ] O símbolo fica bom no diagrama real após Recompile.
```

## O Que Evitar

- Não use `id="..."` fixo dentro dos símbolos.
- Não use PNG/base64 embutido para ícones comuns.
- Não dependa de fontes externas.
- Não use uma cor hard-coded sem motivo.
- Não use texto grande como identidade principal.
- Não transforme componentes em logos.
- Não coloque detalhes tão fortes quanto o contorno principal.
- Não posicione portas longe da caixa lógica.
- Não crie símbolos muito maiores que seus vizinhos sem necessidade.
- Não use `viewBox` como parte do contrato; o merge extrai os blocos `<g>`.

## Arquivo de Teste

`prism_test.svg` é um símbolo experimental para estudar o padrão visual. Ele não
substitui nenhum componente real, porque usa `s:type="prism_test"`. O retângulo
de fundo existe só para o preview do editor; o merger do PRISM extrai apenas o
bloco `<g s:type="prism_test">`.

Esse arquivo serve como referência de:

- Paleta.
- Hierarquia de stroke/fill/texto.
- Portas em lados previsíveis.
- Marca visual PRISM sem virar logo.
- Detalhes internos discretos.

## Componentes Atuais

SAPHO / projeto:

- `ula.svg`
- `processor.svg`
- `core.svg`
- `addr_dec.svg`
- `instr_dec.svg`
- `myFIFO.svg`

Primitivas:

- `and.svg`, `nand.svg`, `or.svg`, `nor.svg`, `xor.svg`, `xnor.svg`
- `not.svg`, `buf.svg`
- `mux.svg`
- `dff.svg`, `dffn.svg`, `dlatch.svg`
- `add.svg`, `sub.svg`, `mul.svg`, `div.svg`, `mod.svg`, `neg.svg`
- `comparators.svg`
- `shifts.svg`

O próximo passo natural é usar `prism_test.svg` para fechar a linguagem visual e
depois refazer os SVGs por categoria, começando pelas primitivas mais frequentes.
