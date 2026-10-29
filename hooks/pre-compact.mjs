#!/usr/bin/env node
// PreCompact (matcher: manual): if no fresh HANDOFF-self.md, block the first /compact
// with a reminder. A second /compact in the same cycle goes through.
// Auto-compaction is never blocked (blocking it would skip compaction or fail the request).
import { readStdinJson, lastAssistantUsage, readState, writeState, handoffPath, handoffMtimeMs, FRESH_GRACE_MS } from './lib.mjs';

const input = readStdinJson();
if (process.env.SELF_HANDOFF_PRECOMPACT === '0') process.exit(0);
if (input.trigger && input.trigger !== 'manual') process.exit(0);

const file = handoffPath(input);
const mtime = handoffMtimeMs(file);
const state = readState(input.session_id);

if (state.remindedManual) process.exit(0);

let fresh = false;
if (mtime !== null) {
  const last = lastAssistantUsage(input.transcript_path);
  const lastTs = last && last.timestampMs;
  fresh = lastTs ? mtime >= lastTs - FRESH_GRACE_MS : true;
}
if (fresh) process.exit(0);

writeState(input.session_id, { ...state, remindedManual: true });
process.stderr.write(
  `Self-handoff: no fresh HANDOFF-self.md for this session (${file}). ` +
    `Ask Claude to write it now ("write HANDOFF-self.md"), then run /compact again. ` +
    `Run /compact again straight away to compact without it.\n`
);
process.exit(2);
