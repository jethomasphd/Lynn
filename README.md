# GetThrough

**Help a voice still present get through.**

A live assisted-speech tool for a person with aphasia or dementia and their
companion. The person speaks; the browser transcribes verbatim; the model
proposes up to three candidate meanings as large tappable cards; the person
taps the one that matches — or rejects them all — and only then is the
confirmed meaning spoken aloud and added to the log. It is a communication
aid, not a diagnostic or treatment device, and it never speaks for anyone.

The full specification lives in [SEED.md](SEED.md).

## Setup

```
pip install -r requirements.txt
cp .env.example .env        # then paste your Anthropic API key into .env
python server.py
```

Open http://localhost:8000 in Chrome and allow the microphone.

## What this tool will never do

These five invariants come from SEED.md §2. Violating any of them is a build
failure, not a style choice.

1. **The verbatim transcript is always visible.** Every interpretation card is
   shown alongside the raw transcript it interprets. The raw fragment is never
   hidden, replaced, or cleaned up in the log. The log stores both.
2. **Nothing is spoken or logged as the patient's meaning until the patient
   confirms it.** No auto-accept. No timeout-accept. No "most likely" default
   selection. Confirmation is a deliberate tap.
3. **"None of these" is always the fourth option**, visually equal in size and
   prominence to the 3 candidates. Rejecting is as easy as accepting.
4. **Every utterance in the log carries a provenance tag**, one of exactly:
   `patient-verbatim`, `patient-confirmed-interpretation`, `companion`. The
   tag renders visibly in the log (small colored chip). The session JSON
   stores it.
5. **The model must be allowed to not know.** The system prompt instructs the
   model to return low confidence or an explicit `unclear: true` flag when the
   fragment does not support interpretation. When `unclear` is true, the UI
   shows a gentle "I couldn't tell what you meant. Want to try again, or
   point/type instead?" state rather than 3 forced guesses. Never punish
   uncertainty by hiding it.

## The pieces

- `server.py` — the whole backend in one readable file: serves the page,
  `POST /interpret` (the model call and its system prompt), `GET/POST /context`,
  `POST /session/save`.
- `static/` — one page, plain HTML/JS/CSS. Mic capture and speech synthesis
  use the browser's own Web Speech APIs, so the only secret is the server-side
  API key.
- `context.json` — the patient-owned context file, the only personalization
  mechanism. Editable and clearable from the settings drawer; sent along in
  full on every interpretation; absorbed nowhere.
- `sessions/` — conversation logs saved locally as JSON, one file per session,
  with provenance on every turn. Nothing leaves your machine except the
  interpretation requests to the model.
