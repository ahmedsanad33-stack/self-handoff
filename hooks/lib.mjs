// Shared helpers for the self-handoff hooks. Node >= 18, no dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HANDOFF_FILE = 'HANDOFF-self.md';
export const DEFAULT_TOKENS = 200000;
export const MIN_TOKENS = 50000;
export const MAX_TOKENS = 1000000;
// A handoff counts as "fresh" if it was written no earlier than this long
// before the last assistant message (the write usually happens a little
// before the closing message of the same turn).
export const FRESH_GRACE_MS = 120 * 1000;

export function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// SELF_HANDOFF_TOKENS: "200000", "150k", "0.3m". Anything invalid -> default.
// Result is clamped to [MIN_TOKENS, MAX_TOKENS].
export function getThreshold(env = process.env) {
  const raw = String(env.SELF_HANDOFF_TOKENS ?? '').trim().toLowerCase();
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*([km]?)$/);
  if (!m) return DEFAULT_TOKENS;
  let n = parseFloat(m[1]);
  if (m[2] === 'k') n *= 1e3;
  if (m[2] === 'm') n *= 1e6;
  if (!Number.isFinite(n)) return DEFAULT_TOKENS;
  return Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, Math.round(n)));
}

export function projectDir(input, env = process.env) {
  return env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

export function handoffPath(input, env = process.env) {
  return path.join(projectDir(input, env), HANDOFF_FILE);
}

// CLAUDE_PLUGIN_DATA is exported to hook processes by Claude Code and survives
// plugin updates. Fall back to ~/.claude/self-handoff if it is not set.
export function stateDir(env = process.env) {
  return env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.claude', 'self-handoff');
}

function stateFile(sessionId, env) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(stateDir(env), `${safe}.json`);
}

export function readState(sessionId, env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sessionId, env), 'utf8'));
  } catch {
    return {};
  }
}

export function writeState(sessionId, state, env = process.env) {
  try {
    const dir = stateDir(env);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile(sessionId, env), JSON.stringify(state));
    pruneOldState(dir);
    return true;
  } catch {
    return false;
  }
}

function pruneOldState(dir) {
  try {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch {
    /* best effort */
  }
}

function readTail(file, bytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    let text = buf.toString('utf8');
    const whole = len === size;
    if (!whole) text = text.slice(text.indexOf('\n') + 1); // drop partial first line
    return { text, whole };
  } finally {
    fs.closeSync(fd);
  }
}

// Latest real assistant message in the main thread:
// { tokens, timestampMs } or null.
// tokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
export function lastAssistantUsage(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    for (let bytes = 1 << 20; bytes <= 1 << 26; bytes <<= 2) {
      const { text, whole } = readTail(transcriptPath, bytes);
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (obj.type !== 'assistant' || obj.isSidechain || obj.isApiErrorMessage) continue;
        const msg = obj.message;
        if (!msg || msg.model === '<synthetic>' || !msg.usage) continue;
        const u = msg.usage;
        const tokens =
          (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
        return { tokens, timestampMs: Number.isFinite(ts) ? ts : null };
      }
      if (whole) return null;
    }
  } catch {
    /* unreadable transcript -> no decision */
  }
  return null;
}

export function handoffMtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
