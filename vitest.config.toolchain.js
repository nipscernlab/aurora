// vitest.config.toolchain.js — integration tests against the REAL toolchain.
//
// Separate from the unit config because these tests shell out to the binaries
// under components/ (cmmcomp, appcomp, asmcomp, iverilog, vvp), which are
// downloaded by `npm run bootstrap` and deliberately NOT present in the
// unit-test CI job. `npm test` must stay fast and toolchain-free; this is the
// suite you run before cutting a release.
//
// The tests skip themselves (with a message naming the missing binaries)
// rather than failing when components/ is not populated, so a fresh clone can
// run everything without a 1 GB download first.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/toolchain/**/*.test.js'],
    // Compilers and simulators are slow, and they are invoked serially inside
    // a single shared scratch directory (components/Temp/<proc>). Running the
    // files in parallel would have them overwrite each other's artefacts.
    fileParallelism: false,
    // A full C± -> Verilog -> elaborate -> simulate chain on a cold cache is
    // well past vitest's 5 s default.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
  },
});
