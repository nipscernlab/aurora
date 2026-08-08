# Skins do PRISM

Esta pasta guarda os símbolos SVG que o PRISM, o visualizador RTL da AURORA, usa
para desenhar cada célula. Cada arquivo define uma ou mais skins para células do
`@silimate/netlistsvg`, e a fusão com a skin padrão acontece em
`main/ipc/prism.js`, dentro de `getDefaultSkinData`. Por isso as skins daqui
sobrevivem a um `npm install` e são relidas a cada recompilação do PRISM.

O inventário completo do que existe está em [COMPONENTS.md](COMPONENTS.md), que é
gerado por `scripts/gen-prism-skins.js` e não deve ser editado à mão.

Este documento reúne o que antes estava separado em dois, o mecanismo e o padrão
visual, porque os dois se sobrepunham em metade do conteúdo.

## O que é uma skin

Um SVG de skin não é ilustração isolada. É símbolo técnico que precisa ser
bonito, legível e roteável, e ele responde a quatro perguntas. Qual célula
representa, pelo `s:type`. Que nomes alternativos cobre, pelos `<s:alias>`. Que
espaço lógico ocupa no layout, pelo `s:width` e `s:height`. E onde os fios
conectam, por uma âncora `<g s:pid="...">` por porta.

A anatomia mínima:

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
    <text x="38" y="35" class="nodelabel $cell_id" s:attribute=""
          style="text-anchor: middle; font-weight: 700; font-size: 12px;
                 fill: var(--prism-module-glyph);">ULA</text>
    <g s:x="18" s:y="0"  s:pid="op"/>
    <g s:x="0"  s:y="22" s:pid="in1"/>
    <g s:x="0"  s:y="42" s:pid="in2"/>
    <g s:x="70" s:y="30" s:pid="out"/>
  </g>
</svg>
```

## Mecanismo

O `s:type` é a chave de correspondência, e precisa casar com o tipo que o Yosys
gera ou com o nome do módulo Verilog depois da normalização que o PRISM faz. Os
`<s:alias>` cobrem variantes do Yosys e nomes equivalentes, como `$and`,
`$logic_and`, `$_AND_` e `$reduce_and` apontando para o mesmo desenho.

O `s:width` e o `s:height` definem a caixa lógica que o roteador usa, e não são
aparência. Um símbolo pequeno com caixa enorme abre buracos no diagrama, e um
símbolo grande com caixa pequena causa sobreposição. Tamanhos que funcionam:

| Categoria | Tamanho típico |
|---|---:|
| Portas simples | `30 x 25` |
| Operadores aritméticos | `25 x 25` a `35 x 30` |
| Comparadores | `32 x 26` |
| Multiplexadores | `35 x 45` |
| Registradores | `45 x 35` |
| ULA | `70 x 60` |
| FIFO e core | `100 x 80` |
| Processor | `140 x 120` |

Cada porta Verilog precisa de exatamente uma âncora, e o `s:pid` diferencia
maiúsculas de minúsculas: se o Verilog usa `io_in`, não escreva `IO_IN`. A
convenção de posição é entrada de dados à esquerda, saída à direita, relógio à
esquerda no alto ou no topo, reset perto do relógio, seleção e controle no topo
ou na base, e sinais de estado embaixo à direita.

## O padrão visual

O objetivo é que quem estuda o esquemático entenda o que cada elemento é e faz
sem ler rótulo, e que o caminho de dados inteiro pareça uma família deliberada e
não uma coleção de logos.

A referência que define o padrão é o `ula_mux.svg`, a célula SAPHO mais complexa,
com um multiplexador de quarenta e dois para um, gerado por
`scripts/prism-skin-standard.js`. Esse script é o padrão: edite os tokens, as
famílias e a geometria nele, e não os SVGs à mão.

São oito princípios.

A silhueta carrega o significado. A forma do corpo diz a função antes de qualquer
rótulo, e existe uma silhueta por classe de elemento, de modo que a mesma forma
sempre queira dizer a mesma coisa.

O corpo é um chip. Ele é um cartão escuro, do token `--prism-card`, para que os
rótulos tenham contraste independentemente do fundo, como um circuito integrado
numa placa.

A marca é contida. Só a célula de topo `processor` carrega a marca d'água, o S do
SAPHO em tom único na área livre. As outras não carregam nenhuma, porque nas
células menores ela lia como borrão.

O fluxo vai da esquerda para a direita e o controle entra pelo norte. Dados
entram a oeste, o resultado sai a leste, e seleção e habilitação entram por cima
no acento de controle, que é violeta, de modo que controle fique sempre
visualmente separado de dado.

As portas são agrupadas por família semântica, coloridas, cada grupo com colchete
e cabeçalho, exatamente como o Verilog as agrupa. A cor codifica a família.

Uma família tipográfica só para texto de interface, e mono apenas para
identificador de porta. Nunca deixe texto sem `font-family`, porque ele cai para
serifada e foi esse o erro original.

Cor vem do tema e não há degradês. Toda cor é uma variável CSS com valor de
reserva. Não use `linearGradient` nem `defs` na raiz, porque o PRISM funde apenas
o bloco `<g s:type>` e qualquer coisa fora dele é descartada; construa espectros
com segmentos de cor sólida.

E a geometria é nítida, sobre grade inteira, com traço de corpo de 1,4 pixel,
passo de linha de 7 pixels e junções arredondadas.

### Cores

| Papel | Token | Reserva |
| --- | --- | --- |
| Corpo do cartão | `--prism-card` | `#0E1320` |
| Traço do corpo | `--prism-module-stroke` | `#5FE0B0` |
| Título e glifo | `--prism-module-glyph` | `#EAF2EE` |
| Referência da instância | `--prism-module-accent` | menta |
| Controle | `--accent` | `#8E83E8` |
| Rótulo de pino | `--prism-port-label` | `#AEB6C4` |
| Subtítulo | `--text-secondary` | `#9CA1AE` |

A cor da família diz a operação: operando em `--aurora-cyan`, aritmética em
`--aurora-mint`, lógica em `--aurora-violet`, condicional em `--aurora-purple`,
comparação em `--aurora-teal`, deslocamento em `--aurora-pink` e normalização em
`--status-warning`.

### Silhuetas por classe

Cada classe é desenhada como seu símbolo de livro-texto, e todas estão
implementadas no `prism-skin-standard.js`, que despacha pela forma devolvida por
`classify(name)`.

| Classe | Forma | Exemplos |
| --- | --- | --- |
| Seletor | pentágono apontando à direita com entalhe de seleção | `ula_mux`, `norm_mux` |
| Operação de caminho de dados | topo reto, borda de resultado afunilada, entalhe em V a oeste com dois ou mais operandos | `ula`, `ula_add` |
| Registrador | cartão de cantos vivos com marca de borda de relógio | `pc`, `stack` |
| Memória | cartão arredondado com grade tênue ao centro | `mem_data`, `mem_instr` |
| Decodificador | trapézio que abre, poucas entradas a oeste e muitas saídas a leste | `instr_dec` |
| FIFO | cartão arredondado com galões de fluxo | `myFIFO` |
| Chip hierárquico | cartão arredondado | `core`, `processor`, `io_ctrl` |

As formas retangulares compartilham um caminho de layout só, de modo que a
geometria de portas seja idêntica entre elas; diferem apenas no raio do canto e
no motivo interior.

### Primitivas escritas à mão

Algumas skins são primitivas do netlistsvg e não módulos do HDL SAPHO, então são
escritas à mão e o gerador nunca as toca. O `constant.svg` é a principal: ele
troca a caixa com número por um símbolo clássico de terra, com haste e três
travessas decrescentes, mantendo o valor visível de leve acima, de modo que um
`1` continue legível e um `0` leia como terra de livro-texto.

O `html/prism/prism.css` esconde as etiquetas de largura de barramento a pedido,
porque os fios já indicam isso, e restringe as regras genéricas de módulo à
classe exata `g.module` e não a qualquer classe que contenha "module", porque o
`prism.js` marca células clicáveis e uma correspondência por substring repintaria
os pinos das nossas skins.

## Regras que não se quebram

O `s:pid` precisa ser exatamente o nome da porta no Verilog, porque é isso que o
ELK usa para rotear.

Portas guardadas por `ifdef YANC_SIM_VIS`, que são as tomadas de visibilidade de
simulação, precisam ficar de fora. O Yosys lê o HDL sem esse define para o PRISM,
então uma âncora para porta que não existe na netlist faz o ELK abortar com
"Referenced shape does not exist".

E valem os princípios sete e seis: nada de degradê nem de `defs` na raiz, e
sempre defina `font-family`.

## Gerando e revisando

O `scripts/prism-skin-standard.js` percorre cada módulo em `components/HDL/*.v` e
o desenha, escolhendo acento e marca automaticamente a partir do nome.

```sh
node scripts/prism-skin-standard.js            # regenera todas as skins
node scripts/prism-skin-standard.js --only pc  # só uma
node scripts/prism-skin-standard.js --print pc # despeja uma na saída padrão
```

Existe ainda o `scripts/gen-prism-skins.js`, que é outro gerador, com outro
propósito: ele extrai a lista real de portas de cada módulo e emite uma skin
baseline para quem ainda não tem uma feita à mão, além de reescrever o
`COMPONENTS.md`. Ele é idempotente e nunca sobrescreve skin manual.

Para conferir uma skin no tema escuro do PRISM, embrulhe-a numa página que defina
as variáveis `--prism-*` e `--aurora-*` e dê um `viewBox` ao `<svg>`. As skins
feitas à mão e as baselines automáticas são o trabalho pendente para chegar a
este padrão, uma classe de elemento por vez.
