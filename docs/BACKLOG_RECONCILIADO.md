# Backlog reconciliado — AURORA (execução por níveis)

> Gerado em 16/06/2026 por reconciliação multi-agente do §13 de `ESTUDO_COMPLETO_AURORA.md`,
> `DESIGN.md` e `surfer-feasibility.md` **contra o código e o git real** (a régua §13 estava
> desatualizada: vários `[ ]` já estavam feitos em commits recentes). 58 itens restantes,
> ordenados do mais fácil ao mais complexo. Convenção: ao concluir → commit + pull (sem push) + `[x]`.

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
39. Tokens codemod base→semantic (~392 usos) · 40. B10 cobertura+Codecov · 41. B12 CLIs sob demanda ·
42. O2 Verible LSP · 43. O5 YoWASP · 44. O9 DigitalJS · 45. O11 slang-server · 46. `<aurora-tabs>` passo 2.

### Radicais (8–10)
47. A3 migrar globais · 48. `<aurora-tree>` passo 2 · 49. `<aurora-terminal>` passo 2 ·
50. `<aurora-statusbar>` ao vivo · 51. O7 tree-sitter · 52. A2 decompor god-files ·
53. O1 Surfer (iframe WASM + WCP + cores por opcode) · 54. `<aurora-editor>` · 55. `<aurora-titlebar>` ·
56. `<aurora-activity-bar>` · 57. B11 cross-platform · 58. `<aurora-panel>` dockável.
