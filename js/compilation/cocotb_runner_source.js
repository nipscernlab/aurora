// @ts-check
/**
 * cocotb_runner_source.js — the Python runner Aurora writes next to a cocotb
 * testbench, as a string.
 *
 * Aurora owns this script; the user's `.py` contains only cocotb tests, with
 * no Makefile or runner boilerplate. `compilation_module._writeCocotbRunnerScript`
 * writes it into the temp dir and `buildCocotbRunSpec` runs it with the bundled
 * Python, passing every project-specific value through the environment.
 *
 * It lives in its own module for one reason: it used to be an ~80-line array
 * of string literals inside the 3,000-line compilation_module class, which
 * made it impossible to test. Splitting it out lets
 * tests/toolchain/pipeline.test.js execute the REAL script — the same bytes
 * the application writes — instead of a copy that could drift.
 */

/**
 * Exit code for "the simulation ran to completion, but tests failed".
 *
 * Deliberately distinct from 1 (infrastructure failure: build error, missing
 * module, interpreter crash) because Aurora reacts differently to each. A
 * failed *test* still gets its waveform opened, which is exactly what a
 * student needs in order to see why it failed; a failed *build* has nothing
 * to show. See `_waveRunCocotbSimulation`.
 *
 * @type {2}
 */
export const COCOTB_TESTS_FAILED = 2;

/**
 * The runner script source.
 *
 * Environment contract (all set by `_waveRunCocotbSimulation`):
 *   AURORA_COCOTB_SOURCES_JSON     JSON array of HDL source paths
 *   AURORA_COCOTB_TOP              HDL top-level module name
 *   AURORA_COCOTB_TEST_MODULE      Python module holding the @cocotb.test()s
 *   AURORA_COCOTB_BUILD_DIR        where the sim is built
 *   AURORA_COCOTB_TEST_DIR         cwd of the simulation (project folder)
 *   AURORA_COCOTB_PYTHONPATH       os.pathsep-joined importable dirs
 *   AURORA_COCOTB_BUILD_ARGS_JSON  extra build args
 *   AURORA_COCOTB_TEST_ARGS_JSON   extra test args
 *   SIM, TOPLEVEL_LANG, WAVES      cocotb's own knobs
 *
 * @type {string}
 */
export const COCOTB_RUNNER_SOURCE = [
  'import json',
  'import os',
  'import sys',
  'from pathlib import Path',
  '',
  'try:',
  '    from cocotb_tools.runner import get_runner, get_results',
  'except ModuleNotFoundError:',
  '    from cocotb.runner import get_runner, get_results',
  '',
  '# Exit code used ONLY for "the simulation ran fine, but tests failed".',
  '# Distinct from 1 (infrastructure failure: build error, crash, missing',
  '# module) because Aurora reacts differently: a failed test still gets',
  '# its waveform opened, which is exactly what the student needs to debug',
  '# it. See _waveRunCocotbSimulation.',
  `COCOTB_TESTS_FAILED = ${COCOTB_TESTS_FAILED}`,
  '',
  'def _json_env(name, default):',
  '    try:',
  '        return json.loads(os.environ.get(name, default))',
  '    except Exception as exc:',
  '        raise SystemExit(f"Invalid {name}: {exc}") from exc',
  '',
  'def main():',
  '    sources = _json_env("AURORA_COCOTB_SOURCES_JSON", "[]")',
  '    build_args = _json_env("AURORA_COCOTB_BUILD_ARGS_JSON", "[]")',
  '    test_args = _json_env("AURORA_COCOTB_TEST_ARGS_JSON", "[]")',
  '    top = os.environ["AURORA_COCOTB_TOP"]',
  '    test_module = os.environ["AURORA_COCOTB_TEST_MODULE"]',
  '    build_dir = os.environ["AURORA_COCOTB_BUILD_DIR"]',
  '    test_dir = os.environ.get("AURORA_COCOTB_TEST_DIR", build_dir)',
  '',
  '    for entry in os.environ.get("AURORA_COCOTB_PYTHONPATH", "").split(os.pathsep):',
  '        if entry and entry not in sys.path:',
  '            sys.path.insert(0, entry)',
  '',
  '    Path(build_dir).mkdir(parents=True, exist_ok=True)',
  '    os.environ.setdefault("SIM", "icarus")',
  '    os.environ.setdefault("TOPLEVEL_LANG", "verilog")',
  '    os.environ.setdefault("WAVES", "1")',
  '    wav = os.environ.get("WAVES", "1") == "1"',
  '    sim = os.environ["SIM"]',
  '',
  '    runner = get_runner(sim)',
  '    runner.build(',
  '        sources=sources,',
  '        hdl_toplevel=top,',
  '        build_dir=build_dir,',
  '        build_args=build_args,',
  '        timescale=("1ns", "1ps"),',
  '        always=True,',
  '        waves=wav,',
  '    )',
  '    results_xml = Path(build_dir) / "results.xml"',
  '    runner.test(',
  '        hdl_toplevel=top,',
  '        test_module=test_module,',
  '        build_dir=build_dir,',
  '        test_dir=test_dir,',
  '        test_args=test_args,',
  '        waves=wav,',
  '        results_xml=str(results_xml),',
  '    )',
  '',
  "    # cocotb's runner.test() does NOT fail the process when a test",
  '    # fails — it returns the results path and exits 0 either way. Left',
  "    # unchecked, a student's failing testbench was reported by Aurora",
  '    # as a successful simulation: the one verdict a testbench exists to',
  '    # produce was being thrown away. Read it and report it.',
  '    total, failed = get_results(results_xml)',
  '    if failed:',
  '        print(f"AURORA_COCOTB_RESULT: {failed} of {total} test(s) failed")',
  '        raise SystemExit(COCOTB_TESTS_FAILED)',
  '    if total == 0:',
  '        # No @cocotb.test() was collected. The simulation "succeeded"',
  '        # without ever checking anything, which must not read as a pass.',
  '        print("AURORA_COCOTB_RESULT: no tests were collected")',
  '        raise SystemExit(COCOTB_TESTS_FAILED)',
  '    print(f"AURORA_COCOTB_RESULT: {total} test(s) passed")',
  '',
  'if __name__ == "__main__":',
  '    main()',
  '',
].join('\n');
