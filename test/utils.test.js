/**
 * Unit tests for the small pure helpers in main/utils.js. Each one is used
 * across multiple IPC modules; getting them under test makes the rest of
 * the layer safer to refactor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce, getMimeType, filterGtkWaveOutput } from '../main/utils.js';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('only fires the wrapped function once after the wait elapses', () => {
    const fn = vi.fn();
    const wrapped = debounce(fn, 100);

    wrapped();
    wrapped();
    wrapped();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('forwards the most recent arguments', () => {
    const fn = vi.fn();
    const wrapped = debounce(fn, 100);

    wrapped('first');
    wrapped('second');
    wrapped('third');
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith('third');
  });

  it('resets the wait window on each call', () => {
    const fn = vi.fn();
    const wrapped = debounce(fn, 100);

    wrapped();
    vi.advanceTimersByTime(50);
    wrapped();
    vi.advanceTimersByTime(50);
    // Total of 100ms elapsed but the second call reset the timer at 50ms,
    // so we still need another 50ms before it fires.
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires twice when calls are spaced wider than the window', () => {
    const fn = vi.fn();
    const wrapped = debounce(fn, 100);

    wrapped();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);

    wrapped();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('getMimeType', () => {
  it.each([
    ['main.v',          'text/x-verilog'],
    ['design.sv',       'text/x-systemverilog'],
    ['header.vh',       'text/x-verilog-header'],
    ['waves.gtkw',      'application/x-gtkwave'],
    ['readme.txt',      'text/plain'],
  ])('maps %s to the right MIME type', (file, expected) => {
    expect(getMimeType(file)).toBe(expected);
  });

  it('is case-insensitive on the extension', () => {
    expect(getMimeType('MAIN.V')).toBe('text/x-verilog');
    expect(getMimeType('Header.VH')).toBe('text/x-verilog-header');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(getMimeType('blob.bin')).toBe('application/octet-stream');
    expect(getMimeType('image.png')).toBe('application/octet-stream');
  });

  it('returns octet-stream for files without extension', () => {
    expect(getMimeType('Makefile')).toBe('application/octet-stream');
  });

  it('handles a full path, not just a basename', () => {
    expect(getMimeType('C:/projects/cpu/src/main.v')).toBe('text/x-verilog');
  });
});

describe('filterGtkWaveOutput', () => {
  it('drops lines starting with the known GTKWave noise prefixes', () => {
    const input = [
      'GTKWave Analyzer v3.3.124',
      'real signal output here',
      'FSTLOAD | loaded 8192 facs',
      'GTKWAVE | reading dump file',
      'another keep-line',
      'WM Destroy',
      '[0] start time = 0',
      '[0] end time = 1000',
      'final keep-line',
    ].join('\n');

    expect(filterGtkWaveOutput(input)).toBe(
      ['real signal output here', 'another keep-line', 'final keep-line'].join('\n'),
    );
  });

  it('drops empty / whitespace-only lines', () => {
    expect(filterGtkWaveOutput('\n\n  \nreal\n\n')).toBe('real');
  });

  it('keeps lines that merely *contain* a noise prefix as a substring', () => {
    // Filter is .startsWith-based, not includes-based — so "look at GTKWave"
    // (where the prefix is mid-line) is intentionally preserved.
    expect(filterGtkWaveOutput('look at GTKWave Analyzer details')).toBe(
      'look at GTKWave Analyzer details',
    );
  });

  it('returns empty string when every line is noise', () => {
    expect(filterGtkWaveOutput('GTKWave Analyzer v1\nWM Destroy')).toBe('');
  });

  it('preserves leading whitespace inside otherwise-real lines', () => {
    // The trim is only used for the noise check; the original line is kept
    // intact in the output.
    expect(filterGtkWaveOutput('  signal value\n')).toBe('  signal value');
  });
});
