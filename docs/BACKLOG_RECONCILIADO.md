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

- [ ] 1. **B9** — limpar refs mortas (smoke.test:157, yanc-managed-files.txt, RELEASE.md). _leve/S_
- [ ] 2. **Discussions** — habilitar + corrigir link/capitalização em CONTRIBUTING.md:107. _leve/S_
- [ ] 3. **Metadados do repo** — topics, homepage, social preview (hoje vazios). _leve/S_
- [ ] 4. **CODEOWNERS** — criar `.github/CODEOWNERS`. _leve/S_
- [ ] 5. **B3** — README/badges → canal `sapho`. _moderado/S_
- [ ] 6. **B7** — validar sentinelas pós-bootstrap no `release.yml`. _leve/S_
- [ ] 7. **B8** — `release.yml` em `on:release:published`; aposentar `build.ps1`/`.bat`. _leve/S_
- [ ] 8. **release-please** — manter como fluxo único (PR #12 v6.4.0: **merge é manual seu**, não mexo no remoto). _leve/S_
- [x] ~~9. **Branch protection** na `main`~~ — **REMOVIDO do plano** (decisão do usuário: não complicar). 
- [ ] 10. **CodeQL** — criar `codeql.yml` (in-repo). _Secret scanning/push protection = toggle de settings, manual._ _leve/S_
- [ ] 11. **commitlint + hook commit-msg**. _leve/S_
- [x] ~~12. **Limpar releases órfãs**~~ — **REMOVIDO do plano** (decisão do usuário: não deletar releases).
- [ ] 13. **CITATION.cff + roadmap público**. _leve/S_
- [ ] 14. **Vite C** — decidir fallback raw do index.html. _leve/S (decisão)_
- [ ] 15. **V8** — `launch-gtkwave-only`/`launch-surfer`/`decode-complex` pela `binary_allowlist`. _leve/S_

### Fáceis (dificuldade 3)

- [ ] 16. **O14 WaveDrom** — diagramas de timing só p/ docs/specs. _leve/S_
- [ ] 17. **V9** — renames passam pelo card Allow/Deny (remover early-return). _leve/S_
- [ ] 18. **V11** — revisar superfície do `set_command_override` no modo allow. _leve/S_
- [ ] 19. **B6/B13** — `copy-components` incremental/junction. _leve/S_
- [ ] 20. **README com mídia** + corrigir badge electron 38→39. _leve/M_
- [ ] 21. **De-flake e2e** `split-pane > PRISM open-at-line`. _leve/S_

### Médios (dificuldade 4–5)

- [ ] 22. **B1** — SHA256SUMS por release + verificar hash nos 4 downloaders. _moderado/M_
- [ ] 23. **Naming SAPHO vs Aurora** — alinhar os 6 pontos + URLs. _moderado/M (decisão)_
- [ ] 24. **Dependabot** — triagem + auto-merge patch/minor. _moderado/M_
- [ ] 25. **Disclosure de terceiros user-facing** — seção no About. _moderado/M_
- [ ] 26. **A4** — colapsar `global.currentProject*` num getter sobre `state`. _moderado/M_
- [ ] 27. **Higiene de memória** — bound em `this.messages` + auditar listeners/DOM. _moderado/M_
- [ ] 28. **O3** — streamar o build longo do Verilator (`runSpec`→`runSpecStreamed`). _moderado/M_
- [ ] 29. **Smoke de orçamento de startup no CI** (assert de TTI). _leve/M_
- [ ] 30. **V7** — token de sessão / `Authorization` no MCP local. _moderado/M_
- [ ] 31. **B2** — code signing (SignPath/Azure). _moderado/L (depende de aprovação externa)_
- [ ] 32. **O10 ripgrep** — find-in-files no projeto. _moderado/M_
- [ ] 33. **O12 simple-git** — painel de source-control. _moderado/M_
- [ ] 34. **V4** — fechar tools nativas de escrita das CLIs (Edit/Write do Claude). _moderado/M_
- [ ] 35. **Empty-states** — unificar (4 skins → 1). _moderado/M (redesenho subjetivo)_
- [ ] 36. **Tokens B** — consolidar `ai_assistant.css` nos tokens. _moderado/M_
- [ ] 37. **P6** — `transition:width`→`transform` no toggle sidebar/IA. _leve/M (ROI baixo)_
- [ ] 38. **Condensar prompt injection** — truncar tool-results, instrumentar tokens. _moderado/M_

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
