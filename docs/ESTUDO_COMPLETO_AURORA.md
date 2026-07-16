# Estudo Completo e Profundo — AURORA IDE

> Documento de trabalho. Mapeamento do código real (não de documentação) feito por uma frota
> de agentes de leitura + auditoria, em 13/06/2026, sobre `nipscernlab/aurora` na versão **6.3.2**.
> Cobre: filosofia/lógica, fluxo de informação, vulnerabilidades, performance (meta **165 FPS**),
> melhorias ativas/passivas, revamp visual, ferramentas open-source, instalação/DX e
> profissionalização do repositório. Cada item é classificado em **🔴 Radical / 🟡 Moderado / 🟢 Leve**.

---

## Sumário executivo

A AURORA é uma IDE Electron + Monaco **bem arquitetada para o tamanho do time** (2 mantenedores):
tem contratos de estado documentados (ARCHITECTURE.md), donos únicos de estado, isolamento de
contexto em todas as 4 janelas, allowlist de binários para a toolchain, e chaves de API
criptografadas via DPAPI. Não é um protótipo — é um produto.

Os problemas que impedem o salto de qualidade se concentram em **cinco frentes**:

1. **Superfície de ataque residual** — um canal IPC legado de execução de shell (`exec-command`)
   ainda registrado, um sink de XSS no renderizador de LaTeX do chat de IA, `webviewTag` ligado
   sem hardening, e CLIs de IA rodando com permissões totalmente abertas.
2. **Jank acima do orçamento de frame (~6 ms a 165 Hz).** Atenção: "+165 FPS" é fisicamente um
   pedido de **zero jank**, não de passar do refresh — o `main.js` já desativou o cap de FPS de
   propósito (saturava a GPU). Os estouros vêm de: um editor Monaco **completo por arquivo aberto**,
   re-parse de markdown **por frame** no chat, `transition: width` que relayouta todos os editores,
   standard-tree e terminal sem virtualização, e first paint dependente de **CDN**.
3. **Três god-files** (`compilation_module.js` 3.927 linhas, `ai_assistant_manager.js` 3.873,
   `aurora_api.js` 2.383) e **acoplamento pesado a globais** (`window.electronAPI` 431 refs).
4. **Camada visual dark-only com identidade fragmentada** — três sistemas de ícones coexistindo,
   paletas duplicadas e divergentes em 3 arquivos, escala de z-index furada, tema light morto.
5. **Pipeline de build/release com lacunas de cadeia de suprimentos** — downloads sem checksum/
   assinatura, instalador não assinado, e releases divididas entre dois repositórios
   (`aurora` vs `sapho`) deixando o usuário baixar a versão errada.

O caminho recomendado é **incremental**: ~15 correções 🟢 leves de alto retorno imediato (segurança
e FPS), depois a introdução de um **bundler (Vite)** como mudança 🟡 moderada que destrava metade da
agenda de performance e DX, e por fim a 🔴 reescrita dos god-files e do design system como projeto
de médio prazo.

---

## 1. Filosofia e lógica do programa

### 1.1 O modelo mental
AURORA = IDE; **SAPHO** = a plataforma/arquitetura de soft-processors. O fluxo conceitual é limpo:

```
Projeto (.spf)  →  Processadores (C±)  →  Compilação (CMM→ASM→Verilog)
                                              →  Simulação (Icarus/Verilator/cocotb)
                                              →  Ondas (GTKWave)  +  RTL (PRISM = Yosys + netlistsvg)
```

O `.spf` é a **fonte canônica de configuração por projeto** (consolidado a partir do antigo
`projectOriented.json` em 2026). O renderer escreve nele por um escritor único serializado
(`SpfStore.update`); o main também escreve em eventos de ciclo de vida. Historicamente havia 3
modos (Processor/Project/Verilog); hoje é **modo único (Project)** e o pipeline auto-decide
sim-completa vs verilog-only via `window.availableProcessors`.

### 1.2 Onde o modelo limpo vaza para o código
- **Orquestração 100% no renderer.** Os botões da toolbar montam toda a sequência em
  `compilation_flow.js` + `compilation_module.js`; o main só faz `spawn`. Isso mantém o main
  enxuto, mas concentra 3.927 linhas de lógica de domínio numa única classe reconstruída a cada
  clique.
- **Dois caminhos para tudo.** Compilação tem o caminho moderno (`CommandSpec` validado por
  allowlist) **e** um legado (`exec-command` com shell). IA tem caminho SDK **e** caminho CLI.
  Editor tem um Monaco por arquivo **e** modelos compartilhados. A coexistência é dívida, não
  design.
- **O `.spf` é fonte única, mas o "projeto aberto" não.** `global.currentProjectPath` /
  `global.currentProject` duplicam o que `state.currentOpenProjectPath` já guarda — duas fontes de
  verdade no main (`project.js` escreve, `files.js`/`prism.js`/`claude_code.js`/`codex_cli.js`
  leem).

**🟢 Leve:** documentar explicitamente no ARCHITECTURE.md a decisão "renderer orquestra, main
executa" e marcar os dois caminhos legados como deprecados com data de remoção.
**🟡 Moderado:** colapsar `global.currentProject*` para um único getter sobre `state`.

---

## 2. Fluxo de informação (mapa real)

### 2.1 Topologia
- **4 BrowserWindows** (main, splash, update, prism), todas com `contextIsolation:true`,
  `nodeIntegration:false` e preload dedicado.
- **95 registros `ipcMain`** (81 `handle` + 14 `on/once`); **~25 canais main→renderer** distintos.
- **4 preloads**: `preload.js` (430 linhas, **107 wrappers** `ipcRenderer` enumerados 1:1 —
  modelo seguro), e os de prism/update/splash. ⚠️ `preload_prism.js` quebra o padrão expondo
  `send(channel,data)` e `removeAllListeners(channel)` **genéricos**.
- **`aurora_api.js` NÃO é a ponte IPC.** A ponte real é o `preload.js`. `window.AuroraAPI` (2.383
  linhas, 90 funções, 9 namespaces) é uma *facade* criada para o tool-runner da IA, que resolve
  managers em call-time via `window.*`.

### 2.2 Backbone de eventos
O renderer é costurado por **CustomEvents** no `window`/`document`:
`aurora:spf-changed`, `aurora:editing-file-changed`, `aurora-editor-focused`,
`aurora:file-saved`, `aurora:locale-changed`, `project-config-saved`. O `AuroraAPI.events`
faz bridge de 7 desses para um bus namespaced. Push do main entra por
`onProcessorCreated/onProcessorsUpdated/onDirectoryChanged/onFileChanged/onOpenFileAt`.

### 2.3 Fluxo da IA (transport-agnostic)
Dois transportes convergem nos mesmos pacotes `ai:chat-event`: (1) **Vercel AI SDK** (`streamText`)
para 6 provedores com chave; (2) **CLIs por assinatura** (`claude -p --output-format stream-json`,
`codex exec --json`) que falam com um **servidor MCP HTTP local** (`127.0.0.1:porta-efêmera`). Todas
as 75 ferramentas voltam ao renderer pelo `tool_bridge` (`ai:tool-exec` → `ai:tool-result`).

**🟡 Moderado:** o `preload_prism.js` genérico deve voltar ao modelo de canais enumerados — é a
maior brecha estrutural do fluxo IPC.

---

## 3. Vulnerabilidades

> Contexto: em Electron sem sandbox de processo, **um XSS no renderer é potencialmente RCE**, porque
> o renderer tem acesso a IPC que lê/escreve arquivos arbitrários e dispara a toolchain.

| # | Severidade | Tier | Achado | Arquivo / símbolo |
|---|---|---|---|---|
| V1 | 🔴 Crítica | 🟢 Leve | **XSS no LaTeX do chat.** `_renderMath()` guarda a fonte da matemática *antes* do `escapeHtml()` e a restaura **sem re-escapar**, injetando em `<span class=ai-math>` via `innerHTML`. `$$<img src=x onerror=...>$$` numa resposta do modelo executa. | `js/ui/ai_assistant_manager.js` `_renderMath`/`renderInline` |
| V2 | 🔴 Crítica | 🟢 Leve | **Canal `exec-command` legado** roda `exec(string)` com shell cru do renderer, sem allowlist. Sem callers reais, mas **ainda registrado e exposto no preload** — injeção de comando completa para um renderer comprometido. | `main/ipc/compile.js` (`exec-command`), `preload.js:111` |
| V3 | 🟠 Alta | 🟢 Leve | **`webviewTag:true`** na main window com comentário desatualizado e **nenhum** `will-attach-webview`/`will-navigate`/`setWindowOpenHandler`. Config morta que amplia superfície. | `main/windows.js:144` |
| V4 | 🟠 Alta | 🟡 Moderado | **CLIs de IA com permissões abertas.** `permissionFlag()` sempre retorna `bypassPermissions`; Codex roda `--dangerously-bypass-approvals-and-sandbox`. As ferramentas **nativas** de escrita (Edit/Write do Claude, shell do Codex) **não** passam pelo card Allow/Deny do renderer. | `main/ai/claude_code.js`, `main/ai/codex_cli.js` |
| V5 | 🟠 Alta | 🟢 Leve | **Path traversal em `create-processor-project`.** `formData.processorName` entra direto em `path.join` **sem** a regex `^[A-Za-z0-9_-]+$` que rename-processor/project aplicam — `..\..` cria árvore fora do projeto. | `main/ipc/project.js:432` |
| V6 | 🟡 Média | 🟢 Leve | **`shell.openExternal` sem validação de protocolo** (aceita `file://` etc.); `folder:open` é o único path handler sem `safePath`; `get-file-stats` idem. | `main/ipc/files.js:293/303/469` |
| V7 | 🟡 Média | 🟡 Moderado | **MCP local sem autenticação.** As 75 tools (incl. `delete_file`, `set_command_override`) ficam em `127.0.0.1:efêmera`; defesa só por loopback + Host check. Tools `read` rodam sem prompt; no modo de permissão `allow`, tools de write também. | `main/ai/aurora_mcp_server.js` |
| V8 | 🟡 Média | 🟢 Leve | **`launch-gtkwave-only`** faz `spawn` de binário vindo do renderer **sem** passar pela `binary_allowlist` (diferente do `exec-spec`). | `main/ipc/compile.js:66` |
| V9 | 🟡 Média | 🟢 Leve | **Renames pré-autorizados.** `confirmToolCall` retorna `true` para `rename_project`/`rename_processor` em **todos** os modos, pulando o card — writes destrutivos sem confirmação. | `js/ui/ai_assistant_manager.js` `confirmToolCall` |
| V10 | 🟢 Baixa | 🟢 Leve | **`exec(string)` com interpolação** em utils de kill/check (`taskkill /PID ${pid}`, `IMAGENAME eq ${name}`). Inputs hoje internos, padrão frágil a caller futuro. | `main/utils.js:47/69/146` |
| V11 | 🟢 Baixa | 🟢 Leve | **`set_command_override`** dá ao agente reescrita da linha de comando da toolchain. Há allowlist + flags protegidas, mas combinado com modo `allow` é superfície ampla dirigida por IA. | `main/ai/tools.js` |
| V12 | 🟢 Baixa | 🟢 Leve | `spec.env`/`prependPath` do renderer entram no env do filho **sem filtro** (afeta grandchildren do make/verilator). | `main/compile/executor.js:51` |

**Pontos fortes a preservar:** chaves de API via `safeStorage`/DPAPI sem canal de leitura; env
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` removidos antes do `spawn` das CLIs; allowlist de 13 binários +
flags protegidas no caminho moderno; isolamento de contexto universal.

### Plano de segurança recomendado (ordem)
1. 🟢 **(V1)** escapar a saída do `_renderMath` (ou trocar por **KaTeX** com `trust:false`, ver §7).
2. 🟢 **(V2/V8)** remover `exec-command` do main e do preload; rotear gtkwave pela allowlist.
3. 🟢 **(V3)** `webviewTag:false` + `setWindowOpenHandler(() => ({action:'deny'}))` +
   `will-navigate` que bloqueia navegação externa, em todas as janelas.
4. 🟢 **(V5/V6)** aplicar `sanitizeFileName`/regex em `create-processor-project`; validar protocolo
   em `openExternal`; passar `folder:open`/`get-file-stats` por `safePath`.
5. 🟡 **(V4/V7)** dar um token de sessão ao MCP local (header `Authorization`) e fechar as tools
   nativas das CLIs por allowlist explícita, mantendo só `mcp__aurora__*`.
6. 🟢 **Habilitar `sandbox:true`** onde o preload não precisar de Node — hoje não está setado
   (cai no default). Avaliar por janela.
7. 🟢 Adicionar uma **CSP** (`<meta http-equip="Content-Security-Policy">` ou via
   `onHeadersReceived`) — hoje inexistente; fecha a maior parte das classes de XSS de uma vez.

---

## 4. Performance — orçamento de frame e zero jank (a meta correta dos "165 FPS")

> **Correção importante, validada no código.** Pedir "+165 FPS" é, na prática, pedir **nunca cair
> abaixo do refresh do monitor** — não "passar de 165". O renderer do Chromium é **paced por
> vsync**: ele apresenta no máximo um frame por refresh (60/120/165 Hz) e `requestAnimationFrame`
> acima disso não gera frames extras. E o [`main.js`](../main.js) (linhas 24–34) **deliberadamente
> NÃO seta `disable-frame-rate-limit`**, com comentário explicando que desativar o vsync saturou a
> GPU e congelou o splash. Ou seja: 165 FPS só existe num monitor de 165 Hz, e a única forma de
> "subir o número" é justamente o que vocês já removeram de propósito por causa de bug.
>
> **A meta real, então, é orçamento de frame: ~6,06 ms/frame a 165 Hz, com p99 de jank ≈ 0** nos
> cenários quentes (digitar no editor, streaming de IA, scroll de terminal/árvore, redimensionar
> painéis). Tudo abaixo trata de **caber nesse orçamento**, não de destravar FPS.

### 4.1 O que NÃO fazer (e por quê)
- **Não** reativar `disable-frame-rate-limit` — já testado, saturou GPU e travou o splash.
- Manter **aceleração de hardware ligada** (já está, via switches de GPU no `main.js`).
- Manter `backgroundThrottling` no default (`true`) na maioria das janelas — economiza CPU/bateria;
  só desligar na janela do shader ambiente (§7) enquanto ela anima visível.
- O ganho vem **inteiramente** de reduzir trabalho por frame (4.2). Medir com DevTools Performance +
  ETW (`chrome://tracing`) e um overlay interno que mede **delta de `rAF` e `longtask`**, expresso
  como **p99 de jank / frames estourados**, não como "FPS médio".

### 4.2 Achados estruturais (🔴/🟡) — onde está o jank de verdade
*(✔ = confirmado por verificação adversarial)*

| # | Tier | Gargalo | Impacto | Correção |
|---|---|---|---|---|
| P1 ✔ | 🔴 XL | **Um editor Monaco COMPLETO por arquivo aberto** (`editors` Map), cada um com `automaticLayout:true`. Memória/criação ∝ nº de tabs; cada resize/drag de painel dispara relayout em **todos** os editores live de uma vez (>6 ms fácil num split 3× com várias tabs). | Pico de jank ao abrir muitos arquivos e ao redimensionar | Padrão VS Code: **um editor por pane com `editor.setModel`**. Os models já são compartilhados (`SharedModelRegistry`); falta reusar a *view*. Trocar `automaticLayout:true` por **um** `ResizeObserver` coalescido. |
| P2 ✔ | 🟡 L | **Chat de IA re-parseia markdown e reescreve o `innerHTML` da bolha inteira por frame** de stream (`_renderStreamingBubble`/`_renderWithReveal`). Custo O(n²) **por segmento** (o `segmentBuffer` zera a cada tool-call). `scrollToBottom` ainda lê `scrollHeight` por frame. | Trava scroll/typing no fim de respostas longas | Renderizar **só o delta**: blocos fechados viram DOM estático; reparsear apenas o bloco em andamento (ou só ao fechar bloco). |
| P9 ✔ | 🟡 L | **Standard tree SEM virtualização** — `innerHTML=''` + rebuild síncrono de toda a subárvore expandida (`standard_tree_render.js` `_doRender`, 6–7 `createElement`/nó). (A *verilog* tree já é reconciliada; a *standard* não.) | Freeze ao expandir pasta grande (build/Temp/libs) | Reconciliação key-based (mesma técnica da verilog tree) **ou** virtualização (só viewport). No mínimo `DocumentFragment` + chunking. |
| P10 ✔ | 🟡 L | **Terminal re-caminha os ~5.000 nós** (`recountMessages` + `applyFilter`, querySelector aninhado) **a cada frame** durante simulação streamada. Pior cenário real de jank (vvp/verilator cuspindo dezenas de linhas/seg). | Trava o terminal e qualquer animação concorrente na simulação | **Otimizar no lugar** (contadores incrementais ao inserir/remover; filtro por classe CSS no container; reduzir cap p/ 1–2k ou virtualizar). **NÃO migrar para xterm.js** — perderia line-numbers clicáveis e cards por tipo (ver §7). |
| P3 | 🟡 M | **N+1 IPC na árvore.** `loadConfiguration`/`_discoverProcessorFiles`/`_classifyAll` fazem `await` serial por arquivo e **leem o conteúdo inteiro de cada `.v`** a cada refresh. | Refresh trava em projetos grandes | Um handler no main que devolve árvore + classificação em **batch**; cachear classificação por mtime. |
| P11 ✔ | 🟡 M | **Scans regex de modelo inteiro por edição** (`decorateBraKet`, debounced 150 ms) + **`document.querySelector` por keystroke** (find-widget). O `\|` é onipresente em Verilog (OR), então `decorateVerticalBar` aplica centenas de decorations. | Stutter ao digitar rápido em `.v` grandes (ula.v ~48 KB) | Restringir `findMatches` ao range visível (`getVisibleRanges`), re-rodar só on-scroll; tirar a query `.find-widget` do `onDidChangeModelContent` (rastrear estado por variável). |

### 4.3 Quick-wins (🟢) — alto retorno, baixo risco

| # | Gargalo | Correção |
|---|---|---|
| P4 ✔ | **First paint depende de rede:** 2 folhas Phosphor de `unpkg.com` + 3 fontes de `fonts.googleapis.com` + `import.css` com **22 @imports seriais**. Offline = ícones/fontes somem. | Bundlar fontes/ícones **locais** (woff2 + sprite SVG) e concatenar o CSS no build. (Resolve §6 também.) |
| P5 | **Init dupla:** `TabManager.initialize()` 2×, `initMonaco()` 2×, `onFileChanged` 2×, refresh-button com 2 listeners → cada refresh força um `loadConfiguration` extra. | Um único ponto de init; tornar `initMonaco` idempotente. |
| P6 ✔ | **`transition: width`** no file-tree (`layout.css:148`) e no painel de IA (`ai_assistant.css:36`) anima **propriedade de LAYOUT** → ~13–16 frames de relayout de **todos** os Monaco a cada toggle de sidebar. | Animar `transform: translateX` num wrapper de largura fixa, **nunca** `width`. |
| P12 ✔ | **Vazamento de listener = bug de perf.** `setupContentChangeListener` descarta o `IDisposable` de `onDidChangeModelContent`; como `addTab` re-chama ao reabrir um arquivo, cada reabertura **empilha** um listener no mesmo editor → callback roda **N× por tecla**. | Capturar o disposable e descartar em `closeEditor`, ou registrar só 1× por `filePath`. |
| P7 ✔ | **Zero `will-change` e zero `contain`/`content-visibility`** em todo o CSS — reflows cruzam fronteiras de painel (append no terminal recalcula a tree). | `contain: layout style paint` nos containers raiz de cada painel; `content-visibility:auto` nas listas (terminal/árvore). |
| P8b ✔ | **`backdrop-filter` em tooltip (hover frequente) e context-menu** — blur reamostrado toda vez que aparecem. | Trocar por `background` semi-opaco sólido (quase idêntico no dark, zero custo). Manter blur só em overlays grandes. |
| P13 ✔ | **`ResizeObserver` no `body`** chama `updateResponsiveSettings` iterando **todos** os editores com `updateOptions` **sem throttle** a cada frame de resize. | Coalescer via rAF; só chamar `updateOptions` quando o breakpoint **realmente** cruza. |
| P14 ✔ | **FontAwesome completo** (~265 KB: 106 KB CSS + 158 KB woff2) para ~35 ícones, parseado no boot. | Migrar os ~35 `fa-solid` para Phosphor/SVG e **remover** o FontAwesome (ou subsetar). |
| P15 | **Polling de mtime** de todos os arquivos abertos em paralelo ao watcher chokidar (redundante). | Manter só o watcher push. |
| P16 | 2 `setInterval(30s)` de health-check de watchers no main **nunca limpos**. | Agendar só com watcher ativo; `clearInterval` no teardown. |
| P17 | **Modais/painéis sempre montados** (4 modais inline + painel IA), togglados por `display`/`width` — style recalc percorre subárvores ocultas. | `display:none` (não `opacity`/`visibility`) + `contain:content`; montar sob demanda. (Converge com a11y — ver §10.) |

**Sequência sugerida:** quick-wins 🟢 (P4–P8b, P12–P17) → estruturais 🟡 (P2, P3, P9, P10, P11) →
🔴 P1 (editor por modelo). O P12 (vazamento de listener) é o de melhor relação esforço/impacto:
conserta um leak **e** um custo por-tecla de uma vez.

### 4.4 Como medir (e impedir regressão)
Overlay dev com **delta de `rAF` + `PerformanceObserver` de `longtask`** (frames > ~6 ms), expresso
como **p99 de jank**, não FPS médio. Marcar o boot com `performance.mark/measure` para ter um
**baseline de time-to-interactive** (hoje inexistente — ver lacuna §10) e adicionar um **smoke de
startup com orçamento** no CI, senão cada otimização regride sem aviso.

**✅ Implementado (15/06/2026, commit `d4f7735`):** o overlay existe — `js/dev/jank_overlay.js`. HUD
com FPS, **p99** de frame vs orçamento de 165 Hz (6,06 ms), **taxa de jank** (% de frames > 2× orçamento),
contagem de **longtask** (`PerformanceObserver`) e **TTI** aproximado (mark `aurora-interactive` → fallback
`navigation.domInteractive`). Buffer circular de 300 frames; **custo zero quando inativo** (o loop de rAF e
o observer só rodam com o overlay visível). Aberto por **import dinâmico** na command palette (grupo "Dev"
→ "Toggle Jank Overlay"). **Falta** ainda: setar o `performance.mark('aurora-interactive')` no fim do init
(pra o TTI sair do fallback) e o **smoke de orçamento no CI** (pareia com B4 — `tsc --noEmit` no CI).

---

## 5. Arquitetura e melhorias estruturais

| # | Tier | Achado | Recomendação |
|---|---|---|---|
| A1 | 🔴 Radical | **Sem bundler.** Ordem de 34 `<script>` em `index.html` é contrato implícito; managers fazem I/O no construtor; `.ts` compila in-place gerando `.js` commitado ao lado (vetor de drift). | Adotar **Vite** (ou esbuild). Elimina o contrato de ordem de carga, dá HMR, tree-shaking, code-splitting, e mata o problema do `.js` in-place. **Destrava metade de §4 e §8.** |
| A2 | 🔴 Radical | **God-files:** `compilation_module.js` 3.927, `ai_assistant_manager.js` 3.873, `aurora_api.js` 2.383. | Decompor por responsabilidade: compilação → por etapa (cmm/asm/wave/verilator/cocotb); IA → (transporte / render de chat / permissões / markdown); AuroraAPI → por namespace. |
| A3 | 🟡 Moderado | **Acoplamento a globais:** 431 `window.electronAPI`, 105 `window.t`, 48 `window.currentProjectPath`, ~40 globais distintos. | Migrar leituras legadas para imports ES; manter espelhos só durante a transição. Testabilidade hoje é refém disso. |
| A4 | 🟡 Moderado | **Estado duplicado** `global.currentProject*` vs `state.currentOpenProjectPath`. | Um único getter sobre `state`. |
| A5 | 🟢 Leve | **Bugs reais achados no mapeamento:** (a) `getActiveFilePath` lê `dataset.file` mas as tabs gravam `data-path` → find-state nunca funciona por arquivo; (b) `editorNs.openFile` usa `tree.value` mas `getTree` retorna `{ok,data}` → fallback morto; (c) snapshot de estado do PDF lê `activeTab` já sobrescrito; (d) código morto com `ReferenceError` latente (`saveEditorState`/`formatCurrentFile`). | Corrigir os 4; são pequenos e de alto valor. |
| A6 | ✅ **FEITO** | **`exec-command` legado REMOVIDO** (sink de command-injection, sem callers — tudo via executor estruturado em `main/compile/executor.js`; ver comentário em `main/ipc/compile.js:26`). | — |
| A7 | ✅ **FEITO** | **`preload_prism.js` endurecido** — removidos os `send`/`removeAllListeners` genéricos; os 14 canais da janela PRISM já têm wrappers nomeados (allowlist intacta). | — |
| A8 | ✅ **FEITO** | **152 linhas de código morto removidas** (view de hierarquia pré-PRISM no fim do `compilation_module.js`). Confirmado por **refutação adversarial** (zero callers; chamava um `this.enableHierarchicalTreeToggle()` inexistente; toggle é do `file_tree_view_controller`). O `cleanModuleName` **vivo** do `prism.js` foi preservado. | — |

---

## 6. Revamp visual completo

### 6.1 Diagnóstico
A base é **melhor do que parece**: "AURORA Design Tokens v3" com ~200 custom properties, **2.399
usos de `var(--)`** contra apenas ~64 hex hardcoded, só 2 `transition:all`, e `prefers-reduced-motion`
respeitado. O problema é **fragmentação de identidade**, não ausência de sistema.

**Dívidas visuais:**
1. **Três sistemas de ícones** coexistindo — Phosphor (canônico, **via CDN**), FontAwesome 6.6
   completo bundlado (fallback, 13 módulos JS) e glifos SVG inline duplicados (`.glyph` no
   `index.html` **e** `.aglyph` em `theme_variables.css` — o SVG do C± está colado 2× no DOM).
2. **Paletas duplicadas e divergentes** em `splash.html` e `update-notification.html` (ex.:
   `--green #45E0A0` vs `--aurora-mint #5FE0B0`) — 3 fontes de verdade para a mesma marca.
3. **Tema light é código morto** (`.theme-light` aponta para `#fractalcomp`, que não existe;
   `setTheme` sem caller externo).
4. **Escala de z-index furada** — token `--z-0..--z-max:100` coexiste com literais `10001/10000/
   1000/200` (duas camadas de empilhamento incompatíveis).
5. **30 dos 55 `!important`** em `editor.css` lutando contra o Monaco (frágil a cada bump).
6. **~50 aliases legados** de tokens (dois vocabulários ativos).
7. `index.html` mistura responsabilidades (4 modais inline, `<style>` inline, ~180 linhas de
   `<script>` com sistema próprio de modais paralelo ao `modal_system.js`).
8. `ai_assistant.css` = **21% de todo o CSS** (2.150 linhas) com paleta de syntax própria fora dos
   tokens.

### 6.2 Proposta em três níveis

**🟢 Leve — "polish" sem mudar estrutura (1–2 semanas)**
- **Bundlar fontes e Phosphor localmente** (woff2 + sprite SVG) → mata CDN, conserta offline e o
  first paint (também P4).
- Unificar os 3 sistemas de ícones em **um sprite SVG** (Phosphor *ou* Lucide); remover FontAwesome
  (≈ –1 dependência pesada) e a duplicação `.glyph`/`.aglyph`.
- Consolidar a paleta: `splash`/`update-notification` importam `theme_variables.css`.
- Normalizar z-index para a escala tokenizada; podar os ~50 aliases legados com um codemod.
- Tipografia: manter **Inter** (UI) + **JetBrains Mono** (código), agora locais.

**🟡 Moderado — design system formal (3–5 semanas)**
- Tokens em **camadas semânticas**: `base` (cor crua) → `semantic` (`--surface-raised`,
  `--text-muted`) → `component`. Hoje há mistura de canônicos + aliases.
- **Reintroduzir o tema light de verdade** (e high-contrast) via troca de classe no `<body>`, com
  sincronização de tema do Monaco e (futuro) xterm. A infra de tokens já suporta.
- Refatorar os painéis principais para animar **só `transform`/`opacity`**; remover blur onde não
  agrega; `content-visibility` nas listas.
- **Command palette** (Ctrl+P/Ctrl+Shift+P) como superfície primária de navegação/ações.
- Extrair os 4 modais inline do `index.html` para componentes e matar o sistema de modais paralelo.

**🔴 Radical — redesign do shell (projeto de médio prazo)**
- Após o bundler (A1), adotar **Web Components (Lit)** para os componentes do shell (titlebar,
  painéis dockáveis, status bar) — encapsula CSS, mata vazamento de `!important`, e dá base para
  layout dockável estilo Fleet/Zed.
- Welcome screen e estados vazios redesenhados (hoje `.empty-state` tem 4 skins diferentes).
- Densidade e hierarquia revisadas com referência a Zed/Linear/Fleet.

### 6.3 Bibliotecas (custo/benefício, todas funcionam offline)
| Biblioteca | Uso | Custo | Tier |
|---|---|---|---|
| **Lucide** (SVG) | Ícones unificados, sprite local | ~poucos KB por ícone usado | 🟢 |
| **KaTeX** | Substitui o `_renderMath` artesanal (conserta V1) | ~150 KB, local | 🟢 |
| **Lit** | Web Components do shell | ~5 KB runtime | 🔴 |
| **Floating UI** | Tooltips/menus/posicionamento (substitui CSS+JS ad-hoc) | ~10 KB | 🟡 |

---

## 7. Ferramentas open-source para integrar

> Avaliado contra o **código real** do repo por auditoria com verificação adversarial. ✔ = a
> recomendação foi confrontada com o código e se sustenta. Duas correções importantes destacadas
> abaixo (xterm.js e monaco-languageclient). ⚠️ = versão a revalidar via web.

| # | Ferramenta | O que entrega | Licença | Tier | Esforço |
|---|---|---|---|---|---|
| O1 ✔ | **Surfer** (Rust→WASM) | **Ondas dentro da IDE** — substitui o GTKWave externo, embutível via iframe WASM; lê VCD/FST. **ESTUDO DE VIABILIDADE FEITO → `docs/surfer-feasibility.md`:** VIÁVEL, **phased-go, em paralelo** (toggle como iverilog/verilator). Trilhas de assembly/linha-fonte + view curada mapeiam limpo; único gap = `comp2gtkw` (complexos), resolvível por **pre-pass** reusando o `.exe`. **EUPL não trava** (já bundlamos GPL/GTKWave; embutir≠derivar). MVP pode **ignorar complexos**. | EUPL ✓ | 🔴 | L |
| O2 ✔ | **Verible** (`verible-verilog-ls`) | Lint + format + **language server** de Verilog → diagnostics inline no Monaco. **Conectar via shim manual** (LS como subprocesso no main → `setModelMarkers`), **não** via `monaco-languageclient` (ver O6). | Apache-2.0 | 🟡 | M |
| O3 ✔ | **Verilator** (já no bundle) | Promover a simulador de regressão. ⚠️ Correção: o **Fast Sim já usa Verilator** exclusivamente; o ganho real é (a) dar feedback streamado no build (~10–60 s hoje mudo) e (b) consolidar a duplicação `waveBuildVvp`/`_prepareWaveBuild`. | LGPL/Artistic | 🟡 | M |
| O4 ✔ | **xterm.js + node-pty** | ⚠️ **NÃO migrar o terminal de output atual** — seria over-engineering e perderia features (line-numbers clicáveis ligados a arquivos, cards por tipo). Reservar **só** para um **shell interativo novo** (PTY), se desejado. O terminal atual se conserta no lugar (P10). | MIT | 🟡 | L |
| O5 ✔ | **YoWASP (`@yowasp/yosys`)** ⚠️ | Roda o Yosys do PRISM **in-process** (sem spawn/allowlist). Benefício **diluído**: iverilog/vvp/verilator seguem nativos, então o download msys não some. Verificar `write_json` compatível com o netlistsvg atual. | ISC | 🔴 | L |
| O6 ✔ | **monaco-languageclient** | ⚠️ **NÃO adotar** para o caso atual — trocaria a base do editor (Monaco puro pinado 0.52.2) por risco alto. Preferir o shim manual fino de O2. | MIT | 🔵 evitar | — |
| O7 | **tree-sitter** (grammar C±/ASM) ⚠️ | Folding/outline/breadcrumbs e highlight semântico que o Monarch regex nunca dá; parser reutilizável p/ indexar símbolos (busca). `web-tree-sitter` (WASM). | MIT | 🔴 | XL |
| O8 ✔ | **cocotb + Verilator** (no bundle) | Formalizar testbench Python como fluxo de teste de 1ª classe (UI p/ `SIM=verilator`); alinha com o branch `cocotbtest` do Arthur. | BSD | 🟡 | M |
| O9 ✔ | **DigitalJS** + `yosys2digitaljs` ⚠️ | Simulação **visual interativa** na janela PRISM (valor pedagógico no contexto universitário). ⚠️ Exige um passo Yosys além do atual (`hierarchy`/`proc`), não é drop-in sobre o JSON existente. | — | 🟡 | L |
| O10 ✔ | **ripgrep** (`@vscode/ripgrep`) | **Find-in-files** inexistente hoje — busca instantânea por sinal/símbolo no projeto multiprocessador (`.cmm`/`.asm`/`.v`). IPC `search-in-project` com `spawn` shell:false. | MIT | 🟡 | M |
| O11 ✔ | **slang-server** (LSP) | Alternativa/complemento ao Verible: análise **semântica** (elaboração completa), mais preciso que lint sintático. Recomendação: **Verible primeiro**, slang depois. | MIT | 🟡 | L |
| O12 ✔ | **simple-git** | Integração Git na IDE (status/diff/commit). ⚠️ Preferir **`simple-git`** (wrapper do git nativo) a `isomorphic-git` no caso desktop. | MIT | 🟡 | M |
| O13 | **KaTeX** | (também §6) renderização de matemática **segura** — conserta o XSS V1. | MIT | 🟢 | S |
| O14 ✔ | **WaveDrom** | Diagramas de timing **só para docs/specs** — não substitui visualização de simulação (isso é o Surfer). | MIT | 🟢 | S |

**Maior alavanca (priorizado):** O1 (ondas embutidas) e O2 (LSP Verible via shim) mudam mais a
experiência; O10 (busca no projeto) é um quick-win de UX; O5/O3/O8 consolidam a base.
**⚠️ Tensão a resolver (ver §10):** embutir Surfer + Verible + slang + tree-sitter + YoWASP soma
WASM/LSPs que competem com o orçamento de frame e o tamanho do instalador — decidir o que é
**default-on** vs **plugin baixado sob demanda**.

---

## 8. Instalação, build e DX

| # | Tier | Achado | Recomendação |
|---|---|---|---|
| B1 | 🟡 Moderado | **Downloads sem integridade.** 3 zips (msys, yanc, gtkwave) baixados por HTTPS de GitHub Releases **sem checksum/assinatura**; verificação só por sentinela de arquivo. | Publicar `SHA256SUMS` por release e validar no downloader antes de extrair. |
| B2 | 🟡 Moderado | **Sem code signing.** Instalador NSIS e auto-update não assinados → SmartScreen; updater valida só sha512 do `latest.yml`. | **SignPath.io** (grátis p/ OSS) ou Azure Trusted Signing; anexar `SHA256SUMS.txt` no release. |
| B3 | 🟡 Moderado | **O split de repos é INTENCIONAL** (corrigido após esclarecimento): `sapho` = repo de **distribuição** (releases estáveis da suíte SAPHO = YANC + AURORA, baixadas no site); `aurora` = repo de **desenvolvimento** da GUI (+ toolchain bundlada). O problema real é só **o README/badges do `aurora` apontarem para releases do próprio `aurora` (v6.2.0, defasado)** em vez do canal `sapho` (v6.3.2). | Manter o split; corrigir README/badges para apontar ao canal `sapho`; documentar a estratégia dos 2 repos no CONTRIBUTING. |
| B4 | 🟢 Leve | **CI não roda `tsc`.** `ci.yml` chama `electron-builder` direto, pulando `build:ts`; os 28 `.ts` nunca são type-checados; testes importam os `.js` **commitados**. | Adicionar `npx tsc --noEmit` no CI + step que falha se `git diff` mostrar `.js` dessincronizado. |
| B5 | 🟡 Moderado | **`.js` gerados commitados in-place** (`outDir:"."`) → drift silencioso. | `.gitignore` nos gerados (já que `prebuild` os regenera) **ou** check de sincronização no CI (B4). |
| B6 | 🟢 Leve | `copy-components.js` faz `remove`+`copy` do bundle msys (centenas de MB) **a cada `npm start`** sem check incremental. | Copiar só se faltando/mtime mudou. |
| B7 | 🟢 Leve | **Bootstrap silencioso no release:** os downloaders saem com `exit 0` em falha (bom p/ dev offline), mas `release.yml` reusa o mesmo bootstrap **sem checar sentinelas** → release pode empacotar sem toolchain. | Validar sentinelas após bootstrap no `release.yml`. |
| B8 | 🟢 Leve | **Três caminhos de release sobrepostos** (`build.ps1` interativo, `npm version`+`release.yml`, release-please). | Escolher **release-please** como único; `release.yml` por `on: release: published`; aposentar `build.ps1`. |
| B9 | 🟢 Leve | Refs mortas: `tests/e2e/smoke.test.js` aponta para `check-monaco-version.js` (renomeado); `scripts/yanc-managed-files.txt` lista arquivos hoje gitignored; `package.json` tem bloco `win` top-level inerte; `RELEASE.md` desatualizado em 2 pontos. | Limpeza pontual. |
| B10 | 🟡 Moderado | **Cobertura de teste só nos módulos puros** (18 unit + 3 e2e). `main/ipc/`, `main/compile/`, `main/ai/`, `updater.js` e os builders TS **sem teste**. | Cobrir builders (puros, fáceis) e adicionar teste de contrato dos handlers IPC; medir cobertura com `--coverage` + Codecov. |
| B11 | 🔴 Radical | **Windows-only** (NSIS, binários win64, paths). 140 ocorrências Windows-específicas em 16 arquivos do main; allowlist hardcoded a `*.exe`. | Avaliar Linux/macOS: a maior trava é a toolchain bundlada por SO. Parametrizar allowlist por `process.platform`, trocar `Expand-Archive`/`taskkill` por libs node (yauzl/tree-kill). YoWASP (O5) reduz a dependência de binário. |
| B12 ✔ | 🟡 Moderado | **Instalador provavelmente >1,5 GB.** `asarUnpack` empacota os CLIs de IA gigantes (**@anthropic-ai ~437 MB + @openai ~238 MB = ~675 MB**) + toolchain ~1 GB. Download/instalação lentos para estudantes; ~675 MB de CLIs que muitos não usam. | Tornar os **CLIs de IA download opcional sob demanda** (como o toolchain já é); exclusões agressivas em `files` (`*.md`, `/test/`, `.d.ts`, sourcemaps); bundler para o código próprio. |
| B13 ✔ | 🟢 Leve | **`copy-components` recopia ~1 GB a cada `npm start`** (`remove`+`copy`, sem check incremental), e mantém o toolchain **duplicado** em disco. | Check incremental por mtime/contagem, **ou junction** (`mklink /J`) em vez de cópia física. |

---

## 9. Profissionalização do repositório

> Base já **acima da média**: LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, SECURITY, RELEASE.md,
> ARCHITECTURE.md completos; issue/PR templates; dependabot; husky+lint-staged; CI com
> lint/knip/testes/e2e/build; histórico reescrito para remover binários.

**Delta para padrão profissional (achados verificados via `gh`/git):**

1. 🟡 **Ponteiro de release errado** (= B3) — o split `aurora` (dev da GUI) / `sapho` (distribuição
   estável) é **intencional**, mas README/badges do `aurora` apontam para releases do próprio
   `aurora` (v6.2.0) em vez do canal `sapho` (v6.3.2). Corrigir só o ponteiro, manter o split.
2. 🟡 **release-please abandonado** — PR de release v6.4.0 **aberto desde maio/2026**; v6.3.x cortadas
   manualmente por fora; `CHANGELOG.md` só tem "Unreleased". Escolher um fluxo e segui-lo.
3. 🟡 **`main` sem proteção** — `branch protection` 404; 150 commits diretos. Criar ruleset
   (PR + status check "Lint + smoke build" obrigatório; bloquear force-push).
4. 🟡 **Naming precisa de decisão canônica** (não é simples bug). Modelo agora explícito:
   **SAPHO = plataforma (YANC + AURORA); AURORA = a GUI**. O produto *instalado* é a suíte SAPHO,
   então `productName:"SAPHO"` pode ser intencional — **decidir** e alinhar os 6 pontos (`name`,
   `productName`, `build.productName`, artefato, repo, publish) a essa decisão.
5. 🟡 **Sem code signing / sem checksums publicados** (= B2).
6. 🟢 **CI não roda typecheck** (= B4).
7. 🟡 **`.js` gerados commitados** (= B5).
8. 🟡 **Dependabot acumulando** (10+ PRs desde maio; fechados sem merge). Triagem quinzenal +
   auto-merge de patch/minor com CI verde.
9. 🟢 **Licença não detectada** (NOASSERTION — MIT + atribuições no mesmo arquivo). Mover atribuições
   para `THIRD_PARTY_NOTICES.md`; adicionar `license`/`repository`/`bugs` no `package.json`.
10. 🟢 **README sem mídia** — adicionar screenshot hero + GIFs (split editor, compilação, PRISM/onda);
    corrigir badge electron-38→39 e nome do instalador.
11. 🟢 **Sem CodeQL / secret scanning** — adicionar `codeql.yml` + push protection.
12. 🟢 **Discussions referenciado mas desabilitado** (link morto no CONTRIBUTING).
13. 🟢 **Metadados vazios** (topics `[]`, sem homepage/social preview) — descoberta zero.
14. 🟢 **Conventional commits seguidos mas não enforced** — `@commitlint/config-conventional` +
    hook `commit-msg`.
15. 🟢 **Sem CODEOWNERS** (roteamento de review p/ Arthur).
16. 🟢 **Cobertura não medida** — `vitest --coverage` + Codecov + badge.
17. 🟢 **Releases poluídas** — 5 drafts órfãos de 2025 + prereleases de toolchain misturadas.
18. 🟢 **Sem CITATION.cff / roadmap público** — relevante para laboratório acadêmico (NIPSCERN/UFJF).

---

## 10. Ângulos transversais (crítico de completude)

Lacunas que nenhuma das 6 dimensões cobriu sozinha, levantadas por um agente crítico. Várias são
**melhorias passivas baratas de alto impacto** na confiabilidade percebida.

| # | Tier | Ângulo | Estado real | Recomendação |
|---|---|---|---|---|
| G1 | — | **Premissa dos "165 FPS"** | Já corrigida em §4: vsync limita o renderer; `main.js` desativou o cap de propósito. | Tratar como **orçamento de frame / p99 de jank**, não FPS-alvo. |
| G2 | 🟢 Leve | **Sem rede de segurança de erro** no renderer | `grep` por `window.onerror`/`unhandledrejection`/`crashReporter` em `js/` e `main/` = **vazio**. Um `throw` em qualquer init derruba a IDE silenciosamente. | Handler global de `error`+`unhandledrejection` no renderer + `crashReporter` no main. Barato, alto impacto. |
| G3 | 🟢 Leve | **Vazamento de listeners** (memória) | **336 `addEventListener` vs 22 `removeEventListener`.** Caso concreto = P12 (`setupContentChangeListener` descarta o `IDisposable`). | Auditar pares; descartar disposables; ver P12. |
| G4 | 🟡 Moderado | **i18n não auditado** | Camada real existe (`js/i18n/`, 138 `data-i18n`), mas só **19 chaves** top-level e **~55 call sites** de notificação/terminal/IA **fora** de `t()`. Só 2 locales (pt/en) num projeto CERN. Largura PT vs EN quebra layout. | O **revamp visual e os empty-states nascem i18n-aware**; processo de extração/validação de chaves faltantes. |
| G5 | 🟡 Moderado | **Acessibilidade** | Parcial: há roles/aria mas **17 `outline:none`**, sem `prefers-contrast`/`forced-colors`, e os 4 modais sempre montados **não fazem focus-trap/`inert`** quando ocultos (leitor de tela e Tab vazam para UI escondida). | **Mesmo problema que P17** — `inert` + `content-visibility` resolve a11y e perf juntos. O tema `aurora-contrast` (DESIGN §1) entra aqui. |
| G6 | 🟡 Moderado | **Governança de modelos de IA** | `DEFAULT_MODELS` hardcoded e `Object.freeze` (`provider.js:61-66`); quando um provider aposenta um id, a chamada **falha em runtime sem fallback**. Sem painel de custo/tokens. | Estratégia de migração de modelo (alias "latest"/checagem de disponibilidade) + indicador de custo/tokens por conversa. |
| G7 | 🟢 Leve | **Cold start sem baseline** | 3 handlers `DOMContentLoaded` em série com awaits + I/O em construtores; **TTI nunca medido**. | Instrumentar TTI (§4.4) + smoke de startup com orçamento no CI. |
| G8 | 🟡 Moderado | **Contradição OSS pesado × FPS/tamanho** | §7 propõe Surfer/Verible/slang/tree-sitter/YoWASP (WASM+LSPs) enquanto §8 já sofre com instalador **>1,5 GB**. | **Priorizar:** o que é default-on vs **plugin baixado sob demanda** (como o toolchain já é); orçamento de RAM/CPU por integração. |
| G9 | 🟡 Moderado | **Processos zumbis da toolchain** | `process_registry.js` é maduro (tree-kill), mas o backstop só varre `vvp.exe`/`gtkwave.exe` + `Temp/`. Qualquer spawn que esqueça `trackChild` e rode fora do Temp (yosys/verilator/g++/make e OSS futuro) vira zumbi. | Tornar o registry o **único ponto de spawn** (wrapper obrigatório) — fecha o buraco por construção. |
| G10 | 🟢 Leve | **Higiene de watchers/caches** | chokidar por-arquivo (depth 0) e por-diretório (**depth 10**, `ReadDirectoryChangesW`) + `fileStatsCache`/`directoryStatsCache` sem limite/expurgo evidente entre projetos. | Confirmar que trocar de projeto não deixa watchers órfãos nem infla caches; TTL/limite nos Maps. |

---

## 11. Roadmap consolidado por tier

### 🟢 Sprint 1 — "Quick wins" (alto retorno, baixo risco)
**Segurança:** V1 (XSS LaTeX), V2 (exec-command), V3 (webviewTag), V5 (traversal), V6 (openExternal)
+ **CSP**. **FPS:** P4 (CDN→local), P5 (init dupla), P6 (`transition:width`), P7 (`contain`),
P8b (backdrop tooltip), P12 (leak de listener), P13/P14 (ResizeObserver/FontAwesome), P15/P16.
**Robustez (passiva):** G2 (handler global de erro + crashReporter), G10 (higiene de watchers).
**Bugs:** A5. **DX:** B4 (tsc no CI), B6/G…, B9 (refs mortas). **Repo:** #9, #10, #15, #16.
→ *Fecha os XSS/RCE óbvios, tira a IDE da dependência de CDN, conserta leaks e trabalho duplicado
por frame, e dá uma rede de segurança de erro — sem mexer em estrutura.*

### 🟡 Sprint 2 — "Estrutura" (médio prazo)
**Pivô: adotar Vite (A1).** FPS estrutural: P2 (markdown incremental), P3 (árvore em batch),
P9 (standard tree reconciliada), P10 (terminal otimizado **no lugar**), P11 (decorations por range).
**Visual:** design system semântico + `aurora-night`/`aurora-contrast` (§6.2; cobre G5 a11y + P17).
**i18n:** G4 (revamp i18n-aware). **IA:** G6 (governança de modelos). **Distribuição:** B1/B2
(checksum + signing), B3 (ponteiro de release), B12 (CLIs de IA sob demanda). **OSS default-on:**
O10 (busca/ripgrep), O2 (Verible via shim), O1 (Surfer). **Repo:** branch protection + release-please.
→ *Mata o jank estrutural, profissionaliza a distribuição e moderniza o editor de hardware.
Resolver a tensão G8 (default-on vs plugin sob demanda) aqui.*

### 🔴 Sprint 3 — "Reescrita" (projeto)
P1 (Monaco por troca de model); A2 (decompor os 3 god-files); **DESIGN.md radical** (Lit + shell
dockável + command palette + `<aurora-canvas>` WebGL); G9 (registry como único ponto de spawn);
O5 (YoWASP) + O7 (tree-sitter) + O9 (DigitalJS no PRISM); B11 (cross-platform).
→ *Orçamento de frame sustentado (zero jank a 165 Hz), código manutenível e identidade visual de
produto maduro — alinhado ao [Design Manifesto](DESIGN.md).*

---

*Documento enriquecido em 13/06/2026 por auditoria multi-agente com verificação adversarial
(43 agentes; achados marcados ✔ foram confrontados com o código). O revamp visual segue o
[DESIGN.md](DESIGN.md).*

---

## 12. Implementação na branch `feature/aurora-revamp` — checklist vivo

> Status real (atualizado), não só a primeira leva. Todos os commits com 253 testes unit passando
> e lint limpo. **Verificação visual/runtime é por conta do usuário** (os testes não exercitam o
> carregamento do Electron).
>
> **➡️ Sessão 16–17/06/2026 (Source Control embutido + polish da IDE): ver §14 no fim do documento.**

### Decisões de escopo (13/06/2026)
- **Tema único canônico.** A AURORA mantém UM tema só (escuro, identidade aurora borealis). **Fora de
  escopo por decisão:** tema light, tema high-contrast (`aurora-contrast`), e qualquer mudança no tema
  da aurora. Itens de §6.2/G5 que pediam troca de tema estão **descartados**.
- **P1 (um Monaco por pane) — tentado e REVERTIDO.** ROI modesto (o ganho de relayout quase não existe:
  editores escondidos são `display:none` e não relayam; sobra memória/velocidade de abrir, só relevante
  com muitas abas) **e** risco alto. A tentativa (3 commits) introduziu 4 bugs confirmados por revisão
  adversarial, incl. **perda de dados** (Ctrl+S sobrescrevia edições externas em abas inativas).
  Revertido. Checklist de armadilhas salvo na memória pra uma futura retomada bem-feita.

### ✅ Feito
**Segurança/robustez:** V1 (XSS LaTeX → **KaTeX** trust:false), V2, V3, V5, V6; G2 (error boundary +
crashReporter), P12 (leak de listener), P13 (ResizeObserver throttled).
**Performance (trilha praticamente fechada no seguro):** P4 (Phosphor+fontes locais, fim dos CDNs);
**P2** (sem reparse de markdown por-frame — "espera e revela"); **P3** (classificação verilog cacheada
por mtime); **P5** (init idempotente: initMonaco memoizado, TabManager guard, refresh dedup); **P7**
(`contain:layout` no corpo do terminal); **P8b** (backdrop-filter desperdiçado removido de tooltip/
context-menu); **P10** (recount+filter do terminal throttled, 60→~8×/s); **P11** (decorations por range
visível + find-widget sem query por tecla); **P15** (poll de mtime só com foco); **P16** (health-check
de watchers = 1 timer idle-aware + unref); **P9** (standard tree em DocumentFragment — fim do freeze
ao expandir pasta grande).
**Visual (trilha fechada no seguro):** `<aurora-canvas>` (shader final + filetes + glow do chat),
focus-ray, elevação por luz nos modais; **3 file trees** padronizadas (foco, cores, Phosphor, ícone C±
custom; hierarchy com paridade); **chat de IA** (KaTeX, markdown do usuário, syntax highlight, reveal,
paths clicáveis, links, sem "subscription usage"); **terminal** (barra deslizante, progresso THTEST,
clear); **tabs** (FLIP, scrollbar fina); **settings** (pill); **FontAwesome removido por completo**
(P14) + dedup `.aglyph`; **paletas unificadas** (`brand_tokens.css`; splash/update offline e on-palette);
**z-index tokenizado** (tier de overlay, mesmos valores) + **~40 aliases legados podados** (codemod);
**paleta de syntax tokenizada** (`--syntax-*`); **command palette** (Ctrl+Shift+K); **sistema de modais
unificado** (abertura realocada pro `modal_system.js`); **foco no editor → aba sempre ativa** (incl.
splits); ícone de onda (senoide) no Wave Config.
**IA/robustez:** busca recursiva de arquivo pela IA; compile da IA chega ao terminal (singleton real +
processador persistido + auto-cura da ref); fix do `project:getInfo` (EISDIR ao receber pasta).
**Fundação (A1 — Vite, renderer-only, flag-gated): Stages 0–4 ✅.**
- **Stage 0–2** (main window): `vite.config.mjs` (`base:'./'` p/ `file://`; `vite-plugin-static-copy` vendoriza
  Monaco/KaTeX/Phosphor em `dist/vendor/*` via `rename.stripBase`, sem comitar 70 MB); `scripts/dev.js`
  (`npm run dev`: Vite 5273 + Electron por `AURORA_RENDERER_URL`, HMR); `dist/**` empacotado. Monaco no loader
  AMD (path → `vendor/vs`); `tsc` in-place mantido. Source `index.html` mantém refs `node_modules/` (raw-safe
  na raiz); plugin `transformIndexHtml` reescreve → `vendor/` só no servido/buildado.
- **Stage 3** (flip): `prestart` e `pretest:e2e` rodam `build:renderer` → `npm start` e o e2e testam o renderer
  **bundled** (não o `dist` velho do disco); `ci.yml`/`release.yml` ganham passo `build:renderer` explícito
  (electron-builder é chamado direto, então o `prebuild` não dispara); `release.yml` também roda `build:ts`.
  Raw-ESM segue como fallback. e2e contra o bundle: **7/8** (a 1 falha "PRISM open-at-line" é **pré-existente**
  — falha idêntica no raw, alheia ao bundling).
- **Stage 4** (janelas secundárias): splash/update/prism viram inputs multi-page; `main/render_loader.js`
  (`loadPage`) centraliza dev→dist→raw nos 4 pontos; `prism.js` → `type=module` (bundla; é import-free,
  module-safe); Phosphor do prism reescrito pelo transform.
- **Fixes achados na validação:** (a) recursos buscados em **runtime** por path relativo (`./locales/*.json`,
  `./resources/sapho_rules.json`, `./assets/icons/*`) agora copiados p/ `dist/` (senão o app empacotado
  perdia traduções/ícones — não pegava no `dev`); (b) `cssMinify:false` (o minificador do esbuild fundia
  `@font-face` de woff2 byte-idênticos — paridade com o raw); (c) `knip.config.js` corrigido (pré-existente:
  `ignoreDependencies` listava o `@fortawesome` removido e faltavam `@phosphor`/`katex`).
- **Fix `dev.js` (pós-boot do usuário):** spawnar o Vite **direto** (não `npx.cmd`+shell) — no Windows o
  servidor caía no meio da sessão (connection-refused em worker do Monaco/lang Verilog/PRISM/fontes) e o
  fechamento ficava lento; agora estável + fail-fast (derruba o Electron se o Vite morrer) + teardown limpo.
- **Verde:** 208 unit + e2e (7/8) + ESLint + knip + `vite build` self-contained + dev-server (curl 200 nas 4
  páginas/vendors/recursos). Revisão adversarial multi-agente (packaging/asar, load-logic, config, CI) limpa.
  **Boot/visual do Electron a verificar pelo usuário.** Plano em `~/.claude/plans/ancient-snacking-wand.md`.
- ✅ **Fontes duplicadas → bold/medium REAIS (corrigido nesta sessão):** as woff2 eram variáveis com 1 `@font-face`
  por peso apontando pro mesmo arquivo (4 conteúdos p/ 14 faces, lia como peso único). Agora 1 face por subset com
  `font-weight` em **faixa** sobre 1 arquivo variável + 10 duplicados removidos (~600 KB). Ver "Resto da Fase C" abaixo.

**Camada semântica de tokens (DESIGN §3 — Fase A do Lit shell) ✅.** `css/base/semantic_tokens.css`
(importado após `theme_variables.css`): aliases dos nomes do DESIGN §3 sobre a base — `--surface-*`,
`--text-bright/default/faint`, `--state-*`, `--accent-veil`, `--focus-ray`, `--motion-*` — **puro aliasing,
zero mudança de valor** (tema único intacto). `--text-muted` **não** re-aliasado (já existe na base; evita
clobber de ~40 usos). 11 literais de z-index → escala `--z-*` (stacking preservado por análise de contexto;
o `z-index:-1` "atrás do pai" do pdf-modal fica). É o vocabulário que o código novo/Lit usa; o codemod
base→semantic dos ~600 usos existentes fica para a migração por-componente. 208 unit + lint + knip +
`vite build` verdes; **paridade visual** (aliases). Próximo: **Fase B** (instalar Lit + `<aurora-statusbar>`
+ Design Lab).

**Fundação Lit + Design Lab (Fase B) ✅.** **Lit 3** instalado. Primeiro componente
`js/components/aurora-statusbar.js` (LitElement + **Shadow DOM** + só **tokens semânticos**, que atravessam o
shadow do `:root`; status dot com glow por estado, raio de foco no chip de processador, reduced-motion). É o
**molde** dos demais. **Design Lab** (`html/design-lab.html`, input multi-page Vite + `js/components/design-lab.js`):
galeria que mostra o componente em todos os estados (idle/projeto/compilando/erro), aberta por **"Open Design
Lab"** na command palette (IPC `open-design-lab` → janela nova via `loadPage`). Lit fica **isolado no chunk do
design-lab** — o `index.html` não importa nada de Lit, então o fallback raw do app principal segue intacto (a
migração ao vivo, que retira o raw, é a Fase C). 208 unit + ESLint + knip + `vite build` + dev-server (200)
verdes; aditivo, **zero mudança no app ao vivo**.

**1ª migração ao vivo — `<aurora-toast>` (Fase C) ✅.** O sistema de notificações virou Lit:
`js/components/aurora-toast.js` (Shadow DOM + tokens semânticos; **self-managing** — entrada/saída, progress
bar de auto-dismiss, pause no hover, auto-remoção; glifo Phosphor por tipo via `--toast-glyph`). `notification.js`
agora só cria o `<aurora-toast>` e seta props — **API pública intacta** (`showCardNotification`/`notify`/
`window.showNotification`). **Escolha do alvo:** o status bar (plano original) acabou sendo o **pior** primeiro
alvo (7+ drivers: `project_manager`/`close_project` no #ready, `status_updater`/`compilation_*` no centro,
`monaco_editor`+`zoom.js` no #editorStatus — o zoom insere irmão), então pivotei pro toast (driver único). Isto
**introduz Lit no `index.html`** (via `notification.js`): o Rollup hoista Lit num chunk compartilhado que o index
carrega; o **fallback raw do index agora degrada** (import bare de `lit` não resolve sem bundler) — consequência
documentada da Fase C (raw das janelas secundárias segue OK). **Smoke e2e: 3/3** confirma que o index bundled com
Lit ainda boota. 208 unit + lint + knip + dev-server verdes.

**Resto da Fase C — sessão 14/06/2026 ✅.** Migração progressiva do shell + 2 quick-wins. Todos com `vite build`
+ **smoke e2e (3/3)** verdes (e 208 unit onde aplicável); verificação visual pelo usuário a cada peça (via prints).
- **Componentes Lit ao vivo** (LitElement + Shadow DOM + tokens semânticos, todos na Design Lab):
  - `<aurora-tooltip>` — `tooltip.js` (descoberta/timing/posição) dirige por `content`/`placement`/`--arrow-x`;
    espera `updateComplete` antes de medir; sempre-no-topo.
  - `<aurora-command-palette>` — `command_palette.js` mantém registry + scoring + teclado global e dirige por
    `.items`/`.selected`/`.open`; Phosphor no shadow via `<link>`. **+3 fixes:** parede-invisível ao fechar
    (`pointer-events:none` no `:host` fechado), removida a barra azul do topo, painel = chrome dos modais.
  - `<aurora-welcome>` — o welcome inteiro; `#editor-overlay` fica **light-DOM** (TabManager + seletor irmão
    intactos); `recent_projects.js` virou **dados+ações** e dirige o componente; botões New/Open **delegam** à
    toolbar; i18n via `window.t` + `aurora:locale-changed`.
  - `<aurora-modal>` + **os 4 modais inline** (new project · processor hub · wave config · settings) — **drop-in**
    que reage a `aria-hidden`/`.show`/`.visible` via CSS (os 3 mecanismos existentes), então **nenhum controller
    foi religado**; título/corpo/footer (+ o ✕ próprio, que faz limpeza) slotados em light-DOM; largura custom via
    `--aurora-modal-width` (settings = 880px); auto-gere backdrop+✕ via `aurora-modal-close`.
- **Aurora-borealis refeita (paisagem artística)** — o `<aurora-canvas>` virou cortinas **contínuas** ancoradas no
  rodapé: paleta verde→teal→cyan→violeta→magenta→**rosa nas pontas**, montanhas de **alturas variadas** (cordilheira
  de ruído), movimento orgânico (morph do nimitz, sem pan linear), **resolução-independente** (coords normalizadas
  pela largura + ResizeObserver → **resize do terminal não espreme mais**) + fix do canvas dentro do Shadow DOM.
  Iterado a olho com o usuário (brilho/densidade/altura/velocidade) até o ponto.
- **3 fixes no caminho** (regra: bug encontrado é corrigido na hora): **worker do Monaco sob `file://`** (path
  absoluto via `document.baseURI` — consertou "abrir arquivo" no app buildado); **resizers de canto** (ResizeObserver
  → aparecem no 1º hover, sem precisar resize antes); **navegação X1/X2 do mouse no PRISM** (histórico de cliques).
- **Quick-wins:** **CSS morto podado** (~685 linhas — `command_palette.css` + `tooltip.css` removidos inteiros,
  `recent_projects.css` reduzido a `.empty-state`); **fontes bold/medium REAIS** — Inter/JetBrains são variáveis;
  era 1 `@font-face` por peso todos no mesmo woff2 variável (lia como peso único + 10 duplicatas); agora 1
  `@font-face` por subset com `font-weight` em **FAIXA** sobre 1 arquivo variável → o navegador interpola 400..700;
  10 duplicados removidos (~600 KB); `fetch-fonts.js` corrigido.
- **Decisão de escopo — titlebar/activity-bar/tabs/tree/terminal ADIADOS:** **maus alvos** p/ Shadow DOM. O sistema
  de **tooltip** e o **i18n** varrem o document por `querySelectorAll` + listeners por elemento → não alcançam o
  shadow; e os botões/tabs são referenciados por **ID/querySelector** + manipulados **imperativamente** pelos managers
  (compile-flow, command-palette, `tab_manager`, etc.) → migrar quebra tudo isso por payoff **~zero** (essas barras
  não têm os 30 `!important`). As peças que migraram limpo eram **overlays + welcome + modais** (dono único OU
  drop-in por sinal de classe). Restam com ganho **distinto**: `<aurora-editor>` (mata os 30 `!important`; mas
  Monaco-em-Shadow-DOM é arriscado) e `<aurora-panel>` dockável (capacidade nova).

**Sessão 14/06/2026 (parte 2 — IA, segurança, correções) ✅.** Tudo com `node --check` + ESLint + **smoke e2e
(3/3)** verde; revisões adversariais por workflow onde o código é sensível; verificação ao vivo pelo usuário.
- **Anexos no chat da IA (imagens + arquivos) + lightbox** — clipe/drag-drop/paste no composer, chips de preview,
  envio aos 3 transportes (SDK multimodal · Claude Code via temp+Read · Codex inline/degrada imagem); clique-pra-
  ampliar nas imagens; leak de temp corrigido (limpa no start, não no quit). Imagens **session-scoped** por decisão
  (não persiste base64 → zero inchaço). Detalhes na régua §13.K.
- **Segurança: CSP + sandbox** — CSP auditada **por-diretiva** (workflow de 9 agentes) via `onHeadersReceived`
  (cobre `file://` empacotado + dev); `sandbox:true` nas **5 janelas**. §13.G. *(Verificação ao vivo do usuário
  pendente: Monaco worker · KaTeX · imagem `data:` colada · fontes.)*
- **Fechar a IDE lento — CORRIGIDO** — as varreduras `taskkill`/PowerShell-WMI (`Get-CimInstance`) rodavam em
  TODO fechamento; agora só se algum toolchain rodou na sessão (`toolchainEverRan`), `stopAllToolchain` memoizado,
  `before-quit` duplicado removido. Sessão só-edição fecha na hora. §13.E.
- **Pan do viewer de imagem — CORRIGIDO** — pan virou `transform: translate` (não scroll), com clamp →
  alcança as 4 bordas no zoom; sem borrão (transição só nos botões). §13.E.
- **Freeze/loop/lentidão da IA — DIAGNOSTICADO (workflow) + CORRIGIDO (A–E)** — não era loop real (chain capada
  em 5, tool-loop em 24); era **FREEZE** por falta de evento terminal do backend. Fix: timeout de inatividade
  **tool-aware** (Set de ids) no SDK + 2 CLIs, `Promise.race` no usage, watchdog com **teto-duro de 12 min**,
  guard no `send()`, cap em tool-results. Revisado adversarialmente (2 HIGH corrigidos). §13.K.
- **Prompt + rules → YANC v5.2** — SYSTEM_PROMPT refrescado (v5.0→**v5.2**, ISA **112→116 opcodes** + F_SCL/
  SF_SCL/XPO/XPO_M, stdlib completa: cosh/sinh/tanh/floor/ceil/round/conj) + dedup (RESERVED standalone);
  `resources/sapho_rules.json` **regenerado** (sync script; `STDLIB_FUNCTIONS` corrigido — 7 funções estavam
  misclassificadas). Identidade já estava correta. Condensação de tokens avaliada e **deferida** (system já
  cacheado: Anthropic ephemeral + auto-cache dos providers + `--resume` dos CLIs). §13.K.

**Sessão 14/06/2026 (parte 3 — UX, limpeza, segurança, bugs) ✅.** Tudo com ESLint + `vite build` + smoke e2e
(3/3); investigações/dead-code com **refutação adversarial** por workflow; verificação ao vivo pelo usuário.
- **3 quick-wins de UX (§13.K):** syntax highlight do `.spf` (→ linguagem `json` built-in); **hover** num projeto
  recente no welcome → **preview dos processadores** (popover no `document.body`, viewport-relative, escapa o
  containing-block do `:host`); **fila de follow-up** no chat (estilo VSCode — enviar enquanto a IA responde
  enfileira + drena na ordem, priorizando a msg do usuário).
- **A5** (4 bugs do mapeamento: find-state `dataset.file`→`dataset.path`, snapshot do PDF lendo `activeTab`
  sobrescrito, código morto `saveEditorState`/`restoreEditorState` com `ReferenceError`). **A6** confirmado
  já-feito (`exec-command` removido). **A7** — `preload_prism.js` endurecido (removidos `send`/`removeAllListeners`
  genéricos; allowlist enumerada). **A8** — 152 linhas de código morto (hierarquia pré-PRISM) removidas,
  confirmadas por **refutação adversarial**; `cleanModuleName` vivo do `prism.js` preservado.
- **GC universal de temps** (`main/temp_gc.js`, best-effort no startup) — limpa os `aurora-mcp-<pid>.json` órfãos
  (vazavam — nunca eram limpos) + consolida a limpeza dos anexos.
- **Bug Ctrl+W** — fechava **TODAS** as abas + `TypeError` (`reading 'layout'` null). Causa: auto-repeat não
  ignorado (segurar a tecla fechava uma por repetição) + rAF de `layout()` num editor já disposto. Fix:
  `e.repeat` guard + null-guard no rAF. (Ctrl+Shift+T reabre uma a uma — já estava wirado e agora se comporta.)
- **Auditoria do `DESIGN.md` (workflow):** maioria implementada (tokens semânticos §3, focus-ray §5, motion §6,
  shader §7, fontes locais §8, Phosphor, 6 componentes Lit, Design Lab, command palette, modais). **Gaps:**
  tokens `--spectrum-*` (§2) → **descoped** (mantemos `--aurora-*`, travados p/ splash/update); redução de
  box-shadow → glow (§4) e display font (§8) = refinamentos abertos; os componentes de shell restantes
  (titlebar/activity-bar/tabs/tree/terminal) seguem **adiados** (maus alvos de Shadow DOM — ver §13.A).

**Sessão 15/06/2026 (Opus — do mais rápido ao mais lento) ✅.** Continuação do backlog §13 na ordem
fastest→slowest. Tudo com **243 unit** + ESLint (lint-staged) + `commit`+`pull` por item (sem push);
**verificação adversarial multi-agente** do estado real (git + arquivos) antes de marcar feito aqui — os
11 itens abaixo voltaram "committed, zero discrepâncias".
- **Overlay de jank (§4.4/G7) ✅** — `js/dev/jank_overlay.js`: HUD dev (FPS · **p99** de frame vs orçamento
  165 Hz de 6,06 ms · taxa de jank = % de frames > 2× orçamento · longtask via `PerformanceObserver` · TTI
  aproximado). Buffer circular de 300 frames; **custo zero quando inativo**. Import dinâmico na command
  palette (grupo novo **"Dev"** → "Toggle Jank Overlay"). Commit `d4f7735`.
- **Stage 5 / B5 ✅** — os 14 testes que importavam os `.js` gerados passam a importar o `.ts` direto
  (vitest resolve TS nativo via esbuild); os **29** `.js` de saída do `tsc` saíram do tracking (`git rm
  --cached`) e entraram no `.gitignore` (seção "TypeScript compiler output"). Só o `.ts` é fonte daqui pra
  frente; 243 unit verdes com os imports novos. Commit `29ebbab`. *(Ainda falta B4 — `tsc --noEmit` no CI
  pra pegar drift; §13.I.)*
- **3 shells semânticos em Lit (passo 1 — wrapper fino) ✅** — `<aurora-tabs>` (`fb0e943`),
  `<aurora-terminal>` (`67306c8`), `<aurora-tree>` (`31287b7`): cada um é um LitElement cujo `render()`
  devolve só um `<slot>` passthrough — **registra o custom element** e nada mais. Os filhos (`.tab`,
  `.terminal-content`/`.log-entry`, `.file-tree-item`) seguem em **light DOM**, gerenciados imperativamente
  pelos managers (`tab_manager`/`terminal_module`/`file_tree_manager`) **sem nenhuma mudança de lógica**; os
  estilos vêm do CSS global pela classe no host. Reabre essas barras "ADIADAS" como **enhancement
  progressivo**: o passo 2 (render declarativo + tokens no `::slotted` + virtual scroll) fica pra quando o
  manager virar data-driven. `index.html`: `<div id=…>` → `<aurora-… id=…>` nos 3 pontos.
- **Higiene de memória do chat IA (base64) ✅** — `ai_assistant_manager.js` solta o `dataUrl` base64 das
  attachments de `this.messages` logo após `apiMessages` ser montado pro turn → imagens de até 8 MB **não**
  são reenviadas a cada turno seguinte (mantém nome/mime/tam pra exibição). Commit `64b3ae7`. *(Era item de
  §13.D escrito na sessão anterior mas que tinha ficado **sem commit** — capturado e commitado agora; daí o
  valor da verificação adversarial antes de documentar.)*
- **Empty-states / `<aurora-statusbar>` ao vivo — não mexidos (motivo registrado):** o "4 skins → 1" segue
  🟡 subjetivo (precisa de prints do usuário); religar a statusbar segue **bloqueado** porque `zoom.js` faz
  `editorStatus.parentNode.insertBefore` — quebraria se `#editorStatus` virasse Shadow DOM. Ambos seguem em §13.A.

**Sessão 16/07/2026 (preview de HTML branco · card de permissão) ✅.** Verificado com **540 unit** + ESLint +
`tsc --noEmit`, e com bancadas Electron descartáveis: uma carregou o **arquivo real** do usuário
(`pmu_plots.html`, export do Plotly) pelo módulo real e inspecionou o frame por dentro; a outra renderizou o
card de permissão com o CSS real, antes vs depois.
- **Preview de `.html` abria branco e sem interação — CORRIGIDO.** O mesmo arquivo renderizava normal no VS Code
  (extensão Live Preview), o que localizou a causa na Aurora, não no arquivo. **Causa raiz:** o iframe do preview
  carregava um **blob URL**, e `blob:` é um *local scheme* — pela CSP3 o documento **herda a política da página que
  o criou** em vez de receber a sua. Ou seja, a CSP do app (`script-src 'self' 'unsafe-inline' 'unsafe-eval'
  blob:`, apertada de propósito, §13.G) valia **dentro** do preview e barrava o `<script>` de CDN. Todo export de
  Plotly/Bokeh/pandas busca a biblioteca num CDN (`https://cdn.plot.ly/plotly-3.7.0.min.js`) → a lib nunca chegava,
  o bootstrap inline que chama `Plotly.newPlot` estourava, e o painel ficava branco. Medido na bancada:
  `typeof Plotly === "undefined"`, com a violação de CSP no console. O VS Code serve por `http://127.0.0.1:3000` —
  origem real, sem CSP nossa — e por isso funcionava.
- **Fix: protocolo `aurora-preview://`** (`main/ipc/preview.js`, novo). Um scheme **de verdade** passa pela pilha de
  rede, então carrega a CSP que **nós** mandamos no header e **não herda nada**. Três ganhos de uma vez: (1) o
  preview roda sob uma política própria (`PREVIEW_CSP` — https/inline/eval liberados, como uma aba de navegador),
  **sem afrouxar um único diretivo da CSP do app**; (2) **caminhos relativos resolvem** — a URL espelha o
  filesystem, então `./style.css` do documento é um irmão de verdade (sob `blob:` tudo relativo dava 404); (3) o
  preview fica **cross-origin** ao app — o blob herdava a origem do renderer, e com `allow-same-origin` a markup
  visualizada alcançava o DOM real; agora a origem é `aurora-preview://<id>` (medido: `parent.document` e
  `parent.electronAPI` → `blocked`).
- **Escopo por diretório.** Cada preview registra a fonte e recebe um **host aleatório de uso único** mapeado para o
  **diretório** do arquivo; o handler serve essa subárvore e nada mais (liberado no fim do tab). `path.resolve` +
  `startsWith` barram travessia — o `..` cru já morre na normalização de URL, mas o **`%2e%2e` codificado** sobrevive
  a ela e só morre nessa guarda (medido: irmão `200` · `..` `404` · `%2e%2e` **`403`** · host não registrado
  inalcançável). O buffer **não salvo** continua sendo o que aparece (snapshot vai junto no registro), igual ao MD.
- **Duas armadilhas achadas pela bancada, não pelo raciocínio:** `onHeadersReceived` **dispara para schemes
  customizados** (carimbaria a CSP do app de volta no preview, ressuscitando o bug) → exceção explícita por URL; e
  `frame-ancestors` **não** cai pra `default-src` e seria checado contra a origem *do preview* (`'self'` =
  `aurora-preview://<id>` recusaria o frame do app) → fica **ausente** de propósito, com o `frame-src` do app
  controlando o que pode ser embutido.
- **Resultado medido no arquivo do usuário:** `typeof Plotly === "object"`, **11 traces**, 3 `main-svg`, `draglayer`
  presente (zoom/pan ativos), e os *ticks* dos 4 eixos (−1..1 · 0..0.8 · −200..200 · 60..64) batendo com o print do
  VS Code.
- **Card de permissão: a prosa da IA saía como código — CORRIGIDO.** `previewArgs` fazia `JSON.stringify` de
  **todos** os args num `<pre>` só, então o `note` — que é texto escrito *pro humano ler* (`set_command_override`:
  "lands in the audit log"; `run_in_background`: "echoed back to you") — ficava preso no bloco de código: entre
  aspas, com as barras escapadas (`C:\\Users\\…`) e quebrado no meio da palavra. `splitArgs()` (novo, em
  `tool_permission.js`) separa os campos de prosa (`note`, `question` do `ask_user_question`) do resto estrutural;
  o card renderiza a prosa como texto (fonte proporcional, barra de destaque à esquerda pra distinguir da
  `.ai-confirm-desc`, que é a descrição estática da tool) e o `<pre>` fica só com `step`/`appendArgs`/`persist`.
  Tudo por `textContent` — é saída de modelo, nunca vira markup. Prosa capada em 1000 (o JSON segue em 500);
  `note` não-string ou em branco cai como dado, não como prosa. **+7 testes** (17 no arquivo).

**Sessão 16/07/2026 (parte 2 — memória de projeto pra IA) ✅.** **563 unit** + ESLint + `tsc --noEmit`.
- **A IA não conseguia gravar memória — CORRIGIDO com tool própria.** O `Write` está em `DISALLOWED_TOOLS`
  (`main/ai/claude_agent.js`), então a memória nativa do Claude Code (que grava por arquivo) morria com
  "Write failed". **Isso não era bug:** toda escrita passa pelas tools MCP da Aurora de propósito, pra bater no
  card de permissão + audit log; o `Write` nativo furaria os dois. Então o conserto **não** foi liberar o `Write`
  (devolveria escrita irrestrita sem card) — foi dar memória de primeira classe à Aurora: `remember` / `forget` /
  `list_memories`. **Razão decisiva:** são **3 transportes** (Agent SDK · Claude Code CLI · Codex); consertar a
  memória nativa resolveria **um**, a tool resolve os três e já entra no card/audit como o resto.
- **Mora em `<root>/.aurora/memory/<name>.md`**, um fato por arquivo (decisão do usuário). In-project, não
  userData: sobrevive a mover a pasta, e o usuário pode ler/versionar/gitignorar. Chavear por path absoluto já
  mordeu este repo — o `testbench/pmu_cocotb.json` do PMU ainda aponta pro Desktop de onde o projeto saiu.
- **Recall junto do contexto de projeto** (`chat_turn.js`): o bloco só aparece **quando há memória** — ele é
  reconstruído todo turno, então um "memories: none" seria desperdício no caminho comum; e fica **depois** do
  `SYSTEM_PROMPT` estático, que é o que mantém o prefixo cacheável intacto. Orçamento de 6 KB e, ao estourar,
  **diz quantas ficaram de fora** (truncar calado se leria como "são todas"). Diz ao modelo que, se a memória
  contradiz o código, **o código vence**.
- **`memorySlug` é fronteira de segurança, não cosmética** — o `name` vem do modelo e vira path. É **allowlist**
  (`[a-z0-9-]`), então `../`, path absoluto, letra de drive, ADS do NTFS, dotfile e null byte morrem **por
  construção**, não por blocklist que alguém tem que manter completa. Extraído pra `js/ai/memory.js` (módulo
  puro) porque `tests/unit` é suíte de módulos puros e o `aurora_api.js` toca `document` — mesmo movimento do
  `tool_permission.js`. **+10 testes** só de traversal/rejeição.
- **Bug pego pelo contrato, antes de rodar:** as tools tinham nascido `argStyle:'object'`, mas
  `tool_runner.buildCallArgs` manda `fn(args)` nesse modo — e `remember(name, content)` é posicional, então
  receberia o objeto inteiro como `name` e **falharia em toda chamada**. Viraram `'positional'` + `argNames`.
  Daí nasceu `tests/unit/tool_manifest.test.js`: **teste de contrato do manifesto inteiro** (positional declara
  argNames · todo argName existe no schema · todo required é passado · nomes únicos · api/access válidos) —
  pega essa classe de erro pra **qualquer tool futura**, que hoje só é ligada à API por convenção, não por tipo.
  Rodou limpo no manifesto existente. **+8 testes.**
- **Lacuna vizinha fechada:** o `_meta.schema()` promete descrever "every function", mas `getMissingFiles` e
  `dismissMissingFiles` nunca entraram no catálogo `NAMESPACES`. Entraram agora, junto das 3 de memória.

### ⬜ Falta
**Fundação (Vite — Stage 5 ✅ nesta sessão):**
- [x] **Stage 5 (B5):** testes importam `.ts` direto; os 29 `.js` gerados saíram do git + foram gitignorados
      (commit `29ebbab`). Falta só **B4** (`tsc --noEmit` no CI) pra travar o drift — item separado em §13.I.

**Visual (Lit shell — em andamento):**
- [x] **Camada semântica de tokens (DESIGN §3)** — feita (Fase A, ver acima). Resta só a **adoção
      por-componente** (codemod base→semantic, junto da migração Lit).
- [x] **Fundação Lit + Design Lab (Fase B)** — feita (ver acima): Lit 3, `<aurora-statusbar>` (molde),
      Design Lab + launcher. Aditivo, app ao vivo intacto.
- [x] **1ª migração ao vivo — `<aurora-toast>` (Fase C)** — feita (ver acima): driver único, API intacta.
- [~] 🔴 **Shell em Lit (Fase C+).** FEITO: overlays (toast · tooltip · command-palette), welcome + redesenho da
      aurora, e os **4 modais** (ver "Resto da Fase C" acima). **PASSO 1 (15/06):** `<aurora-tabs>`,
      `<aurora-terminal>` e `<aurora-tree>` ganharam o **shell semântico** (custom element wrapper fino, `<slot>`
      passthrough; filhos seguem em light DOM, managers intactos) — tira essas 3 do "adiado" e as deixa prontas
      pro **passo 2** (render declarativo) quando o manager virar data-driven. **Ainda ADIADO/imperativo:** titlebar,
      activity-bar, statusbar (esta bloqueada pelo `insertBefore` do `zoom.js`). **Restam com ganho distinto:**
      `<aurora-editor>` (dropa os 30 `!important`; Monaco-em-shadow arriscado) e `<aurora-panel>` dockável (capacidade
      nova). Item-a-item na régua **§13.A**.
- [ ] **Consolidar `ai_assistant.css`** (2.150 linhas; a paleta de syntax já saiu pros tokens, o resto
      do arquivo permanece). Baixa prioridade.
- [ ] ~~Tema light / aurora-contrast~~ — **descartado** (tema único).

**Performance (sobrou o arriscado/de baixo ROI):**
- [ ] **P6** (transition:width→transform no toggle de sidebar/IA) — fora de hot-path, baixo ROI. **Único P restante.**
- [x] **P17** (`inert` nos modais + painel IA quando fechados — casa com a11y G5) — `aurora-modal.js`
      (MutationObserver → `_syncInert`) + `ai_assistant_manager.js`. Commit `bd5271e`.
- [x] **P7 completo** (`content-visibility:auto` + `contain-intrinsic-size` em `.log-entry` e `.file-tree-item`;
      `contain:layout style paint` no `.terminal-body`). Commit `bd5271e`.
- [ ] 🔴 ~~**P1** (um Monaco por pane)~~ — **revertido** (ver decisão acima); retomar só sob pressão real
      de memória com dezenas de abas, usando o checklist da memória.
- [~] Medição (§4.4/G7): **overlay de jank (p99) ✅** (`d4f7735`); falta o mark de **TTI** no fim do init e o
      **smoke de orçamento no CI** (pareia com B4).

**Fora das 2 trilhas (parking lot):** segurança restante (V4/V7/V8/V9/V10–V12 — **CSP + sandbox FEITOS** nesta
sessão, ver acima); OSS (Surfer/Verible/ripgrep/…); build/DX (B1–B13); repo (§9, 18 itens).

---

## 13. TODO oficial — backlog completo do que falta (a régua)

> **[14/07/2026] DESATUALIZADO — o quadro vivo reconciliado vence este §13: ver §17**
> *(era `docs/BACKLOG_RECONCILIADO.md`, mesclado aqui; o arquivo separado foi removido).*

> **Esta é a lista que seguimos.** Consolida tudo que ainda falta de todas as seções (§3 segurança, §4
> performance, §5 arquitetura, §6/§9 visual+Lit, §7 OSS, §8 build/DX) e os achados pré-existentes.
> **Regra de ouro: qualquer bug encontrado no caminho é corrigido NA HORA** (não vira item de backlog).
> Convenção de trabalho: ao concluir cada item → commit + pull (sem push) + marcar `[x]` aqui.
> Tiers: 🔴 radical · 🟡 moderado · 🟢 leve. Sequência: o bloco **A (Lit shell)** é o trabalho ativo;
> o resto (D em diante) é parking lot, atacado por decisão de prioridade.

### A. 🔴 Lit shell — migração progressiva da casca (TRABALHO ATIVO)
Cada peça: LitElement + Shadow DOM + **só tokens semânticos** + codemod base→semantic daquela peça +
entrada na Design Lab + checklist visual (anima só transform/opacity, respeita reduced-motion, raio de foco).
- [x] `<aurora-toast>` — notificações (1ª migração ao vivo).
- [x] `<aurora-tooltip>` — feito: `tooltip.js` (descoberta/timing/posição) dirige o `<aurora-tooltip>` por
      `.content` + atributo `placement` + `--arrow-x`; espera `updateComplete` antes de medir; sempre-no-topo
      (`--z-tooltip-top`); na Design Lab. (CSS morto `.custom-tooltip` em `tooltip.css` a podar depois.)
- [x] `<aurora-command-palette>` — feito: `command_palette.js` mantém registry + scoring + teclado global
      e dirige o `<aurora-command-palette>` (Shadow DOM + tokens; Phosphor no shadow via `<link>`); na
      Design Lab (botão abre o overlay). CSS morto `.cmdk-*` em `command_palette.css` a podar depois.
- [x] **Welcome** — migrado p/ `<aurora-welcome>` (Shadow DOM + tokens semânticos; i18n via `window.t`
      + `aurora:locale-changed`). `#editor-overlay` fica **light-DOM** (TabManager + seletor irmão intactos);
      `recent_projects.js` virou **dados+ações** e dirige o componente (`projects` ↔ `project-open`/`project-remove`);
      botões New/Open **delegam** à toolbar. CSS morto em `recent_projects.css` (chrome do welcome) a podar depois.
- [ ] **Empty-states "4 skins → 1"** — falta unificar os OUTROS estados vazios (tree/AI/wave) num só.
      Subjetivo (redesenho) → fazer com prints do usuário. 🟡
- [~] `<aurora-titlebar>` — **ADIADO (mau alvo p/ Shadow DOM).** O sistema de tooltip e o i18n usam
      `document.querySelectorAll` + listeners por elemento ([tooltip.js:116/211]) → não entram no shadow;
      e os botões são referenciados por ID pelo compile-flow/command-palette/modal_system/delegação do welcome.
      Migrar quebra tudo isso por payoff ~zero (não tem os 30 `!important`). Retomar só com reescrita transversal
      (ensinar tooltip+i18n a varrer shadow roots) — fora do caminho ativo. 🟡
- [~] `<aurora-activity-bar>` — **ADIADO (mesmo motivo, pior):** os botões de compilação são habilitados/
      desabilitados e clicados por ID pelo fluxo de compilação. Idem titlebar. 🟡
- [~] `<aurora-tree>` (file-tree) — **PASSO 1 ✅** (`31287b7`): `js/components/aurora-tree.js` (wrapper fino,
      `<slot>`) registra o custom element; `#file-tree` virou `<aurora-tree>`; `file_tree_manager.js` importa.
      Filhos em light DOM, lógica intacta. **Passo 2 (pendente):** render declarativo das **3 subárvores +
      reconciliação key-based** + `zoom`/views. 🔴
- [~] `<aurora-tabs>` — **PASSO 1 ✅** (`fb0e943`): `js/components/aurora-tabs.js` (wrapper fino); `#tabs-container`
      virou `<aurora-tabs>`; `tab_manager.js` importa. **Passo 2 (pendente):** render declarativo data-driven
      (mover `.tab` create/drag/preview do `tab_manager` pro componente). 🟡
- [ ] `<aurora-editor>` — host do Monaco; **dropa os 30 `!important`** via Shadow DOM. 🔴 maior ganho.
- [~] `<aurora-terminal>` — **PASSO 1 ✅** (`67306c8`): `js/components/aurora-terminal.js` (wrapper fino);
      `#terminal-container` virou `<aurora-terminal>`; `terminal_module.js` importa. **Passo 2 (pendente):**
      `.terminal-body` data-driven com virtual scroll (otimizado no lugar; não xterm). 🟡
- [x] `<aurora-modal>` + os 4 modais inline (new project, processor hub, wave config, settings) — **FEITO.**
      Base `<aurora-modal>` (chrome em Shadow DOM + tokens; título/corpo/footer + ✕-próprio SLOTADOS em
      light-DOM → forms/IDs/handlers/i18n preservados). É **drop-in**: reage a `aria-hidden`/`.show`/`.visible`
      via CSS (os 3 mecanismos que `modal_system`/processor-hub/wave/settings já usam) → **nenhum controller
      religado**; só o `aurora-modal-close` no `modal_system` (backdrop+✕ vivem no shadow). `noclose` mantém o
      ✕-próprio (que faz limpeza); largura custom via `--aurora-modal-width` (settings = 880px). Na Design Lab.
- [ ] `<aurora-statusbar>` **ao vivo** — religar os 7+ drivers (deixado pro fim por ser o mais acoplado).
      O componente `js/components/aurora-statusbar.js` **já existe** (LitElement completo, na Design Lab) — falta
      só ligar os dados. **Bloqueio concreto (achado 15/06):** `js/utils/zoom.js` faz
      `editorStatus.parentNode.insertBefore(zoomWrapper, editorStatus.nextSibling)` — injeta o controle de zoom
      como **irmão** do `#editorStatus`; se a statusbar virar Shadow DOM, esse `insertBefore` (e os drivers que
      fazem `getElementById('status-text'/'editorStatus'/...)` em `project_manager`/`close_project`/`status_updater`/
      `monaco_editor`) não alcançam o shadow. Religar exige reescrever esses 7+ pontos pra dirigir o componente por
      props/eventos primeiro. 🔴
- [ ] `<aurora-panel>` **dockável** + layout dockável estilo Fleet/Zed + densidade/hierarquia revisadas. 🔴

### B. 🟡 Tokens — terminar a estratificação
- [ ] Codemod base→semantic dos ~600 usos existentes (feito por-componente junto de A).
- [x] Resolver o gap do nível "secondary" (#9CA1AE) — **resolvido por decisão documentada** (`bd5271e`):
      `semantic_tokens.css` registra a escala de 4 paradas (faint → muted → secondary → default/bright) e
      explicita que `--text-secondary`/`--text-muted` **não** são re-aliasados (já são tokens-base canônicos;
      re-aliasar clobraria os ~40 usos). Sem nome semântico novo de propósito.
- [ ] Consolidar `ai_assistant.css` (2.150 linhas) nos tokens. 🟢 baixa prioridade.

### C. Fundação Vite + dívidas pequenas
- [x] **Stage 5 / B5 — FEITO** (`29ebbab`): testes importam `.ts` direto (vitest resolve TS nativo), 29 `.js`
      gerados saíram do `git` (`rm --cached`) + gitignorados. Só falta **B4** (`tsc --noEmit` no CI; §13.I). 🟡
- [x] Limpar o CSS morto de `.notification-card` em `notification.css` — **FEITO** (`bd5271e`): 193 linhas do
      sistema antigo de toast removidas; `.confirm-modal` (vivo) preservado; header reescrito p/ apontar o
      `<aurora-toast>`. 🟢
- [x] **Podar o CSS morto das migrações Lit — FEITO.** `command_palette.css` (`.cmdk-*`) e `tooltip.css`
      (`.custom-tooltip`/`.tooltip-*`) removidos (arquivos inteiros + `@import`); `recent_projects.css` gutado
      ao essencial (só `.empty-state`); e o card morto do toast em `notification.css` agora também podado
      (`bd5271e` — ver acima). `modal_config.css` **NÃO** é podável: `.modal-content`/`.modal-container` ainda
      em uso por diálogos não migrados. 🟢
- [x] Silenciar (cosmético) o warning do Vite "can't be bundled without type=module" — **FEITO** (`bd5271e`):
      `customLogger` (`createLogger`) em `vite.config.mjs` filtra a mensagem dos 2 scripts não-módulo vendados
      (Monaco `loader.js` AMD + KaTeX UMD). Benigno (resolvidos em runtime via `vendor/`), só limpa o output. 🟢
- [ ] Decidir o fallback raw do `index.html` (degradado pós-Lit) — remover ou aceitar. 🟢

### D. 🟡 Performance (sobrou o arriscado / baixo-ROI)
- [ ] **P6** — `transition:width`→`transform` no toggle de sidebar/IA. **Único P aberto.**
- [x] **P17 — FEITO** (`bd5271e`): atributo `inert` nos modais (`aurora-modal.js` via MutationObserver →
      `_syncInert`) + no painel IA quando fechado (`ai_assistant_manager.js`). Tab + leitor de tela não
      alcançam conteúdo escondido. (Modais sob demanda = parte do P17 ainda aberta, baixa prioridade.)
- [x] **P7 completo — FEITO** (`bd5271e`): `content-visibility:auto` + `contain-intrinsic-size` em `.log-entry`
      (terminal, `auto 36px`) e `.file-tree-item` (tree, `auto 22px`); `.terminal-body` subiu p/ `contain:layout
      style paint`. Off-screen não pinta; altura lembrada → scrollbar estável.
- [~] **Medição** (§4.4/G7) — **overlay de jank (p99) ✅** (`d4f7735`, `js/dev/jank_overlay.js`, command palette
      grupo "Dev"). **Falta:** mark `performance.mark('aurora-interactive')` no fim do init (baseline de TTI sai do
      fallback) + **smoke de orçamento no CI** (pareia com B4).
- [~] **Higiene de memória — limitar o que fica RETIDO nas superfícies-chave** (NÃO um "GC manual": o V8 já
      coleta; chamar `global.gc()` só ajuda se houver referência presa — e o alvo real é justamente soltar
      essas referências). **FEITO** (`64b3ae7`): o base64 das imagens anexadas é **solto de `this.messages` após
      enviar** (mantém nome/mime/tam) → imagens de até 8 MB não reenviadas a cada turno. **FALTA auditar/bound:**
      `this.messages` cresce sem limite (só o base64 sai), buffer de saída do terminal, decorations/markers do
      Monaco, nós DOM destacados, listeners (já houve P12/P13/P16). Limpeza por **gatilho** (trocar de chat/
      projeto, fechar painel) costuma ser melhor que timer periódico. Medir com heap snapshots antes/depois. 🟡
- [x] ~~P9 (standard tree sem virtualização)~~ — **já feito** (DocumentFragment; fim do freeze ao expandir
      pasta grande — ver §12 ✅ Feito). Listado aqui só pra fechar a dúvida.
- [ ] ~~P1 (um Monaco por pane)~~ — **adiado/revertido** (causou perda de dados nos commits da tentativa);
      retomar só sob pressão real de memória, com o checklist da memória. Por decisão, fora do backlog ativo.

### E. Bugs pré-existentes a corrigir
- [x] **Ctrl+W fechava TODAS as abas + `TypeError` (`reading 'layout'` null) — CORRIGIDO.** Duas causas
      acopladas: o dispatcher de atalhos não ignorava **auto-repeat** (segurar Ctrl+W fechava aba a aba até
      zerar), e o `setActiveEditor` agendava um `rAF(() => activeEditor.layout())` que disparava depois do
      `closeEditor` ter zerado `activeEditor` (close rápido). Fix: `if (e.repeat) return` no `shortcut_manager` +
      null-guard no rAF do `monaco_editor`. Ctrl+Shift+T (reabrir uma a uma) já estava wirado e agora se comporta.
- [x] **Fontes duplicadas → bold/medium reais** — FEITO. Inter/JetBrains são **variáveis**: o build antigo
      emitia 1 `@font-face` por peso (400/500/600/700) todos apontando pro MESMO woff2 variável (14 faces,
      4 conteúdos; lia como peso único + 10 duplicatas byte-idênticas). Agora **1 `@font-face` por subset com
      `font-weight` em FAIXA** (`400 700` / `400 600`) sobre 1 arquivo variável por subset → o navegador
      interpola 400..700 reais. 10 woff2 duplicados removidos (~600 KB); `fetch-fonts.js` corrigido (pede a
      faixa `wght@400..700`). **Validar bold/medium ao vivo.**
- [ ] **e2e flaky** `split-pane > PRISM open-at-line` — timing do ambiente (corrida de 600ms).
- [x] **Viewer de imagem — pan quebrado no zoom — CORRIGIDO.** Causa: o zoom usava `transform: scale()` mas o
      pan era via `scrollLeft/scrollTop` — e `scale()` **não** cria overflow rolável, então o scroll só alcançava
      o tamanho *natural* da imagem (mais o flex-centering do container, que esconde o overflow do topo/esquerda).
      Bônus: a `transition: transform` na img borrava o arrasto. **Fix** (`js/tabs/tab_viewers.js` +
      `css/modals/pdf_image.css`): panear pela própria transform (`translate(panX,panY) scale(zoom)`), com clamp
      ±(tamanho-ampliado − viewport)/2 (toda borda alcançável, sem jogar a imagem pro vazio); `overflow: hidden`;
      transição inline só nos botões de zoom (drag/wheel imediatos). *(Verificação visual pelo usuário: abrir
      imagem → zoom → arrastar até os 4 cantos.)* ✅
- [x] **Fechar a IDE estava LENTO — CORRIGIDO.** Causa raiz (regressão da mudança "fechar todas as janelas
      quando a principal fecha"): o `mainWindow.on('close')` passou a chamar `stopAllToolchain()` em **todo**
      fechamento, e a rotina rodava **incondicionalmente** — mesmo numa sessão que só editou arquivos — duas
      `taskkill /F /IM` (vvp/gtkwave) **e** um `powershell.exe Get-CimInstance Win32_Process` que **enumera TODOS
      os processos da máquina via WMI** (cold-start do PowerShell + scan = ~1-3 s). Pior: chamado **2×**
      (`close` sem await + `before-quit`) e havia **dois** `before-quit` fazendo `fs.rm(Temp)` recursivo
      **concorrente** na mesma pasta (race → `maxRetries` backoff). **Fix:** (a) varreduras caras só rodam se
      algum filho de toolchain de fato rodou na sessão (`toolchainEverRan`, setado em `trackChild`); (b)
      `stopAllToolchain()` **memoizado** (os dois caminhos compartilham 1 teardown); (c) removido o `before-quit`
      duplicado de `windows.js` (o de `lifecycle.js` é o autoritativo). Sessão só-edição agora fecha na hora.
      *(Verificação de runtime pelo usuário: abrir → editar → fechar = instantâneo; após compilar/simular o
      teardown ainda mata os órfãos.)* ✅
- [x] **A5 — FEITO ✅** (a) `getActiveFilePath` lia `dataset.file` → corrigido p/ `dataset.path` (o find-state
      por arquivo volta a funcionar); (b) `tree.value` **já estava corrigido** (o `resolveProjectFile` usa
      `tree.ok`/`tree.data`); (c) snapshot do PDF lia `this.activeTab` **já sobrescrito** → captura `previousTab`
      antes de trocar; (d) `saveEditorState`/`restoreEditorState` (código morto, `ReferenceError` latente em
      `editor` não-declarado, sem callers) → **removidos**. 🟢

### F. 🔴 Arquitetura (god-files)
- [ ] **A2** — decompor `compilation_module.js` (3.927), `ai_assistant_manager.js` (3.873), `aurora_api.js` (2.383) por responsabilidade.
- [ ] **A3** — migrar leituras de globais (`window.electronAPI`×431 etc.) p/ imports ES. 🟡
- [ ] **A4** — colapsar `global.currentProject*` p/ um getter sobre `state`. 🟡
- [x] **A7 — FEITO ✅** — removidos os `send`/`removeAllListeners` genéricos do `preload_prism.js` (os 14 canais
      já têm wrappers nomeados; allowlist enumerada intacta — fim do escape de canais).
- [x] **A8 — FEITO ✅** — 152 linhas de código morto (view de hierarquia pré-PRISM) removidas do
      `compilation_module.js`, confirmadas por **refutação adversarial**; `cleanModuleName` vivo do `prism.js` preservado.
- [x] **GC universal de temps — FEITO ✅** — novo `main/temp_gc.js` (best-effort, non-blocking no startup) limpa os
      `aurora-mcp-<pid>.json` órfãos no tmpdir (vazavam — eram criados por turno e **nunca** limpos) + consolida a
      limpeza dos anexos. Ligado no `main.js`. (`components/Temp` já é limpo no quit; o GC fecha o buraco do MCP.) 🟢
- [ ] **A8** — `npm run deadcode` no CI + podar código morto. 🟢

### G. Segurança (parking lot)
- [ ] **V4** — CLIs de IA com permissões abertas → allowlist + fechar tools nativas. 🟡
- [ ] **V7** — token de sessão no MCP local (`Authorization`). 🟡
- [ ] **V8** — `launch-gtkwave-only` pela `binary_allowlist`. 🟢
- [ ] **V9** — renames (`rename_project`/`rename_processor`) passam pelo card Allow/Deny. 🟢
- [ ] **V10** — tirar `exec(string)` com interpolação dos utils de kill/check. 🟢
- [ ] **V11** — revisar superfície do `set_command_override` no modo `allow`. 🟢
- [ ] **V12** — filtrar `spec.env`/`prependPath` antes do `spawn`. 🟢
- [x] **CSP — FEITO** (auditado por diretiva via workflow). Header no `main.js` whenReady via
      `session.defaultSession.webRequest.onHeadersReceived` (cobre file:// + dev). Cada token é load-bearing:
      `unsafe-eval` (loader AMD do Monaco), `unsafe-inline` (inline `<script>`+`onclick`:82 + estilos
      runtime Monaco/Lit/KaTeX), `blob:` em script/worker (web-worker blob do Monaco sob file://), `data:`
      (anexos base64 + svg do CSS), `file:` (fontes empacotadas), `connect-src` só same-origin + Ollama local
      (providers cloud + MCP rodam no MAIN). `object-src 'none'` + `frame-ancestors 'none'`. Dev: + `ws/http`
      do Vite (derivado de `AURORA_RENDERER_URL`). **Validar ao vivo** (abrir .cmm → tokenização do Monaco;
      KaTeX + imagem data: no chat; fontes).
- [x] **sandbox:true — FEITO** nas 5 janelas (main/splash/update/prism/design-lab). Grátis: todos os preloads
      importam só `'electron'` (contextBridge/ipcRenderer/webUtils, disponíveis sandboxed); fs/spawn/IA já no MAIN.

### H. OSS a integrar (parking lot — resolver G8: default-on vs plugin sob demanda)
- [ ] **O1 Surfer** — ondas embutidas (remove GTKWave externo). 🔴 maior alavanca.
- [x] **O2 Verible** — LSP de Verilog (diagnostics + format + outline + hover + def/refs) via shim manual. ✅ 19/06/2026 (§14.32; aguarda teste ao vivo)
- [ ] **O10 ripgrep** — find-in-files no projeto. 🟡 quick-win de UX.
- [ ] **O3 Verilator** — feedback streamado no build + consolidar `waveBuild`. 🟡
- [ ] **O8 cocotb** — fluxo de teste de 1ª classe (alinha com branch do Arthur). 🟡
- [ ] **O5 YoWASP** — Yosys in-process (sem spawn). 🔴
- [x] **O7 tree-sitter** — highlight preciso (semantic tokens) p/ Verilog/SV/C/C++ via web-tree-sitter. ✅ 19/06/2026 (§14.35; aguarda teste ao vivo). NOTA: CMM/ASM não têm gramática tree-sitter → seguem Monarch; folding/outline já vêm do Monaco/Verible.
- [ ] **O9 DigitalJS** — simulação visual no PRISM. 🟡
- [x] **O11 slang-server** — análise semântica de SystemVerilog (diagnostics + autocompletar, toggle). ✅ 19/06/2026 (§14.34; aguarda teste ao vivo) · [ ] **O12 simple-git** · **O14 WaveDrom (docs)**. 🟡/🟢

### I. Build / DX (parking lot)
- [ ] **B1** SHA256SUMS por release + validar no downloader. 🟡
- [ ] **B2** code signing (SignPath/Azure) — fim do SmartScreen. 🟡
- [ ] **B3** README/badges → canal de release `sapho`. 🟡
- [x] **B4 — FEITO** `tsc --noEmit` já roda no CI; e `scripts/check-no-generated-js.js` (passo novo no `ci.yml`) falha se algum `.js` gerado (com irmão `.ts`) for commitado — trava o B5. 🟢
- [ ] **B6/B13** `copy-components` incremental / junction (não recopiar ~1 GB a cada start). 🟢
- [ ] **B7** validar sentinelas após bootstrap no `release.yml`. 🟢
- [ ] **B8** escolher release-please como fluxo único; aposentar `build.ps1`. 🟢
- [ ] **B9** limpar refs mortas (smoke.test, yanc-managed-files, bloco `win`, RELEASE.md). 🟢
- [x] **B10 — FEITO** `@vitest/coverage-v8` + bloco `coverage` no `vitest.config.js` (`all:false`, lcov),
      script `test:coverage`, passo "Unit tests (with coverage)" + upload Codecov (tokenless) no `ci.yml`,
      badge de cobertura no README. ~66% statements / 68% lines do que a suíte atual exercita. (Aumentar a
      cobertura de ipc/compile/ai/updater = escrever mais testes, fica pra depois.) 🟡
- [ ] **B11** cross-platform (Linux/macOS): allowlist por `process.platform`, libs node no lugar de `taskkill`/`Expand-Archive`. 🔴
- [ ] **B12** CLIs de IA (~675 MB) como download opcional sob demanda. 🟡

### J. Repositório / profissionalização (§9, parking lot)
- [ ] Branch protection na `main` (PR + status check obrigatório).
- [ ] release-please como fluxo único (PR v6.4.0 parado desde maio).
- [ ] Decisão canônica de naming (SAPHO vs Aurora) alinhada nos 6 pontos.
- [ ] Triagem de Dependabot + auto-merge de patch/minor.
- [ ] `THIRD_PARTY_NOTICES.md` + `license`/`repository`/`bugs` no `package.json`.
- [ ] README com mídia (screenshot hero + GIFs) + corrigir badges.
- [ ] CodeQL + secret scanning (push protection).
- [ ] Habilitar Discussions (link morto no CONTRIBUTING).
- [ ] Metadados do repo (topics, homepage, social preview).
- [ ] commitlint + hook `commit-msg`.
- [ ] CODEOWNERS (roteamento de review p/ Arthur).
- [ ] Limpar releases órfãs (5 drafts 2025 + prereleases de toolchain).
- [ ] CITATION.cff + roadmap público (contexto acadêmico NIPSCERN/UFJF).
- [ ] **Disclosure de software de terceiros (user-facing) — profissionalização.** Tela in-app (About /
      Settings) que informa ao usuário **TODO** o software de terceiros empacotado no bundle SAPHO, com
      licenças: toolchain (iverilog · yosys + yosys-abc · verilator · gtkwave-nipscern · python+cocotb ·
      msys2 · @silimate/netlistsvg · surfer/FFPGA quando entrar) · CLIs de IA (@anthropic-ai/claude-code ·
      @openai/codex) · libs de runtime (Monaco 0.52.2 · KaTeX · Phosphor · Lit · fontes Inter + JetBrains
      Mono). Gerar de forma automatizável (a partir de package.json + manifesto do toolchain) e exibir
      offline. Pareia com o `THIRD_PARTY_NOTICES.md` acima (este é o canal **para o usuário**, aquele é o
      do repo).

### K. Features / UX (novas capacidades pedidas)
- [x] **Anexos no chat da IA — imagens e arquivos — FEITO** (validar o envio ao vivo com provider real).
      UI: botão de clipe + drag-drop + paste no composer; chips de preview (thumb de imagem / ícone+nome+tam,
      com ×) + faixa read-only na bolha enviada. Limites: imagem ≤8 MB (data URL), arquivo ≤256 KB de texto
      (clipa), até 10/msg. Protocolo: `attachments` na msg do usuário → `apiMessages` → `startChat`. Transportes:
      **SDK** (`chat.js`) monta content multimodal (image parts); **Claude Code** escreve imagem em temp +
      referencia o path (Read tool nativo lê) + inlina texto de arquivo; **Codex** inlina texto, imagens
      **degradam** com aviso ("use Claude Code ou provider com chave"). Helper `main/ai/attachments.js`.
      Vazamento dos temps **corrigido** (TTL >1h + limpa no start/quit). **Refinar se necessário:** o path temp
      fica FORA do projeto → o modo de permissão do Claude Code pode pedir confirmação pra ler. Opções: passar
      `--add-dir <tempdir>` ao `claude -p` (lê sem prompt) OU — mais elegante — servir a imagem como **MCP image
      content** (sem arquivo temp, sem permissão, sem lixo). Também: apagar o temp **logo após o turno** (mais
      preciso que TTL). Avaliar quando testar imagem com Claude Code. 🟢
  - **DECISÃO (imagens session-scoped) — feita:** imagens são referenciáveis DENTRO do chat ativo (o SDK reenvia
    o histórico todo turno; o Claude Code lembra na sessão `--resume`), mas **não persistem após restart** — o
    registro salvo em `conversations.js` é só `{role, content}` (sem base64) → **zero inchaço de storage**
    (confirmado). Reabrir um chat antigo não tem contexto de imagem; é **intencional** (evita inchaço + custo de
    token + complexidade do fold do CLI). Futuro (se pedirem): persistir + re-alimentar p/ referência cross-restart.
- [ ] **Rever COMPLETAMENTE o prompt injection — condensar p/ não queimar tokens.** Auditar tudo que é
      injetado no `system`/prompt a cada turno e enxugar sem perder contexto útil. Pontos mapeados:
      (a) **`SYSTEM_PROMPT`** (base SAPHO, grande) — concatenado em `_dispatchTurn` (`ai_assistant_manager.js`)
      com (b) **`projectContext`** reconstruído **por-turno** (root/spf/instruções); (c) **`conversation_context`**
      (fold das mensagens antigas no prompt dos CLIs — `claude_code.js`/`codex_cli.js`); (d) **tool-results**
      injetados como `[Tool result for "x"]: ${JSON.stringify(res)}` (`chat.js`) — JSON **inteiro**, pode ser
      enorme; (e) o inline de anexos novo. Ideias: system mais enxuto + só o **delta** por-turno; **resumir/truncar**
      tool-results volumosos; estender o **Anthropic prompt-cache** (já existe no `chat.js`) e equivalentes nos CLIs;
      medir tokens antes/depois. Meta: **menos tokens/turno** mantendo a qualidade. 🟡 (valor: custo + velocidade)
  - **FEITO (refresh + parte do enxugamento):** reestudo completo do **YANC v5.2** (workflow de 4 scouts) →
    SYSTEM_PROMPT atualizado (versão v5.0→**v5.2**, ISA **112→116 opcodes** + F_SCL/SF_SCL/XPO/XPO_M, stdlib
    completa: cosh/sinh/tanh/floor/ceil/round/conj + nota de transcendentais-complexas) + **dedup** (RESERVED
    standalone removido — já está no HARD CONSTRAINTS #6). `resources/sapho_rules.json` **regenerado** (sync
    script; `STDLIB_FUNCTIONS` corrigido — as 7 funções novas estavam misclassificadas como tokens soltos; agora
    116 opcodes + stdlib certo). **Identidade conferida correta** (ATLAS/AURORA-fem/NIPSCERN — não havia erro).
    **Condensação de tokens (split do projectContext): avaliada e DEFERIDA** — o system grande **já é cacheado**
    (Anthropic ephemeral no `chat.js` + auto-cache dos providers + `--resume` dos CLIs), então não é re-cobrado
    por turno dentro da sessão; o split daria ganho só cross-sessão (marginal) e mexeria no laço recém-estabilizado.
  - **Investigar JUNTO (sintoma reportado):** a IA às vezes **demora demais / trava pra responder** e às vezes
    entra em **loop infinito na resposta**. Hipóteses a medir: (i) volume/forma do que é injetado por turno
    (prompt gigante, `tool-results` inteiros via `JSON.stringify`, re-fold do histórico nos CLIs) inflando o
    tempo até o 1º token; (ii) **bug no laço de streaming/auto-continue** — o `_autoQueue`/`_drainAutoQueue` ou um
    ciclo de tool-calls que **re-dispara o turno sem condição de parada** (o watchdog de `STREAM_STALL_MS` 180s só
    mascara). Instrumentar onde o tempo vai (montar prompt vs. 1ª resposta vs. loop de tools) e checar se algum
    caminho reentra sem guard. **DIAGNOSTICADO + CORRIGIDO:** não existe loop infinito real (auto-continuação é
    capada em 5 — `_autoChainCount`; tool-loop em 24 — `stepCountIs(MAX_STEPS)`). O sintoma era **FREEZE**: o
    backend às vezes não emitia evento terminal (SDK `fullStream` travado / CLI vivo-mas-travado / `await
    totalUsage` travado), deixando o spinner até o watchdog de 3 min — que ainda podia ser **suprimido** por um
    chip de tool preso. **Fix (A–E):** timeout de inatividade **tool-aware** (Set de ids) no `chat.js` + nos 2
    CLIs, `Promise.race` de 5s no usage, watchdog com **teto-duro de 12 min**, guard `_isStreaming` no `send()`,
    cap nos tool-results. Revisado por workflow adversarial (2 achados HIGH corrigidos: Set em vez de contador).
    *(Verificação ao vivo do usuário: turnos longos/com tools não travam; freeze raro se recupera sozinho.)* ✅
- [x] **Welcome: hover num projeto recente → preview dos processadores — FEITO ✅** (popover `position:fixed`,
      sem clipping da lista; processadores lidos do `.spf` e enriquecidos/cacheados em `recent_projects.js`,
      exibidos pelo `<aurora-welcome>` no hover). Passar o
      mouse por cima de um card de "projeto recente" na tela de welcome mostra (tooltip/popover) **todos os
      processadores** definidos naquele projeto, sem precisar abri-lo. Fonte: ler o `.spf`/estrutura do projeto
      (a lista de processadores já é conhecida pelo project store / parsing do projeto). Bom pra escolher o
      projeto certo de relance. Pareia com o `<aurora-tooltip>` (já migrado) p/ o popover. 🟢 (UX, baixo risco)
- [x] **Syntax highlight para o arquivo `.spf` — FEITO ✅** (mapeado → linguagem `json` built-in nos 2 mapas de
      extensão: `monaco_editor.js` + `split_editor.js`). Hoje o `.spf` (que é **JSON** — config canônica do projeto:
      `metadata` + `structure` com `processors[]`, listas de arquivos, `commandOverrides`) abre no Monaco como
      **plaintext** (os dois mapas de extensão — `getLanguageFromPath` em `js/editor/monaco_editor.js` e
      `_langFromPath` em `js/editor/split_editor.js` — caem no fallback `'plaintext'` p/ extensão desconhecida).
      **Ganho fácil (recomendado):** mapear `.spf` → a linguagem **`json` built-in** do Monaco (uma linha em
      **cada** um dos dois mapas, que precisam ficar em sync) → highlighting genérico (chaves/strings/números/
      booleans), folding e bracket-matching **de graça**. **Ganho rico (opcional):** uma linguagem `spf` custom
      (Monarch; molde = a linguagem ASM em `monaco_editor.js:974-1123`) que colore o **schema** semanticamente
      (nomes de processador, chaves de `structure`, `commandOverrides`), reusando os theme tokens (defs
      `cmm-dark`/`asm-dark` + base em `theme_variables.css`). Nota: o `.spf` é gerido atômico pelo `SpfStore`/main
      → o highlight serve p/ **inspeção** (editar à mão arrisca corromper o projeto). 🟢 (começar pelo mapa→json)
- [x] **Mensagens follow-up no chat de IA (fila, estilo VSCode) — FEITO ✅** (`_messageQueue` no
      `ai_assistant_manager.js`: `send()` enfileira se streaming; drena no `setStreaming(false)` priorizando a
      msg do usuário sobre o auto-continue; chips canceláveis acima do composer; `stop()`/`newChat()` limpam).
      Enviar uma nova mensagem enquanto a anterior
      ainda está sendo respondida — ela **entra numa fila** e dispara quando o turno atual termina. Importante: o
      "estilo VSCode" é **fila sequencial**, NÃO turnos paralelos (o próprio VSCode enfileira). **Já temos meio
      caminho:** o textarea **continua habilitado** durante o streaming (dá pra compor a próxima msg); só o
      *dispatch* é bloqueado pelo flag `_isStreaming` (guard do Enter em `ai_assistant_manager.js:1770`; botão
      send escondido / stop visível). E o **main já suporta turnos sequenciais** (cada turno gera um `sessionId`
      novo; o anterior é limpo antes do próximo; os CLIs encadeiam via `--resume`/`convSessions`). Já existe até o
      **precedente** `_autoQueue`/`_drainAutoQueue` (turnos autônomos) que drena no `setStreaming(false)` — a fila
      de mensagens do usuário **espelha** isso. **Escopo pequeno (~Fase 1):** `this.messageQueue=[]`; `send()`
      enfileira se `_isStreaming`; `setStreaming(false)` drena em sequência; `newChat()`/`stop()` decidem limpar a
      fila; UI com chips das mensagens enfileiradas + cancelar uma. **FORA de escopo:** streaming **paralelo** de
      verdade (o `currentSessionId`/`segmentBuffer`/`pendingConfirms` únicos exigiriam refactor por-sessão de
      ~300+ LOC, e os `--resume` dos CLIs se atropelariam) — e não é o que o VSCode faz. 🟡 (alto valor de UX)

---

## 14. Source Control embutido + polish da IDE — sessão 16–17/06/2026

> Leva grande. **253 testes unit passando**, ESLint/tsc/knip limpos, `vite build` verde a cada commit.
> **Verificação visual/runtime do Electron é por conta do usuário.** Tudo na `feature/aurora-revamp`.
> ~50 commits no dia (ver `git log --since=2026-06-16`). Idioma: i18n **PT/EN** em tudo que foi adicionado
> (namespaces `git` e `search` em `locales/*.json`).

### 14.1 Source Control embutido — "um GitHub Desktop só pra Aurora"
Painel de controle de versão completo, dirigido por **simple-git** (`^3.36`) sobre o `git` nativo (logo
`.gitignore`, diffs, merges e credenciais se comportam como na linha de comando). Diffs com **diff2html**.

**Backend (main process):**
- `main/ipc/git.js` — handlers: `is-repo`, `status` (com `stats` opcional = numstat +/- por arquivo),
  `diff`, `commit-files` (numstat do commit), `show` (diff por arquivo, capado), `log`, `branches`
  (`-a`: locais + remotas), `remotes`, `info`, `add-remote`, `init`, `stage`, `stage-all`, `unstage`,
  `discard`, `commit` (com amend), `undo-last-commit`, `checkout` (com `create`/`track`), `merge`,
  `stash`/`stash-list`/`stash-pop`/`stash-drop`, `fetch`, `pull` (`--no-edit --autostash`), `push`,
  `clone` (com **barra de progresso** via plugin de progresso do simple-git -> evento `git:clone-progress`),
  `scan-spf`. Leituras aceitam um `dir` opcional (`resolveDir`/`gitFor`) p/ o **modo navegação** (ver 14.1.4);
  mutações sempre no projeto aberto. Cap de diff: `MAX_DIFF_BYTES` 600 KB + corte em borda de linha.
- `main/ipc/github_auth.js` — conexão de conta GitHub. **PAT** (clássico ou fine-grained) **e OAuth Device
  Flow** (OAuth App "sapho", `OAUTH_CLIENT_ID` = `Ov23linD078LyGE5aDvg`, público; escopo `repo read:org`).
  Token cifrado com `safeStorage` (DPAPI no Windows) — plaintext nunca em disco; o renderer só sabe
  "quem está conectado". `listRepos` usa `affiliation=owner,collaborator,organization_member` (pagina ~500)
  -> inclui repos de **organizações**; retorna `owner`/`ownerType`/`htmlUrl`. Avatar bakeado em `data:` URL
  (passa no CSP). Após autorizar o device flow, traz a janela da Aurora pro foco (restore/show/focus +
  toggle `alwaysOnTop` + `flashFrame` de fallback).
- `main/ipc/files.js` — `shell:open-terminal` (cmd/Terminal por plataforma) p/ o menu de projetos clonados.

**UI (renderer):** `js/git/git_panel.js` + `css/panels/git_panel.css` (reescrito do zero, ~970 linhas).
Layout estilo GitHub Desktop: **duas colunas** (lista de arquivos/commits à esquerda  ⟷  **diff à direita**),
colapsa pra coluna única quando não há diff (`:has(#git-diff[hidden])`). Sistema de botões coeso
(`.git-btn`/`.git-mini`/`.git-icon-btn` com mesmo hover/active/focus-ring), barra de conta, status bar
discreta, animações GPU-only (transform/opacity) com `prefers-reduced-motion`. **O painel inteiro rola**
(colunas com `min-height` sólido, não colapsam). Modal 1100px.

#### 14.1.1 Mudanças (Changes) + commit
- Lista estilo GitHub Desktop: **checkbox por arquivo** (marcado = em stage; clique faz stage/unstage) +
  **checkbox mestre** no cabeçalho (stage/unstage all, com estado parcial) + "N/M em stage".
- **Linhas +adicionadas / −removidas** por arquivo não-commitado (numstat; `git:status` com `stats` opt-in,
  então o poll do badge segue barato).
- Commit "rico": título + descrição (auto-grow), **amend** (toggle, com tooltip), desfazer último (soft
  reset, com confirmação). **Commit só habilita com título preenchido** (+ ter mudanças/amend).
- Discard por arquivo (confirmação). Flags de status coloridas (M/A/D/R/U/?).
- **Stage otimista (sem reload):** dar check no arquivo vira o checkbox na hora e roda o `git` em background
  — sem `refresh()` do painel inteiro (preserva diff aberto, scroll e seleção); reconcilia só em erro.
- **Seleção por intervalo (shift-click):** clicar num arquivo e **shift+clicar** em outro seleciona todos
  entre os dois; dar check num deles faz stage/unstage **da seleção inteira**.
- **Changes ao vivo:** com o painel aberto, mudanças em disco (incl. **editar o `.gitignore`** → arquivos
  ignorados somem das Changes) re-renderizam **só a lista** (`refreshChangesOnly`), não o painel todo.
- **Polish:** checkbox maior (24px, micro-press) + **barra accent esquerda arredondada** (`::before` inset)
  nos arquivos em stage.

#### 14.1.2 Histórico (History) + diff que NÃO trava
- Modelo GitHub Desktop: o commit lista os arquivos via **numstat** (rápido) e o diff de **cada arquivo
  carrega sob demanda** ao expandir — nunca tudo de uma vez.
- **Anti-freeze do diff** (um `.txt` de ~900k linhas travava a IDE): gate por contagem de linhas (numstat)
  — arquivos com >1500 linhas alteradas não são auto-renderizados ("Alteração grande" + "Mostrar a primeira
  parte"); `diffHtml` **trunca em 1500 linhas** antes do diff2html (rede de segurança universal); removido
  `matching:'words'` (era O(n^2)); render em `requestAnimationFrame`.
- **Pula binários/imagens** (flag binary do numstat + extensões: png/jpg/.../mif/hex/vcd/fst...).
- **Libera memória**: fechar o painel de diff (ou o modal) limpa o innerHTML dos corpos (solta o DOM pesado
  do diff2html). Linhas de commit com affordance de clique (cursor, barra accent, chevron).

#### 14.1.3 Branches + stash
- Menu de branches como **portal no `<body>`** (era `position:fixed` dentro do modal com `transform`, que
  posiciona relativo ao ancestral transformado — caía "no meio do nada"); posicionado por JS sob o chip,
  clampado à viewport (abre pra cima se não couber). Fecha em click-fora/Esc/ação/refresh.
- **Todas as branches**: locais + seção "Branches remotas" (remote-only); checkout de remota usa
  `git checkout --track origin/<branch>` (DWIM falhava com "pathspec did not match"). Criar branch, merge.
- **Trocar de branch com árvore suja**: oferece "Guardar (stash) e trocar" (git checkout não tem
  `--autostash`) -> `stash push --include-untracked` + checkout. Linha "Alterações guardadas (N)" no menu com
  **Restaurar** (pop) e **Descartar** (drop, com confirmação). **Restaurar com conflito**: detecta e oferece
  "Descartar atuais e restaurar" (aplica a versão guardada).

#### 14.1.4 Clone + projetos clonados + modo navegação
- **Clone**: lista dos repos (agrupada por dono — **seus** com badge accent vs **organizações** com badge/azul),
  escolher local (lembrado entre sessões via localStorage), validação de caminho (sem espaços/exóticos),
  **barra de progresso** que some com fade ao concluir. Pós-clone: scan `.spf` -> "Abrir no SAPHO" (se houver)
  ou entra no **modo navegação** do repo recém-clonado.
- **Gerenciador de projetos clonados** (botão "Projetos"): lista persistida; clique abre no SAPHO (com `.spf`)
  ou navega o histórico (sem `.spf`); **menu de contexto** (clique direito ou ⋮), todas funcionais: abrir no
  SAPHO, copiar nome, copiar caminho, ver no GitHub, abrir no prompt de comando, mostrar no explorador,
  remover (tirar-da-lista ou apagar-do-disco). Aviso (toast) na IDE ao abrir um projeto git.
- **Modo navegação (read-only)**: ver histórico/branches/diffs de **qualquer clone, mesmo sem `.spf`**. As
  leituras do backend aceitam `dir` (browseDir) -> o painel reflete aquela pasta; banner "Navegando: <nome> ·
  somente leitura" com Fechar; esconde commit box/publish/stage e tira fetch/pull/push.
- **Abrir projeto "de verdade"**: usa `window.projectManager.loadProject` (mesmo fluxo do File>Open) — reseta
  a tree **e semeia os processadores do `.spf`** (o IPC cru `openProject` deixava o tree sem processadores).

#### 14.1.5 Conta, token e remoto
- **Publicar no GitHub** (sem remote): cria repo + add origin + push. **Criar repo COM os arquivos**: init +
  stage all + commit inicial. **Push rejeitado (non-fast-forward)**: oferece **"Pull e push"**. Pull com
  `--autostash`. Mensagens de status somem sozinhas (inclusive erros, 8s).
- **Guia "i" do token**: passo-a-passo atual do GitHub (token clássico, escopo `repo`, `read:org` p/ orgs) +
  **tabela de qual permissão cada recurso precisa** (escopo clássico x fine-grained: Contents/Administration/
  Metadata). Botão que abre `github.com/settings/tokens/new`.
- **Login OAuth (Device Flow)**: "Entrar com GitHub" -> mostra um código grande (feedback verde ao copiar) +
  abre o `github.com/login/device` -> polling -> token guardado. Cancelável/re-tentável (não trava o painel).
- **Indicador na status bar** + **avatar (bolinha 18px)** no canto inferior-direito do ícone de branch quando
  logado. **Disconnect**: ícone discreto + confirmação; ao desconectar **limpa todas as seções** da tela
  (o histórico de clones em localStorage é preservado de propósito).

#### 14.1.6 `.spf` tolerante
`spf_store.ts` (renderer) e `project.js` (main) agora parseiam `.spf` com fallback leniente (tira BOM,
comentários `//` e `/* */`, vírgulas finais) quando o JSON estrito falha — recupera arquivos editados à mão
/ vindos de outra máquina em vez de cair pra defaults silenciosamente.

### 14.2 Find in Files (#32) — FEITO
Painel estilo Search do VS Code (`js/search/search_panel.js`, `main/ipc/search.js`). **Ctrl+Shift+F** ou o
botão de lupa **no header da file tree** abre um modal: busca por texto em todo o projeto, resultados
agrupados por arquivo (cabeçalho colapsável + linha/preview, match em `<mark>`), clique abre o arquivo na
linha. Toggles case/word/regex. Backend recursivo **sem dependência nova** (pula `.git`/`node_modules`/
build/binários/>1.5MB; caps de 2000 matches / 500 arquivos). i18n PT/EN.

### 14.3 Empty-states unificados (#35) — FEITO
Os 4 "nada aqui" (file tree, verilog tree, painel IA vazio/offline, "sem projetos recentes") compartilham
**uma linguagem visual única** estilo VS Code (coluna centralizada, ícone muted ~40px, título/corpo
consistentes). CSS-only; divergências mantidas de propósito (card CTA da file tree, tint accent da IA).

### 14.4 File tree — highlight de arquivo aberto (estilo VSCode) — FEITO
O `.editor-focused` (arquivo aberto no Monaco) era idêntico ao `.top-level-file` (accent). Agora é **neutro**
(distinto do top-level/testbench) e **muted quando o editor perde foco**, voltando a brilhar ao re-focar —
via `body.editor-has-focus` (focus/blur do Monaco main+split, debounce 150ms). Vale nas views files/folders.

### 14.5 `.gitignore` pelo menu da file tree — FEITO
No menu de criar (botão direito em área vazia da tree) há "Novo .gitignore": cria na raiz do projeto com
defaults de hardware (Temp/, Backup/, `*.vcd`/`*.fst`/`*.ghw`/`*.vvp`/`*.out`, .DS_Store...), abre no editor,
atualiza a tree. Não entra no `.spf`.

### 14.6 IA — i18n dinâmico + remove-key + brilho
- **Bug i18n dinâmico corrigido**: o painel de IA e os cards de provider do **AI Settings** mostravam chaves
  cruas (`modal.settings.aiSave`...) — race: construídos antes do catálogo i18n carregar, com a chave como
  "fallback". Agora usam **`data-i18n` + fallback em inglês + `applyDOM`** no subtree (resolve mesmo
  construído antes do catálogo; boot/locale-change re-resolvem). `window.i18nApplyDOM` exposto.
- **Botão "Remove key" por provider** sempre visível (desabilitado quando não há key).
- **Brilho do painel de IA**: lilás, arco no rodapé, respiração bem suave (sem "efeito-GIF", sem bola que se
  mexe), `prefers-reduced-motion` off. (Várias iterações ao longo do dia.)

### 14.7 Outros fixes do dia
- Notificações reposicionadas (não mais full-width no rodapé). Rename de projeto/processador voltou a ser
  mecânico (sem card que travava o Codex MCP). Pull não redimensiona o modal (status com altura fixa). Badge
  do source-control menor + auto-update (watcher + poll 8s). **ESC** fecha qualquer `aurora-modal` dismissable
  (find-in-files, git, ...) via handler global no componente.

### 14.8 Pendências / decisões
- **OAuth Device Flow LIGADO** (Client ID preenchido). Funciona ponta-a-ponta.
- **Deferidos do backlog anterior** com disposição final em §17 (ex-`docs/BACKLOG_RECONCILIADO.md`): #16 WaveDrom
  (sem superfície), #36 tokens `ai_assistant.css` (descartar — alias puro/zero valor em tema único),
  #37 P6 width->transform (precisa decisão de UX overlay), #38 condensação de prompt (substancialmente feito).
- **Layout do painel git**: distribuição melhorada (Clone/Projetos mutuamente exclusivos, branch menu portal,
  scroll). Passo maior possível (overlays no lugar de seções inline) fica como opção se o usuário pedir.

### 14.9 Rename de projeto robusto (job + verdito final) — 17/06/2026 — FEITO
A renomeação de projeto pela IA era instável: ora estourava o tempo e não renomeava, ora estourava mas
renomeava (só aparecia depois de um refresh manual). Causa: a tool fazia tudo num único turno (salvar e
fechar as abas + mover a pasta do projeto no disco + reabrir o projeto, que rescaneia a árvore inteira).
Quando isso passava do timeout da tool, a IA via "timeout" mesmo quando o rename tinha dado certo; e a
reabertura, feita em segundo plano, falhava em silêncio, deixando a árvore desatualizada.

Agora a renomeação roda como um **job rastreado**:
- `rename_project` valida o nome e retorna **na hora** um `jobId` (não bloqueia → não estoura o tempo).
- O job roda em segundo plano: prepara (salva/fecha abas e panes) → rename no disco (no main) → reabre o
  projeto (agora *aguardado dentro do job*, então sabemos se realmente reabriu). Cada etapa é registrada.
- Nova tool **`get_rename_status(jobId)`** (read, pré-autorizada para não pedir card a cada poll): a IA
  consulta até `status` virar `done` ou `failed`, recebendo as etapas concluídas e o **verdito final**
  (sucesso, ou o passo exato + o motivo da falha).
- O handler do main (`rename-project`) passou a retornar um **verdito estruturado** (`{success, failedStep,
  error, steps}`) em vez de lançar exceção — a IA nunca mais recebe um erro opaco.
- O usuário vê um toast de início e um toast final (sucesso/aviso/erro). Uma reabertura que falhe vira um
  **aviso** ("renomeado, reabra para atualizar a árvore"), não um rename perdido.
- i18n PT/EN no namespace `rename.*`. Arquivos: `main/ipc/project.js`, `js/api/aurora_api.js` (job runner +
  `getRenameStatus`), `main/ai/tools.js` (descrição + `get_rename_status`), `js/ui/ai_assistant_manager.js`
  (pré-autoriza o status), `locales/{en,pt}.json`, `docs/aurora-intelligence-tools.md`.
- Verde: 253 unit + ESLint + `tsc --noEmit` + `vite build`. **Verificação ao vivo do usuário pendente.**

### 14.10 Anexos da IA (fix crítico + persistência) + glow do painel na 1ª mensagem — 17/06/2026 — FEITO

**Bug crítico: a IA parou de receber imagens.** Causa raiz: a limpeza de memória que solta o base64 das
imagens depois de enviar (pra não reenviar 8 MB a cada turno) estava mutando os MESMOS objetos de anexo que
o `apiMessages` (a lista que vai pro modelo) referenciava — então o base64 era apagado ANTES do envio chegar
ao transporte. Resultado: todo provedor (SDK + Claude Code) recebia o anexo sem conteúdo e o modelo só via
"uma imagem foi anexada". Fix: `apiMessages` agora **clona** cada anexo (`{ ...a }`), então a limpeza do
histórico não alcança mais a cópia que está sendo enviada. (Codex segue sem ver imagens — limitação real do
provider, exibe a nota de degradação.)

**Persistência de anexo ao reabrir o chat.** Antes, ao salvar uma conversa só `{role, content}` era gravado
por mensagem — reabrir um chat com imagem mostrava uma bolha vazia. Agora gravamos os **metadados leves** do
anexo (nome+extensão, kind, mime, size) — **sem** o payload (base64/texto), descartado por performance. Ao
reabrir, os chips dos anexos são re-renderizados com o nome; imagem sem bytes cai num chip com ícone+nome (em
vez de thumbnail quebrado). A mensagem mantém o contexto em vez de ficar vazia.

**Glow do painel de IA — revela na 1ª mensagem.** O brilho lilás no rodapé do painel agora começa
**apagado**; quando o usuário envia a primeira mensagem da sessão ele **revela** (sobe de baixo pra cima +
clareia em toda a extensão, easing `--ease-reveal`, sem overshoot) e fica ligado (respiração calma). Fechar e
reabrir o painel mantém o glow; só reiniciar a interface do zero refaz a animação (flag em memória, não
localStorage). `prefers-reduced-motion` acende o glow sem animação.

Arquivos: `js/ui/ai_assistant_manager.js` (clone de anexos, persist/replay dos metadados, `_revealGlow`),
`css/panels/ai_assistant.css` (estado OFF + keyframe `aiArcReveal` + classe `.revealed`). 253 unit + ESLint +
`tsc --noEmit` + `vite build` verdes. **Verificação ao vivo do usuário pendente.**

### 14.11 Render de LaTeX (`\text`/chaves aninhadas) + IA fora da pasta do projeto (destrava rename) — 17/06/2026 — FEITO

**LaTeX no chat — `\text{}` e chaves aninhadas.** O fallback Unicode do `_renderMath` (usado quando o KaTeX
não está ativo) não tratava `\text{...}` nem super/subscritos com chaves aninhadas, então `E_T^{\text{miss}}`
saía com o `^{\text{miss}}` **literal**. Fix: o fallback agora **remove os macros de texto** (`\text`,
`\mathrm`, `\operatorname`, …) mantendo o conteúdo, **antes** do passo de super/subscrito — então
`^{\text{miss}}` vira `^{miss}` e renderiza como sobrescrito correto. (Quando o KaTeX está carregado ele
segue sendo usado, que é o ideal; isto conserta o caso em que ele não está.)

**IA roda fora da pasta do projeto — destrava o rename durante o turno.** Causa raiz do rename flaky (§14.9):
o processo do agente (Claude Code / Codex) era spawnado com `cwd` = a pasta do projeto. No Windows, um
processo cujo cwd é uma pasta **trava** essa pasta — então o `rename_project` só completava quando o turno
terminava (o agente soltava a pasta). Fix: o agente agora roda de uma **pasta-rascunho neutra**
(`%TEMP%\aurora-ai-cwd`), nunca a do projeto. O projeto segue legível: o Claude Code recebe `--add-dir
<projeto>` (+ `--add-dir <dir de anexos>`, que de quebra conserta a leitura nativa das imagens anexadas); o
Codex acessa via tools MCP (caminhos absolutos) + sandbox liberada. Com isso o rename completa **durante** o
turno e a IA recebe o verdito de verdade (em vez de só descobrir depois que o chat fecha).

Arquivos: `js/ui/ai_assistant_manager.js` (`_stripTextMacros`), `main/ai/claude_code.js` (`agentScratchDir` +
`--add-dir` projeto/anexos), `main/ai/codex_cli.js` (`agentScratchDir`, remove o `state` ocioso). 253 unit +
ESLint + `tsc --noEmit` + knip + `vite build` verdes. **Verificação ao vivo do usuário pendente.**

### 14.12 Error boundary ignora cancelamento benigno do Monaco — 17/06/2026 — FEITO
Com o rename agora completando **durante** o turno (§14.11), a reabertura do projeto fecha todas as abas e o
Monaco **descarta** seus editores — e, ao descartar, rejeita o trabalho assíncrono pendente (tokenização,
hover, resolução de modelo) com um erro **benigno** "Canceled" (`CancellationError`). O error boundary do
renderer tratava isso como crash e mostrava o overlay "Something went wrong: Canceled: Canceled" (dava a
impressão de IDE travada). Fix: `error_boundary.js` agora **ignora** esses cancelamentos benignos
(`name`/`message` = "Canceled"/"CancellationError") nos dois listeners (`error` + `unhandledrejection`), com
`preventDefault()` — exatamente como o próprio VS Code faz com `onUnexpectedError`. A reabertura segue normal,
sem alarme falso. Arquivo: `js/app/error_boundary.js`. 253 unit + ESLint + `tsc --noEmit` + `vite build` verdes.
**Confirmado pelo usuário: rename funciona; faltava só não assustar com o "Canceled".**

### 14.13 Fix: file tree clicável após o rename (sem refresh manual) — 17/06/2026 — FEITO
Após o rename, a árvore reabria mas **nenhum arquivo ficava clicável** até o usuário clicar no botão de
refresh da própria tree. Causa: o `_runRenameJob` chamava `ProjectStore.setProject(novo)` **antes** do
`loadProject` — e o `loadProject` chama `setProject` de novo internamente. O subscriber da file tree
(`file_tree_manager.js` `onProjectChange` → `refreshTree()`) disparava então um `refreshTree` **fora de
banda** que corria com o render do próprio `loadProject`, deixando os handlers de clique quebrados (o refresh
manual reconstruía). Abertura normal de projeto não tinha o bug (só um `setProject`). Fix: removido o
`setProject` redundante do job (e o `newRoot` que só ele usava) — o `loadProject` faz tudo, igual a um
File > Open. Arquivo: `js/api/aurora_api.js`. 253 unit + ESLint + `tsc --noEmit` + `vite build` verdes.

### 14.14 Dagr — nome próprio para o Source Control (G2) — 17/06/2026 — FEITO
O painel de controle de versão ganhou identidade de **"software à parte"** (como o PRISM): **Dagr**, o deus
nórdico que conduz o dia pelo céu — tempo e história tornados visíveis. A marca é a runa dele, **Dagaz ᛞ**
("dia/aurora", um nodo ao tema da AURORA). No header do modal `#gitModal`: o ícone clássico `ph-git-branch`
**fica** (NÃO foi substituído, como pedido), seguido da **runa ᛞ** (em accent, com glow) + **Dagr** na fonte
**Norse** de Joël Carrouché (a fonte Viking clássica, ~1.6em), com "Source Control" como descritor pequeno
(i18n `modal.git.title` preservado). Os ícones/tooltips da activity bar e da status bar seguem clássicos.

**Licença da fonte (Norse):** é grátis para uso comercial e PODE ser embutida em aplicações, mas a licença
**proíbe redistribuição** ("you may not make the font available for download"). Então NÃO commitamos a fonte
no repo público — `components/Scripts/download-norse-font.js` a baixa da fonte oficial (dafont) no bootstrap
para `assets/fonts/Norse.otf` (gitignored), exatamente como a toolchain. O app empacotado embute a fonte
(permitido); a CI baixa antes do build; o `@font-face` tem fallback pra fonte da UI se a fonte faltar. (Antes
tentei Metamorphous OFL como stand-in — substituído pela Norse correta a pedido do usuário.)

Arquivos: `index.html` (título do `#gitModal` + About), `css/panels/git_panel.css` (`@font-face` Norse +
`.dagr-*` redesenhado), `components/Scripts/download-norse-font.js` (novo), `package.json` (bootstrap),
`.github/workflows/ci.yml` (passo de download), `.gitignore`, `THIRD_PARTY_NOTICES.md` + About (licença).
253 unit + ESLint + `tsc --noEmit` + `vite build` (Norse vendorizada/hasheada no `dist`) verdes.
**Verificação visual do usuário pendente.** (Marca d'água grande/muted "ᛞ DAGR" no fundo do painel — `a268edc`.)

### 14.15 Decorações de status git na file tree (estilo VS Code) — 17/06/2026 — FEITO
A file tree ganhou as decorações de status do git estilo VS Code, em **AMBAS** as views ("files"/verilog e
"folders"/standard): um **badge de letra colorido** à direita de cada arquivo alterado (M amarelo = modificado,
A/? verde = adicionado/novo, D vermelho = deletado, R azul = renomeado, U/C = conflito) + um **ponto (•)
colorido nas pastas** que contêm alterações (rollup recursivo) + **tint do nome** na cor do status. Só aparece
quando o projeto aberto é um repo git (gating por `is-repo`); projetos SAPHO não-git ficam limpos.

Arquitetura (`js/tree/git_decorations.js`): `refresh()` busca `window.gitAPI.status()`, monta um
`Map<pathAbs→letra>` + um `Set` de pastas alteradas, e chama `apply()`. `apply()` repinta as rows da view a
partir do cache; um **MutationObserver** no `#file-tree` reaplica após cada re-render (os renderers apagam e
reconstroem as rows), **desconectado durante o paint** pra não disparar a si mesmo. Refresh nos mesmos sinais
que o badge do Source Control já usa (`file-saved`/`spf-changed`/`dir-changed`/`file-changed`) + fallback de 10s
pra ops de git externas. A letra usa a **mesma lógica do painel** (`fileFlag`: working ‖ index ‖ '?') e as cores
reusam os tokens `--status-warning/success/error/info` (tree e painel Dagr sempre concordam). Rows: folders view
= `.file-tree-item[data-path]` (badge no `.file-item`), files view = `.verilog-file-item[data-file-path]` (badge
no `.verilog-file-info`). Arquivos: `js/tree/git_decorations.js` (novo), `js/app/renderer.js` (import),
`css/tree/file_tree.css` (badge + tint). 253 unit + ESLint + `tsc --noEmit` + `vite build` verdes.
**Verificação ao vivo do usuário pendente.**

### 14.16 G1 — APIs de git completas para a IA — 17/06/2026 — FEITO
A IA ganhou acesso completo ao controle de versão do projeto aberto (mesmo backend do painel Dagr). Namespace
`git` novo no `AuroraAPI` (`js/api/aurora_api.js`) — wrappers finos sobre `window.gitAPI` (main/ipc/git.js /
simple-git), com um `gitCall()` que normaliza erros + o caso "não é repo". **14 tools** em `main/ai/tools.js`:
**read** (rodam direto) — `git_status`, `git_log`, `git_branches`, `git_diff`; **write** (passam pelo card
Allow/Deny) — `git_stage`, `git_unstage`, `git_commit`, `git_discard`, `git_create_branch`,
`git_switch_branch`, `git_fetch`, `git_pull`, `git_push`, `git_stash`. Todas erram com mensagem clara se o
projeto aberto não é um repo git. Documentadas em `docs/aurora-intelligence-tools.md`. **Aditivo** (não muda
comportamento existente; falha de tool é isolada). 253 unit + ESLint + `tsc --noEmit` + `vite build` verdes.

### 14.17 Fechamento da sessão (17/06/2026) — feito, adiado, e o estado do merge → `main`

**Feito nesta sessão** (tudo commitado + pushed em `feature/aurora-revamp`, verde por ESLint/tsc/knip/253
unit/vite build):
- Rename de projeto da IA robusto (job + verdito final) — §14.9 (`75afc52`).
- Imagens voltam ao modelo + anexo persiste ao reabrir + glow do painel na 1ª msg — §14.10 (`3395951`).
- LaTeX `\text`/chaves aninhadas + IA roda fora da pasta do projeto (destrava rename mid-turn) — §14.11 (`6a01ddb`).
- Error boundary ignora cancelamento benigno do Monaco — §14.12 (`e4aea07`).
- File tree clicável após rename — §14.13 (`a366ac3`).
- Dagr — nome + fonte Norse (download no bootstrap) + marca d'água — §14.14 (`1b2c3c3`/`bc9d5cd`/`a268edc`).
- Decorações de status git na file tree (VS Code, ambas as views) — §14.15 (`d2aa1d8`).
- G1 — APIs de git completas para a IA (namespace + 14 tools) — §14.16 (`e5c9a24`).
- B4 — guard de CI contra `.js` gerado commitado (`d9be9a7`); B10 — cobertura + Codecov + badge (`b2d9b2f`).

**Adiado — precisa de teste ao vivo (risco de UI quebrada, não subir no escuro):** `<aurora-statusbar>` ao
vivo, `<aurora-tabs>` passo 2, B12 (CLIs de IA sob demanda). **Adiado — features grandes (binário/design):**
O2 Verible LSP, O11 slang-server, O1 Surfer WCP/embed, O9 DigitalJS. **Descartado (baixo valor/já feito):**
codemod base→semantic (tema único), `ai_assistant.css` (já token-based), P6 (não-jank), O14 WaveDrom.
**Bloqueado — externo/manual:** B2 code signing (SignPath), mídia do README, toggles do GitHub
(Discussions/secret scanning/topics) + merge do PR de release, conectar o repo no Codecov.

**Estado do merge `feature/aurora-revamp` → `main`:** a feature está **244 commits à frente** da main, e a
**main está 8 commits à frente** (trabalho paralelo: `split tools.js` em per-namespace, `split prism.js` e
`split project.js` em módulos, `ProjectTreeManager` pure-constructor + 3 arquivos de teste). O merge dá **3
conflitos modify/delete**: `main/ai/tools.js`, `main/ipc/prism.js`, `main/ipc/project.js` — arquivos que a
main DELETOU (viraram módulo) e a feature MODIFICOU. Não é trivial: exige **portar** as mudanças da feature
pra nova estrutura modular da main (ou descartar um dos lados). **Pendente de decisão** — alternativas
discutidas com o usuário (preservar ambos via merge-main-into-feature + port; vs `main = feature` descartando
as refatorações; vs PR).

### 14.18 Grupo B — testes (recuperados + novos) + extração do namespace git — 17/06/2026 — FEITO
**B1 — testes recuperados:** os 4 arquivos de teste que saíram no `main = feature` (monacoPin,
gtkwPickerManager, fileTreeViewController, projectTreeRender) foram recuperados da tag
`main-pre-revamp-20260617`, + `happy-dom` (env DOM dos testes de file tree) reinstalado. Os 4 passam contra o
código atual **sem adaptação** (31 testes) — os invariantes que eles fixam continuam valendo na `main` atual.

**B2 — testes novos + refactor de testabilidade:** `git_decorations.js` ganhou uma função PURA exportada,
`computeDecorations(files, root)` (mapa path→letra + rollup de pastas), testada em `gitDecorations.test.js`
(8 testes, env node). O namespace `git` do AuroraAPI foi **extraído** de `aurora_api.js` (que importa monaco e
por isso é intestável isoladamente) pra `js/api/git_ns.js` standalone — testado em `gitNs.test.js` (9 testes:
shaping do status, validação de commit/branch, not-a-repo, bridge ausente, normalização de files). Bônus: um
passo mínimo do A2 (aurora_api.js encolheu ~64 linhas). Suíte: **301 testes** (era 253). ESLint + `tsc` +
`vite build` + coverage verdes.

### 14.19 Codecov (parcial, bloqueado em permissão de org) + CI vermelho num E2E pré-existente — 17/06/2026

**Codecov:** o `ci.yml` passou a usar `token: ${{ secrets.CODECOV_TOKEN }}` no `codecov/codecov-action@v5` e o
usuário adicionou o secret. **Pendência (externa):** a conta do usuário no Codecov só enxerga o
`Chrysthofer/Aurora` (repo pessoal), mas o CI roda no `nipscernlab/aurora` — token é por-repo, então a
cobertura cai no projeto errado e o badge (que aponta pro `nipscernlab/aurora`) não enche. Pra resolver, o
**app do Codecov tem que ser instalado na org `nipscernlab`** (ação de dono da org). Codecov é OPCIONAL — a
cobertura sai em todo CI no log (~62% linhas) independente disso. No log do run dá pra ver o passo "Upload
coverage to Codecov" rodando (com `fail_ci_if_error:false`, ele nunca quebra o CI).

**CI vermelho — pré-existente, NÃO desta sessão:** o passo "E2E (Electron smoke)" falha em
`tests/e2e/split-pane.test.js` › "PRISM open-at-line": abre um arquivo de 300 linhas e espera o editor pular
pra linha 180, mas ele fica na **linha 1** (o `revealPosition` do `addTab` não dispara). Confirmado
pré-existente: o `tab_manager.js` mudou ~185 linhas entre a main antiga (que passava) e a branch do revamp, e o
teste ficou mais rígido (de-flake da Wave D, com assert de visibilidade). Entrou na main pelo `main = feature`;
o código do reveal **não foi tocado nesta sessão** (último toque: `f357b42`). É bug real do "abrir na linha" do
PRISM, precisa de diagnóstico ao vivo (Electron) → grupo C. **Resolução (18/06): NÃO é bug.** O usuário
verificou no app que o "abrir na linha" funciona (Ctrl+Shift+F / erro do terminal / PRISM → cai na linha
certa). O teste falha **só no CI headless** (editor criado mas cursor fica na linha 1; o poll de 12s já é
generoso, então não é slow-settle — é corrida de layout/timing do headless pós-revamp do `tab_manager`). Fica
**`it.skip`** pra manter o CI verde; re-habilitar exige depurar o ambiente do CI e é **baixa prioridade** (o
recurso em si está OK).

**Codecov — FUNCIONANDO (18/06):** o app foi instalado na org `nipscernlab` e o `nipscernlab/aurora` aparece
no Codecov com **68.47%** de cobertura na `main` (1392/2033 linhas, commit `2a2f390`). A org habilitou upload
**sem token** (tokenless), então o `CODECOV_TOKEN` virou opcional — fica no `ci.yml` como reforço. Badge do
README enche no próximo refresh/CI. B10 100% fechado.

### 14.20 Re-análise do plano (18/06) + reclassificação da status bar — 18/06/2026
Re-análise multi-agente de todos os docs cruzada com o código real → **snapshot atual e limpo** no
§17 (ex-`BACKLOG_RECONCILIADO.md`) ("Estado em 18/06", que agora **vence** a régua §13 desatualizada — done checado +
aberto ordenado fácil→difícil). Conclusões: o **tier fácil está essencialmente esgotado** — a remoção de CDN já
estava feita (o `index.html` é 100% local, sem CDN), e Codecov + re-habilitar o E2E são externos/CI. A
**`<aurora-statusbar>` foi reclassificada de fácil → médio**: o componente que existe é só protótipo (exercitado
só no Design Lab), com API simplificada; a barra real tem **8 indicadores** que ele não cobre (status de
compilação, GitHub/Source Control, controle de zoom, e os estados "falta top-level/testbench/processador" com X
vermelho), pintados por **5 drivers** (`status_bar.js`, `zoom.js`, editor p/ Ln/Col, `git_panel.js`, status de
compilação). Uma troca completa estende o componente + religa os 5 drivers, com risco visual → **precisa teste
ao vivo**, não é quick-win.

### 14.21 E2E "PRISM open-at-line" RE-HABILITADO — era isolamento de teste, não bug — 18/06/2026
Re-habilitei o E2E (`split-pane.test.js`, `it.skip` → `it`) depois de **reproduzir a falha localmente** (não era
só CI). Causa raiz: **isolamento de teste**, não a feature. Os testes de split-pane acima deixam um split pane
focado; aí a `addTab` (`tab_manager.js` ~1031) roteia o arquivo novo pro split focado (`openInFocusedPane`, que
NÃO roda `revealPosition`) e retorna **antes** do reveal — por isso abria na linha 1. No app real o painel
principal está focado, então sempre funcionou. **Fix: 100% no teste** — `window.SplitEditorManager.setFocus(0)`
antes do `addTab`, resetando o foco pro painel principal; **zero mudança em produção** (revertí as tentativas no
`tab_manager`). E2E **9/9**, unit **301/301**. Diagnóstico foi rápido porque os E2E rodam o Electron real
localmente (`npm run test:e2e`) — não precisou iterar no CI. **Tier 1 (fácil) fechado por completo.**

### 14.22 `<aurora-statusbar>` ligado ao vivo (thin shell) — 18/06/2026 — FEITO (primeiro do Tier 2)
A status bar agora é o componente `<aurora-statusbar>` ao vivo, com a MESMA estratégia thin-shell dos
`<aurora-tabs>`/`<aurora-terminal>`: o `<div class="status-bar">` virou `<aurora-statusbar class="status-bar">`
(mesma classe → o CSS de grid/chrome de `css/base/layout.css` estiliza o host **igual a antes**, e o
`document.querySelector('.status-bar')` do `resize.js` continua achando), e o shadow do componente é um único
`<slot>` que passa as zonas/itens light-DOM sem mexer. **Os 8 indicadores e os 5 drivers continuam funcionando
sem alteração** (status_bar.js por id, zoom.js, editor Ln/Col, git_panel.js do GitHub, status de compilação).
A versão property-driven antiga virou o **fallback do `<slot>`** (renderiza só quando nada é slotado),
preservando o demo do Design Lab + a API de propriedades como alvo futuro. Arquivos:
`js/components/aurora-statusbar.js` (reescrito), `index.html` (tag trocada), `js/ui/status_bar.js` (import que
registra o componente). **Zero regressão**: ESLint + `tsc` + `vite build` + **301 unit** + **9 E2E** (o app
real sobe e funciona com a barra nova) verdes. **Verificação visual do usuário pendente.**

### 14.23 `<aurora-titlebar>` ligado ao vivo (sem Shadow DOM) — 18/06/2026 — FEITO
A barra de título virou o componente `<aurora-titlebar>`. No AURORA a títulobar **é a própria toolbar de cima**
(`#custom-titlebar`): título do projeto + ações + região de arrastar a janela + os controles min/maximizar/
fechar. Diferente da statusbar/tabs, esse componente **NÃO usa Shadow DOM**: a toolbar é a região
`-webkit-app-region: drag` da janela, com `no-drag` nos botões — manter os filhos em **light DOM** (sem
`<slot>`, sem fronteira de shadow) garante que o hit-testing de app-region do Chromium continue funcionando
**exatamente** como no `<div>` antigo (tanto o arrastar quanto os botões clicáveis). O `<div class="toolbar"
id="custom-titlebar">` virou `<aurora-titlebar class="toolbar" id="custom-titlebar">` — mesma classe/id, então
todo o CSS e o driver inline (`getElementById('custom-titlebar')`, dblclick→maximizar, win-min/max/close) ficam
intactos. O componente é um marcador semântico hoje (`class AuroraTitlebar extends HTMLElement {}`); render
declarativo (título reativo, detecção de plataforma) pode vir depois. Arquivos: `js/components/aurora-titlebar.js`
(novo), `index.html` (tag), `js/app/renderer.js` (import que registra). **Zero regressão**: ESLint + `tsc` +
`vite build` + **301 unit** + **9 E2E** (o app real sobe e funciona) verdes. **Verificação visual do usuário
pendente** (confirmar que a janela arrasta e os 3 botões funcionam).

### 14.24 Acessibilidade do `<aurora-modal>` / `<aurora-toast>` (passo 2) — 18/06/2026 — FEITO
Fechei os buracos de a11y dos componentes que já existiam (o que já tinham: `role="dialog"`+`aria-modal`, ESC,
`inert` quando fechado, foco inicial). **Modal — `aurora-modal.js`:** adicionei **focus-trap** — ao abrir, todo
elemento top-level (os modais são filhos diretos de `<body>`) que não seja o modal vira `inert`, então Tab e
leitor de tela não escapam pro fundo; **devolução de foco** — guarda o elemento que abriu o modal e devolve o
foco a ele ao fechar; e movi o foco-inicial pra rodar em **todos** os caminhos de abertura (`el.open`, classe
`.show`, classe `.visible`) via o MutationObserver, não só no setter. Modais empilhados aninham certo (cada um
inerta tudo, fechar o de cima restaura o de baixo); só des-inerto o que eu inertei (um modal fechado segue
inert pelo P17). **Toast — `aurora-toast.js`:** `role` + `aria-live` no host — `alert`/`assertive` p/
erro/warning, `status`/`polite` p/ sucesso/info, `aria-atomic` — pro leitor de tela anunciar o card quando
aparece. **Zero regressão**: ESLint + `tsc` + `vite build` + **301 unit** + **9 E2E** verdes. **Verificação ao
vivo pendente** (abrir um modal, dar Tab — não deve sair dele; ESC/✕ fecha e o foco volta pro botão que abriu).

### 14.25 G4 — auditoria de i18n + command-palette (já estava pronto) — 18/06/2026 — FEITO
**G4 (i18n):** criei `scripts/check-i18n.js` — uma auditoria que confere (1) **EN/PT em sincronia** (toda chave
em `en.json` existe em `pt.json` e vice-versa) e (2) **referências sem definição** (`data-i18n*` / `window.t` /
`tt` que não resolvem em `en.json`). Rodando, o estado já era bom: EN/PT em sincronia, só **5 chaves
referenciadas sem definição** (`toolbar.git.tooltip`, `modal.git.title`, `modal.settings.aboutThirdParty`
+`Text`+`Note`). Adicionei as 5 em EN + PT → **661 chaves, em sincronia, tudo definido**. O script virou
**guard de CI** (passo "i18n consistency" no `ci.yml`). (O `path.to.key` era exemplo de comentário no
`i18n.js` — excluído do scan.)

**Command-palette:** a análise dizia "esqueleto, precisa de registry/keybinding" — **estava errada**. Conferindo
o código, `js/ui/command_palette.js` já tem o registry completo (~20 comandos agrupados Compile/Project/View/
Tools/Dev), fuzzy scoring, navegação por teclado e os atalhos Ctrl+Shift+K/P; o `<aurora-command-palette>` já
tem a view completa (input + lista + grupos + seleção); e é **carregado no boot** (`<script src=".../
command_palette.js">` no `index.html`, linha 1380). Ou seja, **já estava completo + ligado** — só não tinha
sido verificado. O único "a mais" seria um localizador de arquivos Ctrl+P (feature separada, não pedida).
**Verificação ao vivo pendente** (Ctrl+Shift+P abre a paleta). Build + 301 unit + ESLint verdes.

### 14.26 Handoff (migração de máquina) + fix do guard de i18n — 18/06/2026
Preparando a migração da conversa pra outra máquina: snapshot do estado + seção **"Handoff 18/06"** no
§17 (ex-`BACKLOG_RECONCILIADO.md`) (convenções, pendências do usuário, próximos passos). No caminho, peguei **dois
problemas**: (1) 3 `.js` gerados de wave (`complex_decode`, `event_markers`, `surfer_layout_writer`) tinham
vazado pro index — des-stageados (são gitignored); (2) o `check-i18n.js` **falhava num falso positivo** — ao
ser commitado, passou a se varrer e o regex pegou o `…` do exemplo `window.t('…')` no próprio comentário (ia
quebrar o CI). Fix: filtro de formato de chave (`/^[A-Za-z][\w.-]*$/`, descarta o `…`) + exclusão dos arquivos
-meta (`i18n.js`, `check-i18n.js`) do scan. Guard volta a passar (661/661). Tudo na `main`, verde.

### 14.27 F1 (ícones) + F2 (fonts) fechados — eram quase-prontos, rótulos desatualizados — 18/06/2026
Primeira sessão na máquina nova. Antes de qualquer coisa, **sincronização do clone**: este clone estava parado em
`de38e4a` (8 commits locais de split de god-files = A2, nunca publicados) enquanto o `origin/main` já tinha
avançado 267 commits (todo o trabalho de statusbar/titlebar/a11y/i18n do §14.22–14.26). Os 8 commits A2 foram
**preservados** num branch+tag de backup local (`backup/a2-godfiles-de38e4a` / `shelf-a2-godfiles-2026-06-18`) e a
`main` local foi alinhada ao `origin/main` (`reset --hard`). Como o backlog já registrava que esses 8 commits
foram conscientemente descartados (e o `origin/main` ainda tem os god-files monolíticos — A2 segue "Radical"
aberto), o alinhamento foi o caminho certo.

**Reconhecimento dos próximos itens "Médio" cruzado com o código real** mostrou o mesmo padrão de
command-palette/CDN (§14.25): os rótulos estavam desatualizados e os dois próximos já estavam essencialmente
prontos.

**F1 — consolidar ícones (Phosphor, tirar FontAwesome):** a IDE já é 100% Phosphor (`@phosphor-icons/web`,
vendorizado local em `dist/vendor/phosphor` pelo `vite-plugin-static-copy`) + SVG inline nos botões de compile
(`glyph-cpm` etc.). Não havia **nenhum** uso real de FontAwesome — as 6 ocorrências de `fa-` no grep eram
comentários (ex.: o aviso histórico no `terminal_module.js` sobre o botão de trash migrado pra `ph-trash`) ou
regex de hexadecimal (`[0-9a-fA-F]`). FontAwesome também já **não era dependência** (`npm ls` → vazio; só sobrava
um diretório órfão vazio em `node_modules/@fortawesome`). O único resíduo real eram **2 linhas mortas de
exclusão** no `files` do `package.json` (`!node_modules/@fortawesome/fontawesome-free/{less,metadata}/**`),
apontando pra um pacote inexistente — **removidas**. O órfão saiu sozinho no `npm ci`.

**F2 — fonts 100% local (verificar):** confirmado, nada a mudar. `css/base/fonts.css` declara Inter e
JetBrains Mono como woff2 **variáveis** locais (`../../assets/fonts/*.woff2`, os 4 arquivos presentes), é o
**primeiro** `@import` do `import.css` (antes de qualquer uso) e não há `@import`/`<link>` remoto ativo em lugar
nenhum (só comentários + o `scripts/fetch-fonts.js`, que é build-time). O `vite build` resolve os `url()` e emite
`inter-latin`, `inter-latin-ext`, `jetbrains-mono-latin`, `jetbrains-mono-latin-ext` + `fonts-*.css` em
`dist/assets` — prova de que carregam offline, sem rede no primeiro paint.

**Green bar local (tudo verde):** check-pinned-versions, check-no-generated-js (384 arquivos), check-i18n
(661/661), `tsc --noEmit`, ESLint (`--max-warnings=0`), `deadcode` (knip), **301 unit**, `vite build`, **9 E2E**
(Electron real sobe e funciona). Mudança de repo: só `package.json` (−2 linhas). Sem risco visual (nenhuma
mudança de DOM/CSS) — não precisa de teste ao vivo seu.

### 14.28 B12 — CLIs de IA sob demanda (sai ~457MB do instalador) — 18/06/2026 — FEITO
A AURORA empacotava dois binários nativos pesados pra os provedores de assinatura funcionarem "out of the box":
`@anthropic-ai/claude-code` (claude.exe de 229MB) e `@openai/codex` (vendor de 239MB, com ripgrep). Eles iam no
`asarUnpack`. Agora **saem do build empacotado** e são **baixados sob demanda no 1º uso**. Continuam como
`dependencies` no `package.json` (dev/CI/testes resolvem do `node_modules` igual a antes, via `require.resolve`)
— só o **instalador** fica ~457MB menor, o que casa com a história de distribuição/SmartScreen (B2).

**Como funciona.** No 1º turno de chat contra um provider de assinatura (ou no gerador de harness one-shot do
Claude), se o exe não está nem no `node_modules` (dev) nem no cache de usuário, a AURORA baixa o **pacote de
plataforma** direto do registry npm, verifica a **integridade sha512**, extrai com `tar --strip-components=1`
pra `userData/cli-cache/<pkg>@<versão>/`, e roda dali. Nos turnos seguintes (e reinícios) o cache resolve sem
rede. Peças:
- **`main/ai/cli_manifest.js`** (novo) — fixa, por plataforma (hoje só `win32:x64`, o único alvo de build):
  pacote, versão, URL do tarball, integridade sha512 e o caminho do exe (Claude: `@anthropic-ai/claude-code-
  win32-x64` → `claude.exe`; Codex: o alias `@openai/codex-win32-x64` → `@openai/codex@<ver>-win32-x64`, exe em
  `vendor/x86_64-pc-windows-msvc/codex/codex.exe` + ripgrep em `.../path`).
- **`main/ai/cli_downloader.js`** (novo) — `ensureCli(kind,{onProgress})` (download com redirects + progresso +
  **timeout de socket**, verificação de integridade ANTES de extrair, cache idempotente, dedupe de chamadas
  concorrentes, **prune** de versões antigas), `cachedLocation`, `isDownloadable`, `installPaths`. Cache root:
  `AURORA_CLI_CACHE` (testes) > `userData` (Electron) > `os.tmpdir`.
- **`main/ai/cli_locator.js`** — ganhou um **passo 0** que olha o cache de download antes do `require.resolve`
  bundled, e `invalidate()` pra reescanear após baixar.
- **`claude_code.js` / `codex_cli.js`** — `detect()` agora reporta `{installed:false, downloadable, authed}`
  quando não há exe (lê as credenciais mesmo sem binário, pra não baixar 230MB e só então falhar por login);
  `start()` checa login primeiro, baixa sob demanda emitindo eventos `cli-download` de progresso, e o codex
  re-prima seu `cachedBin`.
- **`ai_assistant_manager.js`** — gate de envio relaxado pra `downloadable && authed`; status do painel mostra
  "Downloads on first message"; o chat mostra "Downloading … X% · MB/MB" via um caso `cli-download`.
- **`package.json`** — `asarUnpack` removido; os dois pacotes (e os de plataforma) excluídos do `files`.
- **`scripts/check-pinned-versions.js`** — guard de CI: as versões do manifest têm que acompanhar o
  `package.json`, **e** a integridade/tarball têm que bater com o `package-lock.json` (offline) — pega o erro
  clássico de "bumpou a versão e esqueceu de atualizar o hash", que quebraria 100% dos downloads em produção.
  Nota (18/06): os deps dos CLIs (`@anthropic-ai/claude-code`, `@openai/codex`) viraram **pin exato** (sem `^`)
  porque o manifest pina exato — com `^`, um `npm install` qualquer re-resolvia pra última do range
  (claude-code 2.1.144→2.1.181) e o guard barrava o `npm start`. Pin exato mantém manifest↔lockfile↔deps alinhados.

**Revisão adversarial multi-agente (18 agentes, 14 candidatos → 6 reais) — todos corrigidos:**
1. *(alto)* `downloadToFile` sem timeout: conexão que trava no meio pendurava a Promise pra sempre **e
   envenenava o dedupe `inFlight`** (retry impossível até reiniciar). → `req.setTimeout(60s)` que destrói com
   erro, liberando o dedupe.
2. *(médio)* bump de versão sem refresh do hash passava no CI e quebrava o download em runtime. → cross-check
   da integridade/tarball contra o `package-lock.json`.
3. *(baixo)* dirs de versões antigas nunca eram limpos (vazamento de disco no upgrade). → `pruneStaleVersions`
   best-effort após install.
4. *(baixo)* status ficava em "Downloads on first message" até re-check manual. → `refreshSubStatus()` no fim do
   download.
5. *(alto)* linha de progresso órfã no Stop/stall + **reuso de nó destacado** (próximo download renderizava
   invisível). → `_clearCliDownload()` no chokepoint `resetTurnState()` + guard `isConnected`.
6. *(baixo)* janela sem indicador entre fim do download e 1º token (parecia travado). → `showThinking(true)` no
   `done`.

**Green bar local (tudo verde):** check-pinned-versions (+ integridade vs lockfile), check-no-generated-js,
check-i18n (661/661), `tsc --noEmit`, ESLint, `deadcode`, **310 unit** (9 novos em `cliDownloader.test.js`:
manifest, integridade, cache hit/miss — o download real de rede é validado ao vivo), `vite build`, **9 E2E**.
O download fim-a-fim (rede + 230MB) foi **validado ao vivo pelo usuário** ("tudo funcionando").

### 14.29 O9 — DigitalJS: simulação interativa no PRISM (modo "Simular") — 18/06/2026 — FEITO
O rótulo do backlog ("O9 = netlistsvg, já é dependência") enganava: o **esquemático estático já é o PRISM**
(Yosys `write_json` + `@silimate/netlistsvg` → SVG, janela própria, navegação por módulo). O **O9 de verdade**
(pelo §315) é **simulação visual interativa** — o usuário toggla entradas, vê sinais propagarem, passa o clock.
Decisão do usuário: **DigitalJS completo, dentro da janela PRISM**, com toggle "Esquemático ↔ Simular".

**Arquitetura.**
- **Main (`main/ipc/prism.js`):** `collectSynthFiles()` (coleta os `.v` — espelho enxuto e standalone da
  coleta do `runYosysCompilationWithPaths`, que ficou **intocado** pra não arriscar o esquemático) +
  `buildDigitalJSCircuit()` roda o **yosys nativo (allowlisted) da AURORA** com um script word-level
  (`hierarchy -top; proc; opt_clean; memory -nomap; wreduce -memx; opt_clean; write_json`) e converte o JSON com
  `require('yosys2digitaljs/core').yosys2digitaljs(json,{})` — a função **pura** de convert, sem precisar de
  yosys no PATH (o `process_files` do yosys2digitaljs usa `timeout`/PATH, Linux-only). Novo IPC
  `prism:build-digitaljs` → `{ ok, circuit, topLevelModule }`.
- **Preload:** `buildDigitalJS()` no allowlist enumerado (sem passthrough).
- **Renderer (`prism.js`):** `import { Circuit } from 'digitaljs'`; toggle na toolbar; `enterSimMode()` busca os
  paths + chama o IPC, depois `new Circuit(json, { layoutEngine: 'dagre' }).displayOn(host).start()`. **Decisão
  de design que matou o maior risco:** o `Circuit` já usa o **`BrowserSynchEngine`** (síncrono) por padrão, e
  `layoutEngine: 'dagre'` (em vez do `elkjs`, que exige Web Worker) → **zero Web Worker**, então o digitaljs
  bundla limpo no Vite e roda sob `file://`. Interatividade (toggles, clock, monitores) vem pronta do digitaljs.
- **Bundle:** o Vite empacota o digitaljs no chunk do PRISM (~2MB, carregado só quando a janela abre; o elkjs
  entra mas nunca instancia worker). A CSP existente já permite (`script-src`/`style-src 'unsafe-inline'`).

**Revisão adversarial (13 agentes, 10 candidatos → 6 reais; nenhum tocava o esquemático — corrigidos):**
1. *(médio×3)* sem guard de re-entrância: clicar "Simular" 2× durante o build (yosys leva segundos) disparava
   builds concorrentes (yosys duplicado, race em `this.circuit`/tempDir). → flag `_simBusy` + `try/finally` +
   botão desabilitado durante o build.
2. *(baixo)* handlers de teclado/Ctrl-wheel/context-menu/resize agiam no esquemático escondido em modo Sim. →
   early-return quando `simMode` (mantendo Ctrl+R/recompile).
3. *(baixo)* o paper do JointJS não era destruído (soft leak de view/listeners por ciclo enter/exit). → capturo
   `this._paper` e chamo `remove()` no `_destroyCircuit`.
4. *(baixo)* o overlay de status vivia dentro do `#svgContainer` escondido → erros em modo Sim ficavam
   invisíveis. → movido pra `.main-content` (irmão dos dois surfaces).

**Green bar local (tudo verde):** ESLint, `tsc --noEmit`, check-i18n (661/661), check-no-generated-js,
check-pinned (+ integridade vs lockfile), `deadcode` (knip vê digitaljs + yosys2digitaljs como usados),
**310 unit**, `vite build` (digitaljs bundla; sem worker em runtime), **9 E2E**. O render + simulação do
DigitalJS em si (Yosys→convert→circuito vivo) é **validado ao vivo pelo usuário**: abrir PRISM → "Simular".

**Fix pós-teste (regressão pega ao vivo).** O `import { Circuit } from 'digitaljs'` no topo do `prism.js` fazia o
digitaljs — e o **jquery-ui** que ele puxa, que referencia o **global `jQuery`** — avaliar no carregamento do
módulo. O Vite não expõe `jQuery` global → `ReferenceError: jQuery is not defined` quebrava o **módulo inteiro do
PRISM** (até o esquemático), travando em "Compiling RTL design…". O E2E não abre a janela PRISM, por isso passou
verde. **Correção:** o digitaljs virou **lazy** (`_loadDigitalJS()`, `await import('digitaljs')` só ao entrar em
"Simular"), com `window.jQuery`/`window.$` setados **antes** do import. Agora o esquemático nunca avalia o
digitaljs (uma falha não o quebra) e o chunk do PRISM voltou de ~2MB pra ~23KB (digitaljs/jquery sob demanda).
`jquery` declarado como dependência direta. Green bar + lazy-split confirmados.

### 14.30 G6 — governança de modelos de IA (robustez + tokens por conversa) — 18/06/2026 — FEITO
Escopo escolhido pelo usuário: **completo (a robustez + b indicador de tokens), tokens sem custo em $**.

**(a) Robustez de modelo.** Hoje `DEFAULT_MODELS` é hardcoded + `Object.freeze`, e um id de modelo aposentado/
renomeado **falhava em runtime sem fallback**, com mensagem críptica do SDK. Em `main/ai/provider.js`:
- **`resolveModelId(provider, requested)`** — `''`/`'default'`/`'latest'` → o padrão atual do provider; id
  conhecido-aposentado → seu substituto via **`MODEL_MIGRATIONS`** (mapa por provider, semeado vazio mas é o
  gancho pra renomeações futuras); qualquer outro → passa direto. O `getModelFor` agora resolve por aqui.
- **`isModelUnavailableError(e)`** — heurística que detecta "id de modelo ruim": status 404, OU mensagem/corpo/
  `code` contendo "model" + um token de falha (`not_found`/`does not exist`/`deprecated`/`unknown`/`invalid`/…,
  com separador `_`/`-`/espaço — pega o `model_not_found` do OpenAI, que vem com status 400). O requisito do
  token de falha mantém fora os falsos positivos (rate limit, chave inválida, overloaded).
- **Auto-fallback** nos caminhos de chamada única (`testConnection`, `generateOneshot` — `generateText` sem
  loop): ao detectar erro de modelo, **uma** nova tentativa com o padrão do provider, reportando `fellBackFrom`.
- **Caminho de streaming do chat (`chat.js`):** resolve o modelo via `resolveModelId`; o `modelKey` foi içado
  pra fora do `try` pra o `catch` poder citá-lo; no erro de modelo, troca a mensagem críptica por uma
  **acionável** ("o modelo X não está disponível… troque pelo padrão Y no menu"). **Decisão consciente:** o
  loop de streaming (caminho mais crítico) **não** foi refatorado pra auto-retry — alias + mensagem acionável
  cobrem os casos, sem arriscar o chat que o usuário testa só no fim.

**(b) Indicador de tokens por conversa (sem $).** O *counter* por conversa **já existia** (pill
`#ai-token-counter`, `cumulativeTokens` persistido em `conversations.js`). O incremento foi torná-lo visível na
lista: `listAll()` agora inclui `cumulativeTokens` e o `renderChatList()` mostra um badge "· N tok" por conversa
(omitido quando 0). Sem custo em $ (decisão do usuário) — zero manutenção de tabela de preços.

**Revisão adversarial (2 revisores focados):** **nenhum bug real**. Verificaram: a mudança do `getModelFor` é
segura (só transforma ids que nunca foram válidos); o auto-retry não dupla-cobra (só no `catch`), é limitado a 1
tentativa e gated por `def !== model` + erro-de-modelo; o `modelKey` içado está seguro no `catch` (o branch
acionável só dispara em erro de modelo, não em "no api key"); a Parte B é sempre numérica (`Number()||0`) e sem
XSS. O único ponto (otimização perdida: `model_not_found` com underscore + status 400) foi **incorporado** ao
fortalecer a heurística.

**Green bar local (tudo verde):** ESLint, `tsc --noEmit`, check-i18n (661/661), check-no-generated-js,
check-pinned, `deadcode`, **316 unit** (6 novos em `modelGovernance.test.js`: resolveModelId + a heurística),
`vite build`, **9 E2E**. Comportamento ao vivo (fallback real num id aposentado, badge de tokens na lista) é
**validado pelo usuário**.

### 14.31 O9 — endurecimento nos testes ao vivo + UX do "Simular" — 18/06/2026 — FEITO
O O9 passou no green bar mas **o E2E não abre a janela PRISM**, então vários problemas só apareceram no teste ao
vivo do usuário. Sequência de correções (todas verdes + commitadas):

1. **PRISM nem carregava** (`e3905f8`): o `import { Circuit } from 'digitaljs'` no topo do `prism.js` avaliava o
   digitaljs (e o jquery-ui) no load do módulo; o jquery-ui referencia o `jQuery` global, que o Vite não expõe →
   `ReferenceError: jQuery is not defined` quebrava o módulo INTEIRO do PRISM (até o esquemático). Fix: digitaljs
   virou **lazy** (`_loadDigitalJS`, `await import('digitaljs')` só no "Simular"), com `window.jQuery` setado
   antes. O chunk do PRISM voltou de ~2MB pra ~23KB.
2. **"Simular" travava** (`f64b515`): o convert `yosys2digitaljs` é **síncrono no processo main** → num netlist
   grande congela o app. Fixes: **timeout de 45s** no yosys + **guard de tamanho** (recusa > 3000 células com
   mensagem clara) + erro auto-some no renderer.
3. **`npm start` bloqueado** (`b8fedce`): ao adicionar o `jquery` como dep, o `npm install` re-resolveu o
   `@anthropic-ai/claude-code` de `^2.1.144` → 2.1.181 no lockfile, e o guard do B12 barrou (manifest pina
   2.1.144). O guard fez o trabalho dele; a correção durável foi **pinar os CLIs exatos** (sem `^`) — alinhado
   com o manifest. (Ver nota no §14.28.)
4. **Logs de fase** (`5d34570`): instrumentei a build do DigitalJS (yosys/convert/render) no terminal pra
   diagnosticar onde trava — yosys e convert são rápidos (processador SAPHO: 90 células, convert 14ms); o gargalo
   real em designs grandes é a escala (daí o guard).
5. **"e.widget is not a function"** (`52696d9`): num design pequeno, o render falhava — o jquery-ui (dialog)
   chama `$.widget` no load, mas a fábrica não estava anexada ao jQuery global a tempo. Fix: carrego o
   **jquery-ui completo** (`jquery-ui/dist/jquery-ui.js`) no global ANTES do digitaljs. jquery-ui declarado como
   dep. **Aqui o "Simular" passou a funcionar de verdade** (validado pelo usuário num full adder).
6. **UX da área de trabalho** (`723f528`, `dd05884`, `32d7ac8`): o usuário pediu polish:
   - **Rótulos limpos** — `stripYosysLabels` no main blanka os nomes internos `$xor$<arquivo>:<linha>$n` (só o
     símbolo do gate fica; nomes de porta a/b/sum permanecem).
   - **Centralizar/zoom/pan/drag** com os MESMOS valores do esquemático (fator `exp(-deltaY*0.0016)`, clamp
     0.1–5, fit ~90%) — via transform CSS num `.djs-wrapper` em volta do paper, em estado separado (não toca o
     pan/zoom do esquemático). Botões Fit/＋/－/🏠 + roda + arrastar-vazio funcionam nos dois modos.
   - **Fundo uniforme** — forço o paper transparente (`!important`, vence o `joint-theme-default { #FFFFFF }`) →
     superfície única, sem a "caixa branca".
   - **Dígito 0/1/x ao vivo** em cada caixinha de I/O de 1 bit (`_buildValueOverlays`): overlay dentro do
     `.djs-wrapper` (acompanha zoom/pan), posicionado com `paper.localToPaperPoint` (considera o offset interno
     do paper), branco com contorno escuro (legível em qualquer fundo), atualizando a cada mudança de sinal.

**Conclusão O9:** o esquemático estático sempre foi o PRISM; o O9 adicionou a **simulação interativa** (DigitalJS)
no modo "Simular", agora funcional + polida em designs pequenos (o alvo do simulador didático). Designs grandes
(CNN, processador inteiro) dão mensagem clara "use a visão esquemática". **Validado ao vivo pelo usuário.**
Green bar a cada passo (ESLint, tsc, guards, 316 unit, vite build, 9 E2E).

### 14.32 O2 — Verible LSP (diagnostics + format + outline + hover + def/refs) — 19/06/2026 — FEITO (aguarda teste ao vivo)
Primeiro item do "Difícil". Liga o **language server do Verilog** (`verible-verilog-ls`, suite C++ Apache-2.0) ao
editor Monaco, dando pela primeira vez **diagnóstico semântico ao vivo** (lint + sintaxe) em `.v`/`.sv`, além de
formatação, outline, hover e ir-para-definição/referências.

**Decisões do usuário (AskUserQuestion):** binário **baixado no bootstrap** (estilo surfer, não sob demanda) +
escopo **completo** (todas as features que o Verible faz bem).

**Arquitetura — ponte LSP mínima e custom (NÃO `monaco-languageclient`)**, como o §7 (O6) já mandava: a AURORA já
tem IPC na mão e o Monaco é o build AMD vendorizado; uma ponte fina basta.
1. **`components/Scripts/download-verible.js`** — bootstrap (depois do surfer, antes do copy-components). Baixa o
   asset win64 da release `chipsalliance/verible` (pin `v0.0-4080-ga0a8d8eb` + **SHA-256** verificado), extrai e
   **poda tudo menos o `verible-verilog-ls.exe`** (3.3MB, vs ~25MB dos ~10 exes) em
   `components/Packages/verible/bin/`. Best-effort (exit 0 se falhar → editor cai pro highlight estático, sem erro).
2. **`main/lsp/verible_lsp.js`** — manager: spawna **um** LS de vida longa (`--lsp_enable_hover`
   `--rules_config_search`), fala **JSON-RPC framed por Content-Length** no stdio, `trackChild` (morre ao fechar a
   janela). Ciclo de vida **resiliente**: `start()` memoiza a promessa (nula no fracasso → retry, mantém no
   sucesso), `handleProcessGone` idempotente rejeita pendências, e o `openDocs` **persiste entre restarts** → um LS
   re-spawnado é **re-semeado** (re-`didOpen`) transparente. `didChange` usa **full-replace sem range** (o Verible
   anuncia sync incremental mas aceita — validado). Tudo no-op gracioso se o binário faltar. Gateado pelo
   `binary_allowlist` (entrada nova) antes do spawn.
3. **IPC `lsp:*`** (no próprio manager) + **`window.lspAPI`** no preload — `status/didOpen/didChange/didClose` +
   `format/documentSymbols/hover/definition/references` + push `onDiagnostics`.
4. **`js/editor/lsp_integration.js`** (renderer) — espelha o `setupCMMLanguage`: anexa no nível do **model** Monaco
   (`onDidCreateModel` → `didOpen`; `onDidChangeContent` debounced 350ms → `didChange`; `onWillDispose` →
   `didClose`), então splits que compartilham um model abrem o doc **uma vez**. Mapeia publishDiagnostics →
   `setModelMarkers` (LSP 0-based → Monaco 1-based) e registra os 5 providers. `initVerilogLSP()` é **try/catch**
   total — uma falha do LSP nunca quebra o boot do Monaco (lição do O9).

**`verilog`/`systemverilog` já vêm registrados no Monaco vendorizado** (só liguei os providers; highlight estático
fica pro O7 tree-sitter depois). Adicionei `.vh/.sv/.svh` ao mapa de linguagem (alinha com `split_editor.js`).

**Verificação empírica contra o binário real** (E2E não exercita o LSP — mesma lição do O9): handshake initialize →
capabilities completas (format, documentSymbol, hover, definition, references, documentHighlight, codeAction,
rename); `didOpen` válido → 0 diagnostics; `didChange` full-replace de código quebrado → 1 syntax error;
`format` de código feio → edits corretos; `documentSymbol` → módulo. **Mapeamento de coordenadas confere.**

**LIÇÃO:** a revisão adversarial (workflow) bateu no **limite de sessão** e não rodou — fiz a revisão manual + a
verificação empírica acima no lugar. Green bar completo (ESLint, tsc, 4 guards, 316 unit, vite build, 9 E2E) +
downloader validado de verdade (baixou, verificou SHA, podou, instalou). **VALIDADO AO VIVO pelo usuário** ("Funcionou").

### 14.33 Formatação C/C++/CMM via clang-format (Shift+Alt+F) — 19/06/2026 — FEITO (aguarda teste ao vivo)
Logo após o O2 o usuário pediu pra estender o Shift+Alt+F além do Verilog. **Não existe "formatar qualquer coisa"**
no Monaco — o atalho chama o `DocumentFormattingEditProvider` registrado pra linguagem do buffer em foco. Então
cada linguagem precisa de um provider. Escopo escolhido pelo usuário: **Verilog** (já era, via Verible), **CMM**
(formatar como C) e **C++**. Monaco despacha por linguagem **automaticamente** — só registrei o provider certo.

Pra C/C++/CMM o motor é o **clang-format** (mesma estratégia do Verible, mas mais simples — não é LSP, é CLI
one-shot stdin→stdout):
- **`components/Scripts/download-clang-format.js`** — bootstrap (depois do verible). Baixa o `.exe` estático avulso
  do `muttleyxd/clang-tools-static-binaries` (clang-format 20.1.0, pin `master-796e77c` + **SHA-256** verificado
  ANTES de promover o temp→bin, 2.7MB) em `components/Packages/clang-format/bin/`. Best-effort (exit 0).
- **`main/format/clang_format.js`** — IPC `format:clang`: spawna o clang-format, joga o buffer no stdin, devolve o
  stdout formatado. CMM usa regras de C via `-assume-filename=<dir>/<base>.c`; C/C++ usam o caminho real (detecta
  dialeto + acha um `.clang-format` do projeto, com `-style=file -fallback-style=LLVM`). Timeout 15s, gate de
  allowlist, `trackChild`, no-op se o binário faltar.
- **`js/editor/clang_format_integration.js`** — registra o provider de formatação pra `c`/`cpp`/`cmm`; troca o
  buffer inteiro (`getFullModelRange`) pelo texto formatado; no-op se já formatado ou se o backend devolve null.
  `initClangFormat` em try/catch total (não quebra o boot do Monaco), chamado no `initMonaco` após o `initVerilogLSP`.
- **preload** `window.clangFormatAPI`, **allowlist** + extensões C++ extras (`.cc/.cxx/.hh/.hxx`) no mapa de linguagem.

**Verificado empiricamente** contra o binário real: `clang-format --version` (20.1.0); formatou C (pra CMM), C++ e
um caso `-style=file -fallback-style=LLVM` sem `.clang-format` (cai pro LLVM, exit 0). Green bar completo (ESLint,
tsc, 4 guards, 316 unit, vite build, 9 E2E) + downloader rodado de verdade. **Falta o teste ao vivo do usuário.**

### 14.34 O11 — slang-server: análise SEMÂNTICA de SystemVerilog (diagnostics + completion) — 19/06/2026 — FEITO (aguarda teste ao vivo)
Segundo item do "Difícil". Liga o **slang-server** (hudson-trading/slang-server, LSP baseado na lib slang) ao
Monaco. Diferente do Verible (O2, sintático/per-file), o slang **elabora o design inteiro** → pega erros
semânticos que o Verible não vê (sinal não declarado, tipo/porta errados, sinal não usado, …) e oferece
**autocompletar** de símbolos.

**Decisões do usuário (AskUserQuestion):** (1) **meio-termo** — slang = diagnostics semânticos + autocompletar (os
ganhos únicos); Verible mantém hover/def/refs/outline/format (sem duplicação). (2) **toggle** — ligável/desligável
(slang elabora a cada mudança e pode ser ruidoso em design incompleto).

**Arquitetura** — reusa o padrão LSP do O2, mas o `verible_lsp.js` (validado ao vivo) ficou **intocado**; escrevi
um `slang_lsp.js` paralelo (zero risco de regressão no O2):
1. **`components/Scripts/download-slang-server.js`** — bootstrap (depois do clang-format). Baixa o asset win64 da
   release `hudson-trading/slang-server` (pin `v0.2.7` + **SHA-256**), extrai só o `slang-server.exe` (7.2MB) em
   `components/Packages/slang-server/bin/`. Best-effort.
2. **`main/lsp/slang_lsp.js`** — manager stdio JSON-RPC, mas com o que o slang exige a mais que o Verible:
   **workspace/rootUri** = pasta do projeto (slang indexa a árvore), **restart automático ao trocar de projeto**
   (`maybeRestartForProject` compara o `state.currentOpenProjectPath`), **enable/disable** (toggle → mata o server
   + limpa markers), e **resposta a requests servidor→cliente** (`workspace/configuration` → itens nulos;
   `registerCapability`/progress → null). Diagnostics → push `slang:diagnostics`; pede `textDocument/completion`.
   Ciclo resiliente igual ao Verible (restart re-semeia `openDocs`). Gate de allowlist, `trackChild`, no-op se o
   binário faltar ou o toggle off.
3. **IPC `slang:*`** + **`window.slangAPI`** no preload.
4. **`js/editor/slang_integration.js`** (renderer) — anexa no nível do model (didOpen/didChange debounced
   400ms/didClose), mapeia diagnostics → `setModelMarkers(model, 'slang', …)` (coexiste com `'verible'`), e
   registra **completion provider** (kinds LSP→Monaco, range do textEdit ou palavra atual, trigger chars
   `` ` # . ( : [ ``). **Toggle** persistido em `localStorage` (`window.AuroraSlang.toggle()`), com **atalho
   dedicado Ctrl+Alt+S** (no `shortcut_manager.js` — inclui Ctrl pra disparar com o editor Monaco focado; o
   Ctrl+Shift+P é do command palette) e entrada no **command palette** ("Toggle slang…") com toast; ao desligar
   limpa markers, ao ligar re-`didOpen` os buffers.
5. Wiring no `monaco_editor.js` após o `initClangFormat`.

**Verificado empiricamente** contra o binário real (E2E não exercita o LSP): handshake → capabilities completas
(completion/hover/def/refs/symbol/rename/inlay/callHierarchy); `didOpen` de `assign a = b;` → diagnostics
SEMÂNTICOS (`use of undeclared identifier 'b'`, `variable 'a' assigned but never used`) que o Verible não pega;
`textDocument/completion` dentro de `assign out = ` → 3 sinais em escopo (`clk, reset, out`); reply de
`workspace/configuration`. Green bar completo (ESLint, tsc, 4 guards, 316 unit, vite build, 9 E2E) + downloader
rodado de verdade. **Falta o teste ao vivo do usuário.**

**Estado das integrações de linguagem (resumo):** Verilog/SV → **Verible** (lint sintático, format, hover, def/refs,
outline) **+ slang** (diagnostics semânticos, autocompletar, toggle). C/C++/CMM → **clang-format** (Shift+Alt+F).

### 14.35 O7 — tree-sitter: highlight preciso (semantic tokens) p/ Verilog/SV/C/C++ — 19/06/2026 — FEITO (aguarda teste ao vivo)
Terceiro item do "Difícil" e a fase de highlighting. Usa **web-tree-sitter** (WASM) pra parsear o buffer e, via a
**highlights query (.scm)** de cada gramática, gera **semantic tokens** do Monaco que SOBREPÕEM o Monarch com cores
fiéis à gramática (nome de módulo vs instância, direção de porta, tipo, macro, …). Escopo escolhido pelo usuário:
**Verilog/SV + C/C++**. CMM/ASM não têm gramática tree-sitter → seguem no Monarch (inevitável).

**Pesquisa/de-risco (spikes em Node antes de qualquer linha de integração):**
- web-tree-sitter **0.26.9** (runtime WASM). Gramáticas pré-compiladas **.wasm**: SystemVerilog do
  `gmlarumbe/tree-sitter-systemverilog` v0.3.1 (cobre .v e .sv, **20,5MB**, ABI 15 ✓), C do `tree-sitter-c` v0.24.2
  (0,6MB) e C++ do `tree-sitter-cpp` v0.23.4 (3,3MB). O `tree-sitter-wasms` (npm) **não** tem verilog e suas
  C/C++ falham o ABI do 0.26 → usei os .wasm oficiais das releases (ABI compatível, validado).
- Validado de ponta a ponta: **carregar por BYTES** (`Parser.init({wasmBinary})` + `Language.load(bytes)`) — o
  caminho do renderer, sem fetch/URL; **query real** com a highlights.scm oficial (SV: 31 capturas corretas —
  `module`→keyword, `foo`→function, `wire`→type); C++ **herda** a query de C (`; inherits: c` → concateno c+cpp).

**Implementação:**
1. **`components/Scripts/download-tree-sitter-grammars.js`** — bootstrap: baixa as 3 .wasm (pin + **SHA-256** cada)
   pra `components/Packages/tree-sitter/` e copia o `web-tree-sitter.wasm` do node_modules (casa com o JS bundlado).
   Best-effort (exit 0 → cai pro Monarch). +`web-tree-sitter` 0.26.9 como dep (pin exato, guard reconhece).
2. **`main/treesitter/grammars.js`** — IPC `treesitter:status`/`treesitter:wasm(name)`: serve os BYTES de um
   conjunto fixo de nomes (runtime/systemverilog/c/cpp) — o renderer não pede caminhos arbitrários.
3. **`js/editor/treesitter_highlight.js`** — registra um **DocumentSemanticTokensProvider** p/ verilog/
   systemverilog/c/cpp. Lazy (carrega a gramática no 1º uso), parse → query.captures → semantic tokens. Cuidados:
   **byte(UTF-8)→coluna UTF-16 por linha** (fast-path ASCII) pra comentários acentuados (PT-BR) não deslocarem o
   highlight; **resolução de sobreposição** (mais específico/interno vence, sem overlap); **split de captura
   multi-linha** (block comment); mapa capture→tipo padrão (VS Code) p/ o tema colorir sozinho. Tudo em try/catch:
   se faltar wasm ou o runtime falhar, devolve 0 tokens e o Monarch fica (sem regressão).
4. **preload** `window.treeSitterAPI`; **wiring** no `monaco_editor.js` (após o slang) + opção de editor
   `'semanticHighlighting.enabled': true`. Queries `.scm` commitadas em `js/editor/treesitter/queries/` (import
   Vite `?raw`).

**CSP**: o `script-src` já tem `'unsafe-eval'` (loader AMD do Monaco) → cobre a glue Emscripten do web-tree-sitter
+ a instanciação WASM (de bytes, sem fetch). Sem worker (roda in-thread).

**Custo**: ~24,6MB de .wasm em `components/Packages/tree-sitter/` (a SV é 20,5MB) → entra no instalador
(extraResources), como os outros tools. Green bar completo (ESLint, tsc, 4 guards, 316 unit, vite build, 9 E2E) +
downloader rodado de verdade (baixou, verificou SHA, copiou runtime). **Falta o teste ao vivo do usuário.**

**Estado FINAL das integrações de linguagem:** Verilog/SV → **tree-sitter** (highlight) + **Verible** (lint/format/
hover/def/refs/outline) + **slang** (semântica + autocompletar, toggle). C/C++ → **tree-sitter** (highlight) +
**clang-format** (format). CMM/ASM → **Monarch** (highlight) + clang-format só no CMM (regras de C).

### 14.36 aurora-tree passo 2 — endurecimento de performance (sem virtual scroll) — 19/06/2026 — FEITO
A file tree tem 3 views: **Files** (lista plana, 10–100, reconciliação por chave), **Hierarchy** (módulos Yosys,
pode ser 1000+), **Folders** (lazy — filhos só ao expandir). **Decisão do usuário:** *endurecer performance, leve e
seguro* — NÃO fazer o virtual scroll completo. Razões (apresentadas + aceitas): (a) as linhas já têm
`content-visibility: auto` ([file_tree.css:126]) → o Chromium **já pula layout/paint das linhas fora da tela** (o
ganho central do virtual scroll); (b) o virtual scroll exigiria achatar a estrutura aninhada → quebraria os
conectores curvos da hierarchy (`::before` com `top:-11px`), o expand/collapse, scroll-to-file e context menu; (c)
precedente: o **P1 foi revertido** por bugs. Otimização prematura de alto risco p/ projetos SAPHO pequenos/médios.

Em vez disso, 3 ajustes cirúrgicos e seguros:
1. **`.verilog-file-item`** ganhou `content-visibility: auto; contain-intrinsic-size: auto 22px` — a view Files
   (lista plana, 22px, sem aninhamento/conectores) agora pula paint fora da tela, igual à view Folders.
2. **`.hierarchy-children.collapsed`** ganhou `content-visibility: hidden` — o **ganho real**: o colapso era só
   `max-height:0; overflow:hidden`, que **CLIPA mas ainda calcula o layout** de toda a subárvore escondida. Com
   `content-visibility: hidden` o navegador **pula layout+paint do conteúdo colapsado** → uma hierarchy de 1000+
   módulos colapsada no topo custa quase nada. NÃO afeta as linhas visíveis: os conectores trunk/elbow ficam no
   `.hierarchy-item` pai (fora deste container) e a altura do item colapsado já era 0, então os conectores não
   mudam. O `max-height` segue animando o expand.
3. **Guarda de contagem** em `renderHierarchicalTree`: conta `.hierarchy-item`; se > 2000, loga um aviso
   informativo (observabilidade — atribui eventual lentidão ao design, não ao IDE). Sem truncar (não esconde
   módulos).

NÃO toquei: a estrutura aninhada, os conectores, expand/collapse, drag, context menu, scroll-to-file — zero risco
de regressão de interação. Green bar completo (ESLint, tsc, 4 guards, 316 unit, vite build, 9 E2E). NOTA p/ o
futuro: se algum dia uma hierarchy gigante PESAR no build inicial (createElement de N nós), o próximo passo seria
**build lazy on-expand** (como a view Folders já faz) — mas isso é médio risco e ficou fora deste passo seguro.

### 14.37 aurora-terminal passo 2 — cap por card + content-visibility nos grouped-message — 19/06/2026 — FEITO
Auditando o terminal pro "passo 2 (virtual scroll)", o achado foi que ele **já estava fortemente endurecido** — o
objetivo do virtual scroll (DOM limitado + pular paint fora da tela) já estava entregue por: **cap de 5000
`.log-entry`** (`MAX_TERMINAL_ENTRIES` + `trimTerminal` removendo os mais antigos), **`content-visibility: auto`**
nos `.log-entry` (terminal.css), **`contain: layout style paint`** no `.terminal-body`, e **bookkeeping batched por
frame** (`_scheduleTerminalRefresh` — evita o O(n²) de trim+recount+filter+scroll por linha que travava builds
grandes). Então, como no aurora-tree, **não** fiz o virtual scroll (reescrita arriscada e redundante).

A **única lacuna real**: o cap conta `.log-entry`, mas um **card AGRUPADO** é UMA entrada que acumula
`.grouped-message` filhos **sem limite** (ex.: build cuspindo milhares de warnings do mesmo tipo num só grupo), e
os `.grouped-message` **não** tinham `content-visibility`. Dois ajustes cirúrgicos:
1. **Cap por card** (`MAX_GROUPED_MESSAGES = 5000`): em `addMessageToCard`, dropa os grouped-message mais antigos
   além do limite — espelha o `trimTerminal`. Um card não cresce mais sem limite.
2. **`content-visibility: auto` em `.grouped-message`** (intrinsic ~21px): pula layout/paint das linhas fora da
   tela DENTRO de um card alto e on-screen (o card já tinha content-visibility, mas um único card visível podia ter
   milhares de linhas).

Sem mexer no streaming, grouping, filtro verbose, line-links ou auto-scroll — zero risco de regressão. Green bar
completo (ESLint, tsc, 4 guards, 316 unit, vite build, 9 E2E).

### 14.38 aurora-editor — shell semântico do painel do editor — 19/06/2026 — FEITO
Fecha o conjunto de componentes-casca (já existiam `<aurora-tabs>`, `<aurora-terminal>`, `<aurora-tree>`,
`<aurora-statusbar>`, `<aurora-titlebar>`, `<aurora-welcome>`). O painel do editor ainda era um `<div
class="editor-container">` cru. Criei **`js/components/aurora-editor.js`** — LitElement fino (`render → <slot>`),
exatamente o padrão do `<aurora-tabs>`/`<aurora-terminal>` — e troquei `<div class="editor-container">` por
`<aurora-editor class="editor-container">` no index.html (importado por `monaco_editor.js`).

Por que é seguro (e por que o Monaco não se importa): a `.editor-container` já é `display:flex; flex-direction:
column` (editor.css), então o host vira o flex container; o `<slot>` é `display:contents`, logo os filhos slotted
(`<aurora-tabs>` + `#monaco-editor`) viram os flex items do host — layout idêntico ao `<div>`. O Monaco monta em
`#monaco-editor` (descendente light-DOM, achável por `getElementById`), e os seletores `.editor-container`
(split_editor.js, aurora_api.js) casam o host pela classe. Mesmo mecanismo já provado pelo `<aurora-terminal>` (que
envolve `.terminal-container` com filhos slotted). **O E2E abre a janela real + o editor e passou (9/9)** —
confirma que o mount/layout do Monaco não regrediu. Green bar completo (ESLint, tsc, 4 guards, 316 unit, vite
build, 9 E2E).

### 14.39 A3 (migrar globais) — CONCLUÍDO (100%) — 19/06/2026
`window.electronAPI` (global injetado pelo preload) aparecia em ~482 sites / 34 arquivos. **Decisão do usuário: A3
parcial** — migrar só os arquivos pequenos/estáveis, deixando os god-files pro A2 (senão migra 226 sites do
compilation_module e decompõe em seguida = trabalho dobrado).

Feito:
1. **`js/app/electron_api.js`** — re-export tipado do global: `export const electronAPI = window.electronAPI;`
   (tipo inferido da declaração em aurora-globals.d.ts). Módulos agora podem `import { electronAPI }` em vez de
   tocar no global — explícito, grep-ável, mockável. O bridge segue no window (preload é o dono); os dois estilos
   coexistem enquanto a migração é incremental.
2. **15 arquivos pequenos migrados** (~26 sites): close_project, git_panel, gtkw_picker, file_tree_toggler,
   status_bar, split_editor, aurora_settings, app_initializer, aurora-welcome, renderer, new_project_modal,
   standard_tree_render, ai_assistant_manager, file_tree_manager, terminal_module. Cada um: + `import { electronAPI }`
   e `window.electronAPI` → `electronAPI`.

**Deferido (pro A2 / lotes futuros):** os god-files **compilation_module.js (226)** e **tab_manager.js (27)**, o
central **aurora_api.js (33)**, os médios (project_tree_actions 18, wave_config_manager 16, project_manager 14,
tab_watchers 10, file_mode 9, compilation_flow 8, zoom 6, processor_hub 6), os arquivos com fonte **.ts**
(spec_factory, wave_state_store, spf_store, spec_runner, command_overrides, compilation_helpers) e dois sem bloco de
import no topo (search_panel, tab_viewers). Como é parcial, o global continua configurado no eslint — a remoção do
global + enforcement só quando 100% migrado (no/após o A2). Green bar completo (ESLint, tsc, 4 guards, 316 unit,
vite build, 9 E2E — inclusive E2E que exercita renderer/terminal migrados).

**CONCLUSÃO DO A3 (100%, 19/06/2026 — a pedido do usuário "faça o A3 COMPLETO"):** migrados TODOS os ~490 sites
restantes; **nenhum `window.electronAPI` sobra no `js/` fora do próprio `electron_api.js`**.
- **Pré-requisito — `electron_api.js` virou handle LIVE (Proxy):** o re-export era SNAPSHOT
  (`export const electronAPI = window.electronAPI`), capturado no load → quebraria os módulos cujos testes trocam
  `globalThis.window = { electronAPI: fake }` **depois** do load (WaveStore/SpfStore/wave_toolchain/
  wave_signal_validator/processor_compiler/spec_*). Agora é um **Proxy** que encaminha cada acesso pro
  `window.electronAPI` ATUAL — transparente (incl. `this`), então `electronAPI.foo(x)` ≡ `window.electronAPI.foo(x)`,
  e os mocks de teste voltam a funcionar. Caveat documentado: o Proxy é sempre truthy → preferir checagem por
  propriedade (`if (electronAPI.foo)`); as checagens de existência que existiam eram todas pareadas com checagem de
  propriedade, então a troca é comportamento-idêntica. Commit `5502105`.
- **`electron_api.d.ts`** dá o tipo (`Window['electronAPI']`) pros importadores **.ts** sem `allowJs` (tsc resolve o
  import do `.js` pro `.d.ts` irmão); `build:ts` emite+checa limpo.
- **22 módulos `.js`** migrados por script (sed + inserção do import), incl. os god-files compilation_module/
  aurora_api/tab_manager e os test-mockados wave_toolchain/wave_signal_validator/processor_compiler. Commit `fb3728b`.
- **4 módulos `.ts`** migrados (wave_state_store/spf_store/spec_runner/spec_factory); a `.js` gerada (gitignored)
  regenera com a migração. Commit `44610af`.
- **Validação chave:** TODOS os testes que trocam `globalThis.window` (processor_compiler, spfStore, WaveStore,
  spec_*) **continuam passando** com os módulos importando o Proxy → confirma o live-forward. Green bar a cada lote
  (eslint `.`, tsc/build:ts, 4 guards, **471 unit**, vite build, 9 E2E). eslint: não há global `electronAPI` no
  config (o bridge sempre foi acessado via `window`), então não houve nada a remover; o acoplamento ao global some
  pelo uso do import.

### 14.40 G9 (spawn único) + G8 (política default-on × sob-demanda) — 19/06/2026 — FEITO
**G9 — registry como único ponto de spawn.** O `process_registry.js` já tinha `trackChild` (tree-kill no fechamento),
mas cada spawn de toolchain chamava `trackChild` na mão — qualquer spawn futuro que esquecesse vira zumbi (a
varredura-backstop só pega vvp/gtkwave + `Temp/`). Adicionei **`spawnTracked(cmd, args, opts)`** = exatamente
`trackChild(spawn(...))`, e migrei **todos os 9 sites de spawn de toolchain** pra ele: executor (×2:
iverilog/vvp/verilator), prism (×2: yosys síntese + DigitalJS), verible_lsp, slang_lsp, clang_format, e compile (×3:
gtkwave, surfer, **decode-complex/comp2gtkw** — este **não era tracked antes**, um buraco que agora fechou). Os
spawns que NÃO entram: os CLIs de IA (claude_code/codex_cli, que têm árvore própria + `killAll`), o `taskkill`/
`tasklist` (cleanup efêmero) e o terminal externo (`files.js`, detached p/ sobreviver ao IDE de propósito). Agora
"registrar pra tree-kill" é automático por construção — um spawn novo de toolchain só precisa usar `spawnTracked`.

**G8 — política default-on × plugin sob-demanda (governança, codificando o que já decidimos).** Tensão: §7 quer
muito OSS (LSPs/WASM) vs §8 (instalador grande). Regra de fato em vigor:
- **Default-on (baixado no bootstrap, vai no instalador via extraResources):** toolchain msys (iverilog/vvp/
  verilator/yosys/g++/make/python), GTKWave, Surfer, **Verible** (O2), **clang-format**, **slang-server** (O11),
  **gramáticas tree-sitter** (O7). Critério: pesado MAS necessário pro fluxo central de hardware.
- **Sob-demanda (B12 — download lazy pra userData, FORA do instalador):** os CLIs de IA (Claude Code, Codex,
  ~457MB). Critério: grande + opcional/pessoal (nem todo usuário usa).
Resumo da regra: *central pro fluxo → bootstrap; opcional/pessoal e grande → sob-demanda*. Novas integrações se
encaixam num dos dois. Green bar completo (ESLint full em main/, tsc, 4 guards, 316 unit, vite build, 9 E2E).

### 14.41 PRISM reskin — verificação: já estava no design system; 1 alinhamento de token — 19/06/2026 — FEITO
Decisão do usuário: **aplicar o design system da AURORA** (conservador). Auditando o `html/prism/prism.css`, o achado
foi que ele **já está totalmente no design system** — o cabeçalho confirma ("Aurora design system... uses --accent /
--bg / --text"). Usa tokens em tudo (superfícies `--bg`/`--bg-elev`, `--border`, `--text`, `--accent`, fontes,
`--radius`, `--shadow`, `--space`), o logo usa o `--gradient-aurora`, e a toolbar/breadcrumbs/zoom/overlay/tooltip
espelham a UI principal. Como aurora-tree/terminal, o reskin **já estava feito**.

Os hardcodes restantes são **intencionais e não-mexíveis às cegas**: (a) o vermelho do botão fechar
(`#E25C5C`/`#C24A4A`) é **idêntico ao da titlebar principal** (toolbar.css) — mudar QUEBRARIA a consistência; (b) as
cores do schematic (netlistsvg) e da simulação (DigitalJS: superfície clara `#eef1f6`, dígito 0/1 branco+halo) foram
**afinadas no O9** (risco classe-O9 de só aparecer no teste). Não toquei nenhuma.

**Única mudança:** o `prism.css` definia os fallbacks do netlistsvg com cores **genéricas do VS Code**
(`--vscode-foreground: #cccccc; --vscode-editor-background: #1e1e1e`) — o único ponto fora do palette Aurora.
Apontei pros tokens (`var(--text-secondary)` e `var(--bg-elev-2)`), escolhidos pra **preservar a relação visual**
(texto claro; célula um pouco mais clara que o canvas). É um fallback majoritariamente sobreposto pelas regras
`.svg-content` (texto/rect/path/line/circle já são Aurora), então o impacto visível é mínimo — mas, por ser visual,
**vale o olhar do usuário no teste** (fácil reverter). Green bar (build, 4 guards, 316 unit, 9 E2E).

### 14.42 A2 — decomposição do compilation_module (COMPLETA — 5/5 extrações, commit por extração) — 19/06/2026
God-file de ~4210 linhas (classe `CompilationModule`, 53 métodos async, ~13 responsabilidades). Mapeei com agente de
leitura e **apresentei o plano ao usuário ANTES de mexer** (ele aprovou: 5 extrações, da mais segura pra mais
arriscada, **commit por extração**, pode interromper a qualquer ponto). Ordem: (1) hierarchy_parser → (2)
hierarchy_view → (3) wave_toolchain → (4) wave_signal_validator → (5) processor_compiler.

**Extração #1 — `js/compilation/hierarchy_parser.js` (FEITO):** movidas as 3 funções **PURAS** de parsing do Yosys
(`parseYosysIdentifier`, `extractFileInfoFromSource`, `parseYosysHierarchy` + `PRIMITIVE_PATTERNS`) — zero DOM/
`window`/estado. No compilation_module: removidos os 3 métodos (via sed nos ranges verificados), `import` adicionado e
o call site em `generateProjectHierarchy` (`this.parseYosysHierarchy` → `parseYosysHierarchy`). O arquivo encolheu
~142 linhas. **Ganho além da decomposição:** a classe NÃO tinha teste de unidade — adicionei **11 testes**
(`tests/unit/hierarchy_parser.test.js`: identificadores Yosys mangled, src→file:line, montagem da árvore + filtro de
primitivos + top ausente). Green bar (ESLint, tsc, 4 guards, **327 unit [+11]**, vite build, 9 E2E).

**Extração #2 — `js/compilation/hierarchy_view.js` (FEITO):** movida toda a renderização **DOM** da árvore de
hierarquia (`renderHierarchy` ex-renderHierarchicalTree, `buildHierarchyChildren` ex-buildHierarchyTree,
`createHierarchyItem`, `toggleHierarchyItem`, `refreshHierarchyFocusHighlight`, `openModuleFile`, `goToLineInEditor`).
`this.` → funções de módulo; a hierarchyData entra por parâmetro. **`renderHierarchicalTree()` virou delegador fino**
no CompilationModule (o `file_tree_view_controller.js` ainda o chama na instância → API preservada). O listener
`aurora:editing-file-changed` agora chama a função importada direto. Removidos os imports órfãos (`EditorManager`).
**Cuidados:** (a) renomeei o builder pra `buildHierarchyChildren` — `buildHierarchyTree` é OUTRA função, importada do
`signal_parser.js` (colisão de nome evitada); (b) o `openModuleFile` era `static` e logava via `this.terminalManager`
**sempre undefined** (bug latente que travava no caminho de erro) → troquei pra `console` (sem dep quebrada). God-file
encolheu **~250 linhas**. Green bar (ESLint, tsc, 4 guards, 327 unit, vite build, 9 E2E).

**Extração #3 — `js/compilation/wave_toolchain.js` (FEITO 19/06/2026):** movidos os 3 helpers de **resolução de
toolchain por IO puro** da pipeline de wave — `resolveWaveToolchain` (ex-`_waveResolveToolchain`: paths
iverilog/vvp/gtkwave/fst2vcd/surfer + `Temp`), `findWaveCandidateInDir` (ex-`_findWaveCandidateInDir`: acha o
.fst/.vcd preferido num dir) e `resolveVerilatorTools` (ex-`_waveResolveVerilatorTools`: verilator/perl/g++/fst2vcd,
**lança** se o bundle ausente). Única transformação: `this.componentsPath` → parâmetro `componentsPath`;
corpo/erros/return byte-a-byte idênticos. **9 call sites** atualizados (`this._wave…()` → função). **Decisão:**
mantive `window.electronAPI` direto (não o `import { electronAPI }` do #2) pra deixar o módulo **testável** com o
padrão `globalThis.window = { electronAPI: fake }` (igual WaveStore/SpfStore) — o re-export captura `window` no load
e quebraria o mock; e mantém o **A3 separado**. **+16 testes** (`tests/unit/wave_toolchain.test.js`: prioridade de
nome fst>vcd>dump, exclusão de `fix.vcd`, fallback de arquivo único, ambíguo→null, dir inexistente→null,
case-insensitive; verilator throw/sucesso; smoke dos 8 campos). God-file **−121 linhas** (3817→3696). **Revisão
adversarial** (workflow, 3 lentes: behavior-preservation / call-site / regression-hunt) = **0 achados** — confirmou
que `componentsPath` está sempre inicializado nos call sites (todos passam por `precompileAllProcessors` →
`await initializeComponentsPath()` em compilation_flow.js). Green bar (ESLint, tsc, 4 guards, **343 unit [+16]**,
vite build, 9 E2E).

**Extração #4 — `js/compilation/wave_signal_validator.js` (FEITO 19/06/2026):** movida a resolução de seleção de
sinais da wave — `validateWaveSelection` (poda seleção stale vs hierarquia parseada + warning + auto-prune no
WaveStore), `resolveWaveSelection` (precedência da fonte do $dumpvars: .gtkw ativo > Wave Config > $dumpvars
hand-written > default), `resolveCocotbWaveSelection` e `parseProjectSources`. **Não são puras** (tocam WaveStore,
terminal, config), então recebem um **deps bag** `{ projectPath, terminalManager, projectConfig, componentsPath }`;
a classe mantém **delegadores finos** (via `_instanceDeps()`, renomeado de `_waveDeps()` no #5) — preserva os call sites internos + o **externo**
(`wave_config_manager.js` chama `compiler._validateWaveSelection`). **Seam do `_validatedWaveSelection`:** o campo
(cache lido pelos geradores de auto-gtkw/auto-surfer) continua **dono da classe** — `resolveCocotbWaveSelection`
agora **retorna** a seleção e o delegador escreve o campo, mantendo as **3 escritas / 2 leituras** todas dentro da
classe (o risco central do §14.42 some por construção). Removidos 4 imports órfãos (validateSelection,
parseVerilogModules, buildHierarchyTree, hasUserDumpCalls). **+13 testes** (`tests/unit/wave_signal_validator.test.js`,
exercitam o parser/validator/WaveStore reais: poda + persistência, precedência gtkw/wc/tb/default, HDL SAPHO, seam
cocotb). God-file **−238 linhas** (3696→3458). **Revisão adversarial** (workflow, 3 lentes: behavior-preservation /
seam-integrity / integration) = **0 defeitos**; fechei os 3 gaps de cobertura que ela apontou. Green bar (ESLint,
tsc, 4 guards, **356 unit [+13]**, vite build, 9 E2E).

**Extração #5 — `js/compilation/processor_compiler.js` (FEITO 19/06/2026) — ENCERRA a decomposição:** movidos os 6
métodos de compile do processador SAPHO — `cmmCompilation` (.cmm → .asm via cmmcomp), `asmCompilation` (appcomp +
asmcomp → `<proc>.v` + pc_*_mem.txt + tb), `getSelectedCmmFile`, `getTestbenchInfo`, `ensureChegueiToaqui`
(instrumenta #TOAQUI), `stageProcessorMemoryFiles`. **Não são puras** (rodam .exe via runSpec, salvam abas, dirigem
status/terminal) → recebem o **deps bag** (renomeei `_waveDeps()` → **`_instanceDeps()`**, agora bag comum de
wave+compile). A classe mantém **delegadores** pra API pública (`cmmCompilation`/`asmCompilation` são chamados por
`compilation_flow.js`) + `_stageProcessorMemoryFiles`; os 3 helpers internos saíram de vez (sem caller restante).
**Dois seams de campo preservados exatos:** (a) **`lastCompiledCmmPath`** — escrito ANTES do runSpec (sobrevive a
falha de compile, lido de fora pelo `terminal_module.js`) → o helper recebe um **callback `setLastCompiledCmmPath`** e
o invoca no mesmo ponto, então a escrita fica na classe, no timing idêntico; (b) **`_chegueiInstrumentProc`** —
setado de fora por `compilation_flow.js`, passado como **parâmetro** pro gating do #TOAQUI. Removidos 4 imports
órfãos (buildCmmSpec, buildAsmPreSpec, buildAsmSpec, insertChegueiToaqui). **+18 testes**
(`tests/unit/processor_compiler.test.js`: helpers + cmm/asm com **runSpec mockado** assertando o seam do
lastCompiledCmmPath, o gating do #TOAQUI, a cópia do tb e os branches de staging). God-file **−342 linhas**
(3458→3116). **Revisão adversarial** (workflow, 3 lentes) = **0 defeitos** (só uma ref stale de comentário do rename,
corrigida). Green bar (ESLint, tsc, 4 guards, **374 unit [+18]**, vite build, 9 E2E).

**Decomposição do compilation_module COMPLETA (5/5):** hierarchy_parser · hierarchy_view · wave_toolchain ·
wave_signal_validator · processor_compiler. God-file: **4197 → 3116 linhas (−1081)**, ~13 responsabilidades
desmembradas em módulos testáveis (o conjunto ganhou ~58 testes de unidade ao longo das 5 extrações).
Depois de compilation_module, os outros god-files do A2 (ai_assistant 4592, tab_manager 2044) + o **A3 restante**
(migrar os globais dos god-files) seguem a mesma cadência (um por commit, green bar). **LIÇÃO desta sessão:** várias
fases ("virtual scroll", "reskin") já estavam majoritariamente resolvidas por trabalho anterior — sempre auditar
antes de assumir que há trabalho; e refatorar a pipeline de wave pede contexto fresco + idealmente testes primeiro.

### 14.43 A2 — decomposição de ai_assistant_manager (4592) + tab_manager (2044), em paralelo — 19/06/2026
Próximos god-files do A2, mapeados por workflow (3 agentes de leitura) e consolidados pra granularidade do §14.42
(~6 extrações por arquivo, não os ~22 micro que os agentes sugeriram). Plano apresentado e **aprovado**. Mesma
cadência: 1 extração = deps/delegadores + testes + green bar + revisão adversarial + 1 commit. Os dois arquivos em
paralelo (interleaved, seguro→arriscado).

**Mapa.** `ai_assistant_manager.js` (em js/ui/, só 2 importers, API externa mínima): o grosso seguro são as ~1250
linhas de helpers de módulo ANTES da classe (system prompt, markdown/math/syntax, file-ref, metadata/formatters —
quase tudo PURO). `tab_manager.js` (js/tabs/, classe **ESTÁTICA**, 17 importers): externos leem
`TabManager.tabs/activeTab/unsavedChanges/untitledDocuments` como propriedades + chamam ~29 métodos → o estado
estático **fica na classe**, funções extraídas recebem o estado, a classe mantém **delegadores**.

**AI-1 — `js/ai/system_prompt.js` (FEITO):** movida a constante `SYSTEM_PROMPT` (string imutável concatenada ao
contexto do projeto a cada turno). Movimentação por script (**byte-idêntica**, verificada via `git show`). God-file
**−460 linhas** (4592→4132). +2 testes smoke (string não-vazia; invariantes AURORA-feminina / ATLAS-nunca-LHCb).
Green bar (ESLint, tsc, 4 guards, **376 unit [+2]**, vite build, 9 E2E).

**TM-1 — `js/tabs/tab_utils.js` (FEITO):** movidos os 10 helpers **PUROS** de nome/caminho de arquivo
(`basenameOf`/`withoutExtension`/`extensionOf`/`normalizeKey`, sanitizers verilog/python/processor,
`typeFromExtension`, `createCmmTemplate`/`ensureCmmPrname` + `CMM_DEFAULTS`) — zero estado/DOM, **0 callers
externos**, re-importados no tab_manager pro uso interno. Byte-idêntico (script). God-file **−87 linhas** (2044→1957).
+12 testes (parsing, sanitizers, template C±). A detecção de tipo/ícone (`isImageFile`/`getFileIcon` — métodos
estáticos, precisam de delegador p/ os 4 callers externos de `getFileIcon`) fica pra extração própria. Green bar
(**388 unit [+12]**, build, 9 E2E).

**AI-2 — `js/ai/chat_render.js` (FEITO, absorve o AI-4):** movida a stack COMPLETA de render texto→HTML do chat
(~573 linhas) — syntax highlighter zero-dep, `escapeHtml`, math LaTeX→Unicode (KaTeX opcional), Markdown inline +
bloco (headings/listas/quotes/tabelas GFM) E a linkificação de refs de arquivo (`core.v`/`my_proc.cmm:25` → spans
clicáveis). Tudo **PURO/DOM-only** (sem estado/electronAPI/TabManager). Como markdown e file-ref estavam
**interleaved** e ambos são "render do texto do chat", uni os dois (AI-2 absorve o AI-4) num módulo só. Exporta os 6
entry points que a classe usa (`escapeHtml`, `renderMarkdown`, `highlightCodeBlocks`, `linkifyFileRefs`,
`aiPathIsText`, `TRUST_LINKS_KEY`). Byte-idêntico (script, verificado vs `git show` 216-788). God-file **−570
linhas** (4132→3562). +7 testes (escape, markdown headings/bold/listas/fence, **XSS guard**, aiPathIsText). Green bar
(**395 unit [+7]**, build, 9 E2E).

**AI-3 — `js/ai/ai_metadata.js` (FEITO):** movidos os metadados de provider/model/permission + formatters **puros**
(~191 linhas) — tabelas de config (`PROVIDER_META`/`SUB_META`/listas de modelo/effort/permissão/janelas de token) +
helpers stateless (`isSubProvider`/`shortModelName`/`formatTokens`/`untilTime`/`usageRowHTML`/`readPermissionMode`/
`relativeTime`). Sem estado/DOM; 18 símbolos exportados (`CLAUDE_CODE_MODELS` fica interno). Byte-idêntico. God-file
**−186 linhas** (3562→3376). +6 testes (isSubProvider, formatTokens k/M, shortModelName, permission modes c/
localStorage). Com isso **toda a região de helpers de módulo do ai_assistant saiu** (4592→3376, **−1216**); o que
resta é a CLASSE. Green bar (**401 unit [+6]**, build, 9 E2E).

**TM-2 — file-type/ícone → `js/tabs/tab_utils.js` (FEITO 19/06/2026):** primeira extração da Wave 2 (tab_manager).
Movida a detecção de tipo + o mapa de ícones do TabManager (classe **estática**) — os 4 métodos
`isImageFile`/`isPdfFile`/`isBinaryFile`/`getFileIcon` + os sets `imageExtensions`/`pdfExtensions` — pra
`tab_utils.js` como **funções puras** (sets viram constantes de módulo). Os sets eram lidos **só internamente**
(zero leitor externo, verificado no repo inteiro), então saíram de vez da classe. Movimentação **por script** com
verificação **byte-idêntica** (diff normalizado = só as 4 linhas em branco que separam as funções; **zero mudança**
no icon-map de ~80 entradas). A classe mantém **4 delegadores estáticos finos** — preserva os ~20 call sites
internos (`this.isBinaryFile`/`this.getFileIcon`…) E os **4 callers externos** de `getFileIcon`
(`standard_tree_render`, `project_tree_render` via `window.TabManager`, `split_editor`, `hierarchy_view`), todos
intactos. Padrão de delegação idêntico ao compilation_module #5 (mesmo nome no import e no delegador; a chamada nua
resolve pro import, não recursão — comentado no código). **Re-mapeado vs código real antes** (os símbolos batiam, ao
contrário do "TM-2 file-operations" do mapa do workflow). **+6 testes** (`tab_utils.test.js`: image/pdf/binary
case-insensitive + sem-extensão; getFileIcon p/ famílias SAPHO cmm/v/sv/vcd/asm/spf, svg special-case, lowercase do
ext, fallback `ph ph-file`). God-file **−123 linhas** (1957→1834). **BAIXO risco** (funções puras, delegadores
preservam tudo) → sem revisão adversarial (não é estado entrelaçado; reservada pras extrações de watchers/save_flow).
Green bar (ESLint, tsc, 4 guards, **407 unit [+6]**, vite build, 9 E2E).

**Auditoria file-watching (b) — JÁ FEITO, nada a fazer (19/06/2026):** ao re-mapear vs o código real, o
file-watching **já está totalmente extraído** em `js/tabs/tab_watchers.js` (mixin `tabWatchers`, `Object.assign`
no fim do tab_manager): poll periódico, watcher chokidar (push), restart resiliente, e todo o handling de conflito
externo (diff/diálogo/reload undoable) vivem lá. O que resta na classe são só os **5 campos de estado** que o mixin
lê como `this.X` (`fileWatchers`/`lastModifiedTimes`/`externalChangeQueue`/`periodicCheckInterval`/`isCheckingFiles`)
+ os call sites — exatamente o correto (estado fica na classe). Lição §14.42 de novo: auditar antes de assumir que há
trabalho.

**TM-3 — save-name helpers → `js/tabs/tab_utils.js` (FEITO 19/06/2026):** extraídas as 2 funções **PURAS** de
nome-de-save que sobraram na classe — `appendDefaultExtension` (mapeia tipo→extensão, fallback `.v`) e
`validateSaveName` (valida o base name por linguagem verilog/python/processor e sugere um nome saneado) + as 3 regex
`VALID_VERILOG_FILENAME_RE`/`VALID_PYTHON_MODULE_RE`/`VALID_PROCESSOR_NAME_RE`. Zero estado/DOM, **0 callers
externos** (só `this.X` interno: appendDefaultExtension ×3, validateSaveName ×2) → **sem delegador**, os 5 call sites
viraram chamada nua ao import (igual ao TM-1). `validateSaveName` agora chama os sanitizers irmãos no próprio
`tab_utils`; `appendDefaultExtension` puxa `getExtensionForDocumentType` do `document_type_detector.js` (módulo
folha, sem ciclo). Removidos 2 imports que ficaram órfãos no tab_manager (`sanitizeVerilogFileName`/
`sanitizePythonModuleName` — só o validateSaveName os usava; `sanitizeProcessorName` continua, usado em outro lugar).
Movido por script, byte-idêntico. **+7 testes** (tipo→ext, fallback, extensão já-presente case-insensitive; nomes
válidos/ inválidos+sugestão por linguagem, passthrough de extensão não-policiada). God-file **−32 linhas** (1834→1802).
BAIXO risco (puro). Green bar (ESLint, tsc, 4 guards, **414 unit [+7]**, vite build, 9 E2E).

**TM-4 — untitled metadata puro → `js/tabs/untitled_docs.js` (FEITO 19/06/2026) — DECISÃO DE ESCOPO DO USUÁRIO:**
ao re-mapear, o untitled lifecycle se revelou **não** ser uma extração limpa (caso clássico do "workflow
over-especificou"): as 6 funções têm callers externos (`createNewFile`→aurora_api/renderer;
`createNewFileFromDialog`→project_tree_actions; `isUntitledPath`/`getDisplayName`/`expandUntitledSnippet`/
`updateUntitledDocumentType`→split_editor) e o grosso (`updateUntitledDocumentType`/`expandUntitledSnippet`/
`updateUntitledTabPresentation`) é orquestração de **monaco + DOM + métodos-irmãos** (`addTab`/`markFileAsModified`/
`updateContextPath`/`setModelLanguage`), sem seam limpo e **SEM cobertura E2E** — deps bag = alto risco/baixo ganho
(o oposto do TM-2/3). Apresentei isso ao usuário; ele escolheu **extrair só os helpers PUROS de metadados** e deixar
os orquestradores na classe com rationale documentado. Movidos: `isUntitled` (map.has), `untitledDisplayName`
(path+ext detectado, senão basename), `nextUntitledPath` (loop de nomeação "Untitled-N", pula colisão de tab/doc;
retorna `{filePath, counter}` — a classe **escreve o counter de volta**, é dona dele) + `UNTITLED_PREFIX`. A classe
mantém **delegadores** (`isUntitledPath`/`getDisplayName`) e o `createNewFile` virou delegador fino. **Seam do counter
preservado:** o loop extraído só LÊ o counter atual e devolve o novo; comportamento byte-equivalente (counter final
idêntico — loop síncrono, sem await, sem leitor concorrente). **+8 testes** (`untitled_docs.test.js`: isUntitled,
display por tipo/sem-tipo/saved, avanço+colisão do counter). God-file **−2 linhas** (1802→1800) — o ganho aqui é
**+47 linhas testáveis num módulo**, não encolher o god-file (o grosso ficou de propósito). Puro → **sem revisão
adversarial** (não é estado entrelaçado; a parte entrelaçada foi deixada na classe por decisão). Green bar (ESLint,
tsc, 4 guards, **422 unit [+8]**, vite build, 9 E2E).

**AI-5 — chat_scroll (math puro) → `js/ai/chat_scroll.js` (FEITO 19/06/2026):** primeira extração da CLASSE do
ai_assistant (depois dos helpers de módulo AI-1/2/3). Re-mapeado vs código real: o sistema de scroll é interdependente
(`_isAtBottom`/`scrollToBottom`/`smoothScrollToBottom` + listener de scroll + pill "Jump to latest" + estado
`stickToBottom`/`_scrollRaf` + rAF) — DOM/estado, **sem E2E** (o E2E não exercita o chat). O subconjunto **puro** é a
**matemática**: `isAtBottom(el, thresholdPx)` (geometria; el ausente = no fundo; lê só scrollHeight/clientHeight/
scrollTop), `easeInOutCubic(p)` (curva ease-in-out) e `smoothScrollDuration(dist)` (≈metade da distância, clamp
[240,560]). Extraídos pra `chat_scroll.js`; a classe mantém a **orquestração** (dona de messagesEl/stickToBottom/
_scrollRaf e do loop rAF) e só **delega a matemática** — `_isAtBottom` → `isAtBottom(...)`, `smoothScrollToBottom`
usa `smoothScrollDuration`+`easeInOutCubic`. Comportamento idêntico (revisão manual de equivalência: mesma fórmula de
ease/duração/geometria). Mesma decisão do TM-4: extrai o puro/testável, deixa o DOM/estado na classe. **+7 testes**
(`chat_scroll.test.js`: isAtBottom null/dentro/fora do threshold; ease endpoints+aceleração; duração clamp+meio).
ai_assistant **3376→3375** (ganho = +26 linhas testáveis num módulo; o god-file mal encolhe — o valor é a matemática
isolada/testável, não o tamanho). Puro → sem revisão adversarial. Green bar
(ESLint, tsc, 4 guards, **429 unit [+7]**, vite build, 9 E2E).

**AI-6 — anexos (subconjunto puro) → `js/ai/chat_attachments.js` (FEITO 19/06/2026):** segunda peça ortogonal da
classe. O sistema de anexos é DOM + FileReader + estado (`pendingAttachments`); o puro/testável é a **formatação +
o markup dos chips**: `formatAttachmentSize` (B/KB/MB, ex-`_fmtSize`), `composerChipHtml` (chip da régua acima do
input) e `bubbleChipHtml` (chip read-only dentro da bolha enviada). Os builders recebem `esc` (o **mesmo** escaper
DOM da classe, passado como dep) e `fmtSize` por parâmetro → **markup byte-idêntico** (templates copiados verbatim,
só `this._escAtt`→`esc`/`this._fmtSize`→`fmtSize`). A classe mantém a orquestração: FileReader (`_addFiles`/
`_readAs`), `pendingAttachments`, inserção de nós + wiring do botão remove, e o `_escAtt` (escaper DOM, dono dela).
`_fmtSize` saiu de vez (sem outro caller). **+7 testes** (`chat_attachments.test.js`: formatação nos limites;
chip imagem/arquivo + clipped; bolha thumbnail vs fallback nome+ícone — com fakes de esc/fmt provando o wiring).
ai_assistant **3375→3353 (−22)**. Mesma decisão do TM-4/AI-5 (extrai o puro, deixa DOM/IO/estado na classe). Green
bar (ESLint, tsc, 4 guards, **436 unit [+7]**, vite build, 9 E2E).

**AI-7 — strip de tool-call inline → `js/ai/tool_call_text.js` (FEITO 19/06/2026):** alguns modelos (Llama/Qwen)
emitem tool calls como TEXTO inline (blocos XML `<tool_call>`/`<function_calls>`/`<invoke>`, JSON Qwen
`{"name":...,"arguments":{...}}`, tags órfãs) em vez de eventos estruturados. A limpeza disso é uma **cadeia de 3
`.replace` PURA que estava DUPLICADA em 3 call sites** (`_revealSegment`, `_renderStreamingBubble`, fim de turno).
Extraída pra `stripToolCallArtifacts(text)` (a cadeia verbatim, regexes **byte-idênticas** incl. o range CJK
`[⺀-鿿]`, verificado por diff) + `mayHaveToolArtifacts(text)` (o pré-check barato que pula 3 scans/frame no caso
comum). Os 3 sites viraram `(mayHaveToolArtifacts(buf) ? stripToolCallArtifacts(buf) : buf).trim()`. **Ganho duplo:
dedup (3→1) + testável.** Comportamento idêntico. **+7 testes** (XML/JSON/órfã removidos; prosa intacta; tag
meio-streamada incompleta preservada). ai_assistant **3353→3331 (−22)**. Green bar (ESLint, tsc, 4 guards,
**443 unit [+7]**, vite build, 9 E2E).

**AI-8 — permission-gate (lógica pura) → `js/ai/tool_permission.js` (FEITO 19/06/2026):** a DATA de permissão já
saíra no AI-3 (`ai_metadata.js`); aqui sai a **lógica de decisão** do gate. `decideToolPermission(def, mode)` →
`'allow'`|`'confirm'` (pura: always-confirm `set_command_override` V11; pré-autorizados rename_project/processor/
get_rename_status; `allow` aprova tudo; `writes` aprova reads; senão confirma) + `previewArgs(args)` (pretty-print
JSON capado em 500, verbatim) + `permissionOptionsHtml(modes, currentMode)` (markup dos radios, byte-idêntico). A
classe mantém `confirmToolCall` (API pública chamada pelo `tool_runner.js`) como **delegador** —
`decideToolPermission(...) === 'allow' ? Promise.resolve(true) : this.showInlineConfirm(...)` (comportamento idêntico,
revisão manual de equivalência) — e o `showInlineConfirm` (card DOM) fica nela. `previewArgs`/`buildPermissionOptions`
(internos) viram chamadas aos imports. **+10 testes** (decisão nos 5 caminhos; previewArgs vazio/json/cap; radios
checked). ai_assistant **3331→3299 (−32)**. Green bar (ESLint, tsc, 4 guards, **453 unit [+10]**, vite build, 9 E2E).

**AI-9 — provider/model view (markup + label puros) → `js/ai/provider_view.js` (FEITO 19/06/2026):** a DATA de
provider/model já saíra no AI-3; aqui sai o **view**: `providerOptionsHtml(providers, currentProvider)` (radios do
picker de provider), `modelPresetsHtml(models, active)` (botões segmentados dos presets das CLIs) e
`faithfulModelName(entry, provider)` (o label fiel do marcador "--- Modelo: … ---": preset pra CLI assinada, id
encurtado pra API, fallback pro default). Puros (importam só PROVIDER_META/SUB_META/shortModelName do ai_metadata.js,
sem ciclo). As `render*` ficam na classe (donas dos elementos do popover) e chamam os builders; `_faithfulModelName`
saiu (caller único virou import). Markup byte-idêntico. **+6 testes** (`provider_view.test.js`: checked + hint +
fallback de label; preset ativo; label fiel CLI/API/fallback). ai_assistant **3299→3271 (−28)**. Green bar (ESLint,
tsc, 4 guards, **459 unit [+6]**, vite build, 9 E2E).

**AI-10 — history (lista + serialização puras) → `js/ai/chat_history.js` (FEITO 19/06/2026):** o load/save real é IPC
(`main/ai/conversations.js`) e fica na classe; o puro/testável são duas coisas: `chatListHtml(chatList,
currentChatId)` (markup da lista de chats salvos no popover — empty-state + item ativo + badge de tokens G6, com
escapeHtml/relativeTime/formatTokens/PROVIDER_META) e `serializeMessagesForStorage(messages)` (shape de persistência:
breadcrumb completo das entradas tool; user/assistant guardam content + **metadata leve** de anexo, **payload
dropado**; **não muta** a entrada). `renderChatList`/`persistCurrentChat` ficam na classe (donas do DOM/IPC) e
chamam os puros. Markup byte-idêntico. Removido o import órfão `relativeTime` (só o renderChatList o usava). **+7
testes** (empty/ativo/token/XSS na lista; tool breadcrumb, drop de payload, não-mutação). ai_assistant **3271→3219
(−52)**. Green bar (ESLint, tsc, 4 guards, **466 unit [+7]**, vite build, 9 E2E).

**AI-11 — streaming/turn (shaping puro) → `js/ai/chat_turn.js` (FEITO 19/06/2026):** o núcleo de streaming/sessão
(`_dispatchTurn`/`handleChatEvent`/`currentSessionId`/`setStreaming`) é orquestração pesada (IPC, estado, DOM, seam
de sessão) e **fica inteiro na classe**. O puro/testável do caminho de envio são duas funções:
`buildApiMessages(messages)` (filtra entradas `tool` display-only + **clona** anexos pro strip de memória pós-envio
não esvaziar o que foi enviado — o bug histórico das imagens) e `buildProjectContext(projectPath, spfPath)` (o bloco
de contexto de projeto anexado ao SYSTEM_PROMPT por turno — **texto model-facing, byte-idêntico verificado por diff**).
`_dispatchTurn` chama os dois; o loop de strip de `dataUrl` e o `startChat` IPC ficam na classe. Extração de funções
puras (não toca o estado de streaming) → sem revisão adversarial. **+5 testes** (filtro tool + independência do clone;
contexto com/sem spf/sem projeto). ai_assistant **3219→3204 (−15)**. Green bar (ESLint, tsc, 4 guards, **471 unit
[+5]**, vite build, 9 E2E).

**A2 — DECOMPOSIÇÃO DA CLASSE ai_assistant CONCLUÍDA (passo de subconjuntos puros), 19/06/2026.** ai_assistant_manager
**4592 → 3204 (−1388, ~30%)**. Saíram, em módulos testáveis em `js/ai/`: helpers de módulo (AI-1 system_prompt ·
AI-2 chat_render · AI-3 ai_metadata) + da CLASSE (AI-5 chat_scroll · AI-6 chat_attachments · AI-7 tool_call_text ·
AI-8 tool_permission · AI-9 provider_view · AI-10 chat_history · AI-11 chat_turn). **Decisão consistente** (TM-4
diante): extrai o **puro/testável** (matemática, markup, shaping, decisão, parsing) e deixa na classe a **orquestração
de estado/DOM/IPC/streaming** (sem seam limpo, sem cobertura E2E do chat ao vivo — extrair via deps bag seria alto
risco/baixo ganho). ~+50 testes de unidade novos nesta leva da classe.

**RESTANTE (Wave 2/3) — HANDOFF pro próximo chat (a parte ARRISCADA, contexto fresco):** a Wave 1 (helpers puros)
está FEITA; o que sobra é estado entrelaçado — mesma situação do compilation_module #3-5, que pediu contexto fresco.
**Cadência (a mesma das 9 extrações já feitas):** mover verbatim (script, **byte-idêntico** vs `git show`) → para
funções que tocam estado, passar um **deps bag** ou (no tab_manager estático) receber o estado e manter
**delegadores** na classe → +testes → green bar (ESLint, tsc, 4 guards, unit, vite build, 9 E2E) → **revisão
adversarial (workflow 3 lentes)** pras entrelaçadas → 1 commit/push por extração → atualizar §14.43 + BACKLOG +
memória. **IMPORTANTE: re-mapear vs o código REAL antes** — o workflow de mapeamento OVER-especificou símbolos (ex.:
"TM-2 file-operations" listou `registerSavedProjectFile`/`registerProcessor`/`saveCmmProcessorFile`, que **não
existem** assim no `tab_manager.js`). Use `grep -nE "(static |function )<nome>" js/tabs/tab_manager.js` pra confirmar.

- **tab_manager (js/tabs/, classe ESTÁTICA, 17 importers) — 1957 linhas restantes.** Externos leem
  `TabManager.tabs/activeTab/unsavedChanges/untitledDocuments` como **propriedade** e chamam ~29 métodos (`addTab`,
  `saveAllFiles`, `getEditingFilePath`, `closeTab`, `markFileAsModified`…). Logo: **estado estático fica na classe**,
  funções extraídas recebem o estado, classe mantém **delegadores**. Extrações candidatas (re-mapear nomes/linhas):
  (a) ~~**file-type/ícone**~~ — **FEITO (TM-2)**. ~~(b) **file-watching**~~ — **JÁ ESTAVA FEITO** (tudo em
  `tab_watchers.js`; só o estado fica na classe — ver auditoria acima). (c) ~~**untitled** lifecycle~~ — **FEITO
  PARCIAL (TM-4)**: extraído só o metadata puro (`isUntitled`/`untitledDisplayName`/`nextUntitledPath` →
  `untitled_docs.js`); os orquestradores monaco/DOM (`updateUntitledDocumentType`/`expandUntitledSnippet`/
  `updateUntitledTabPresentation`) ficaram na classe **por decisão** (alto risco/baixo ganho, sem E2E). (d)
  ~~**save_flow**~~ — **DEIXADO NA CLASSE POR DECISÃO DO USUÁRIO (19/06)**: é a API de save mais chamada/espalhada
  (`saveAllFiles` só ele tem 8 callers externos; `saveCurrentFile`/`saveUntitledFile`/`saveFile`/`markFileAsSaved`/
  `markFileAsModified` todos externos), **sensível a perda de dados** (escreve disco, troca untitled→saved, resolve
  conflito — lição P1), e a parte **pura já saiu no TM-3**. O resto é orquestração sem subconjunto puro e **sem
  cobertura E2E** → deps bag = alto risco/baixo ganho. Fica como núcleo coeso da classe. + overlay/dialogs (idem).

  **Status tab_manager (Wave 2 FECHADA, 19/06):** 2044 → 1800 linhas. Saíram TM-2 (file-type/ícone), TM-3 (save-name
  helpers), TM-4 (untitled metadata puro); file-watching já estava em tab_watchers.js. O que permanece é, por
  decisão, o **núcleo de estado entrelaçado** (save_flow, orquestração untitled monaco/DOM, add/close-tab, split,
  overlay) — a parte pura já foi; extrair o resto seria alto risco/baixo ganho. Próximo alvo do A2: classe do
  **ai_assistant_manager**.
- **ai_assistant_manager (js/ui/) — classe `AIAssistantManager` ~3376 linhas, ~40 campos entrelaçados.** **E2E NÃO
  exercita o chat ao vivo** → bug sutil só no teste do usuário (classe-risco do O9/O11). Peças mais ortogonais
  primeiro (deps bag + delegadores): ~~**scroll**~~ — **FEITO (AI-5)**: só a matemática pura saiu (chat_scroll.js);
  a orquestração DOM/rAF fica na classe. ~~Próximo ortho: **anexos**~~ — **FEITO (AI-6)**: formatação + builders de
  chip puros (chat_attachments.js); FileReader/DOM/estado ficam na classe. Próximo = o núcleo profundo
  (mais arriscado — o usuário pediu **"faça tudo"**, seguir sem pausar, com revisão adversarial nas peças de estado;
  sequência
  própria): **tool-chips**, **permission-gate** (`confirmToolCall` é chamado por `tool_runner.js`),
  **provider/model UI**, **histórico** (load/save/replay), **streaming/sessão** (`_dispatchTurn`/`handleChatEvent` +
  o campo-seam `currentSessionId`). API externa a preservar: `initialize`/`toggle` (renderer), `confirmToolCall`
  (tool_runner), `showAskUserQuestionInline` (aurora_api), `askAboutSelection` (window.AuroraAPI.ai).

Estado: tudo no `origin/main`, verde. Branch backup antigo: `backup/a2-godfiles-de38e4a` + tag
`shelf-a2-godfiles-2026-06-18`.

### 14.44 `<aurora-tabs>` passo 2 — tablist acessível (não o rewrite data-driven) — 19/06/2026 — FEITO
A nota do roadmap dizia "passo 2 (data-driven)" e estava deferida "DEPOIS do A2" por estar entrelaçada com o
TabManager. **Re-mapeando vs o código real:** o tab-strip é DOM 100% imperativo — TabManager faz
`createElement`/`innerHTML`/`querySelectorAll('.tab[data-path]')` em ~15 pontos espalhados por tab_manager.js +
tab_drag.js + tab_watchers.js + split_editor.js, e o caminho de ativar/salvar é sensível a perda de dados (lição P1).
Um rewrite **data-driven** (TabManager vira dono de um array e o `<aurora-tabs>` renderiza declarativo) seria uma
rearquitetura cross-file de alto risco SEM E2E ao vivo do chat/tab — **a mesma situação do `<aurora-tree>` passo 2**,
onde o rewrite arriscado (virtual scroll) foi corretamente trocado por um endurecimento seguro e contido. Mesma
decisão aqui (princípio "seguro→arriscado" + P1).

**Entregue (seguro, contido no componente, ZERO mudança no TabManager):** o `<aurora-tabs>` deixou de ser um `<slot>`
puro e virou um **controlador de tablist ARIA** sobre seus filhos light-DOM: `role="tablist"` no host, `role="tab"` +
`aria-selected` em cada `.tab` (espelhando a classe `.active` que o TabManager já controla), **roving tabindex** (a
aba ativa é o único tab-stop, então o strip não prende o Tab) e navegação por teclado **Arrow/Home/End** (move o
foco) + **Enter/Space** (ativa via o `click()` que já existe). Um `MutationObserver` (filtro `class` + childList)
re-aplica a semântica quando o TabManager adiciona/remove aba ou troca o `.active`; só ESCREVE role/aria/tabindex (não
class), então não há loop. A matemática do roving (`nextRovingIndex`) saiu como função **pura exportada** e
testada. Nada toca estado/save do TabManager — só reflete o `.active` e ativa pelo caminho de clique existente.
**+5 testes** (`aurora_tabs.test.js`: wrap-around das setas, Home/End, teclas ignoradas, strip vazio). Green bar
(ESLint, tsc, 4 guards, **476 unit [+5]**, vite build, **9 E2E** — que abrem arquivos = criam/ativam abas, exercendo
o componente no app real). O rewrite data-driven completo fica disponível se o usuário quiser pagar o risco; não é
pré-requisito de nada.

### 14.45 `<aurora-panel>` — shell semântico do painel (não o docking-rewrite) — 19/06/2026 — FEITO
A nota de roadmap pedia `<aurora-panel> dockável`. **Re-mapeando:** o "docking" de verdade (arrastar painéis entre
zonas, persistir layout) é uma rearquitetura grande do grid/layout sem cobertura E2E — mesma decisão do aurora-tree
passo 2 (rewrite arriscado → endurecimento seguro). Entreguei o **shell semântico seguro** que o design system pede,
no padrão dos outros (`<aurora-tabs>`/`<aurora-editor>`/`<aurora-statusbar>`): **`js/components/aurora-panel.js`** —
LitElement `render()=><slot>` + `connectedCallback` que dá **`role="region"` + `aria-label`** (landmark a11y), e
exporta o helper **PURO `nextCollapseState(width, threshold)`** (`width < threshold`). O **sidebar** (`.file-tree-
container`) virou `<aurora-panel class="file-tree-container" role="region" aria-label="File tree"
data-i18n-aria-label="fileTree.label">` (a classe é preservada → o CSS `display:flex;column` e o `resize.js` que acha
por `.file-tree-container` continuam funcionando; o `<slot>` é `display:contents`, então os filhos light-DOM
(resizer/header/actions) ficam idênticos — mesma técnica do `<aurora-editor>`). O `resize.js` **importa** o
componente (registra o elemento) e usa `nextCollapseState` no `applyFileTreeWidth` (a regra de threshold do collapse
agora vive num único lugar testado). NÃO toca docking/persistência. **+3 testes** (`aurora_panel.test.js`:
nextCollapseState abaixo/no/acima do threshold + coerção de string). Green bar (ESLint, tsc, 4 guards, vite build,
**9 E2E** — que sobem o renderer real com o sidebar embrulhado). O docking real fica disponível se o usuário quiser.

### 14.46 Surfer + GTKWave — tag `(procType)` nas variáveis em multi-proc — 19/06/2026 — FEITO
Polish v4+ do Surfer externo (item aberto no §13). Antes, a tag `(procType)` só ia nas **instruções**
(`Assembly (cnn_features)`); as **variáveis** repetiam entre processadores (`float acc in global` igual em todos os
procs, só desambiguadas pelo grupo dobrável). Agora a mesma tag vai nas variáveis: em design **multi-proc**,
`buildVariables` (Surfer, `surfer_layout_writer.ts`) e `emitVariablesSection` (GTKWave, `gtkw_proc_writer.ts`) recebem
`procName` (= `procs.length > 1 ? proc.procType : null`) e anexam ` (procType)` ao `manual_name`/alias das variáveis
tipadas E ao label dos grupos de array. **Single-proc fica byte-idêntico** (procName null → sufixo vazio → sem ruído
onde não há ambiguidade). **Paridade Surfer↔GTKWave** mantida (igual à tag de instrução). **+4 testes** (surfer +
gtkw: multi-proc tagueia variável+array; single-proc não). Green bar.

### 14.47 Git badges (M/A/D…) alinhados à direita nas DUAS file trees — 19/06/2026 — FEITO
A pedido do usuário: o badge de status git deve ficar **flush à direita** de cada arquivo nas duas árvores (folders +
files). Re-mapeado: na view de **folders** o badge já era a última flex-child de `.file-item` (com `.file-item-row`
`flex:1`) → direita; na view de **files** ele era anexado em `.verilog-file-info`, que **para antes** do botão de
delete do hover (`.verilog-file-actions`), então não ficava flush e deslocava no hover. Correções: (1)
`css/tree/file_tree.css` — `.git-deco` `margin-left: 6px` → **`margin-left: auto`** (empurra pra borda direita em
qualquer flex row; inócuo onde um filho já cresce) + `padding-left: 8px` (gap de um nome longo/truncado); (2)
`js/tree/git_decorations.js` — na view de files o badge passa a ser hospedado em **`.verilog-file-content`** (a row
full-width), virando o elemento mais à direita, flush e estável no hover, igual à view de folders. `_paint`/observer/
tint inalterados. Sem novo teste de unidade (alinhamento é CSS+DOM; a lógica pura `computeDecorations`/`letterOf`
segue testada e intocada) — validado por raciocínio + 9 E2E (app sobe com as decorações).

### 14.48 Sessão 14/07/2026 — MATLAB highlight · TCMD Ctrl+C/V · CRUD da file tree (Folders) · fusão dos estudos

**MATLAB/Octave (.m):** linguagem `matlab` registrada via Monarch em `monaco_editor.js` (o build vendorizado do
Monaco NÃO traz matlab — conferido em `basic-languages/`), mesmo padrão de CMM/ASM. Tokens genéricos + regra nova
`constant.language` (dourado) nos temas Aurora; a sutileza é o apóstrofo (string `'txt'` × transpose `A'`),
resolvido com o mini-estado `@transpose` (pós-valor → operador; posição de valor → string) — lookbehind evitado de
propósito (Monarch ancora no offset). Validado compilando o tokenizer com o próprio `monarchCompile` em Node.
Ícones: `.m` → matlab no Folders (override em `material_icons.js`, Material mapeia .m→objective-c) e `ph-function`
nas abas. **TCMD:** Ctrl+C/V duplicado corrigido em `shell_terminal.js` — `attachCustomKeyEventHandler` retornar
`false` NÃO faz `preventDefault()`; o paste nativo do browser disparava na textarea do xterm além do nosso
`_paste()` (2×). **Ícone collapse:** `ph-rows` → `ph-minus-square` (glifo do collapse-all do VS Code), nos 2 pontos
(index.html + `file_tree_toggler.js`). **CRUD Folders:** ver §16 (estudo + implementação). **Estudos:** §15 (estilos),
§16 (file tree), §17 (quadro vivo, ex-`BACKLOG_RECONCILIADO.md` — arquivo removido, referências atualizadas).

---

## 15. Estudo consolidado da interface (estilos) — 14/07/2026

> Substitui o diagnóstico visual do §6 onde conflitar (o §6 é de 13/06; este reflete o código real de
> 14/07, pós-revamp §12). Recon multi-arquivo verificada contra o CSS/JS atual. **Este é o material de
> base para a consolidação de estilos que vamos executar em seguida.**

### 15.1 Estado do design system — a base é sólida

`css/base/theme_variables.css` ("Design Tokens v3", ~200 custom properties) é maduro e bem documentado:

- **Superfícies (4 elevações):** `--bg #0A0D14` → `--bg-elev #0F131C` → `--bg-elev-2 #151A25` → `--bg-elev-3 #1B2130` + `--bg-overlay`.
- **Bordas:** `--border-subtle/border/border-strong`. **Texto (4 stops):** `--text/-secondary/-muted/-disabled`.
- **Acento único:** `--accent #8E83E8` + hover/active/soft/strong/border/glow. **Status** 4 cores + tints `-bg`.
- **Marca:** `brand_tokens.css` (6 cores da aurora, única fonte, compartilhada com splash/update).
- **Escalas:** spacing 4px (`--space-*`), radius (`--radius-sm..full`), tipografia (Inter/JetBrains Mono,
  `--text-2xs..3xl`), ícones (`--icon-*`), alturas de controle (`--h-*`).
- **Motion "deriva de aurora":** easings sem overshoot + durações nomeadas (`--dur-instant..ambient`);
  `--ease-spring`/`--transition-bounce` DEPRECADOS mas ainda vivos como alias (remover).
- **Z-index:** escala tokenizada 0–100 **+** tier de overlay `200/1000/10000/10001/10050` — duas camadas
  numéricas incompatíveis convivendo (nomeadas, mas o salto 100→10000 permanece).
- **Camada semântica** (`semantic_tokens.css`, DESIGN §3): alias puro (`--surface-*`, `--text-bright/faint`,
  `--state-*`, `--focus-ray`). Vocabulário para CÓDIGO NOVO/Lit; o legado cita tokens base — duas
  vocabulários por design de migração. **Decisão registrada no quadro (§17 item 36): codemod base→semantic
  do legado foi RECOMENDADO DESCARTAR** (tema único para sempre → alias sem valor funcional).

### 15.2 Adoção vs hardcode (números medidos)

~2.400 usos de `var(--…)` contra ~64 hex fora do arquivo de tokens — a base É token-driven. Os hotspots de
valor mágico (hex/rgba/px literais) concentram-se em DOIS arquivos:

| Arquivo | hex | rgba | px | Situação |
|---|---:|---:|---:|---|
| `panels/ai_assistant.css` (72 KB, ~21% de todo o CSS) | 38 | 30 | **346** | layout do chat ad-hoc; só a paleta de sintaxe foi extraída p/ `--syntax-*` |
| `panels/git_panel.css` (61 KB, "Dagr") | 71 | 26 | **258** | `var(--token, #hex)` com fallback re-hardcodeando a marca ~50×; pills `999px`; shadows soltos |
| `shell/toolbar.css` (24 KB) | 8 | 8 | 88 | razoável, token-driven |
| `panels/aurora_settings.css` (22 KB) | 4 | 4 | 65 | consistente internamente, mas 3º sistema de cards |
| `terminal/terminal.css` (20 KB) | 4 | 10 | 86 | ok |

### 15.3 Os problemas concretos ("a interface não está boa")

1. **Três sistemas de botão/card/pill paralelos** para o mesmo trabalho visual: `.btn*` (modal_config),
   `.git-btn/.git-mini/.git-icon-btn/.git-act` (git_panel), cards/rows/pill do settings. → unificar em UM.
2. **Magia numérica** nos dois arquivos acima ignorando `--space-*`/`--radius-*`/`--shadow-*` (346+258 px).
3. **Três identidades visuais numa janela:** título "SAPHO", design system "AURORA", Git "Dagr" (fonte Norse +
   marca d'água próprias). Decidir a hierarquia de marca (sugestão: Dagr vira só um wordmark discreto).
4. **Guerra de `!important`:** 73 no total; 30 só em `editor.css` contra o Monaco (sai apenas com Monaco em
   Shadow DOM — deferido, risco alto), 19 no git_panel, 10 no ai_assistant.
5. **Elevação por sombra contradiz o manifesto** (DESIGN §4 pede luz/glow): ~71 `box-shadow` remanescentes.
6. **Fallbacks hex** (`var(--accent, #8E83E8)`) no git_panel: se o token mudar, os fallbacks driftam. Remover
   fallback (o token SEMPRE existe — import.css garante ordem).
7. **Tokens deprecados vivos:** `--ease-spring`, `--transition-bounce` (repontados) — remover usos e defs.
8. **Z-index de duas escalas** (item 15.1). Unificar numérica ou documentar o tier como intencional.
9. **`index.html` ainda mistura:** `<style>` inline, ~130 linhas de `<script>` inline, corpos dos 6 modais
   hardcoded (o chrome já é `<aurora-modal>`).
10. **CSS morto residual:** `.theme-light` (tema claro descartado), `.custom-tooltip` (tooltip.css), aliases
    de motion deprecados.

*(Empty-states: os 4 skins JÁ foram unificados — §17 item 35 — o diagnóstico antigo do §6 está superado
neste ponto.)*

### 15.4 Ordem de consolidação recomendada (para a próxima sessão de estilos)

1. **Unificar botões/cards/pills** num único sistema (base `.btn` do modal_config; git/settings herdam) —
   maior impacto visual, risco contido (CSS-only onde possível).
2. **Tokenizar os px mágicos** de `ai_assistant.css` e `git_panel.css` (mapear → `--space-*`/`--radius-*`).
3. **Remover fallbacks hex** do git_panel + tokens deprecados + `.custom-tooltip`/`.theme-light` mortos.
4. **Sombras → luz** (DESIGN §4): trocar `--shadow-md/lg` por `--elev-raised/--elev-overlay` nos painéis.
5. **Marca:** decidir SAPHO/AURORA/Dagr e aplicar.
6. (Deferido consciente) Monaco-em-Shadow p/ matar os 30 `!important`; codemod semantic no legado = descartado.

---

## 16. Estudo — file tree do VS Code (Explorer) e o CRUD implementado na AURORA — 14/07/2026

### 16.1 Como o Explorer do VS Code se comporta (pesquisa de referência)

**Criação (New File / New Folder):** input INLINE na posição-alvo da árvore (nunca dialog). Validação ao vivo
enquanto digita, numa caixinha vermelha sob o input: nome vazio; duplicado ("A file or folder … already exists
at this location"); caracteres inválidos (`< > : " | ? *` no Windows); nomes reservados (CON, PRN, AUX, NUL,
COM1-9, LPT1-9 — com qualquer extensão); `.`/`..`; termina em ponto/espaço; espaço nas pontas. Enter confirma,
Esc cancela, blur confirma-se-válido. **Criação aninhada:** digitar `a/b/c.txt` cria as pastas intermediárias.

**Rename (F2):** input inline sobre a própria row, com o nome SEM a extensão pré-selecionado. Mesmas
validações (sem separadores). Arquivo aberto no editor: a aba segue o novo path preservando estado; sujo
continua sujo. Renomear pasta migra todas as abas abertas de dentro dela.

**Delete:** vai para a LIXEIRA do SO por padrão (dialog "Move to Recycle Bin?"; `explorer.confirmDelete`
desliga). Shift+Delete = permanente com dialog próprio. Arquivo aberto: aba limpa fecha; suja permanece
marcada como deletada (na AURORA optamos por confirmar a perda ANTES e fechar — mais simples e explícito).

**Clipboard:** Ctrl+C/X/V nas rows. Colar com conflito NO MESMO diretório → auto-sufixo `name copy.ext`,
`name copy 2.ext`… Colar/mover com conflito em OUTRO diretório → dialog (Replace / Cancel; a AURORA adiciona
"Keep Both" no copy). Mover pasta para dentro de si mesma é bloqueado.

**Extras de menu:** Copy Path / Copy Relative Path · Reveal in File Explorer · Open in Integrated Terminal
(abre o terminal com `cd` no diretório) · Refresh · Collapse All. **Teclado:** F2, Delete, Shift+Delete,
Ctrl+C/X/V com a árvore focada. **Multi-select** (Ctrl/Shift+click) e **drag & drop move** completam o
Explorer — ficaram como próximos passos aqui.

### 16.2 O que foi implementado (14/07/2026) — mapa de arquivos

- **`js/tree/fs_name_utils.js`** (NOVO, puro): `validateEntryName` (todas as regras acima, incl. reservados
  por segmento e case-only-rename permitido), `nextCopyName` (sufixo copy do VS Code), `normSlash/baseName/
  parentDir/isUnder`. **+13 testes** (`tests/unit/fs_name_utils.test.js`).
- **`js/tree/standard_tree_crud.js`** (NOVO, ~700 linhas): menu de contexto (rows + área vazia) reusando as
  classes `.verilog-context-menu`/`.context-menu-item`; inputs inline de create/rename com bolha de erro ao
  vivo; delete → Lixeira (Shift+Del permanente; fallback permanente se a Lixeira falhar); cut/copy/paste com
  todos os conflitos; Copy Path/Relative Path; Reveal; **Open in Integrated Terminal** (troca pra aba TCMD e
  `cd "dir"` no PTY vivo — PowerShell, aspas duplicadas); Refresh/Collapse All; quick-creates legados
  (cocotb/.gitignore) mantidos na área vazia; teclado F2/Del/Shift+Del/Ctrl+C-X-V; seleção + estado visual de
  recorte (`cut-pending`) re-aplicados pós-render via evento `aurora:standard-tree-rendered`.
- **Consciência de abas abertas:** rename/move migram as abas afetadas (salva sujas com confirmação ANTES,
  fecha sem re-prompt, reabre no novo path, reativa a ativa); delete conta editores abertos + sujos NO dialog
  ("N editores serão fechados / alterações serão PERDIDAS") e fecha sem prompt duplo após o OK.
- **IPC novo** (`main/ipc/files.js` + preload + `aurora-globals.d.ts`): `file:rename` (EEXIST como resposta
  p/ o dialog de conflito; case-only rename no Windows via rename em 2 passos; `fse.move` cobre EXDEV),
  `file:trash` (`shell.trashItem`), `file:copy-any` (`fse.copy` recursivo, mesmo contrato EEXIST).
- **`js/terminal/shell_terminal.js`:** método `openAt(dir)` + `window.shellTerminal`.
- **Roteamento:** `project_tree_actions.handleTreeContextMenu` delega pro CRUD quando a view ativa é
  'standard' (as views verilog/hierarchy mantêm seus menus).
- **Renderer:** `dataset.isDir` nas rows + evento pós-render (`standard_tree_render.js`).
- **CSS** (`css/tree/file_tree.css`): `.selected`, `.cut-pending`, `.tree-inline-input` (+`.invalid`),
  `.tree-inline-error` (bolha vermelha), `.hidden-during-rename` — tudo em tokens.
- **i18n:** 46 chaves × EN/PT em `fileTree.crud` (inserção cirúrgica preservando o formato dos locales).

### 16.3 Lacunas conhecidas (próximos passos do CRUD)

- [ ] Multi-select (Ctrl/Shift+click) + operações em lote.
- [ ] Drag & drop para mover entre pastas (com `explorer.confirmDragAndDrop`-like).
- [ ] Undo (Ctrl+Z) de operações de arquivo (VS Code mantém um undo-stack próprio do Explorer).
- [ ] Auto-refresh por watcher do diretório na view Folders (hoje os próprios ops re-renderizam; mudanças
  externas dependem do Refresh manual — ligar `watchDirectory` é barato e o IPC já existe).
- [ ] Renomear com aba aberta preserva conteúdo mas não cursor/scroll (close+reopen). Aceitável; melhorar se incomodar.
- [ ] `.spf` awareness: renomear/deletar um `.v` trackeado no .spf da view verilog não atualiza o .spf (as
  views são independentes hoje; avaliar sync).

---

## 17. Quadro vivo reconciliado — execução por níveis (ex-`docs/BACKLOG_RECONCILIADO.md`, mesclado 14/07/2026)

> Gerado em 16/06/2026 por reconciliação multi-agente do §13 de `ESTUDO_COMPLETO_AURORA.md`,
> `DESIGN.md` e `surfer-feasibility.md` **contra o código e o git real** (a régua §13 estava
> desatualizada: vários `[ ]` já estavam feitos em commits recentes). 58 itens restantes,
> ordenados do mais fácil ao mais complexo. Convenção: ao concluir → commit + pull (sem push) + `[x]`.

---

### Estado em 18/06/2026 — snapshot atual (ESTE é o quadro vivo)

> Reconciliado contra o código real (re-análise multi-agente 18/06). A régua §13 do ESTUDO está
> desatualizada — **este snapshot vence.** `main = feature/aurora-revamp`; os 8 commits paralelos
> descartados (splits de god-files + 3 testes) ficam salvos na tag `main-pre-revamp-20260617`.

#### ✅ Feito (checado)

**Fundação:** [x] Vite (renderer, stage 0–4) · [x] 301 testes (27 unit + 3 e2e) · [x] B4 (tsc no CI + guard
de `.js` gerado) · [x] B5 (`.js` gerado gitignored) · [x] B10 (cobertura vitest-v8 + Codecov + badge) ·
[x] knip/deadcode no CI · [x] commitlint + hooks.

**Segurança:** [x] V1–V12 (XSS LaTeX, `exec`→`execFile`, path traversal, `openExternal`, token MCP, allowlist,
renames pelo card) · [x] CSP + `sandbox:true` nas 5 janelas.

**Performance:** [x] P2–P17 (sem reparse por frame, classificação por mtime, `initMonaco` idempotente,
`contain`/`content-visibility`, throttles, ResizeObserver, decorations por range visível, leaks fechados).

**Features:** [x] Dagr/Source Control completo (status/diff/stage/commit/amend/branch/clone/publish + OAuth) ·
[x] G1 (14 git tools p/ IA + namespace `git`) · [x] decorações de git na file tree · [x] O10 find-in-files
(Ctrl+Shift+F) · [x] O12 painel Git · [x] O3 Verilator streamado · [x] O8 cocotb · [x] Surfer (viewer externo
v0–v3: layout/translators/complexos/grupos/markers) · [x] Processor Hub · [x] Wave Config + instrumentação.

**Robustez/UX (esta sessão):** [x] rename robusto (job+verdito) · [x] imagens chegando à IA · [x] anexo
persistente · [x] glow na 1ª msg · [x] LaTeX `\text` · [x] error boundary · [x] file tree clicável pós-rename ·
[x] Dagr branding (fonte Norse + marca d'água) · [x] empty-states unificados.

**Componentes Lit (design system, ~40%):** [x] toast · [x] tooltip · [x] welcome (+ canvas aurora) ·
[x] modal · [x] tabs (shell) · [x] terminal (shell) · [x] **command-palette** (completo + ligado, §14.25) ·
[x] **statusbar** (ligado ao vivo — thin shell, §14.22) · [x] **titlebar** (ligado ao vivo — no-shadow, §14.23) ·
[x] **modal/toast a11y** (focus-trap + return-focus + `aria-live`, §14.24).

**Repo/infra:** [x] naming SAPHO/Aurora-IDE · [x] CODEOWNERS · [x] CodeQL · [x] dependabot auto-merge ·
[x] CITATION/ROADMAP · [x] disclosure de terceiros · [x] README+badges.

#### ⬜ Aberto — do mais fácil ao mais difícil

**Decisões suas (decidir, não implementar):**
- [x] **Codecov** — conectado ao `nipscernlab/aurora` (mostrou ~68% de cobertura); upload + guard no CI
  prontos. Falta só confirmar que o badge do README enche. Ver §14.19/§14.25.
- [ ] **Merge do PR de release v6.4.0** — seu clique.
- [ ] **P6** (painéis em overlay?) · **tokens semânticos** (recomendo descartar — tema único).

**Fácil (1–3) — FECHADO (18/06):**
- [x] **O4** persistir os toggles do find-in-files (case/word/regex) entre sessões — via `localStorage`
  (`aurora.search.toggles`), restaurados no `init` e salvos a cada clique. *(precisa teste ao vivo)*
- [x] **D5** `try/catch` na criação do editor — **já estava feito**: a IIFE do `addTab` (`tab_manager.js`
  ~1152) fecha a aba tanto no `!editor` quanto no `catch`. Nada a fazer.
- [x] **Re-habilitar o E2E "abrir na linha"** — FEITO (18/06): reproduzido **localmente** e a causa era
  **isolamento de teste**, não bug. Os testes de split-pane antes deixam um split focado → `addTab` roteia o
  arquivo pro split (sem `revealPosition`) e retorna antes do reveal. Fix **só no teste** (`setFocus(0)` antes
  do `addTab`), **zero mudança em produção**. E2E 9/9, unit 301/301. Ver §14.21.

**Médio (4–6):**
- [x] **`<aurora-statusbar>` ao vivo** — FEITO (18/06): thin shell igual aos `<aurora-tabs>`/`<aurora-terminal>`
  — `<div class="status-bar">` → `<aurora-statusbar class="status-bar">` + `<slot>`; os **8 indicadores** e os
  **5 drivers** continuam funcionando sem alteração (light-DOM preservado). Property-driven vira fallback do
  Design Lab. Zero regressão (301 unit + 9 E2E). Ver §14.22. *(precisa teste visual ao vivo)*
- [x] **`<aurora-tabs>` passo 2** — FEITO 19/06/2026 (NÃO o rewrite data-driven). Re-mapeado: tab-strip é DOM 100% imperativo (TabManager em ~15 pontos / 4 arquivos, sensível a perda de dados/P1) → rewrite data-driven = alto risco cross-file sem E2E (mesma decisão do aurora-tree passo 2). Entregue seguro e contido no componente (zero mudança no TabManager): `<aurora-tabs>` virou controlador de **tablist ARIA** (role=tablist/tab + aria-selected espelhando `.active`, roving tabindex, teclado Arrow/Home/End/Enter), via MutationObserver; helper puro `nextRovingIndex` testado. +5 testes; 9 E2E. Ver §14.44. · [ ] **`<aurora-activity-bar>`** (feature nova, adiada).
- [x] **F1** consolidar ícones — FEITO (18/06): a IDE já era 100% Phosphor (`@phosphor-icons/web`,
  vendorizado local em `dist/vendor/phosphor`) + SVG inline nos botões de compile; FontAwesome já não tinha
  uso real (as ocorrências de `fa-` eram comentários/regex de hex) e nem era mais dependência. O único resíduo
  eram 2 linhas mortas de exclusão (`!node_modules/@fortawesome/...`) no `package.json` — removidas. Ver §14.27.
- [x] **F2** fonts 100% local — FEITO/verificado (18/06): Inter + JetBrains Mono são woff2 variáveis locais em
  `assets/fonts/` (`css/base/fonts.css`, importado 1º no `import.css`), sem `@import`/`<link>` de CDN; o
  `vite build` resolve os `url()` e emite as 4 fontes em `dist/assets`. Nada a mudar — só confirmar. Ver §14.27.
- [x] **B12** CLIs de IA sob demanda — FEITO (18/06): `@anthropic-ai/claude-code` (219MB) e
  `@openai/codex` (239MB) saíram do bundle (~457MB a menos no instalador); baixam do registry npm no 1º uso,
  com verificação de integridade sha512, cache em `userData/cli-cache`, progresso no chat e fallback. *(precisa
  teste ao vivo: 1ª mensagem num provider de assinatura baixa o CLI)* Ver §14.28.
- [x] **O9** DigitalJS — FEITO + **validado ao vivo** (18/06): o esquemático estático já era o PRISM
  (Yosys+netlistsvg); o O9 real é **simulação interativa** — `digitaljs` + `yosys2digitaljs` (deps novas;
  `jquery`/`jquery-ui` também), modo "Simular" na janela PRISM, engine síncrono + `dagre` (zero Web Worker),
  lazy-load. Endurecido nos testes ao vivo (jQuery/jquery-ui, timeout+guard de tamanho p/ designs grandes) e
  polido (rótulos limpos, centralizar/zoom/pan/drag iguais ao PRISM, fundo uniforme, dígito 0/1/x ao vivo nas
  caixinhas). Ver §14.29 + §14.31. *(Os CLIs de IA viraram pin exato — §14.28/§14.31.)*
- [x] **G4** auditoria de i18n — FEITO (18/06): `scripts/check-i18n.js` (en/pt sync + chaves indefinidas, virou
  guard de CI), 5 chaves faltantes adicionadas (EN+PT), 661 chaves em sincronia. Ver §14.25.
- [x] **G6** governança de modelos — FEITO (18/06): (a) robustez — `resolveModelId` (alias 'latest'/'default' +
  mapa de migração), `isModelUnavailableError`, auto-fallback em testConnection/generateOneshot, mensagem
  acionável no chat (id aposentado não quebra mais em runtime); (b) indicador de tokens por conversa — badge
  "· N tok" no sidebar (counter por conversa já existia), sem custo em $. Ver §14.30.

**Difícil (6–7):**
- [x] **O2** Verible LSP — FEITO 19/06/2026 (diagnostics + format + outline + hover + def/refs; ponte stdio custom; binário no bootstrap). Ver §14.32. · [x] **O11** slang-server — FEITO 19/06/2026 (análise semântica + autocompletar, toggle; complementa o Verible). Ver §14.34. · [x] **O7** tree-sitter — FEITO 19/06/2026 (highlight preciso via semantic tokens p/ Verilog/SV/C/C++; CMM/ASM seguem Monarch). Ver §14.35.
- [x] **`<aurora-tree>` passo 2** — FEITO 19/06/2026 (endurecimento de perf, sem virtual scroll: content-visibility na view Files + content-visibility:hidden nas subárvores colapsadas da hierarchy + guarda de contagem. content-visibility já cobria o paint fora da tela; virtual scroll seria reescrita arriscada). Ver §14.36. · [x] **`<aurora-terminal>` passo 2** — FEITO 19/06/2026 (já tinha cap 5000 + content-visibility + contain + batched; fechei a única lacuna: cap por card agrupado + content-visibility nos grouped-message). Ver §14.37. · [x] **`<aurora-editor>`** — FEITO 19/06/2026 (shell semântico fino envolvendo `.editor-container`, padrão dos outros componentes; E2E que abre o editor passou). Ver §14.38.
- [x] **A3** migrar globais (~490× electronAPI → imports) — **CONCLUÍDO 100% 19/06/2026**: `electron_api.js` virou handle LIVE (Proxy, encaminha pro window.electronAPI atual → mocks de teste e checagens de existência seguem corretos) + `electron_api.d.ts` (tipo pros .ts). Migrados TODOS os módulos restantes — 22 .js (incl. god-files compilation_module/aurora_api/tab_manager + test-mockados wave_toolchain/wave_signal_validator/processor_compiler) e 4 .ts (wave_state_store/spf_store/spec_runner/spec_factory). **Nenhum window.electronAPI fora do electron_api.js.** Todos os testes que trocam globalThis.window seguem passando (valida o Proxy). Commits 5502105/fb3728b/44610af. Ver §14.39. · [x] **G8/G9** plugins + spawn único — FEITO 19/06/2026 (G9: `spawnTracked` único ponto de spawn + 9 sites de toolchain migrados, incl. decode-complex antes não-tracked; G8: política default-on×sob-demanda documentada). Ver §14.40.
- [x] **PRISM reskin** (identidade aurora no viewer RTL) — FEITO 19/06/2026: o prism.css JÁ estava todo no design system Aurora; alinhei o único ponto fora (fallbacks netlistsvg vscode → tokens). Demais hardcodes intencionais (close-red = igual à titlebar; schematic/sim afinados no O9). Ver §14.41.

**Radical (8–10):**
- [~] **A2** decompor god-files (ai_assistant 4592 · compilation 4197 · tab_manager 2044) — EM ANDAMENTO. **compilation_module: decomposição COMPLETA (5/5 extrações)** 19/06/2026 — #1 hierarchy_parser +11 testes `eb14e3f`; #2 hierarchy_view `4eecdf7`; #3 wave_toolchain +16 testes `e03c07e`; #4 wave_signal_validator +13 testes `2a57e47`; #5 processor_compiler +18 testes (deps bag `_instanceDeps`, delegadores, seams `lastCompiledCmmPath`+`_chegueiInstrumentProc` preservados, revisão adversarial 0 defeitos). God-file **4197 → 3116 linhas (−1081)**, ~58 testes novos. **ai_assistant_manager + tab_manager EM ANDAMENTO** (§14.43, plano mapeado por workflow + aprovado): Wave 1 (helpers puros) FEITA — AI-1 system_prompt `b654b4d`, TM-1 tab_utils `0b2eb53`, AI-2 chat_render (markdown+math+syntax+file-ref) `54722b2`, AI-3 ai_metadata `df357d0`. **Wave 2 em andamento:** TM-2 file-type/ícone (isImageFile/isPdfFile/isBinaryFile/getFileIcon + sets → tab_utils.js puro; 4 delegadores estáticos; +6 testes; 1957→1834). **file-watching (b): já estava feito** (tudo em tab_watchers.js; só o estado fica na classe). TM-3 save-name helpers (appendDefaultExtension/validateSaveName + 3 regex VALID_* → tab_utils.js puro; 0 callers externos → sem delegador; +7 testes; 1834→1802). TM-4 untitled metadata PURO (decisão do usuário: untitled se revelou orquestração monaco/DOM com callers externos = alto risco/baixo ganho; extraído só isUntitled/untitledDisplayName/nextUntitledPath → novo untitled_docs.js, orquestradores ficam na classe; delegadores + counter seam; +8 testes; 1802→1800, ganho = +47 linhas testáveis). **save_flow DEIXADO NA CLASSE por decisão do usuário** (API de save mais chamada/espalhada — saveAllFiles tem 8 callers externos —, sensível a perda de dados/lição P1, parte pura já saiu no TM-3, sem cobertura E2E → deps bag = alto risco/baixo ganho). **tab_manager Wave 2 FECHADA: 2044→1800**, núcleo entrelaçado fica na classe por decisão. **classe do ai_assistant EM ANDAMENTO:** AI-5 chat_scroll (matemática pura de scroll → js/ai/chat_scroll.js; +7 testes; 3376→3375); AI-6 anexos (builders de chip puros → js/ai/chat_attachments.js; +7 testes; 3375→3353); AI-7 strip de tool-call inline (→ js/ai/tool_call_text.js; dedup de 3 cópias + testável; +7 testes; 3353→3331); AI-8 permission-gate (decideToolPermission + previewArgs + permissionOptionsHtml → js/ai/tool_permission.js; confirmToolCall fica delegador; +10 testes; 3331→3299); AI-9 provider/model view (→ js/ai/provider_view.js; +6 testes; 3299→3271); AI-10 history (→ js/ai/chat_history.js; +7 testes; 3271→3219); AI-11 streaming/turn (buildApiMessages + buildProjectContext → js/ai/chat_turn.js; núcleo de streaming/sessão fica na classe; +5 testes; 3219→3204). **A2 ai_assistant CONCLUÍDO: 4592→3204 (−1388, ~30%)**, ~+50 testes na leva da classe (95 testes A2 no total). Decisão consistente: extrai o puro/testável, orquestração de estado/DOM/IPC/streaming fica na classe. **A2 (ai_assistant + tab_manager + compilation_module) — decomposição substancial concluída.** Resta o A3 (migrar globais restantes). **Restante:** classe do ai_assistant (streaming/provider/history/tool-chips — alto risco, ~40 campos) + tab_manager (file-type, file-ops, watchers, untitled, save_flow — estado estático entrelaçado) → **melhor com contexto fresco** (lição do compilation_module #3-5). Detalhe em §14.42/§14.43.
- [~] **O1** Surfer embarcado (WASM em iframe + sync WCP editor↔onda) — **due diligence FEITA 19/06/2026, BLOQUEADO no dev** (ver §16 do surfer-feasibility): (1) iframe WASM sem bundle web baixável (GitLab packages só nativo) + remoto descartado por CSP/sandbox/offline/privacidade; (2) `surfer.exe` v0.7.0 suporta `--wcp-initiate` (confirmado), mas o spec WCP está 404/instável e o handshake TCP não é validável aqui. Precisa de máquina com Rust+`trunk` (build do bundle) e/ou o app rodando ao vivo (iterar WCP). Viewer externo (§9–§15) cobre o uso; embed é conveniência, não bloqueia nada. · [x] **`<aurora-panel>` dockável** — FEITO 19/06/2026: shell semântico seguro (role=region + aria-label landmark + helper puro nextCollapseState), sidebar embrulhado como `<aurora-panel class="file-tree-container">`, resize.js usa o helper; NÃO o docking-rewrite arriscado (mesma decisão do aurora-tree passo 2). +3 testes; 9 E2E. Ver §14.45. **Surfer-polish:** tag (procType) nas variáveis multi-proc (Surfer+GTKWave, single-proc byte-idêntico; +4 testes; §14.46). **Git badges:** alinhados à direita nas 2 file trees (margin-left:auto + host .verilog-file-content; §14.47).
- [ ] **O5** YoWASP · **B11** cross-platform (Linux/Mac).

**Externo/manual:** [ ] B2 code signing (cert) · [ ] mídia real do README · [ ] toggles do GitHub.

---

### Handoff 18/06 — para a próxima sessão (migração de máquina)

**Onde estamos:** tudo na branch **`main`** (pushed, verde). Para continuar é só abrir o repo e seguir o
backlog acima (ordem fácil→difícil).

**Convenções desta linha de trabalho (a próxima IA deve seguir):**
- Ao concluir uma implementação de verdade: atualizar o `.md` relevante, **commit + push** (o usuário autorizou).
- Antes do push: `git fetch origin && git rebase origin/main` — o dependabot mergeia direto na `main` o tempo todo.
- O usuário **testa só no fim** (não consegue testar entre implementações). Implementar **por completo**; ele valida depois.
- Pra mudança de UI, rodar os **E2E localmente** (`npm run test:e2e`) — sobem o Electron real, não dependem do CI.
- Verde local exigido: ESLint, `tsc --noEmit`, **301 unit**, **9 E2E**, `vite build`, e os guards
  (`check-i18n`, `check-no-generated-js`). **Atenção:** os `.js` gerados de `.ts` (lista no `.gitignore`) às
  vezes vazam pro index — `git status` antes de commitar; se aparecerem, `git reset HEAD <arquivo>`.
- Escrever em **linguagem clara** (pedido do usuário — nada de frases cifradas/genéricas).

**Pendente de VERIFICAÇÃO VISUAL do usuário** (implementado, aguardando teste ao vivo): statusbar, titlebar,
modal/toast a11y, command-palette (Ctrl+Shift+P), i18n em PT, O4 (toggles do find-in-files persistem).

**Pendente de AÇÃO do usuário (externo, só ele faz):**
- [ ] Merge do PR de release-please (v6.4.0) — clique no GitHub.
- [ ] **B2** code signing — certificado externo (SignPath/Azure) p/ acabar com o SmartScreen.
- [ ] Mídia real do README — gravar os GIFs.
- [ ] Toggles do GitHub — Discussions, secret scanning/push protection, topics/social.
- [ ] Confirmar o badge de cobertura do Codecov no README (já está conectado).

**Próximo a implementar (resumo — detalhe no backlog acima):**
- **Médio:** `<aurora-tabs>` passo 2 (entrelaçado c/ TabManager → após A2). _(F1/F2 §14.27 · B12 §14.28 · O9 §14.29 · G6 §14.30 — todos FEITOS 18/06. Médio esgotado exceto aurora-tabs.)_
- **Difícil:** O2/O11 LSP (Verible/slang) · O7 tree-sitter · `<aurora-tree>`/`<aurora-terminal>` passo 2 ·
  `<aurora-editor>` · A3 globais · PRISM reskin.
- **Radical:** A2 god-files · O1 Surfer embarcado · `<aurora-panel>` dockável · O5 YoWASP · B11 cross-platform.

---

### Já concluído mas não marcado no §13 (provado por commit/código)

- **V10** — `execFile` no lugar de `exec(string)` em `main/utils.js` (`eb0ade4`).
- **V12** — filtro de `spec.env`/`prependPath` antes do spawn (`eb0ade4`).
- **CSP + sandbox** — `onHeadersReceived` + `sandbox:true` nas 5 janelas (`13ac024`).
- **B4** — `tsc --noEmit` + sanity `node --check` no CI (`d03c5ee`).
- **THIRD_PARTY_NOTICES.md** + `license`/`repository`/`bugs`/`homepage` no `package.json` (`d03c5ee`).
- **Mark de TTI** — `performance.mark('aurora-interactive')` no fim do init (`d03c5ee`).
- **A8** — `npm run deadcode` (knip) no CI.
- **O8 cocotb** — fluxo de teste completo (builders/runner/UI).
- **Features de IA** — anexos (imagens+arquivos), hover do welcome, highlight `.spf`, fila de follow-up (`016230c`+).

> Nota: o doc marcava **B12 `✔`**, mas o download sob demanda dos CLIs **não** foi implementado
> (ainda no `asarUnpack`). Reclassificado como aberto (rank 41).

---

### Lote em execução agora: Triviais + Fáceis + Médios (ranks 1–38)

#### Triviais (dificuldade 1–2)

- [x] 1. **B9** — refs mortas limpas (smoke.test, yanc-managed-files, RELEASE.md). _Wave B_
- [x] 2. **Discussions** — link/capitalização corrigidos em CONTRIBUTING. _(toggle de settings = manual)_ _Wave A_
- [~] 3. **Metadados do repo** — `homepage` no package.json; topics/social = toggle de settings (manual). _Wave A_
- [x] 4. **CODEOWNERS** — `.github/CODEOWNERS` criado. _Wave A_
- [x] 5. **B3** — README/badges → canal `sapho`. _Wave A_
- [x] 6. **B7** — sentinelas validadas pós-bootstrap no `release.yml`. _Wave B_
- [x] 7. **B8** — `release.yml` em `on:release:published`; `build.ps1`/`.bat` aposentados. _Wave B_
- [ ] 8. **release-please** — manter como fluxo único (PR #12 v6.4.0: **merge é manual seu**, não mexo no remoto). _leve/S_
- [x] ~~9. **Branch protection** na `main`~~ — **REMOVIDO do plano** (decisão do usuário: não complicar). 
- [x] 10. **CodeQL** — `codeql.yml` criado. _Secret scanning/push protection = toggle de settings, manual._ _Wave A_
- [x] 11. **commitlint + hook commit-msg** — instalado e testado. _Wave A_
- [x] ~~12. **Limpar releases órfãs**~~ — **REMOVIDO do plano** (decisão do usuário: não deletar releases).
- [x] 13. **CITATION.cff + ROADMAP.md** criados (autores reais). _Wave A_
- [x] 14. **Vite C** — fallback raw removido (erro claro se dist ausente). _Wave B_
- [x] 15. **V8** — launches/decode-complex pela `binary_allowlist`. _Wave C_

#### Fáceis (dificuldade 3)

- [ ] 16. **O14 WaveDrom** — diagramas de timing só p/ docs/specs. **MANTIDO DEFERIDO** — não há superfície onde renderizar (não existe preview de markdown/docs na IDE); o **surfer** já cobre waveforms de *simulação* (VCD/FST), e WaveDrom seria para diagramas *desenhados à mão* de spec. Sem um caso de uso/superfície concreta, construir seria especulativo. _Pronto p/ fazer assim que houver uma superfície (ex.: preview de `.json5`/markdown)._
- [x] 17. **V9** — renames passam pelo card Allow/Deny. _Wave C_
- [x] 18. **V11** — `set_command_override` sempre confirma (mesmo no allow). _Wave C_
- [x] 19. **B6/B13** — `copy-components` por junction. _Wave B_
- [x] 20. **README com mídia** (scaffold docs/media) + badge electron 39. _Wave A_
- [x] 21. **De-flake e2e** `split-pane > PRISM open-at-line` (poll-until-settled). _Wave D_

#### Médios (dificuldade 4–5)

- [x] 22. **B1** — SHA256SUMS verificado nos 4 downloaders (surfer pinado). _Wave B_
- [x] 23. **Naming** — decisão SAPHO=suíte/Aurora-IDE=app; URLs corrigidas. _Wave A_
- [~] 24. **Dependabot** — workflow de auto-merge criado; triagem dos PRs = manual (remoto). _Wave A_
- [x] 25. **Disclosure de terceiros user-facing** — seção no About. _Wave F (commit 3d4ac32)_
- [x] 26. **A4** — `global.currentProject*` colapsado no `state`. _Wave D_
- [x] 27. **Higiene de memória** — `_capMessages()` (bound de 400) + base64 já saía. _Wave D_
- [x] 28. **O3** — build do Verilator streamado. _Wave E_
- [x] 29. **Smoke de orçamento de startup no CI** (assert de TTI). _Wave B_
- [x] 30. **V7** — token de sessão no MCP local (path/Bearer). _Wave C_
- [~] 31. **B2** — `docs/CODE_SIGNING.md` + nota no release.yml; assinatura real depende de cert externo. _Wave B_
- [x] 32. **O10 find-in-files** — busca em todo o projeto (Ctrl+Shift+F + botão na toolbar), backend recursivo sem dependência nova, resultados agrupados por arquivo, i18n EN/PT. _feito (precisa teste ao vivo)_
- [x] 33. **O12 simple-git** — painel source-control completo estilo GitHub Desktop: status/diff/stage/commit/amend/branch/clone/publish + i18n + badge auto-update + pull --autostash. _feito (precisa teste ao vivo)_
- [x] 34. **V4** — Edit/Write nativos do Claude bloqueados. _Wave C_
- [x] 35. **Empty-states** — 4 skins unificados numa linguagem visual única estilo VS Code (CSS-only, nenhuma classe/markup mudou). _feito_
- [ ] 36. **Tokens B** (`ai_assistant.css` base→semantic). **RECOMENDADO DESCARTAR.** `semantic_tokens.css` é *puro alias* (zero mudança de valor em runtime) e o próprio cabeçalho dele diz que a camada semântica é "o vocabulário que CÓDIGO NOVO referencia" — código existente mantém os tokens base. Como o app tem **tema único, sem temas alternativos jamais** (decisão do usuário), o motivo de existir tokens semânticos (portabilidade de tema) não se aplica. Resultado: ~109 trocas que não mudam nada em runtime, contra a própria regra do design. Sem valor funcional → descartar (junto do #39 global).
- [ ] 37. **P6** — `transition:width`→`transform`. **PRECISA DE DECISÃO DE UX.** Não é ganho de perf "de graça": painéis hoje *empurram* o conteúdo (animar `width` força layout/frame); `transform` só é barato em **overlay** (painel flutua por cima). Ou seja, fazer isto = mudar push→overlay, um comportamento que o usuário não pediu. _Faço se você quiser painéis em overlay; senão fica como está._
- [x] 38. **Condensar prompt injection** — cap de tool-results (`capForModel`, chat.js:76/389) + prompt-cache ephemeral (chat.js:198) + bound de mensagens (#27) já existem. O restante é "deferido conscientemente" (§13.K). _substancialmente feito._

---

### Próximos níveis (fora deste lote)

#### Difíceis (6–7)
39. Tokens codemod base→semantic (~392 usos) · 40. ~~B10 cobertura+Codecov~~ **FEITO (17/06)** · 41. B12 CLIs sob demanda ·
42. ~~O2 Verible LSP~~ **FEITO (19/06)** · 43. O5 YoWASP · 44. ~~O9 DigitalJS~~ **FEITO** · 45. ~~O11 slang-server~~ **FEITO (19/06)** · 46. `<aurora-tabs>` passo 2.

#### Radicais (8–10)
47. A3 migrar globais · 48. `<aurora-tree>` passo 2 · 49. `<aurora-terminal>` passo 2 ·
50. `<aurora-statusbar>` ao vivo · 51. O7 tree-sitter · 52. A2 decompor god-files ·
53. O1 Surfer (iframe WASM + WCP + cores por opcode) · 54. `<aurora-editor>` · 55. `<aurora-titlebar>` ·
56. `<aurora-activity-bar>` · 57. B11 cross-platform · 58. `<aurora-panel>` dockável.

### 14.49 Sessão 14/07/2026 (parte 2) — Estudo do sistema de IA + fix do AskUserQuestion em bypass + modernização Claude/Codex

Ver §18 (estudo completo). Entregue nesta sessão: (1) **bug do card AskUserQuestion em bypass CORRIGIDO** —
a tool nativa `AskUserQuestion` do Claude Code agora está em `DISALLOWED_CLI_TOOLS` e as `MCP_TOOL_RULES`
das duas pontes direcionam o modelo para `mcp__aurora__ask_user_question` (a única variante que renderiza o
card interativo); (2) **modelos atualizados** — Claude: default/fable/opus/sonnet/haiku/opus[1m]; Codex:
default + GPT-5.6 Sol/Terra/Luna + Spark (Pro-only); (3) **reasoning effort ligado no Codex**
(`-c model_reasoning_effort`, resume-safe) — o mesmo controle segmentado low→max serve às duas pontes;
(4) **CLIs bumpados**: claude-code ^2.1.202, codex 0.144.3 (lock + cli_manifest re-sincronizados).

---

## 18. Estudo — sistema de IA da AURORA (Claude Code + Codex) — 14/07/2026

> Pesquisa dupla: mapa completo do código (multi-arquivo, com file:line) + estado da arte via documentação
> oficial (code.claude.com/docs, learn.chatgpt.com/docs, npm). **Foco: as duas pontes de assinatura.**
> Roadmap de melhoria brutal de performance/confiabilidade em 18.5.

### 18.1 Arquitetura atual (como é hoje)

`ai_assistant_manager.js` (renderer, 3204 linhas) → `aiAPI.startChat` (IPC fire-and-forget,
`main/ipc/ai.js:162`) → roteia por provider: `claude-code` → `main/ai/claude_code.js`, `chatgpt` →
`main/ai/codex_cli.js`, demais → `main/ai/chat.js` (Vercel AI SDK). Streaming volta por eventos
`ai:chat-event` (`text-delta`/`tool-call`/`tool-result`/`finish`/`error`). System prompt montado no
renderer (SYSTEM_PROMPT + contexto do projeto por turno). Histórico: 1 JSON por conversa (userData),
cap 400 mensagens.

- **Claude Code**: spawn por turno de `claude -p --output-format stream-json --verbose
  --include-partial-messages --permission-mode bypassPermissions --mcp-config <tmp> --strict-mcp-config
  --disallowed-tools "Bash … AskUserQuestion" [--model] [--effort] [--resume <sid>]`, prompt via stdin,
  OAuth de assinatura (`~/.claude/.credentials.json`; API keys removidas do env). Tools da AURORA via
  MCP HTTP (`aurora_mcp_server.js`, ~90 tools de `tools.js`). Reaper de inatividade 120s; usage/custo
  acumulados do evento `result`; janelas de rate-limit de `rate_limit_event`.
- **Codex**: spawn por turno de `codex exec [resume <tid>] --json --skip-git-repo-check
  --dangerously-bypass-approvals-and-sandbox -c mcp_servers.aurora.url=… -c tool_timeout_sec=600
  [-m modelo] [-c model_reasoning_effort=…]`. Mesmo MCP. SEM deltas de token (mensagens inteiras via
  `item.completed`); custo sempre 0; plano lido do JWT de `~/.codex/auth.json`.
- **Permissões**: os 3 modos do renderer (ask/writes/allow) só gateiam as tools MCP da AURORA
  (`tool_permission.js`); o CLI SEMPRE roda bypass (decisão consciente: `-p` sem TTY auto-negaria
  writes/bash silenciosamente). Guard-rails reais = `--disallowed-tools` (Claude) + regras de texto (Codex).

### 18.2 O bug "bypass → nenhum card de AskUserQuestion" (CORRIGIDO 14/07)

**Causa raiz** — existem DOIS mecanismos de pergunta e só um mostra card:
1. `mcp__aurora__ask_user_question` (tool MCP da AURORA) → `tool_runner.js` pula o gate de permissão
   (a pergunta É o prompt) → `showAskUserQuestionInline` → **card interativo**. ✔
2. `AskUserQuestion` NATIVO do CLI → em `-p` + bypass sem TTY não há como perguntar a um humano; o
   evento chegava como `tool-call` genérico → `startToolChip` → **chip inerte girando**, sem card e sem
   como responder. ✘

Como `permissionFlag()` força bypass em todo turno e a tool nativa não estava bloqueada nem havia
qualquer menção a `ask_user_question` nas MCP_TOOL_RULES, o modelo usava a nativa e o card NUNCA
aparecia. **Fix aplicado**: `AskUserQuestion` adicionada a `DISALLOWED_CLI_TOOLS` (claude_code.js) +
seção "Asking the user" nas MCP_TOOL_RULES das DUAS pontes apontando para
`mcp__aurora__ask_user_question`. Nota de referência: desde o claude-code 2.1.199 a nativa carrega
`_meta["anthropic/requiresUserInteraction"]` e SEMPRE cai no callback `canUseTool` mesmo em bypass —
mas isso só ajuda no Agent SDK (onde há callback); no modo `-p` atual, bloquear + direcionar é o correto.

### 18.3 Modelos & níveis — estado da arte verificado (07/2026)

**Claude Code** (CLI 2.1.202; docs code.claude.com):
- Aliases (nunca ids datados — resolvem sempre pro mais novo): `default` (Opus 4.8 em Max/Enterprise,
  Sonnet 5 em Pro/Team), `fable` (Claude Fable 5), `opus` (4.8), `sonnet` (5), `haiku` (4.5),
  `opusplan`, sufixo `[1m]` p/ contexto 1M (`opus[1m]`; Sonnet 5 já é 1M nativo na API Anthropic).
- Effort REAL e atual: `--effort low|medium|high|xhigh|max` (default `high` em Fable 5/Sonnet 5/Opus 4.8) —
  os níveis da AURORA NÃO estavam ultrapassados, apenas o Codex não os usava. `ultracode` = xhigh +
  workflows (≥2.1.203, ainda não exposto).
- Caminho recomendado p/ embedding: **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, `query()`),
  com `canUseTool` (permissões de verdade por modo: default/dontAsk/acceptEdits/bypassPermissions/plan),
  MCP in-process, `resume`/`continue`, hooks, usage no `ResultMessage` — ver 18.5.

**Codex** (CLI 0.144.3; docs learn.chatgpt.com):
- Lineup atual: família **GPT-5.6 — `gpt-5.6-sol` (default, complexo), `gpt-5.6-terra` (equilíbrio),
  `gpt-5.6-luna` (rápido)** — Plus E Pro; `gpt-5.3-codex-spark` (iteração em tempo real, Pro-only);
  `gpt-5.4`/`gpt-5.4-mini`. **Deprecados**: gpt-5.2, gpt-5.3-codex (e os antigos gpt-5/gpt-5-codex
  rejeitados em auth ChatGPT).
- Reasoning effort: `model_reasoning_effort` = minimal/low/medium/high/xhigh (+ `max` first-class e
  `ultra` na 5.6). Agora WIRED na AURORA via `-c` (resume-safe).
- Caminho recomendado p/ embedding: **`@openai/codex-sdk`** (Thread API, `runStreamed()` → eventos
  estruturados, JSON schema de saída) ou o protocolo app-server (thread/turn UUID7, `history_mode`).

### 18.4 Achados de performance/confiabilidade (mapa completo)

1. **Spawn por mensagem** nas duas pontes (cold-start de CLI a cada turno; mcp-config reescrito por
   turno). Continuidade via `--resume`/`exec resume` ok, mas sessão nova re-injeta transcript inteiro.
2. **Codex sem streaming de tokens** — `agent_message` chega inteiro (`item.completed`); percepção de
   lentidão. O app-server/SDK tem deltas.
3. **Zero retry/backoff** em 429/5xx/rede — qualquer falha transitória mata o turno (chat.js e pontes).
4. **Full-history re-send** por turno no caminho API (só Anthropic tem prompt-cache); caps: 400 msgs,
   100KB por tool-result, dataURLs strip.
5. **6+ constantes de timeout sobrepostas** mantidas em sincronia por comentário (120s stream, 120s
   inatividade CLI, 120s/5min/10min tool_bridge, 600s MCP, 180s+12min watchdog renderer, 7min oneshot).
6. **taskkill /T /F** spawnado por abort/reaper (ok, mas pesado); regex de scrubbing multi-padrão por
   flush de delta (fallback Llama/Qwen).
7. Custo Codex sempre 0 (não reportado); tokens só provider-reported.
8. Pontos FORTES a preservar: fire-and-forget IPC, death-listener no tool_bridge, dedup de tool-calls,
   heartbeats de progresso do MCP (mantêm o CLI vivo em tools longas), reaper por posse do turno.

### 18.5 Roadmap de modernização (proposto, em ordem)

1. **[FEITO 14/07]** Fix AskUserQuestion + modelos/efforts atuais + bump dos CLIs.
2. **[FEITO 15/07] Ponte Claude → Claude Agent SDK** — `main/ai/claude_agent.js` (engine novo) +
   roteamento em `claude_code.js` com FALLBACK automático pro spawn legado (import falhou, binário
   .cmd-shim, ou escape hatch `AURORA_CLAUDE_LEGACY_CLI=1`). O engine dirige o MESMO binário nativo
   (`pathToClaudeCodeExecutable`) via `query()` do `@anthropic-ai/claude-agent-sdk` (0.3.210; exigiu
   zod ^4 — nenhum código próprio importa zod, só peer). Ganhos entregues: (a) **`canUseTool`** — o
   AskUserQuestion NATIVO agora renderiza o card da AURORA mesmo em bypass (tool interaction-required
   sempre cai no callback; respostas mapeadas de volta via `updatedInput.answers`; o SDK-path
   RE-habilita a tool nativa que o legado bloqueia); (b) aborts limpos via AbortController (sem
   taskkill); (c) system prompt sem limite de argv (canal de controle; sem fold >2048); (d) prompt em
   streaming-input mode (exigência do canUseTool). Paridade total de eventos/bookkeeping (convSessions,
   usage, rate-limit, reaper de inatividade 120s). MCP continua o servidor HTTP (in-process fica p/
   depois). Validado: 525 unit + 13 E2E (app boota com o engine), lint/tsc/knip/build verdes.
3. **[FEITO 15/07] Ponte Codex → `@openai/codex-sdk`** — `main/ai/codex_agent.js` (engine novo) +
   roteamento em `codex_cli.js` com FALLBACK automático pro spawn legado (import falhou, binário
   .cmd-shim, ou `AURORA_CODEX_LEGACY_CLI=1`). Thread API: `startThread`/`resumeThread(threadId)` +
   `runStreamed(prompt, {signal})` sobre o MESMO binário nativo (`codexPathOverride`). Ganhos:
   (a) aborts limpos via AbortSignal (sem taskkill); (b) **deltas incrementais de texto** quando o CLI
   emite `item.updated` de agent_message (o engine faz diff e streama; turnos whole-message degradam
   exatamente pro comportamento legado); (c) opções tipadas — `approvalPolicy:'never'` +
   `sandboxMode:'danger-full-access'` (idêntico ao que o flag bypass legado expande; continua a única
   combinação onde mcp__aurora__* roda em modo não-interativo); (d) effort + MCP via `config` (objeto →
   `--config` TOML; aceita `max` que o tipo do SDK ainda não lista). Env: CodexOptions.env SUBSTITUI o
   ambiente do filho → clone sanitizado completo (sem OPENAI_API_KEY, ripgrep no PATH). Paridade total
   de eventos/bookkeeping (convThreads, usage, reaper 120s, rewrite de model-not-supported).
   Validado: 525 unit + 13 E2E, lint/tsc/knip verdes. deps: +@openai/codex-sdk 0.144.3 (92KB).
4. **[FEITO 15/07] Retry/backoff** — `main/ai/retry.js` (puro, testado): `isTransientAiError`
   (429/5xx/network ENUMERADOS — sem falso-positivo em "512 ms"), `backoffDelay` full-jitter
   (AWS-style, base 1s, cap 8s), `TRANSIENT_MAX_ATTEMPTS=3`. Política: só re-tenta quando NADA
   chegou ao usuário (flag `anyEvent` nos engines — replay invisível; depois do 1º delta/chip,
   nunca, para não duplicar saída nem re-rodar tools). Aplicado: engines Claude+Codex (attempt
   loop com estado por tentativa) e via API (`streamText maxRetries:3` — o retry request-level
   nativo do ai-sdk, explicitado). Spawns legados ficam sem retry (são fallback).
5. **[FEITO 15/07] Timeouts unificados** — `main/ai/timeouts.js`: tabela única com a HIERARQUIA
   documentada e AUTO-VERIFICADA (throw no load se a ordem quebrar + teste): MCP_TOOL_CALL (10min)
   ≥ TOOL_INTERACTIVE (10min) > TOOL_SLOW (5min) > TOOL_DEFAULT (2min); reapers de silêncio
   (STREAM_IDLE/CLI_INACTIVITY 2min) ≤ TOOL_DEFAULT; watchdogs do renderer (ai_metadata.js, não
   importa CJS de main — hierarquia documentada + testada cross-boundary: STALL 3min > INACTIVITY,
   STALL_HARD 12min > MCP_TOOL_CALL). Consumidores migrados: tool_bridge, chat.js, claude_code,
   codex_cli, claude_agent, codex_agent (zero literais soltos). +8 testes (ai_retry_timeouts).
6. Expor `ultracode`/thinking adaptativo (Claude ≥2.1.203) e `ultra` (Codex 5.6) quando estáveis.
7. Prompt-cache/history-mode: usar `history_mode` do app-server (Codex) e confiar no resume nativo dos
   CLIs em vez de fold de transcript.

**Estado do roadmap (15/07/2026): itens 1–5 CONCLUÍDOS.** Restam os opcionais 6–7 (dependem de
estabilização upstream) e as ideias de longo prazo: processo persistente por conversa (eliminar o
cold-start de ~1-2s por turno), MCP in-process no Agent SDK, e aposentar os spawns legados quando
os engines SDK acumularem rodagem ao vivo suficiente.

---

### 14.50 Sessão 15/07/2026 — ponte Claude migrada pro Agent SDK (ESTUDO §18.5 passo 2)

`main/ai/claude_agent.js` novo (engine `query()` do @anthropic-ai/claude-agent-sdk) + roteamento com
fallback automático em `claude_code.js` (spawn legado preservado). AskUserQuestion nativo volta a
existir NO SDK-path e vira card via canUseTool; aborts via AbortController; system prompt sem limite
de argv. Detalhe completo no §18.5 item 2. deps: +@anthropic-ai/claude-agent-sdk ^0.3.210, zod 3→4
(peer-only; nenhum import próprio). Verde: 525 unit, 13 E2E, lint, tsc, knip, vite build.

### 14.51 Sessão 15/07/2026 (parte 2) — ponte Codex migrada pro codex-sdk (ESTUDO §18.5 passo 3)

`main/ai/codex_agent.js` novo (Thread API do @openai/codex-sdk 0.144.3, 92KB) + roteamento com fallback
automático em `codex_cli.js` (spawn legado preservado; `AURORA_CODEX_LEGACY_CLI=1` força o legado).
Aborts via AbortSignal; deltas incrementais de agent_message via item.updated (diff no engine);
resumeThread em vez de `exec resume` manual; effort/MCP via config TOML. abort()/killAll() unificados
num stopSession() (mesmo padrão da ponte Claude). Detalhe completo no §18.5 item 3. Verde: 525 unit,
13 E2E, lint, tsc, knip. Roadmap §18.5: passos 1–3 CONCLUÍDOS; próximos = retry/backoff (4) e
tabela única de timeouts (5).

### 14.52 Sessão 15/07/2026 (parte 3) — retry/backoff + tabela única de timeouts (§18.5 itens 4 e 5)

Fecha o roadmap de confiabilidade da IA (§18.5 itens 1–5 CONCLUÍDOS). `main/ai/retry.js` (classificador
de erro transitório com códigos ENUMERADOS + full-jitter backoff + attempts=3) e `main/ai/timeouts.js`
(tabela única com hierarquia documentada E auto-verificada no load). Retry aplicado nos engines
Claude/Codex (attempt loop gated pelo flag anyEvent — só re-tenta se NADA chegou ao usuário) e no
caminho API (streamText maxRetries:3). Timeouts migrados em 6 consumidores (tool_bridge, chat,
2 bridges, 2 engines); watchdogs do renderer documentados + testados cross-boundary. +8 testes
(533 unit no total), 13 E2E, lint/tsc/knip verdes. ROADMAP.md refrescado (Now/Next).
