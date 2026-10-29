# self-handoff

A Claude Code plugin that makes your session write a `HANDOFF-self.md` **before** its context is compacted, and read it **right after**.

> English first, then Egyptian Arabic below. / الشرح بالمصري تحت.

## Why

Big sessions get expensive: every step re-reads the whole context. In our case a plan hit 100% in about 3 hours because one 500k-token session did roughly 150 small steps.

Auto-compaction fixes the size but keeps only the gist. What it loses is what hurts most:

- the **exact words** of the person (constraints, corrections, approvals),
- the **rejected ideas** (so they get proposed again),
- the **exact next step** (so the session wanders).

`HANDOFF-self.md` keeps those three things, written while the conversation is still fresh.

## Install

```text
/plugin marketplace add ahmedsanad33-stack/self-handoff
/plugin install self-handoff@sanad-plugins
```

(From a shell: `claude plugin marketplace add ahmedsanad33-stack/self-handoff` then `claude plugin install self-handoff@sanad-plugins`. Needs a recent Claude Code with plugin support.)

## How it works

1. **Stop hook.** At the end of a turn it reads the latest assistant message's usage in the transcript: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. If that is at or above the threshold and the session has not been asked yet in this compaction cycle, it blocks the stop once and tells Claude to write or update `HANDOFF-self.md` in the project root, then stop. It respects `stop_hook_active`, so it never loops.
2. **SessionStart hook (matcher `compact`).** After a manual `/compact` or an auto-compaction, it starts a new cycle (so the next big context can ask again) and, if `HANDOFF-self.md` exists, tells Claude to read it first and continue from **Exact next step**.
3. **PreCompact hook (matcher `manual`).** On a manual `/compact`, if there is no fresh `HANDOFF-self.md` (missing, or written earlier than about 2 minutes before the last assistant message), the first `/compact` is blocked with a reminder shown to you. Run `/compact` again to go ahead, or ask Claude to write the handoff first. Auto-compaction is never blocked.
4. **Skill `self-handoff`.** The how-to Claude follows: fixed sections, verbatim quotes, update rather than rewrite, add the file to `.gitignore`. You can also say "write a handoff" any time.

The file has these sections: Goal · Where we are · What we tried (including what failed) · Decisions taken and rejected · The user's exact words · Evidence and numbers · Exact next step · Commands to resume.

State (which session was asked) lives in `${CLAUDE_PLUGIN_DATA}` (falls back to `~/.claude/self-handoff/`), one small JSON file per session.

## Config

| Env var | Default | Meaning |
|---|---|---|
| `SELF_HANDOFF_TOKENS` | `200000` | Context size that triggers the request. Accepts `150000`, `150k`, `0.3m`. Clamped to 50,000 – 1,000,000. Invalid values fall back to the default. |
| `SELF_HANDOFF_PRECOMPACT` | on | Set to `0` to turn off the reminder before a manual `/compact`. |

Set them in `~/.claude/settings.json`:

```json
{ "env": { "SELF_HANDOFF_TOKENS": "250000" } }
```

Keep the threshold **below** the point where your session auto-compacts, otherwise compaction happens first. The auto-compact window is controlled by `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (100,000 to 1,000,000 tokens).

### Optional: let idle sessions compact themselves

Claude Code has an idle-compaction feature. Its threshold is `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` (default 200000, minimum 100000, requires Claude Code 2.1.290 or later; documented in the [environment variables reference](https://code.claude.com/docs/en/env-vars)). To change it:

```json
{ "env": { "CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS": "150000" } }
```

When an idle compaction happens, the SessionStart hook above still fires (`compact`) and points Claude at the handoff file.

## Cost tips

- Big model plans, small model executes. Let the strong model decide, hand the clear, repeatable steps to a smaller one.
- Give every subagent an explicit `model`. A subagent without one inherits the session's model, which is often the expensive one, without anyone noticing.
- Long admin loops (renaming, archiving, inventory) do not belong inside a huge session: every step re-reads the whole context. Send them to a small fresh subagent and take back only the result.

## Develop and test

```bash
npm test                       # node:test, no dependencies, no real Claude session
claude plugin validate .       # manifest + marketplace
claude --plugin-dir .          # try it locally
```

## License

MIT, Ahmed Sanad.

---

# بالمصري

## ليه

الجلسات الكبيرة بتغلى: كل خطوة بتعيد قراية السياق كله. عندنا الباقة وصلت ١٠٠٪ في حوالي ٣ ساعات لأن جلسة سياقها ٥٠٠ ألف عملت حوالي ١٥٠ خطوة صغيرة.

التلخيص التلقائي بيصغّر السياق بس بيحتفظ بالخلاصة، واللي بيضيع هو اللي بيوجع:

- **كلام صاحب الشغل بالحرف** (شروط، تصحيحات، موافقات)
- **الأفكار المرفوضة** (فبتترجع تتقترح تاني)
- **الخطوة الجاية بالظبط** (فالجلسة بتتوه)

`HANDOFF-self.md` بيحفظ التلاتة دول، بيتكتب والكلام لسه فريش.

## التركيب (خطوتين)

```text
/plugin marketplace add ahmedsanad33-stack/self-handoff
/plugin install self-handoff@sanad-plugins
```

## بيشتغل إزاي

1. **لما السياق يوصل الحد** (٢٠٠ ألف توكن تلقائيًا) ويخلص الدور، الجلسة بتتطلب **مرة واحدة** في كل دورة تلخيص تكتب أو تحدّث `HANDOFF-self.md` في فولدر المشروع، وبعدين تقف.
2. **بعد التلخيص** (يدوي بـ`/compact` أو تلقائي) الجلسة بتتقالها تقرا الملف الأول وتكمّل من «Exact next step».
3. **قبل `/compact` اليدوي** لو مفيش ملف حديث، أول `/compact` بيتوقف برسالة تذكير. اكتب الملف أو اعمل `/compact` تاني وهيعدّي. التلخيص التلقائي عمره ما بيتوقف.

الأقسام: الهدف · إحنا فين · اللي جرّبناه (حتى اللي فشل) · القرارات المختارة والمرفوضة · كلام صاحب الشغل بالحرف · الدليل والأرقام · الخطوة الجاية بالظبط · أوامر الاستئناف.

## الإعدادات

- `SELF_HANDOFF_TOKENS`: الحد بالتوكن (الافتراضي ٢٠٠٠٠٠، بيقبل `150k`، ومحصور بين ٥٠ ألف ومليون). حطه في `env` جوه `~/.claude/settings.json`.
- `SELF_HANDOFF_PRECOMPACT=0`: يقفل التذكير قبل `/compact` اليدوي.
- اسيب الحد **أقل** من نقطة التلخيص التلقائي، وإلا التلخيص هيسبقك.
- اختياري: `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` (موجود في دوكس كلود كود، من النسخة 2.1.290) بيخلي الجلسات الواقفة تلخّص نفسها.

## نصايح توفير

- الموديل الكبير يخطط، والصغير ينفّذ.
- كل وكيل فرعي بموديل صريح (`model`)، وإلا بياخد موديل الجلسة الغالي من غير ما حد ياخد باله.
- الشغل الإداري الطويل يروح لوكيل صغير بره الجلسة الكبيرة.
