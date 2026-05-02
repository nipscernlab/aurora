# Security Policy

## Supported versions

Only the latest released version of AURORA receives security fixes.

| Version | Supported          |
|---------|--------------------|
| Latest  | :white_check_mark: |
| Older   | :x:                |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Instead, email **nipscern@ufjf.br** with:

* A description of the issue and its impact.
* Steps to reproduce, or a proof-of-concept project.
* The AURORA version (`Help ▸ About` or `package.json#version`), Windows
  build, and any relevant toolchain versions (Icarus, GTKWave, Yosys).

We aim to acknowledge reports within **5 working days** and to publish a
fix or mitigation within **30 days** for issues we can reproduce.

## Scope

In scope:

* Local privilege escalation through AURORA's main process.
* Arbitrary file read/write triggered by an untrusted `.spf` project.
* Code execution through prepared C±/ASM/Verilog inputs.
* Auto-update channel manipulation.

Out of scope:

* Vulnerabilities in third-party tools we ship (Icarus, GTKWave, Yosys,
  netlistsvg). Please report those upstream and let us know so we can
  pin or patch our bundled version.
* Issues that require an attacker to already have arbitrary code
  execution on the user's machine.

## Coordinated disclosure

We will credit reporters in the release notes unless they ask to remain
anonymous, and we will hold off on public discussion until a fix is
shipped.
