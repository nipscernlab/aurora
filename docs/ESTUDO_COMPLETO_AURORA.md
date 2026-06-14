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

---

## 5. Arquitetura e melhorias estruturais

| # | Tier | Achado | Recomendação |
|---|---|---|---|
| A1 | 🔴 Radical | **Sem bundler.** Ordem de 34 `<script>` em `index.html` é contrato implícito; managers fazem I/O no construtor; `.ts` compila in-place gerando `.js` commitado ao lado (vetor de drift). | Adotar **Vite** (ou esbuild). Elimina o contrato de ordem de carga, dá HMR, tree-shaking, code-splitting, e mata o problema do `.js` in-place. **Destrava metade de §4 e §8.** |
| A2 | 🔴 Radical | **God-files:** `compilation_module.js` 3.927, `ai_assistant_manager.js` 3.873, `aurora_api.js` 2.383. | Decompor por responsabilidade: compilação → por etapa (cmm/asm/wave/verilator/cocotb); IA → (transporte / render de chat / permissões / markdown); AuroraAPI → por namespace. |
| A3 | 🟡 Moderado | **Acoplamento a globais:** 431 `window.electronAPI`, 105 `window.t`, 48 `window.currentProjectPath`, ~40 globais distintos. | Migrar leituras legadas para imports ES; manter espelhos só durante a transição. Testabilidade hoje é refém disso. |
| A4 | 🟡 Moderado | **Estado duplicado** `global.currentProject*` vs `state.currentOpenProjectPath`. | Um único getter sobre `state`. |
| A5 | 🟢 Leve | **Bugs reais achados no mapeamento:** (a) `getActiveFilePath` lê `dataset.file` mas as tabs gravam `data-path` → find-state nunca funciona por arquivo; (b) `editorNs.openFile` usa `tree.value` mas `getTree` retorna `{ok,data}` → fallback morto; (c) snapshot de estado do PDF lê `activeTab` já sobrescrito; (d) código morto com `ReferenceError` latente (`saveEditorState`/`formatCurrentFile`). | Corrigir os 4; são pequenos e de alto valor. |
| A6 | 🟢 Leve | **`exec-command` legado** sem callers (também é V2 em segurança). | Remover. |
| A7 | 🟡 Moderado | **`preload_prism.js` genérico** (escape do modelo de canais enumerados). | Enumerar os canais da janela PRISM. |
| A8 | 🟢 Leve | ~150 linhas de **código morto** no fim de `compilation_module.js`; knip já configurado. | Rodar `npm run deadcode` no CI e podar. |

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
| O1 ✔ | **Surfer** (Rust→WASM) ⚠️ | **Ondas dentro da IDE** — substitui o GTKWave externo, embutível numa BrowserWindow (mesmo padrão do PRISM); lê VCD/FST via postMessage. **Remove 1 dos 3 downloads** (fork GTKWave + runtime GTK), a janela externa e o polling de 2s. | EUPL | 🔴 | L |
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

> Status real (atualizado), não só a primeira leva. Todos os commits com 208 testes unit passando
> e lint limpo. **Verificação visual/runtime é por conta do usuário** (os testes não exercitam o
> carregamento do Electron).

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
- ⚠️ **Achado pré-existente (fora do Vite):** as woff2 commitadas estão **duplicadas** — todos os pesos de cada
  família são o mesmo arquivo (4 conteúdos p/ 14 faces). A IDE **não tem bold/medium reais**; provável bug no
  `scripts/fetch-fonts.js`. Corrigir à parte.

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

### ⬜ Falta
**Fundação (Vite — só o Stage 5 restante):**
- [ ] **Stage 5 (B5):** deletar os `.js` in-place quando os testes migrarem para importar `.ts` (muda o contrato
      de teste; tratar como esforço próprio).

**Visual (Lit shell — em andamento):**
- [x] **Camada semântica de tokens (DESIGN §3)** — feita (Fase A, ver acima). Resta só a **adoção
      por-componente** (codemod base→semantic, junto da migração Lit).
- [x] **Fundação Lit + Design Lab (Fase B)** — feita (ver acima): Lit 3, `<aurora-statusbar>` (molde),
      Design Lab + launcher. Aditivo, app ao vivo intacto.
- [x] **1ª migração ao vivo — `<aurora-toast>` (Fase C)** — feita (ver acima): driver único, API intacta.
- [ ] 🔴 **Shell em Lit (Fase C+ continua)** + painéis dockáveis + redesenho de welcome/empty-states +
      densidade/hierarquia (Zed/Linear/Fleet). Próximos alvos por isolação/verificabilidade: tooltip ·
      command palette (dono único) · welcome/empty-states · titlebar → activity-bar → file-tree (preservar as
      3 subárvores) → tabs → `<aurora-editor>` (dropa os 30 `!important` via Shadow DOM) → terminal → modais.
      **Status bar fica pro fim** (7+ drivers + `zoom.js` insere irmão — mau alvo). Cada peça: codemod
      base→semantic + entrada na Design Lab. **Dívida:** limpar o CSS morto de `.notification-card` em
      `notification.css`; decidir se o fallback raw do index é removido (degradado pós-Fase C).
- [ ] **Consolidar `ai_assistant.css`** (2.150 linhas; a paleta de syntax já saiu pros tokens, o resto
      do arquivo permanece). Baixa prioridade.
- [ ] ~~Tema light / aurora-contrast~~ — **descartado** (tema único).

**Performance (sobrou o arriscado/de baixo ROI):**
- [ ] **P6** (transition:width→transform no toggle de sidebar/IA) — fora de hot-path, baixo ROI.
- [ ] **P17** (modais montados sob demanda + `contain`/`inert` — casa com a11y G5).
- [ ] **P7 completo** (paint/content-visibility com `contain-intrinsic-size` nas listas).
- [ ] 🔴 ~~**P1** (um Monaco por pane)~~ — **revertido** (ver decisão acima); retomar só sob pressão real
      de memória com dezenas de abas, usando o checklist da memória.
- [ ] Medição: overlay de jank (p99), baseline de TTI, smoke de orçamento no CI (§4.4/G7).

**Fora das 2 trilhas (parking lot):** segurança restante (V4/V7/V8/V9/V10–V12, CSP, sandbox); OSS
(Surfer/Verible/ripgrep/…); build/DX (B1–B13); repo (§9, 18 itens).

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
- [ ] `<aurora-tree>` (file-tree) — **preservar as 3 subárvores + reconciliação key-based** + `zoom`/views. 🔴
- [ ] `<aurora-tabs>` — `tab_manager.js`. 🟡
- [ ] `<aurora-editor>` — host do Monaco; **dropa os 30 `!important`** via Shadow DOM. 🔴 maior ganho.
- [ ] `<aurora-terminal>` — `terminal_module.js` (otimizado no lugar; não xterm). 🟡
- [x] `<aurora-modal>` + os 4 modais inline (new project, processor hub, wave config, settings) — **FEITO.**
      Base `<aurora-modal>` (chrome em Shadow DOM + tokens; título/corpo/footer + ✕-próprio SLOTADOS em
      light-DOM → forms/IDs/handlers/i18n preservados). É **drop-in**: reage a `aria-hidden`/`.show`/`.visible`
      via CSS (os 3 mecanismos que `modal_system`/processor-hub/wave/settings já usam) → **nenhum controller
      religado**; só o `aurora-modal-close` no `modal_system` (backdrop+✕ vivem no shadow). `noclose` mantém o
      ✕-próprio (que faz limpeza); largura custom via `--aurora-modal-width` (settings = 880px). Na Design Lab.
- [ ] `<aurora-statusbar>` **ao vivo** — religar os 7+ drivers (deixado pro fim por ser o mais acoplado). 🔴
- [ ] `<aurora-panel>` **dockável** + layout dockável estilo Fleet/Zed + densidade/hierarquia revisadas. 🔴

### B. 🟡 Tokens — terminar a estratificação
- [ ] Codemod base→semantic dos ~600 usos existentes (feito por-componente junto de A).
- [ ] Resolver o gap do nível "secondary" (#9CA1AE) — hoje sem nome semântico limpo (colisão `--text-muted`).
- [ ] Consolidar `ai_assistant.css` (2.150 linhas) nos tokens. 🟢 baixa prioridade.

### C. Fundação Vite + dívidas pequenas
- [ ] **Stage 5 / B5** — deletar os `.js` in-place, migrar testes p/ importar `.ts`, gitignorar os gerados. 🟡
- [ ] Limpar o CSS morto de `.notification-card` em `notification.css`. 🟢
- [ ] **Podar o CSS morto acumulado das migrações Lit** (chrome que foi pro Shadow DOM): `.custom-tooltip`
      (`tooltip.css`), `.cmdk-*` (`command_palette.css`), chrome do welcome (`recent_projects.css`),
      chrome de modal (`modal_config.css`) — manter só o que ainda serve conteúdo light-DOM (ex.: `.empty-state`,
      `.modal-body/.modal-footer/.modal-title`). 🟢
- [ ] Silenciar (cosmético) o warning do Vite "can't be bundled without type=module" dos 2 scripts não-módulo
      vendados (Monaco `loader.js` AMD + KaTeX UMD) — **benigno** (resolvidos em runtime via `vendor/`), só polui
      o output do build. 🟢
- [ ] Decidir o fallback raw do `index.html` (degradado pós-Lit) — remover ou aceitar. 🟢

### D. 🟡 Performance (sobrou o arriscado / baixo-ROI)
- [ ] **P6** — `transition:width`→`transform` no toggle de sidebar/IA.
- [ ] **P17** — modais sob demanda + `contain`/`inert` (casa com a11y G5).
- [ ] **P7 completo** — `content-visibility` + `contain-intrinsic-size` nas listas.
- [ ] **Medição** — overlay de jank (p99) + baseline de TTI + smoke de orçamento no CI (§4.4/G7).
- [x] ~~P9 (standard tree sem virtualização)~~ — **já feito** (DocumentFragment; fim do freeze ao expandir
      pasta grande — ver §12 ✅ Feito). Listado aqui só pra fechar a dúvida.
- [ ] ~~P1 (um Monaco por pane)~~ — **adiado/revertido** (causou perda de dados nos commits da tentativa);
      retomar só sob pressão real de memória, com o checklist da memória. Por decisão, fora do backlog ativo.

### E. Bugs pré-existentes a corrigir
- [ ] **Fontes duplicadas** — `scripts/fetch-fonts.js` baixa o mesmo arquivo p/ todos os pesos (4 conteúdos p/ 14 faces); **a IDE não tem bold/medium reais**. 🟡 alto impacto visual.
- [ ] **e2e flaky** `split-pane > PRISM open-at-line` — timing do ambiente (corrida de 600ms).
- [ ] **A5** — verificar/corrigir os 4 bugs do mapeamento (getActiveFilePath `dataset.file`↔`data-path`; `editorNs.openFile` `tree.value`; snapshot do PDF; código morto com `ReferenceError`). 🟢

### F. 🔴 Arquitetura (god-files)
- [ ] **A2** — decompor `compilation_module.js` (3.927), `ai_assistant_manager.js` (3.873), `aurora_api.js` (2.383) por responsabilidade.
- [ ] **A3** — migrar leituras de globais (`window.electronAPI`×431 etc.) p/ imports ES. 🟡
- [ ] **A4** — colapsar `global.currentProject*` p/ um getter sobre `state`. 🟡
- [ ] **A7** — enumerar os canais do `preload_prism.js` (tirar `send/removeAllListeners` genéricos). 🟡
- [ ] **A8** — `npm run deadcode` no CI + podar código morto. 🟢

### G. Segurança (parking lot)
- [ ] **V4** — CLIs de IA com permissões abertas → allowlist + fechar tools nativas. 🟡
- [ ] **V7** — token de sessão no MCP local (`Authorization`). 🟡
- [ ] **V8** — `launch-gtkwave-only` pela `binary_allowlist`. 🟢
- [ ] **V9** — renames (`rename_project`/`rename_processor`) passam pelo card Allow/Deny. 🟢
- [ ] **V10** — tirar `exec(string)` com interpolação dos utils de kill/check. 🟢
- [ ] **V11** — revisar superfície do `set_command_override` no modo `allow`. 🟢
- [ ] **V12** — filtrar `spec.env`/`prependPath` antes do `spawn`. 🟢
- [ ] **CSP** — adicionar (`<meta>` ou `onHeadersReceived`); fecha a maior classe de XSS. 🟢
- [ ] **sandbox:true** por janela onde o preload não precisa de Node. 🟢

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
- [ ] **B4** `tsc --noEmit` no CI + check de `.js` dessincronizado. 🟢
- [ ] **B6/B13** `copy-components` incremental / junction (não recopiar ~1 GB a cada start). 🟢
- [ ] **B7** validar sentinelas após bootstrap no `release.yml`. 🟢
- [ ] **B8** escolher release-please como fluxo único; aposentar `build.ps1`. 🟢
- [ ] **B9** limpar refs mortas (smoke.test, yanc-managed-files, bloco `win`, RELEASE.md). 🟢
- [ ] **B10** cobertura de testes (ipc/compile/ai/updater) + Codecov. 🟡
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
- [ ] **Anexos no chat da IA — imagens e arquivos.** Permitir anexar **imagens** (upload, drag-and-drop e
      paste do clipboard) e **arquivos** (do projeto ou do disco) nos chats da IA (`js/ai/`,
      `ai_assistant_manager.js` + painel de IA). Inclui: UI do anexo (chip/preview/remover), limites de
      tamanho/tipo, e o **transporte multimodal** pro provider (Claude/Codex aceitam imagem? mandar como
      base64 / referência de arquivo no payload). Pareia com o fluxo de IA transport-agnostic do §2.3. 🟡
