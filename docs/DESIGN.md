# Manifesto de desenho da AURORA

Escrito em 13/06/2026 como proposta, e reenquadrado em 08/08/2026 depois de
conferido contra o CSS.

Este documento dizia ser a fonte da verdade visual, e que se o código discordasse
dele o código teria um bug. A conferência mostrou uma relação mais interessante
que essa.

O raio de foco da seção 5 pede quatro coisas, e cada uma teve um destino
diferente. Na aba ativa ele foi implementado, com o código até anotado como
`DESIGN §5 focus-ray`, e depois removido de propósito no commit `c08692ef`, de
20/06/2026, cujo título diz `drop tab beam`. Hoje a aba ativa se distingue só
pelo contraste de fundo, e há um comentário no `tabs.css` dizendo exatamente
isso. No pane focado do split o problema foi resolvido por outro caminho, com
escurecimento dos panes sem foco (`.split-pane-dim`) em vez do raio, e funciona.
No foco de input o objetivo foi atendido sem o gradiente: são 37 regras de
`:focus-visible` e nenhum contorno azul de sistema solto, usando `--accent`. Só
a linha selecionada na árvore continua como a seção critica, com preenchimento
sólido de `--overlay-selected`.

Ou seja, não é um documento ignorado. É um documento cuja ideia central foi
testada, e em parte rejeitada por quem desenha. Os tokens `--focus-ray` e
`--accent-veil` seguem definidos e com zero uso, assim como `--surface-overlay` e
`--surface-raised`; `--border-hairline`, `--border-luminous` e `--accent-glow`
chegaram ao código, com 17, 5 e 10 usos.

Ele também está velho nos dois sentidos. A meta da seção 4 era derrubar os 71
`box-shadow`; hoje são 99, então essa foi na direção contrária. Já a escala de
z-index furada que a seção 5 reclama foi resolvida: dos nove literais fora da
escala sobraram quatro no CSS inteiro.

Então a forma certa de ler este arquivo é como proposta com histórico, e não como
descrição do que está na tela nem como regra que o código esteja violando. Onde
ele foi tentado e revertido, a reversão é a decisão mais recente e vale mais que
o texto. Onde o objetivo foi atingido por outro caminho, como o escurecimento do
pane e o `:focus-visible` com acento, o objetivo é que importava.

O que sobra de fato aberto é pouco e está listado no item 2 do
[PENDENCIAS.md](PENDENCIAS.md), para ser decidido e não presumido.

---

## 0. Princípio único

> **A AURORA é luz contra o escuro.** Toda decisão — cor, profundidade, movimento — deriva de como
> uma aurora boreal se comporta no céu noturno. Não é tema escuro com gradiente bonito. É a física
> do fenômeno traduzida em regra de interface.

Quatro propriedades do fenômeno, quatro regras inegociáveis:

| Fenômeno | Regra de design |
|---|---|
| **Emissão** — a aurora é luz de oxigênio (verde/vermelho) e nitrogênio (azul/violeta) | A cor de marca é uma **transição vertical verde→teal→violeta**, nunca um acento chapado. |
| **Deriva** — cortinas que escorrem lentas, movidas por um campo invisível; nunca saltam | Movimento é **fluxo contínuo e eased**. Zero spring saltitante, zero pop-in. |
| **Luminosidade** — a aurora brilha; não projeta sombra | Elevação se expressa por **glow e borda luminosa**, não por drop-shadow. |
| **Raios** — estrutura vertical de feixes e cortinas | Seleção/foco é marcado por um **raio luminoso fino**, não por preenchimento sólido. |

E a regra que protege tudo isso:

> **Anti-slop.** Decoração só existe quando É a identidade (a aurora) e quando não atrapalha o
> usuário. Todo o resto do movimento tem **trabalho**: orientar, mostrar causa-e-efeito, ou manter
> contexto numa troca de estado. Movimento sem função é removido.

---

## 1. Dark-only é a identidade, não limitação

A AURORA é **dark-first por design** — a aurora não existe ao meio-dia. O tema light atual já é
código morto (`.theme-light` aponta para `#fractalcomp`, que não existe no DOM); ele é **aposentado
formalmente**, não consertado. Em troca, oferecemos **dois ambientes escuros**:

- **`aurora-night`** (default) — o céu profundo, fundo `#0A0D14`, para uso prolongado.
- **`aurora-contrast`** — high-contrast acessível (WCAG AAA onde possível), bordas e texto reforçados.

A alternância é uma classe no `<body>` lida por tokens semânticos (§3). Nada de regras condicionais
espalhadas. O Monaco e o (futuro) xterm recebem o tema derivado dos mesmos tokens.

---

## 2. Camada base — o espectro de emissão

A base já existe em [`css/base/theme_variables.css`](../css/base/theme_variables.css) (~200 custom
properties, 2.399 usos de `var(--)` no projeto). **Ela é boa e fica.** O trabalho é (a) renomear o
espectro de acento para nomes do fenômeno, (b) **consolidar** as três paletas divergentes hoje
existentes (`splash.html`, `update-notification.html` re-declaram cores próprias) nesta única fonte.

O espectro de acento (valores ancorados nos tokens reais atuais — **não inventar paralelos**):

```
/* Linhas de emissão — a paleta-assinatura */
--spectrum-green     /* O₂ 557nm — verde-mint, o acento primário (≈ --aurora-mint #5FE0B0) */
--spectrum-teal      /* transição                                                          */
--spectrum-cyan      /* (≈ --aurora-cyan #5BB8E8)                                          */
--spectrum-azure
--spectrum-violet    /* N₂ — a franja inferior                                             */
--spectrum-magenta   /* o raro vermelho/rosa de alta altitude                              */
```

**O gradiente de marca** (usado no raio de foco, no logo, no shader ambiente, na borda do pane ativo):

```
--aurora-veil: linear-gradient(180deg,
  var(--spectrum-green) 0%,
  var(--spectrum-teal) 35%,
  var(--spectrum-cyan) 60%,
  var(--spectrum-violet) 100%);
```

As **16 cores estáveis de processador** permanecem (já existem) e passam a derivar matiz desse mesmo
espectro, para que um projeto multiprocessador pareça uma aurora de várias bandas, não um arco-íris
aleatório.

Superfícies (4 níveis de elevação) e texto (4 stops) **ficam como estão** — só ganham nomes
semânticos na camada de cima.

---

## 3. Camada semântica — o que estava faltando

Hoje há ~50 aliases legados (`--bg-primary`, `--hover-color`, `--accent-primary`…) misturados com os
canônicos: **dois vocabulários ativos**. Substituímos por **uma** camada semântica explícita. Regra:
componentes **nunca** referenciam a camada base direto; só a semântica.

```
/* Superfícies (mapeiam os 4 níveis base) */
--surface-sky        /* fundo da janela — o céu             */
--surface-raised     /* painéis, cards                      */
--surface-overlay    /* modais, popovers, menus             */
--surface-sunken     /* inputs, poços, áreas de scroll      */

/* Texto */
--text-bright        /* títulos, foco                       */
--text-default
--text-muted
--text-faint         /* placeholders, desabilitado          */

/* Acento / interação */
--accent             /* = --spectrum-green, o verde-assinatura */
--accent-veil        /* = --aurora-veil, o gradiente de marca  */
--accent-glow        /* sombra luminosa do acento (§4)         */

/* Estado */
--state-ok  --state-warn  --state-error  --state-info
--focus-ray          /* o raio luminoso de foco (§5)         */
--border-hairline    /* borda de 1px, baixa opacidade        */
--border-luminous    /* borda que brilha no hover/ativo      */
```

Migração: um codemod mapeia os ~50 aliases legados → semânticos e remove os aliases. Resultado: **um
vocabulário só**.

---

## 4. Elevação por luz, não por sombra

Eram 71 `box-shadow` e 12 `backdrop-filter` quando isto foi escrito. Em 08/08/2026
são 99 e 11: a sombra cresceu em vez de diminuir, o que mostra que esta seção
nunca saiu do papel. Ambos são caros de pintar e estranhos à identidade, porque
aurora não faz sombra. A regra de profundidade proposta:

1. **Elevação = luminosidade + borda, não offset escuro.** Um painel "sobe" ficando levemente mais
   claro que o céu e ganhando uma `--border-hairline`. Modais ganham `--border-luminous`.
2. **Glow é reservado ao acento e ao estado.** `--accent-glow` (um `box-shadow` suave colorido, sem
   blur exagerado) marca o elemento ativo/em foco e os estados `ok/error`. Nada de glow decorativo
   genérico em tudo — isso é slop.
3. **`backdrop-filter` some do caminho quente.** Modais e overlays usam `--surface-overlay` sólido
   com leve transparência; o blur fica reservado a **um** lugar de assinatura (o overlay do welcome),
   `@supports` com fallback sólido.

Meta de performance: derrubar os 71 box-shadows para um punhado intencional. Sombra não animada que
sobra vira borda; sombra animada vira `transform`/`opacity` (§6).

---

## 5. O raio de foco — a assinatura estrutural

Em vez de preencher o item ativo com um fundo sólido (genérico), a AURORA marca foco/seleção com um
**raio luminoso vertical fino** — um feixe de 2px com o `--accent-veil`, à esquerda do item:

- **Aba ativa:** raio na base + texto `--text-bright`.
- **Pane focado (split):** raio na borda esquerda do pane.
- **Linha selecionada na árvore / lista:** raio à esquerda, fundo apenas `--surface-raised` sutil.
- **Input em foco:** borda vira `--focus-ray` (gradiente), não um anel azul de sistema.

A escala de z-index furada que esta seção citava, com o token convivendo com
literais como `10001` e `10000`, foi resolvida por outro caminho: em 08/08/2026
sobraram quatro literais numéricos no CSS inteiro, e o maior é um só. Este
parágrafo fica como registro de um problema que deixou de existir.

---

## 6. Sistema de movimento — "deriva de aurora"

A aurora **escorre**. O movimento da IDE também. Um conjunto pequeno e fechado de tokens — usados em
**tudo**, sem exceção ad-hoc:

```
/* Durações */
--motion-instant: 80ms    /* feedback de toque (botão pressionado)        */
--motion-quick:   140ms   /* hover, foco, micro-troca                     */
--motion-flow:    260ms   /* abrir painel, trocar aba, revelar conteúdo   */
--motion-curtain: 420ms   /* modais, overlays, transições de tela         */
--motion-ambient: 18s     /* a deriva de fundo do shader/gradiente        */

/* Easing — a curva da deriva, nunca spring */
--ease-aurora:   cubic-bezier(0.4, 0.0, 0.2, 1)   /* entrada/saída padrão */
--ease-reveal:   cubic-bezier(0.16, 1, 0.3, 1)    /* "cortina que clareia" — desacelera longo */
--ease-exit:     cubic-bezier(0.4, 0.0, 1, 1)     /* sai rápido, sem eco   */
```

**Regras invioláveis de movimento:**

1. **Anima só `transform` e `opacity`.** Largura/altura/top/left/margin nunca animam. É isso que
   garante os 165 FPS (orçamento de **6,06 ms/frame**).
2. **Sem spring, sem bounce, sem overshoot.** Aurora não salta. `--ease-aurora`/`--ease-reveal` só.
3. **Conteúdo REVELA, não voa.** Entrada = opacity 0→1 + `translateY(4px)→0` no máximo. Nada de
   slide-from-offscreen. A metáfora é uma cortina clareando, não um card chegando de fora.
4. **Rápido onde o usuário espera, lento onde ele não espera.** Resposta a clique = `--motion-quick`.
   Movimento ambiente de fundo = `--motion-ambient`. Nunca o contrário (nada de animação longa
   bloqueando uma ação).
5. **`will-change` é cirúrgico** — aplicado no início da interação, removido no fim. Nunca permanente.
6. **`prefers-reduced-motion` corta tudo que é ambiente e encurta o resto para `--motion-instant`.**
   Já respeitado em 4 lugares hoje; passa a ser global e obrigatório.

---

## 7. A assinatura — o shader ambiente de aurora

Uma aurora **real**, contínua e lentíssima, em chrome que **não bloqueia** o usuário: fundo do
**welcome screen**, do **splash** e da moldura do **PRISM**. É o "wow" que não é slop porque é
literalmente o nome do produto, feito com contenção.

**Spec técnico:**
- **WebGL** (full-screen quad + fragment shader), com **fallback** para `--aurora-veil` animado em
  CSS quando WebGL falta ou em `prefers-reduced-motion`.
- **Forma:** cortinas de aurora **em perspectiva**, varrendo o céu com profundidade 3D — o march
  volumétrico do nimitz ("Auroras", ShaderToy XtGGRt, 2017), colorido por **profundidade** (verde na
  base → teal → ciano → violeta → magenta nas pontas). Bandas em altitudes próximas se **sobrepõem
  numa fita única conectada**; uma **franja de filamentos** verticais pende da borda inferior.
- **Movimento:** a forma se transforma **no lugar** (o gradiente do tri-noise gira no tempo), **sem
  translação lateral**; bandas extras **aparecem e somem** num envelope de período irregular (duas
  senoides incomensuráveis), então nunca há loop perceptível. Lentíssimo. A aurora *ondula*, não pisca.
- **Custo:** resolução interna reduzida (half-res) + upscale; `requestAnimationFrame` pausado fora de
  tela / quando a janela perde foco. São 3 marchas empilhadas (banda-base + 2 camadas), custo maior
  que uma cortina única — aceitável para um fundo ambiente pausável; reduzir passos se preciso.
- **Restrição:** **nunca** atrás de texto de leitura prolongada (editor, terminal). Só em telas de
  transição/identidade. Opacidade baixa o suficiente para o conteúdo respirar.

Isto é um componente Lit/vanilla isolado (`<aurora-canvas>`) com parâmetros `intensity` e `speed`,
para ser reutilizado e nunca duplicado. Os coeficientes do visual (SOFT/FIL/BANDS/CONN/SWEEP/…) foram
afinados ao vivo num protótipo e ficam como constantes no `FRAG` de [aurora_canvas.js](../js/visual/aurora_canvas.js).

---

## 8. Tipografia e iconografia — uma fonte de cada

**Tipografia (100% local, zero CDN):**
- **Inter** — toda a UI. Pesos 400/500/600.
- **JetBrains Mono** — todo código e terminal.
- Uma face de **display** (a atual *Mrs Saint Delafield* ou substituta) **só** no wordmark do
  welcome/splash — em nenhum outro lugar.
- Os `.woff2` vão **no repo** (`assets/fonts/`). Hoje há **zero** webfonts locais e tudo vem de
  `fonts.googleapis.com` — a IDE perde a tipografia offline. Isso acaba.

**Iconografia — um sistema só:**
- **Phosphor** (linha fina, casa com a estética luminosa) como **sprite SVG local**.
- **Remover FontAwesome** (hoje carregado inteiro, usado por 13 módulos) e os **glifos duplicados**
  (`.glyph` no `index.html` *e* `.aglyph` em `theme_variables.css` — o SVG do C± está colado 2× no
  DOM). Os ícones de compilação viram entradas do mesmo sprite.
- Ícone herda `currentColor` → pode receber o `--accent-veil` via `mask` quando precisar brilhar.

---

## 9. Arquitetura de componentes — Lit

"Padronizado" não se mantém por disciplina; se mantém por **construção**. Cada peça do shell vira um
Web Component (Lit) com **CSS encapsulado** (Shadow DOM) — estilo não vaza, e a guerra dos **55
`!important`** (30 deles brigando com o Monaco em `editor.css`) acaba.

**Componentes do shell (alvo):**
```
<aurora-titlebar>   <aurora-activity-bar>   <aurora-panel> (dockável)
<aurora-tabs>       <aurora-tree>           <aurora-terminal> (custom, otimizado)
<aurora-statusbar>  <aurora-modal>          <aurora-command-palette>
<aurora-canvas>     <aurora-toast>          <aurora-tooltip> (Floating UI)
```

**Regras de componente:**
1. Tokens semânticos (§3) entram via custom properties que **atravessam** o Shadow DOM. Um componente
   nunca cita a camada base nem hex cravado.
2. Todo componente declara seus estados visuais (`default/hover/active/focus/disabled/loading/empty`)
   e é exibido na **Design Lab** (§11).
3. Movimento só pelos tokens do §6.
4. O **Monaco** e o **terminal** são *hosts* dentro de componentes, recebendo tema derivado dos
   tokens — não estilizados por `!important` externo.

**Command palette** (`Ctrl+P` / `Ctrl+Shift+P`) entra como superfície primária de navegação e ações —
hoje inexistente. É o atalho que faz uma IDE parecer profissional.

`index.html` deixa de ter 4 modais inline, `<style>` inline e ~180 linhas de `<script>` com um
sistema de modais paralelo ao `modal_system.js`. Tudo isso vira componente.

---

## 10. PRISM no mesmo sistema

O PRISM (viewer de RTL: Yosys + netlistsvg em janela própria) **não é exceção** — mesma moldura,
mesmos tokens, mesma linguagem de movimento:

- A janela ganha `<aurora-titlebar>` e o fundo `<aurora-canvas>` em intensidade baixa.
- O **netlist** é o palco perfeito para a estética: módulos **aurora-coded** (as 16 cores já
  existem), **arestas com glow** sutil, nós em `--surface-raised` com `--border-luminous`.
- **Zoom/pan** com `--ease-aurora` — a deriva também governa a navegação do grafo.
- Skins de `assets/prism-skins/` (82 arquivos) revisadas para os tokens; seleção de módulo usa o
  **raio de foco** (§5).

Um grafo luminoso no escuro: é onde a marca mais brilha.

---

## 11. Como mantemos a coerência (anti-slop operacional)

- **Design Lab** — uma rota interna que renderiza **todo** componente em **todo** estado. É onde a
  inconsistência aparece *antes* de chegar no produto. Sem isso, padronização decai.
- **Lint de design** — regra que falha o CI se um arquivo de componente usar hex cravado, `!important`
  ou uma duração/easing fora dos tokens do §6.
- **Orçamento de frame no CI/manual** — overlay de FPS (delta de `rAF`) + `PerformanceObserver` de
  `longtask`; nenhuma interação quente pode estourar 6 ms/frame.
- **Checklist de PR visual:** anima só transform/opacity? respeita reduced-motion? usa só tokens
  semânticos? tem estado de foco com raio? aparece na Design Lab?

---

## 12. Mapa de migração (o que sai, o que entra)

| Dívida atual | Vira |
|---|---|
| 3 sistemas de ícones (Phosphor CDN + FontAwesome + glifos duplicados) | **1** sprite Phosphor local |
| Fontes via `fonts.googleapis.com` (0 locais) | `.woff2` em `assets/fonts/` |
| 3 paletas divergentes (`theme_variables` + splash + update) | **1** fonte (`theme_variables.css` consolidado) |
| ~50 aliases legados de token | camada **semântica** única (§3) |
| 71 `box-shadow` / 12 `backdrop-filter` | elevação por **luz** (§4) |
| z-index: escala tokenizada + 9 literais soltos | **só** a escala `--z-*` |
| 55 `!important` (30 vs Monaco) | Shadow DOM (§9) |
| Tema light morto | `aurora-night` + `aurora-contrast` (§1) |
| 4 modais inline + sistema de modais no `index.html` | `<aurora-modal>` + command palette |
| Terminal custom (1 div/linha, cap 5.000, re-scan por frame) | `<aurora-terminal>` **otimizado no lugar** (contadores incrementais, filtro por classe CSS, cap menor) — **não** xterm.js, que perderia line-numbers clicáveis e cards por tipo. xterm fica reservado a um futuro shell interativo (PTY). |
| Movimento ad-hoc / inexistente | tokens de movimento §6 + `<aurora-canvas>` §7 |

**Ordem de execução** (alinhada ao roadmap do estudo): Vite primeiro (destrava HMR e o fim do
contrato de ordem de scripts) → camada semântica + consolidação de paleta/ícones/fontes → tokens de
movimento + `<aurora-canvas>` → componentização do shell (titlebar, tabs, tree, panel, statusbar) →
command palette → terminal (xterm) → PRISM. Cada etapa entrega valor visível e não quebra o núcleo
de estado preservado (ARCHITECTURE.md).

---

*Este manifesto é a régua. Implementação começa pela fundação (Vite) e pela Design Lab, para que a
primeira tela nova já nasça medida contra ele.*
