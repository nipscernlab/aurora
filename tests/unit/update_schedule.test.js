import { describe, it, expect } from 'vitest';
import {
  STARTUP_CHECK_DELAY_MS,
  SILENT_RETRY_SCHEDULE_MS,
  PERIODIC_CHECK_MS,
  DOWNLOAD_RETRY_DELAYS_MS,
  nextSilentCheckDelay,
  nextDownloadRetry,
} from '../../main/update_schedule.js';

// The decision half of the auto-updater (main/update_schedule.js). The
// property that matters for a lab deployment is that EVERY outcome yields a
// finite next attempt — a schedule that can return "never" is the silent
// failure this module exists to prevent.

describe('nextSilentCheckDelay', () => {
  it('returns the periodic cadence after a successful check', () => {
    expect(nextSilentCheckDelay('ok', 0)).toBe(PERIODIC_CHECK_MS);
    // Success clears the streak, so a prior streak must not linger.
    expect(nextSilentCheckDelay('ok', 7)).toBe(PERIODIC_CHECK_MS);
  });

  it('walks the backoff on consecutive failures', () => {
    const walked = SILENT_RETRY_SCHEDULE_MS.map((_, i) => nextSilentCheckDelay('failed', i));
    expect(walked).toEqual([...SILENT_RETRY_SCHEDULE_MS]);
  });

  it('holds at the last backoff step forever instead of growing unbounded', () => {
    const last = SILENT_RETRY_SCHEDULE_MS[SILENT_RETRY_SCHEDULE_MS.length - 1];
    expect(nextSilentCheckDelay('failed', SILENT_RETRY_SCHEDULE_MS.length)).toBe(last);
    expect(nextSilentCheckDelay('failed', 500)).toBe(last);
  });

  it('never returns a non-positive or non-finite delay', () => {
    // A zero delay would spin the check; NaN would make setTimeout fire
    // immediately and forever. Both are ways the schedule could go wrong
    // without any error being logged.
    for (const outcome of /** @type {const} */ (['ok', 'failed'])) {
      for (const streak of [-5, 0, 1, 2, 3, 4, 99]) {
        const d = nextSilentCheckDelay(outcome, streak);
        expect(Number.isFinite(d)).toBe(true);
        expect(d).toBeGreaterThan(0);
      }
    }
  });

  it('backs off monotonically — a later failure never retries sooner', () => {
    for (let i = 1; i < SILENT_RETRY_SCHEDULE_MS.length; i++) {
      expect(nextSilentCheckDelay('failed', i))
        .toBeGreaterThanOrEqual(nextSilentCheckDelay('failed', i - 1));
    }
  });

  it('retries a failure sooner than it polls a success', () => {
    // Otherwise a transient network blip would cost a full periodic cycle.
    expect(nextSilentCheckDelay('failed', 0)).toBeLessThan(PERIODIC_CHECK_MS);
  });
});

describe('nextDownloadRetry', () => {
  it('retries each configured attempt, in order', () => {
    DOWNLOAD_RETRY_DELAYS_MS.forEach((expected, i) => {
      const plan = nextDownloadRetry(i);
      expect(plan.shouldRetry).toBe(true);
      expect(plan.delayMs).toBe(expected);
      expect(plan.attempt).toBe(i + 1);
      expect(plan.ofAttempts).toBe(DOWNLOAD_RETRY_DELAYS_MS.length);
    });
  });

  it('gives up once the budget is spent', () => {
    // Unlike a check, a download must NOT retry forever: the user opted in and
    // is watching a progress bar, so a permanent failure has to surface.
    const spent = nextDownloadRetry(DOWNLOAD_RETRY_DELAYS_MS.length);
    expect(spent.shouldRetry).toBe(false);
    const wayPast = nextDownloadRetry(99);
    expect(wayPast.shouldRetry).toBe(false);
  });

  it('treats a negative streak as a fresh download', () => {
    expect(nextDownloadRetry(-1)).toMatchObject({
      shouldRetry: true,
      delayMs: DOWNLOAD_RETRY_DELAYS_MS[0],
      attempt: 1,
    });
  });
});

describe('schedule constants', () => {
  it('starts the first check after the splash handoff, not during it', () => {
    // The splash fills for ~1s and reveals over ~1s; checking inside that
    // window put the update panel in a race with the handoff.
    expect(STARTUP_CHECK_DELAY_MS).toBeGreaterThanOrEqual(3_000);
  });

  it('keeps the retry ladder non-empty and increasing', () => {
    expect(SILENT_RETRY_SCHEDULE_MS.length).toBeGreaterThan(0);
    for (let i = 1; i < SILENT_RETRY_SCHEDULE_MS.length; i++) {
      expect(SILENT_RETRY_SCHEDULE_MS[i]).toBeGreaterThan(SILENT_RETRY_SCHEDULE_MS[i - 1]);
    }
  });

  it('keeps the ladder shorter than the periodic cadence at every step', () => {
    // If a backoff step exceeded the success cadence, a failing machine would
    // check LESS often than a healthy one — backwards.
    for (const step of SILENT_RETRY_SCHEDULE_MS) {
      expect(step).toBeLessThanOrEqual(PERIODIC_CHECK_MS);
    }
  });
});
