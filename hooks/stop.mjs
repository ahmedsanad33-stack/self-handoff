#!/usr/bin/env node
// Stop hook: when context >= threshold, ask ONCE per compaction cycle for HANDOFF-self.md.
import { readStdinJson, getThreshold, lastAssistantUsage, readState, writeState, handoffPath, emit, HANDOFF_FILE } from './lib.mjs';

const input = readStdinJson();

// Already continuing because of a stop hook (ours, after the block): never block again.
if (input.stop_hook_active) process.exit(0);

const threshold = getThreshold();
const usage = lastAssistantUsage(input.transcript_path);
if (!usage || usage.tokens < threshold) process.exit(0);

const sid = input.session_id;
const state = readState(sid);
if (state.asked) process.exit(0); // already asked in this compaction cycle

// Mark first, so a crash or a double fire can never loop.
writeState(sid, { ...state, asked: true, askedAt: Date.now(), tokensAtAsk: usage.tokens });

const file = handoffPath(input);
const k = Math.round(usage.tokens / 1000);
const reason = [
  `Self-handoff: this session's context is about ${k}k tokens (threshold ${Math.round(threshold / 1000)}k).`,
  `Before anything else, write (or update, if it exists) ${file} now. Use the self-handoff skill if available.`,
  `Use exactly these sections: Goal / Where we are / What we tried (including what failed) / Decisions taken and rejected / The user's exact words (verbatim quotes, in quotation marks) / Evidence and numbers / Exact next step / Commands to resume.`,
  `Write it from memory of this conversation while it is fresh. Update the existing file rather than rewriting it. Make sure ${HANDOFF_FILE} is in .gitignore.`,
  `Then STOP: reply with one line saying where the file is, and do not start any other work. After compaction you will be told to read it and continue from "Exact next step".`
].join('\n');

emit({ decision: 'block', reason });
