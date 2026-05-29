import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  alreadyInstalled,
  cleanEnv,
  COCOTB_SPEC,
  COCOTB_VERSION,
  isPinnedAndReady,
  PYTHON_NUGET_URL,
  PYTHON_VERSION,
} from '../../components/Scripts/download-python.js';

describe('download-python bootstrap pins', () => {
  it('downloads the pinned 64-bit CPython NuGet package', () => {
    expect(PYTHON_NUGET_URL).toBe(`https://www.nuget.org/api/v2/package/python/${PYTHON_VERSION}`);
  });

  it('pins cocotb exactly for reproducible bundled installs', () => {
    expect(COCOTB_SPEC).toBe(`cocotb==${COCOTB_VERSION}`);
  });
});

describe('isPinnedAndReady', () => {
  it('accepts the pinned Python and cocotb versions', () => {
    expect(isPinnedAndReady({
      ok: true,
      pythonVersion: PYTHON_VERSION,
      hasCocotb: true,
      cocotbVersion: COCOTB_VERSION,
    })).toBe(true);
  });

  it('rejects missing cocotb', () => {
    expect(isPinnedAndReady({
      ok: true,
      pythonVersion: PYTHON_VERSION,
      hasCocotb: false,
      cocotbVersion: null,
    })).toBe(false);
  });

  it('rejects an unexpected Python version', () => {
    expect(isPinnedAndReady({
      ok: true,
      pythonVersion: '3.12.0',
      hasCocotb: true,
      cocotbVersion: COCOTB_VERSION,
    })).toBe(false);
  });
});

describe('runtime probing helpers', () => {
  it('returns false for a missing python.exe path', () => {
    const missing = path.join(process.cwd(), 'missing-python-for-test.exe');
    expect(alreadyInstalled(missing)).toBe(false);
  });

  it('cleans Python environment variables before probing/installing', () => {
    const env = cleanEnv({
      PYTHONHOME: 'C:/bad',
      PYTHONPATH: 'C:/also-bad',
      VIRTUAL_ENV: 'C:/venv',
      CONDA_PREFIX: 'C:/conda',
    });

    expect(env.PYTHONHOME).toBeUndefined();
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.VIRTUAL_ENV).toBeUndefined();
    expect(env.CONDA_PREFIX).toBeUndefined();
    expect(env.PIP_DISABLE_PIP_VERSION_CHECK).toBe('1');
    expect(env.PYTHONNOUSERSITE).toBe('1');
  });
});
