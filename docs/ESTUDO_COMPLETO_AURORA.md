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
- [ ] **O2 Verible** — LSP de Verilog (diagnostics inline) via shim manual. 🟡
- [ ] **O10 ripgrep** — find-in-files no projeto. 🟡 quick-win de UX.
- [ ] **O3 Verilator** — feedback streamado no build + consolidar `waveBuild`. 🟡
- [ ] **O8 cocotb** — fluxo de teste de 1ª classe (alinha com branch do Arthur). 🟡
- [ ] **O5 YoWASP** — Yosys in-process (sem spawn). 🔴
- [ ] **O7 tree-sitter** — grammar C±/ASM (folding/outline/símbolos). 🔴
- [ ] **O9 DigitalJS** — simulação visual no PRISM. 🟡
- [ ] **O11 slang-server** · **O12 simple-git** · **O14 WaveDrom (docs)**. 🟡/🟢

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
- **Deferidos do backlog anterior** com disposição final em `docs/BACKLOG_RECONCILIADO.md`: #16 WaveDrom
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
`BACKLOG_RECONCILIADO.md` ("Estado em 18/06", que agora **vence** a régua §13 desatualizada — done checado +
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
