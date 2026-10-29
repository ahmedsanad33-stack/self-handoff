import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-test-'));
  const proj = path.join(dir, 'proj');
  fs.mkdirSync(proj);
  return { dir, proj, data: path.join(dir, 'data'), transcript: path.join(dir, 't.jsonl') };
}

function transcript(file, tokens, ts = new Date().toISOString()) {
  const lines = [
    { type: 'user', message: { role: 'user', content: 'hi' }, timestamp: ts },
    { type: 'assistant', isSidechain: true, message: { model: 'x', usage: { input_tokens: 9999999 } }, timestamp: ts },
    {
      type: 'assistant',
      timestamp: ts,
      message: {
        model: 'claude-x',
        usage: { input_tokens: 10, cache_read_input_tokens: tokens - 30, cache_creation_input_tokens: 20, output_tokens: 5 }
      }
    },
    { type: 'assistant', timestamp: ts, message: { model: '<synthetic>', usage: { input_tokens: 0 } } }
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

function run(script, input, sb, env = {}) {
  const r = spawnSync('node', [path.join(HOOKS, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: sb.data, CLAUDE_PROJECT_DIR: sb.proj, SELF_HANDOFF_TOKENS: '', ...env }
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const stopInput = (sb, extra = {}) => ({
  session_id: 's1',
  transcript_path: sb.transcript,
  cwd: sb.proj,
  hook_event_name: 'Stop',
  stop_hook_active: false,
  ...extra
});

test('stop: below threshold -> no output', () => {
  const sb = sandbox();
  transcript(sb.transcript, 150000);
  const r = run('stop.mjs', stopInput(sb), sb);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
});

test('stop: above threshold -> block once, then nothing in the same cycle', () => {
  const sb = sandbox();
  transcript(sb.transcript, 250000);
  const a = run('stop.mjs', stopInput(sb), sb);
  assert.equal(a.code, 0);
  const j = JSON.parse(a.out);
  assert.equal(j.decision, 'block');
  assert.match(j.reason, /HANDOFF-self\.md/);
  assert.match(j.reason, /Exact next step/);
  assert.match(j.reason, /250k/);
  const b = run('stop.mjs', stopInput(sb), sb);
  assert.equal(b.out, '');
});

test('stop: stop_hook_active true -> nothing, and does not consume the ask', () => {
  const sb = sandbox();
  transcript(sb.transcript, 250000);
  const a = run('stop.mjs', stopInput(sb, { stop_hook_active: true }), sb);
  assert.equal(a.out, '');
  const b = run('stop.mjs', stopInput(sb), sb);
  assert.equal(JSON.parse(b.out).decision, 'block');
});

test('stop: env threshold respected, clamped, and invalid -> default', () => {
  const sb = sandbox();
  transcript(sb.transcript, 120000);
  assert.equal(JSON.parse(run('stop.mjs', stopInput(sb), sb, { SELF_HANDOFF_TOKENS: '100k' }).out).decision, 'block');
  const sb0 = sandbox();
  transcript(sb0.transcript, 120000);
  assert.equal(run('stop.mjs', stopInput(sb0), sb0, { SELF_HANDOFF_TOKENS: '150k' }).out, '');
  const sb2 = sandbox();
  transcript(sb2.transcript, 120000);
  // 1000 clamps up to 50k -> 120k is above it
  assert.equal(JSON.parse(run('stop.mjs', stopInput(sb2), sb2, { SELF_HANDOFF_TOKENS: '1000' }).out).decision, 'block');
  const sb3 = sandbox();
  transcript(sb3.transcript, 120000);
  assert.equal(run('stop.mjs', stopInput(sb3), sb3, { SELF_HANDOFF_TOKENS: 'banana' }).out, ''); // default 200k
});

test('stop: missing or unreadable transcript -> nothing', () => {
  const sb = sandbox();
  assert.equal(run('stop.mjs', stopInput(sb), sb).out, '');
  assert.equal(run('stop.mjs', { session_id: 's1' }, sb).out, '');
});

test('session-start compact: with file -> additionalContext and cycle reset', () => {
  const sb = sandbox();
  transcript(sb.transcript, 250000);
  run('stop.mjs', stopInput(sb), sb); // asked = true
  fs.writeFileSync(path.join(sb.proj, 'HANDOFF-self.md'), '# HANDOFF-self\n');
  const r = run('session-start.mjs', { session_id: 's1', source: 'compact', cwd: sb.proj, hook_event_name: 'SessionStart' }, sb);
  assert.equal(r.code, 0);
  const j = JSON.parse(r.out);
  assert.equal(j.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(j.hookSpecificOutput.additionalContext, /Read HANDOFF-self\.md FIRST/);
  assert.match(j.hookSpecificOutput.additionalContext, /Exact next step/);
  // new cycle: Stop asks again
  const again = run('stop.mjs', stopInput(sb), sb);
  assert.equal(JSON.parse(again.out).decision, 'block');
});

test('session-start compact: without file -> no output (but cycle still reset)', () => {
  const sb = sandbox();
  transcript(sb.transcript, 250000);
  run('stop.mjs', stopInput(sb), sb);
  const r = run('session-start.mjs', { session_id: 's1', source: 'compact', cwd: sb.proj }, sb);
  assert.equal(r.out, '');
  assert.equal(JSON.parse(run('stop.mjs', stopInput(sb), sb).out).decision, 'block');
});

test('session-start: non-compact source -> nothing', () => {
  const sb = sandbox();
  fs.writeFileSync(path.join(sb.proj, 'HANDOFF-self.md'), 'x');
  assert.equal(run('session-start.mjs', { session_id: 's1', source: 'startup', cwd: sb.proj }, sb).out, '');
});

test('pre-compact manual: no file -> exit 2 with reminder, second time allowed', () => {
  const sb = sandbox();
  transcript(sb.transcript, 100000);
  const inp = { session_id: 's1', transcript_path: sb.transcript, cwd: sb.proj, hook_event_name: 'PreCompact', trigger: 'manual' };
  const a = run('pre-compact.mjs', inp, sb);
  assert.equal(a.code, 2);
  assert.match(a.err, /HANDOFF-self\.md/);
  assert.equal(run('pre-compact.mjs', inp, sb).code, 0);
});

test('pre-compact manual: fresh file -> allowed; stale file -> blocked', () => {
  const sb = sandbox();
  const old = new Date(Date.now() - 3600 * 1000).toISOString();
  transcript(sb.transcript, 100000);
  const f = path.join(sb.proj, 'HANDOFF-self.md');
  fs.writeFileSync(f, 'x');
  const inp = { session_id: 's1', transcript_path: sb.transcript, cwd: sb.proj, trigger: 'manual' };
  assert.equal(run('pre-compact.mjs', inp, sb).code, 0); // written just now, after the last assistant turn
  const sb2 = sandbox();
  transcript(sb2.transcript, 100000);
  const f2 = path.join(sb2.proj, 'HANDOFF-self.md');
  fs.writeFileSync(f2, 'x');
  fs.utimesSync(f2, new Date(old), new Date(old));
  assert.equal(run('pre-compact.mjs', { ...inp, transcript_path: sb2.transcript, cwd: sb2.proj }, sb2).code, 2);
});

test('pre-compact: auto trigger and SELF_HANDOFF_PRECOMPACT=0 never block', () => {
  const sb = sandbox();
  transcript(sb.transcript, 100000);
  assert.equal(run('pre-compact.mjs', { session_id: 's1', transcript_path: sb.transcript, trigger: 'auto' }, sb).code, 0);
  assert.equal(
    run('pre-compact.mjs', { session_id: 's2', transcript_path: sb.transcript, trigger: 'manual' }, sb, { SELF_HANDOFF_PRECOMPACT: '0' }).code,
    0
  );
});

test('stop: large transcript (tail read) still finds the last assistant usage', () => {
  const sb = sandbox();
  const filler = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(2000) } });
  const body = Array.from({ length: 2000 }, () => filler).join('\n') + '\n';
  fs.writeFileSync(sb.transcript, body);
  fs.appendFileSync(
    sb.transcript,
    JSON.stringify({ type: 'assistant', message: { model: 'm', usage: { input_tokens: 5, cache_read_input_tokens: 300000 } } }) + '\n'
  );
  fs.appendFileSync(sb.transcript, body); // >1MB of non-assistant lines after it
  assert.equal(JSON.parse(run('stop.mjs', stopInput(sb), sb).out).decision, 'block');
});
