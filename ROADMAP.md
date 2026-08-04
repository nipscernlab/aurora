# AURORA — Roadmap

> Public, high-level view. The living, detailed backlog lives in
> [docs/ESTUDO_COMPLETO_AURORA.md](docs/ESTUDO_COMPLETO_AURORA.md)
> (§17 = quadro vivo de execução; §15–16 = estudos de interface e file tree).
> AURORA is built by NIPSCERN / UFJF — context at <https://www.nipscern.com>.

## Now (hardening + professionalisation)

- AI bridges modernised (done): Claude Agent SDK + Codex SDK engines with
  automatic legacy fallback, transient retry/backoff, unified timeout table.
- Residual security follow-ups (MCP auth, AI-CLI tool allowlists, allowlisted launches).
- Build/DX: release-integrity (SHA256SUMS), incremental component copy, CI startup budget.
- Repository: CODEOWNERS, commitlint, CodeQL, CITATION, release-please as the single flow.

## Next (capability)

- C++ as a second processor source language, alongside C±. The yanc front end
  (`cpppp` + `cppcomp`) already exists and converges on the same assembly, so the
  work is AURORA-side integration plus a dedicated C++ processor-creation panel.
  Every capability ships as an AI-callable API before it ships as a button.
  Plan and gap inventory: [docs/ESTUDO_CPP_PROCESSADORES.md](docs/ESTUDO_CPP_PROCESSADORES.md).
- Persistent AI process per conversation (kill the per-turn CLI cold-start);
  retire the legacy spawn paths once the SDK engines have live mileage.
- Style consolidation (single button/card system, tokenised panels — ESTUDO §15).
- Embedded waveforms (Surfer) graduating from opt-in toward default.

## Later (foundation)

- Finish the Lit shell migration (tabs/tree/terminal/statusbar → declarative, editor host).
- Decompose the remaining god-files; collapse legacy globals onto the state store.
- Cross-platform (Linux/macOS) evaluation; tree-sitter-based language tooling.

This roadmap is intentionally coarse; priorities shift with lab needs. Open a
[Discussion](https://github.com/nipscernlab/aurora/discussions) to weigh in.
