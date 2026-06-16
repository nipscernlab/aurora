# AURORA — Roadmap

> Public, high-level view. The living, detailed backlog lives in
> [docs/BACKLOG_RECONCILIADO.md](docs/BACKLOG_RECONCILIADO.md) and
> [docs/ESTUDO_COMPLETO_AURORA.md](docs/ESTUDO_COMPLETO_AURORA.md).
> AURORA is built by NIPSCERN / UFJF — context at <https://www.nipscern.com>.

## Now (hardening + professionalisation)

- Residual security follow-ups (MCP auth, AI-CLI tool allowlists, allowlisted launches).
- Build/DX: release-integrity (SHA256SUMS), incremental component copy, CI startup budget.
- Repository: CODEOWNERS, commitlint, CodeQL, CITATION, release-please as the single flow.

## Next (capability)

- In-project search (ripgrep) and Git integration (status/diff/commit).
- Verilog language intelligence (Verible LSP) and richer Verilator feedback.
- Embedded waveforms (Surfer) graduating from opt-in toward default.

## Later (foundation)

- Finish the Lit shell migration (tabs/tree/terminal/statusbar → declarative, editor host).
- Decompose the remaining god-files; collapse legacy globals onto the state store.
- Cross-platform (Linux/macOS) evaluation; tree-sitter-based language tooling.

This roadmap is intentionally coarse; priorities shift with lab needs. Open a
[Discussion](https://github.com/nipscernlab/aurora/discussions) to weigh in.
