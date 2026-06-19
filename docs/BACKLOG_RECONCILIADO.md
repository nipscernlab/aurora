# Backlog reconciliado — AURORA (execução por níveis)

> Gerado em 16/06/2026 por reconciliação multi-agente do §13 de `ESTUDO_COMPLETO_AURORA.md`,
> `DESIGN.md` e `surfer-feasibility.md` **contra o código e o git real** (a régua §13 estava
> desatualizada: vários `[ ]` já estavam feitos em commits recentes). 58 itens restantes,
> ordenados do mais fácil ao mais complexo. Convenção: ao concluir → commit + pull (sem push) + `[x]`.

---

## Estado em 18/06/2026 — snapshot atual (ESTE é o quadro vivo)

> Reconciliado contra o código real (re-análise multi-agente 18/06). A régua §13 do ESTUDO está
> desatualizada — **este snapshot vence.** `main = feature/aurora-revamp`; os 8 commits paralelos
> descartados (splits de god-files + 3 testes) ficam salvos na tag `main-pre-revamp-20260617`.

### ✅ Feito (checado)

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

### ⬜ Aberto — do mais fácil ao mais difícil

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
- [ ] **`<aurora-tabs>` passo 2** (data-driven) · **`<aurora-activity-bar>`** (feature nova, adiada).
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
- [x] **O2** Verible LSP — FEITO 19/06/2026 (diagnostics + format + outline + hover + def/refs; ponte stdio custom; binário no bootstrap). Ver §14.32. · [x] **O11** slang-server — FEITO 19/06/2026 (análise semântica + autocompletar, toggle; complementa o Verible). Ver §14.34. · [ ] **O7** tree-sitter.
- [ ] **`<aurora-tree>` passo 2** (virtual scroll) · **`<aurora-terminal>` passo 2** · **`<aurora-editor>`**.
- [ ] **A3** migrar globais (431× electronAPI → imports) · **G8/G9** plugins + spawn único.
- [ ] **PRISM reskin** (identidade aurora no viewer RTL).

**Radical (8–10):**
- [ ] **A2** decompor god-files (ai_assistant 4515 · compilation 4197 · tab_manager 2044) — **reaberto**.
- [ ] **O1** Surfer embarcado (WASM em iframe + sync WCP editor↔onda) · **`<aurora-panel>` dockável**.
- [ ] **O5** YoWASP · **B11** cross-platform (Linux/Mac).

**Externo/manual:** [ ] B2 code signing (cert) · [ ] mídia real do README · [ ] toggles do GitHub.

---

## Handoff 18/06 — para a próxima sessão (migração de máquina)

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

## Já concluído mas não marcado no §13 (provado por commit/código)

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

## Lote em execução agora: Triviais + Fáceis + Médios (ranks 1–38)

### Triviais (dificuldade 1–2)

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

### Fáceis (dificuldade 3)

- [ ] 16. **O14 WaveDrom** — diagramas de timing só p/ docs/specs. **MANTIDO DEFERIDO** — não há superfície onde renderizar (não existe preview de markdown/docs na IDE); o **surfer** já cobre waveforms de *simulação* (VCD/FST), e WaveDrom seria para diagramas *desenhados à mão* de spec. Sem um caso de uso/superfície concreta, construir seria especulativo. _Pronto p/ fazer assim que houver uma superfície (ex.: preview de `.json5`/markdown)._
- [x] 17. **V9** — renames passam pelo card Allow/Deny. _Wave C_
- [x] 18. **V11** — `set_command_override` sempre confirma (mesmo no allow). _Wave C_
- [x] 19. **B6/B13** — `copy-components` por junction. _Wave B_
- [x] 20. **README com mídia** (scaffold docs/media) + badge electron 39. _Wave A_
- [x] 21. **De-flake e2e** `split-pane > PRISM open-at-line` (poll-until-settled). _Wave D_

### Médios (dificuldade 4–5)

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

## Próximos níveis (fora deste lote)

### Difíceis (6–7)
39. Tokens codemod base→semantic (~392 usos) · 40. ~~B10 cobertura+Codecov~~ **FEITO (17/06)** · 41. B12 CLIs sob demanda ·
42. ~~O2 Verible LSP~~ **FEITO (19/06)** · 43. O5 YoWASP · 44. ~~O9 DigitalJS~~ **FEITO** · 45. ~~O11 slang-server~~ **FEITO (19/06)** · 46. `<aurora-tabs>` passo 2.

### Radicais (8–10)
47. A3 migrar globais · 48. `<aurora-tree>` passo 2 · 49. `<aurora-terminal>` passo 2 ·
50. `<aurora-statusbar>` ao vivo · 51. O7 tree-sitter · 52. A2 decompor god-files ·
53. O1 Surfer (iframe WASM + WCP + cores por opcode) · 54. `<aurora-editor>` · 55. `<aurora-titlebar>` ·
56. `<aurora-activity-bar>` · 57. B11 cross-platform · 58. `<aurora-panel>` dockável.
