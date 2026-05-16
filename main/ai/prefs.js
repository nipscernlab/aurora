// @ts-check
/**
 * prefs.js — non-secret Aurora Intelligence preferences.
 *
 * Currently just the per-provider model override: a user whose plan
 * doesn't include our hard-coded default (or who simply wants a newer
 * model) can pick their own. Unlike `keystore`, nothing here is
 * sensitive, so the store is plain JSON in `userData/aurora-ai-prefs.json`.
 *
 *     { "models": { "google": "gemini-2.5-flash", ... } }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('electron-log');

function prefsPath() {
  return path.join(app.getPath('userData'), 'aurora-ai-prefs.json');
}

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(prefsPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    if (e && e.code !== 'ENOENT') log.warn('ai prefs: read failed:', e);
    return {};
  }
}

function write(prefs) {
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
    fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2));
  } catch (e) {
    log.warn('ai prefs: write failed:', e);
  }
}

/** The user's chosen model for `provider`, or `null` to use the default. */
function getModel(provider) {
  const models = read().models;
  return models && typeof models[provider] === 'string' && models[provider]
    ? models[provider]
    : null;
}

/** Set (or, with an empty value, clear) the model override for `provider`. */
function setModel(provider, model) {
  const prefs = read();
  prefs.models = prefs.models || {};
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (trimmed) prefs.models[provider] = trimmed;
  else delete prefs.models[provider];
  write(prefs);
}

module.exports = { getModel, setModel };
