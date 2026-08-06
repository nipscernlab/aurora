// @ts-check
/**
 * update_schedule.js — when the auto-updater should try again.
 *
 * Pure decision logic, split out of [main/updater.js](updater.js) so it can be
 * unit-tested without an Electron main process. `updater.js` owns the timers,
 * the IPC and the electron-updater events; this module owns only the question
 * "given what just happened, how long until the next attempt?".
 *
 * Why the schedule exists at all: SAPHO is installed once on a fleet of lab
 * machines and updated only over the network, so a single startup check that
 * silently loses to a late network, a proxy or a transient 5xx would strand
 * the whole fleet on an old version with nothing to show for it. Every outcome
 * therefore arms a next attempt — there is no path that stops the schedule
 * while the app is running.
 */

'use strict';

/** Delay from update-system init to the first silent check (ms). */
const STARTUP_CHECK_DELAY_MS = 6_000;

/**
 * Backoff for a silent check that FAILED, indexed by how many consecutive
 * failures preceded it. Short at first — a boot-time network that is merely
 * late recovers within a minute — then long, so a genuinely offline machine
 * settles into hourly attempts instead of spinning. The last entry repeats
 * for every further failure.
 */
const SILENT_RETRY_SCHEDULE_MS = Object.freeze([
  60_000,          // 1 min
  5 * 60_000,      // 5 min
  15 * 60_000,     // 15 min
  60 * 60_000,     // 1 h, and every hour after
]);

/**
 * Cadence for a silent check that SUCCEEDED. Three hours covers a lab machine
 * left open across a full day of classes without polling GitHub often enough
 * to matter.
 */
const PERIODIC_CHECK_MS = 3 * 60 * 60 * 1000;

/**
 * Delays before retrying a download that died mid-flight, indexed by how many
 * consecutive download failures preceded it. Bounded: unlike a check, a
 * download is expensive and the user is watching, so after this many attempts
 * the failure is theirs to see rather than ours to keep hiding.
 */
const DOWNLOAD_RETRY_DELAYS_MS = Object.freeze([5_000, 20_000]);

/**
 * How long until the next silent check.
 *
 * @param {'ok'|'failed'} outcome  what the check that just finished did
 * @param {number} failureStreak   consecutive failures BEFORE this outcome
 * @returns {number} delay in ms
 */
function nextSilentCheckDelay(outcome, failureStreak) {
  if (outcome === 'ok') return PERIODIC_CHECK_MS;
  const i = Math.min(
    Math.max(0, failureStreak | 0),
    SILENT_RETRY_SCHEDULE_MS.length - 1,
  );
  return SILENT_RETRY_SCHEDULE_MS[i];
}

/**
 * Whether a failed download should be retried, and after how long.
 *
 * @param {number} failureStreak  consecutive download failures BEFORE this one
 * @returns {{shouldRetry: boolean, delayMs: number, attempt: number, ofAttempts: number}}
 *   `attempt` is 1-based and only meaningful when `shouldRetry` is true.
 */
function nextDownloadRetry(failureStreak) {
  const streak = Math.max(0, failureStreak | 0);
  const ofAttempts = DOWNLOAD_RETRY_DELAYS_MS.length;
  if (streak >= ofAttempts) {
    return { shouldRetry: false, delayMs: 0, attempt: streak, ofAttempts };
  }
  return {
    shouldRetry: true,
    delayMs: DOWNLOAD_RETRY_DELAYS_MS[streak],
    attempt: streak + 1,
    ofAttempts,
  };
}

module.exports = {
  STARTUP_CHECK_DELAY_MS,
  SILENT_RETRY_SCHEDULE_MS,
  PERIODIC_CHECK_MS,
  DOWNLOAD_RETRY_DELAYS_MS,
  nextSilentCheckDelay,
  nextDownloadRetry,
};
