// @ts-check
/**
 * conversations.js — persistent chat history for Aurora Intelligence.
 *
 * One JSON file per conversation under
 * `userData/aurora-intelligence-chats/<id>.json`. We keep it as
 * one-file-per-chat (rather than a single index) so adding a chat
 * never rewrites the whole history — important once a user has dozens
 * of them — and so a corrupt file only kills that one chat.
 *
 * Shape on disk:
 *
 *     {
 *       "id":        "c-1737067200000-a1b2c3",
 *       "title":     "Refactor proc_rls.cmm",
 *       "provider":  "anthropic",
 *       "model":     "claude-haiku-4-5",
 *       "createdAt": 1737067200000,
 *       "updatedAt": 1737067845231,
 *       "messages":  [{ "role": "user"|"assistant", "content": "..." }],
 *       "cumulativeTokens": 4823
 *     }
 *
 * `listAll()` returns a *light* view — id/title/provider/model/dates
 * + message count — so the chat-list sidebar doesn't have to load
 * every message body up front. `read(id)` returns the full document
 * (used when the user clicks a chat to resume it).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const log = require('electron-log');

function dirPath() {
  return path.join(app.getPath('userData'), 'aurora-intelligence-chats');
}

function ensureDir() {
  try { fs.mkdirSync(dirPath(), { recursive: true }); }
  catch (e) { log.warn('[ai.conversations] dir create failed:', e?.message || e); }
}

function safeId(id) {
  return String(id || '').replace(/[^\w.-]/g, '');
}

function filePath(id) {
  const clean = safeId(id);
  if (!clean) throw new Error('invalid conversation id');
  return path.join(dirPath(), `${clean}.json`);
}

function readSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) {
    if (e && e.code !== 'ENOENT') log.warn('[ai.conversations] read failed:', e?.message || e);
    return null;
  }
}

/** Renderer-generated ids would round-trip through IPC anyway — handing them out from main keeps everything in one place. */
function generateId() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Lightweight metadata for every saved conversation, newest first.
 * The chat sidebar consumes this directly — no message bodies, so a
 * huge chat doesn't pay for being listed.
 */
function listAll() {
  ensureDir();
  let entries = [];
  try { entries = fs.readdirSync(dirPath()); }
  catch (e) {
    if (e && e.code !== 'ENOENT') log.warn('[ai.conversations] list failed:', e?.message || e);
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const data = readSafe(path.join(dirPath(), name));
    if (!data || typeof data.id !== 'string') continue;
    out.push({
      id: data.id,
      title: data.title || 'Untitled',
      provider: data.provider || null,
      model: data.model || null,
      createdAt: data.createdAt || 0,
      updatedAt: data.updatedAt || data.createdAt || 0,
      messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
    });
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

/** Full document, including every message. `null` if the id is unknown. */
function read(id) {
  if (!safeId(id)) return null;
  return readSafe(filePath(id));
}

/**
 * Upsert a conversation. Always stamps `updatedAt`. Seeds `createdAt`
 * on first save. Returns the persisted document.
 */
function save(conv) {
  if (!conv || !safeId(conv.id)) throw new Error('id required');
  ensureDir();
  const now = Date.now();
  const data = {
    id: conv.id,
    title: (conv.title || 'Untitled').toString().slice(0, 200),
    provider: conv.provider || null,
    model: conv.model || null,
    createdAt: conv.createdAt || now,
    updatedAt: now,
    messages: Array.isArray(conv.messages) ? conv.messages : [],
    cumulativeTokens: Number(conv.cumulativeTokens) || 0,
  };
  fs.writeFileSync(filePath(conv.id), JSON.stringify(data, null, 2));
  return data;
}

function remove(id) {
  if (!safeId(id)) return false;
  try { fs.unlinkSync(filePath(id)); return true; }
  catch (e) {
    if (e && e.code !== 'ENOENT') log.warn('[ai.conversations] delete failed:', e?.message || e);
    return false;
  }
}

function rename(id, title) {
  const data = read(id);
  if (!data) return null;
  data.title = (title || 'Untitled').toString().trim().slice(0, 200) || 'Untitled';
  data.updatedAt = Date.now();
  fs.writeFileSync(filePath(id), JSON.stringify(data, null, 2));
  return data;
}

module.exports = { listAll, read, save, remove, rename, generateId };
