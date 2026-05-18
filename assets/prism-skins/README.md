# PRISM custom skins

Esta pasta é onde você coloca **símbolos SVG customizados** para o PRISM (o
visualizador RTL do Aurora). Cada arquivo `.svg` aqui é fundido em runtime
com a skin padrão do `@silimate/netlistsvg`, substituindo (ou adicionando)
símbolos sem precisar tocar em `node_modules/`.

Como o merge acontece em [main/ipc/prism.js](../../main/ipc/prism.js)
(`getDefaultSkinData`), **`npm install` não apaga suas customizações**.

---

## TL;DR — como criar um símbolo novo

1. Copie [`_template.svg`](_template.svg) para `<nome-do-modulo>.svg`
   (o nome do arquivo é só pra você se organizar — o que importa pro PRISM
   é o atributo `s:type` lá dentro).
2. Troque `MYMODULE` pelo nome exato do módulo Verilog (e.g. `ula`,
   `processor`, `core`).
3. Ajuste `s:width` / `s:height` pro tamanho do seu símbolo.
4. Desenhe a forma com qualquer primitivo SVG (`<rect>`, `<path>`,
   `<circle>`, `<polygon>`, `<image>`, etc.).
5. Liste **uma `<g s:pid="...">`** por porta do Verilog, posicionada
   na borda do retângulo `s:width × s:height`.
6. Clique **Recompile** (`Ctrl+R`) no PRISM. Pronto.

> A skin é re-lida do disco a cada compilação — não precisa reiniciar o app.

---

## Anatomia de um arquivo

```xml
<g s:type="ula"                  <!-- 1. tipo (= nome do .v) -->
   transform="translate(0, 0)"
   s:width="60" s:height="60">   <!-- 2. bounding box -->

  <s:alias val="ula"/>            <!-- 3. (opcional) tipos extras que casam -->

  <path d="M0,0 L40,0 L60,18 ..." <!-- 4. forma visível -->
        class="$cell_id"/>

  <text x="32" y="34"             <!-- 5. label do tipo -->
        class="nodelabel $cell_id"
        s:attribute="">ULA</text>

  <text x="30" y="-4"             <!-- 6. label da instância -->
        class="nodelabel $cell_id"
        s:attribute="ref">u_inst</text>

  <g s:x="18" s:y="0"  s:pid="op"/>  <!-- 7. uma <g s:pid> por porta -->
  <g s:x="0"  s:y="22" s:pid="in1"/>
  <g s:x="0"  s:y="38" s:pid="in2"/>
  <g s:x="60" s:y="30" s:pid="out"/>
</g>
```

### Os 7 elementos numerados acima

| # | Atributo | Obrigatório? | O que faz |
|---|---|---|---|
| 1 | `s:type` | **sim** | Chave de match. Qualquer célula no JSON do Yosys cujo `type` (depois de `cleanModuleName`) seja igual a esse valor usa esta skin. |
| 2 | `s:width` / `s:height` | **sim** | Bounding box lógico (em unidades SVG). O ELK usa pra roteamento — _não confunda com a viewBox do SVG_. |
| 3 | `<s:alias val="..."/>` | não | Casa tipos adicionais (ex.: `$dff`, `$_DFF_P_`). Útil pra cobrir variantes do Yosys. |
| 4 | Forma | **sim** | Qualquer primitivo SVG. Coordenadas relativas ao bounding box (`0,0` = canto sup-esq, `s:width,s:height` = canto inf-dir). |
| 5 | Label literal | não | `s:attribute=""` mantém o texto da tag (`ULA`, `+`, `mux`…). |
| 6 | Label de instância | não | `s:attribute="ref"` substitui o texto pelo nome da instância (`u1`, `meu_alu`…). |
| 7 | Portas | **sim, uma por porta** | Posição onde o fio se conecta. `s:pid` **deve casar exatamente** com o nome da porta Verilog. |

---

## Restrições

### Bounding box e coordenadas
- Origem em `(0, 0)` no canto superior-esquerdo. `+x` direita, `+y` baixo.
- A forma pode ir **levemente além** dos limites declarados (ex.: bolhas de
  inversão em `-3,12`), mas o ELK considera só o retângulo `s:width × s:height`
  pra layout. Saídas muito fora podem causar overlap com fios.

### Portas (`<g s:pid="...">`)
- **Uma por porta do módulo.** Se faltar uma, ELK ignora o fio e o
  netlistsvg pode quebrar silenciosamente.
- **`s:pid` é case-sensitive** e tem que bater 1:1 com o nome do port no
  Verilog (`input op` → `s:pid="op"`, não `"OP"` nem `"op_i"`).
- Posicione `s:x` em `0` (lado esquerdo) ou `s:width` (lado direito) pra
  entradas/saídas horizontais; `s:y` em `0` (topo) ou `s:height` (base) pra
  sinais verticais (ex.: clock, op).
- `s:x` / `s:y` levemente fora do bounding box (e.g. `-1`) são tolerados e
  comuns pra empurrar o ponto de conexão pra fora da borda.

### Largura e altura recomendadas
- **Gates primitivos** (AND, OR, NOT…): 25-30 × 20-25
- **MUX / adders pequenos**: 20-25 × 30-40
- **Módulos com muitas portas** (ULA, processador, FIFO): 60-100 × 60-120
- **Mantenha proporções comparáveis às primitivas** (~30-60 unidades) — o
  layout do ELK reserva espaço proporcional à área declarada e desproporção
  forte produz layouts feios.

### Classes e estilos
- `class="$cell_id"` em qualquer elemento pinta-o com `cell_<instanceName>`
  em runtime. Útil pra hover/highlight via CSS de [html/prism/prism.css](../../html/prism/prism.css).
- `class="nodelabel"` em `<text>` pra label centralizado (CSS aplica
  `text-anchor:middle`).
- `class="inputPortLabel"` em `<text>` próximo a uma entrada (right-aligned).
- **Use variáveis CSS** (`var(--prism-module-fill)`, `var(--accent)`,
  `var(--text)`, etc.) em vez de cores hard-coded sempre que possível, pra
  que o símbolo siga o tema Aurora.

### Como o CSS interage com o seu SVG inline

`html/prism/prism.css` foi ajustado pra **não usar `!important`** em
`font-size`, `fill` e `stroke` (de texto e do path do corpo de uma célula).
Isso significa que `style="font-size: 11px"` ou `style="fill: var(--accent)"`
inline **vencem** o CSS global. Use isso pra criar hierarquia visual
(label do tipo grande e bold, hints de porta pequenos e mutados).

**Baseline automático:** qualquer `<g>` que recebe `data-cell-type=<tipo>`
(injetado por `main/ipc/prism.js`) ganha por padrão `stroke:
var(--prism-module-stroke)` e `opacity: 1` no `<path>` direto-filho. Se
sua skin não declarar stroke inline, ela já sai com o stroke mint do tema
e separa visualmente da cor de fios (`--prism-wire`).

**Regras que continuam com `!important` (não tente sobrescrever inline):**
- `font-family: var(--font-sans)` em texto — sempre Aurora sans
- `rect { stroke-width: 1.5 }` — pra retângulos de células default
- `path[class*="net_"] / line[class*="net_"] { stroke: var(--prism-wire) }`
  — esses são fios entre células, mantém uniforme
- `text[class*="busLabel_"] { font-size: 8px; fill: var(--accent-hover) }`
  — labels de bus mantêm tamanho/cor fixos
- `circle { stroke: var(--accent-hover); stroke-width: 1.5 }` —
  bolhas de inversão (NAND/NOR) etc.

### O que NÃO fazer
- ❌ Não use `id="..."` fixo nos filhos — várias instâncias do mesmo símbolo
  no diagrama gerariam IDs duplicados. Use `class="$cell_id"`.
- ❌ Não importe fontes externas; o renderer já carrega a stack do Aurora.
- ❌ Não embuta PNGs gigantes via `<image href data:...>` — funcionam, mas
  inflam o SVG e o roteamento ELK ignora a imagem (só vê o bounding box).
- ❌ Não use `viewBox` no `<svg>` raiz deste arquivo — o conteúdo é
  extraído por blocos `<g s:type=...>` e a viewBox do arquivo é descartada.
- ❌ Não use nomes de arquivo começando com `_` — são ignorados pelo merger
  (`_template.svg` fica de fora).

---

## Componentes que você pode customizar

### Da biblioteca SAPHO (Verilog em [components/HDL/](../../components/HDL))
Todos esses caem hoje na skin `generic` (retângulo cinza com labels).
Crie `<nome>.svg` aqui pra dar visual próprio:

| `s:type` | Arquivo Verilog | Portas (top-level) |
|---|---|---|
| `ula` | [ula.v](../../components/HDL/ula.v) | `op`, `in1`, `in2`, `out` |
| `processor` | [processor.v](../../components/HDL/processor.v) | ver módulo (clk, rst, IO…) |
| `core` | [core.v](../../components/HDL/core.v) | ver módulo |
| `addr_dec` | [addr_dec.v](../../components/HDL/addr_dec.v) | `valid_in`, `index`, `valid_out` |
| `instr_dec` | [instr_dec.v](../../components/HDL/instr_dec.v) | ver módulo |
| `myFIFO` | [myFIFO.v](../../components/HDL/myFIFO.v) | `clk`, `data`, `rdreq`, `sclr`, `wrreq`, `almost_empty`, `empty`, `full`, `q`, `usedw` |

> Submódulos da ULA (`ula_mux`, `ula_add`, `ula_fadd`, `ula_norm`, etc.)
> também são clicáveis e por enquanto caem no `generic` — você pode criar
> skins próprias pra eles do mesmo jeito.

### Primitivas do Yosys (já têm skin padrão; você pode sobrescrever)
Estão definidas em [`node_modules/@silimate/netlistsvg/lib/default.svg`](../../node_modules/@silimate/netlistsvg/lib/default.svg).
Coloque um `<g s:type="<nome>">` aqui pra substituir.

| Categoria | `s:type` |
|---|---|
| MUX | `mux`, `mux-bus` |
| Lógica | `and`, `nand`, `andnot`, `or`, `reduce_nor`, `ornot`, `reduce_xor`, `reduce_nxor`, `not`, `buf`, `tribuf` |
| Aritmética | `add`, `sub`, `mul`, `div`, `mod`, `pow`, `pos`, `neg` |
| Comparadores | `eq`, `ne`, `lt`, `le`, `gt`, `ge` |
| Shifts | `shr`, `shl`, `sshr`, `sshl` |
| Flip-flops | `dff`, `dff-bus`, `dffn`, `dffn-bus` |
| Latches | `dlatch`, `dlatch-bus`, `dlatchn`, `dlatchn-bus` |
| AOI/OAI | `_AOI3_`, `_OAI3_`, `_AOI4_`, `_OAI4_` |
| Externos | `inputExt`, `constant`, `outputExt`, `split`, `join` |
| Fallback genérico | `generic` |

> Os tipos do Yosys vêm com prefixo `$` (e.g. `$add`). A skin casa via
> `<s:alias val="$add"/>` — veja o `default.svg` pra mapeamentos completos.

---

## Como o merge funciona (resumo técnico)

1. `main/ipc/prism.js` (função `getDefaultSkinData`) lê o `default.svg`
   do `node_modules`.
2. Lista todo `*.svg` em `assets/prism-skins/` (ignora arquivos `_*.svg`).
3. Pra cada arquivo, extrai TODO bloco `<g s:type="X">…</g>` no topo de
   nível (contagem de profundidade — blocos aninhados são preservados).
4. Pra cada bloco extraído:
   - Se já existe um `<g s:type="X">` no `default.svg`, ele é **removido**.
   - O bloco customizado é inserido antes de `</svg>`.
5. O SVG resultante é entregue ao `netlistsvg.render()`.

A skin é re-construída a cada chamada (sem cache), então editar um arquivo
e clicar **Recompile** já mostra a alteração.

---

## Skins já incluídas (starter pack)

Você já tem 26 arquivos prontos como ponto de partida. **Cada um é só um
rascunho** — abra, mude o que quiser (tamanho, forma, label, cor) e
recompile. Os blocos `s:alias` cobrem todas as variantes do Yosys que
casam com cada tipo (e.g. `and` cobre `$and`, `$logic_and`, `$_AND_`,
`$reduce_and`).

### SAPHO (6)
- [`ula.svg`](ula.svg) — ALU clássica (pentágono com entalhe em V)
- [`processor.svg`](processor.svg) — chip IC com pin-1
- [`core.svg`](core.svg) — CPU core (datapath + control)
- [`addr_dec.svg`](addr_dec.svg) — DEMUX trapezoidal
- [`instr_dec.svg`](instr_dec.svg) — decoder com striped lookup
- [`myFIFO.svg`](myFIFO.svg) — fila com cells visuais + seta de fluxo

### Gates lógicos (8)
- [`and.svg`](and.svg), [`nand.svg`](nand.svg) — D-shape, com/sem bolha
- [`or.svg`](or.svg), [`nor.svg`](nor.svg) — shield curvo, com/sem bolha
- [`xor.svg`](xor.svg), [`xnor.svg`](xnor.svg) — OR com curva extra
- [`not.svg`](not.svg) — triângulo + bolha
- [`buf.svg`](buf.svg) — triângulo simples

### MUX + sequenciais (4)
- [`mux.svg`](mux.svg) — trapezóide com `0/1` (cobre mux + mux-bus)
- [`dff.svg`](dff.svg) — D-FF positive-edge (single + bus)
- [`dffn.svg`](dffn.svg) — D-FF negative-edge (bolha no CLK)
- [`dlatch.svg`](dlatch.svg) — D-latch (level-sensitive, sem triângulo)

### Aritmética (6)
- [`add.svg`](add.svg), [`sub.svg`](sub.svg), [`mul.svg`](mul.svg),
  [`div.svg`](div.svg), [`mod.svg`](mod.svg) — círculos com operador
- [`neg.svg`](neg.svg) — negação unária

### Comparadores (1 arquivo, 6 blocos)
- [`comparators.svg`](comparators.svg) — `eq`, `ne`, `lt`, `le`, `gt`, `ge`
  em hexágonos com o glifo correspondente

### Shifts (1 arquivo, 4 blocos)
- [`shifts.svg`](shifts.svg) — `shl`, `shr`, `sshl`, `sshr`

### Ainda em `generic` (default.svg) — você pode adicionar quando quiser:
`pos`, `pow`, `tribuf`, `andnot`, `ornot`, `dlatchn`, `_AOI3_`, `_OAI3_`,
`_AOI4_`, `_OAI4_`, `inputExt`, `outputExt`, `constant`, `split`, `join`,
+ todos os submódulos da ULA (`ula_mux`, `ula_add`, `ula_fadd`, etc.) e
quaisquer módulos próprios do seu projeto.
