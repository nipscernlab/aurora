# Security Policy

## Supported versions

Only the latest released version of AURORA receives security fixes. Older
versions are not patched; upgrading is the fix.

## Reporting a vulnerability

Please do not open a public GitHub issue for a security problem. Email
<nipscern@ufjf.br> instead, with a description of the issue and its impact,
steps to reproduce or a proof-of-concept project, and the AURORA version, which
you will find under Settings, then About. Your Windows build and the versions of
any toolchain component involved help too.

We aim to acknowledge a report within five working days, and to publish a fix or
a mitigation within thirty days for anything we can reproduce.

## Scope

In scope: local privilege escalation through AURORA's main process; arbitrary
file read or write triggered by an untrusted `.spf` project; code execution
through prepared C±, assembly or Verilog inputs; and manipulation of the
auto-update channel.

Out of scope: vulnerabilities in the third-party tools we bundle, which today are
Icarus Verilog, Verilator, GTKWave, Surfer, Yosys, netlistsvg, cocotb and the
Verible and Slang language servers. Report those upstream, and tell us as well so
we can pin or patch the version we ship. Also out of scope are issues that
require an attacker to already have arbitrary code execution on the machine.

## Coordinated disclosure

We credit reporters in the release notes unless they ask to stay anonymous, and
we hold off on public discussion until a fix ships.
