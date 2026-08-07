# AURORA — Roadmap

> Public, high-level view. The living, detailed backlog lives in
> [docs/ESTUDO_COMPLETO_AURORA.md](docs/ESTUDO_COMPLETO_AURORA.md)
> (§17 = quadro vivo de execução; §15–16 = estudos de interface e file tree).
> AURORA is built by NIPSCERN / UFJF — context at <https://www.nipscern.com>.

## Now (lab deployment + signing)

The near-term goal is concrete: install once on the DLP teaching lab's machines and
update them remotely, for good. What was done is in
[docs/ESTUDO_COMPLETO_AURORA.md](docs/ESTUDO_COMPLETO_AURORA.md) §19; what is still
open, and in which order, is in [docs/PENDENCIAS.md](docs/PENDENCIAS.md).

- Release pipeline unblocked (done): it had never worked — cross-repo publish was
  403-ing and every release was cut by hand. Now gated on publish access, toolchain
  sentinels, and verification that the published `latest.yml` matches the published
  installer.
- Auto-updater hardened (done): retry with backoff, periodic re-check, resumable
  download, install-on-quit, and an update-health panel for remote diagnosis.
- Toolchain integration tests (done): the compile + simulate pipeline had **zero**
  automated coverage; now 24 tests run the real binaries and gate every release.
- Code signing via SignPath Foundation (in progress): approved, wiring pending —
  see [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md).
- Rename the installer and app identity to SAPHO before the first lab deploy
  (§19.5) — after deployment it would cost an NSIS migration.
- Lab IT package (done): [docs/IMPLANTACAO_LABORATORIO.md](docs/IMPLANTACAO_LABORATORIO.md)
  covers Defender exclusions, AppLocker rules and the SmartScreen shortcut.
- Residual security follow-ups (MCP auth, AI-CLI tool allowlists, allowlisted launches).

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
