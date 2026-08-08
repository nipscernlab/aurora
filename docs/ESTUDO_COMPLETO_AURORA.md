# Estudos temáticos da AURORA

Este arquivo já foi um documento guarda-chuva de 3420 linhas fazendo quatro
trabalhos ao mesmo tempo: auditoria de achados, log de sessões datadas, backlog
vivo e estudos temáticos. Em 07/08/2026 ele foi reduzido aos estudos, que são a
parte que envelhece bem, porque descrevem análise e não estado.

O que saiu, e para onde foi. Os logs de sessão de 16 e 17 de junho e de 6 de
agosto, mais o checklist de implementação da branch `feature/aurora-revamp`,
somavam 2064 linhas de história que o git guarda melhor do que um markdown; a
branch em questão foi verificada como inteiramente mergeada e apagada no mesmo
dia. Os dois backlogs, o "TODO oficial" e o "quadro vivo", saíram porque
duplicavam o [PENDENCIAS.md](PENDENCIAS.md) e porque não eram mais confiáveis:
numa amostra de nove itens marcados como abertos, oito já estavam feitos, entre
eles o `deadcode` no CI, o token de sessão do MCP, a allowlist das ferramentas
das CLIs de IA e os três componentes Lit que a lista dizia faltar. O backlog
passa a ser um só, o PENDENCIAS.

A auditoria original de junho também saiu. O que ela achou e continua aberto está
no PENDENCIAS; o que ela achou e foi corrigido está no código.

Para entender como a aplicação é montada, leia o
[ESTUDO_CODIGO_AURORA.md](ESTUDO_CODIGO_AURORA.md). Para os contratos que quebram
em silêncio, o [ARCHITECTURE.md](../ARCHITECTURE.md).

Os estudos abaixo são de 14/07/2026 e não foram reconferidos contra o código
nesta limpeza.

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
   (a pergunta É o prompt) → `showAskUserQuestionInline` → **card interativo**. ok
2. `AskUserQuestion` NATIVO do CLI → em `-p` + bypass sem TTY não há como perguntar a um humano; o
   evento chegava como `tool-call` genérico → `startToolChip` → **chip inerte girando**, sem card e sem
   como responder. nao

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

### 14.53 Sessão 04/08/2026 — estudo: processadores SAPHO em C++ (nada implementado)

Sessão de estudo, sem código. Mapeamento dos dois repositórios para responder se dá para criar
processadores em C++ no pipeline atual. Resposta: o front-end já existe no yanc e é maduro; o gap é
todo na AURORA. Achados que valem registro fora do estudo dedicado:

- `cpppp.exe` e `cppcomp.exe` **já estão em `components/bin/`** e os headers C++ em `components/Header/`
  — o empacotamento foi feito e parou antes da integração. Nenhum dos dois está no
  `binary_allowlist.js`, então hoje o spawn seria recusado pelo gate.
- O `cppcomp` emite `Software/<proc>.asm` + `cmm_log.txt` no mesmo formato do cmmcomp. Do `appcomp`
  em diante o pipeline não muda. A única diferença estrutural é um passo a mais na frente (`cpppp`),
  e o compilador ler o `pp.cpp` de `Temp/<proc>/`, não o fonte original.
- Parâmetros de hardware em C++ vêm por `#pragma yanc <chave> <valor>` (prname/nubits/nbmant/nbexpo/
  nugain/ndstac/sdepth/nuioin/nuioou/fftsiz/itradd), não por `#DIRETIVA`. O `parseCmmHeader` e o
  renomeador de `#PRNAME` em `main/ipc/project.js` precisam de irmãos que leiam a forma pragma.
- Limites reais do `cppcomp` hoje: só os builtins `in`/`out` (sem `fin`/`fout`); `<cmath>` só tem
  `fabs` + `sqrt` por software (24 iterações Newton-Raphson), sem sin/cos/tan/exp/log/atan/pow, que
  em C± vêm das macros `float_*.asm`; sem complexos nem notação de Dirac; sem `#TOAQUI`/`#PRACA`
  (logo, o botão Verilator não funciona p/ C++); sem `-pt`/`-en` (mensagens só em inglês); e o
  `cpppp` não emite `#line` (erros numerados sobre o arquivo expandido quando há `#include`).
- Consequência de escopo: processadores de controle, protocolo, máquina de estados e aritmética
  inteira/ponto-fixo cabem em C++ hoje. DSP com transcendentais ou complexos continua exclusivo do C±.

Plano em 3 fases e inventário de gaps com arquivo:linha em
[ESTUDO_CPP_PROCESSADORES.md](ESTUDO_CPP_PROCESSADORES.md); itens no quadro vivo (§17).

---
