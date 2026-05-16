// @ts-check
/**
 * audit.js — append-only activity log for Aurora Intelligence.
 *
 * Every tool call the assistant makes (and its outcome) is appended as
 * one JSON object per line to `userData/aurora-intelligence-log.jsonl`.
 * This gives the user a reviewable trail of what the AI did to their
 * workspace — useful both for trust ("what did it just change?") and
 * for debugging a misbehaving prompt.
 *
 * Best-effort: a failed append is logged and swallowed. The audit
 * trail must never be able to break a chat turn.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('electron-log');

function logPath() {
  return path.join(app.getPath('userData'), 'aurora-intelligence-log.jsonl');
}

/**
 * Append one audit entry. A timestamp is added automatically.
 * @param {object} entry
 */
function append(entry) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(logPath(), line);
  } catch (e) {
    log.warn('[ai.audit] append failed:', e?.message || e);
  }
}

module.exports = { append, logPath };
