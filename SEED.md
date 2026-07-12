# SEED: GetThrough
## A live, in-the-moment assisted speech tool for people with aphasia and dementia

**Tagline:** Help a voice still present get through.
**Version:** Seed v1.0
**Scope:** Product A only. Live communication assistance for a person who is present and can confirm or reject. This is NOT a persona simulator, NOT a memorial tool, NOT an archive reconstructor. If a feature drifts toward generating what the person "would say," it is out of scope.

---

## 1. What this is

A person with aphasia or dementia speaks. Their speech may be fragmented, agrammatic, repetitive, or partly unintelligible. The system:

1. Captures their speech live (browser microphone).
2. Transcribes it verbatim (browser Web Speech API).
3. Sends the verbatim fragment, plus recent conversation context and a small patient-owned context file, to an LLM.
4. Receives 3 candidate interpretations of what the person may mean, each with a confidence level, plus an explicit "I cannot tell" path.
5. Displays the candidates as large tappable cards. The person (or the person with companion help) taps the one that matches, or taps "None of these, let me try again."
6. Only after confirmation, the system speaks the confirmed meaning aloud (browser speechSynthesis) and adds it to the conversation log.

The companion (spouse, caregiver, family member) speaks normally; their turns can be added to the log via the same mic button in "companion mode" so the LLM has conversational context for the next interpretation.

## 2. The five invariants (non-negotiable, enforce in code and UI)

These come from 21 months of research on this exact failure mode. Violating any of them is a build failure, not a style choice.

1. **The verbatim transcript is always visible.** Every interpretation card is shown alongside the raw transcript it interprets. The raw fragment is never hidden, replaced, or cleaned up in the log. The log stores both.
2. **Nothing is spoken or logged as the patient's meaning until the patient confirms it.** No auto-accept. No timeout-accept. No "most likely" default selection. Confirmation is a deliberate tap.
3. **"None of these" is always the fourth option**, visually equal in size and prominence to the 3 candidates. Rejecting is as easy as accepting.
4. **Every utterance in the log carries a provenance tag**, one of exactly: `patient-verbatim`, `patient-confirmed-interpretation`, `companion`. The tag renders visibly in the log (small colored chip). The session JSON stores it.
5. **The model must be allowed to not know.** The system prompt instructs the model to return low confidence or an explicit `unclear: true` flag when the fragment does not support interpretation. When `unclear` is true, the UI shows a gentle "I couldn't tell what you meant. Want to try again, or point/type instead?" state rather than 3 forced guesses. Never punish uncertainty by hiding it.

## 3. What this is NOT (hard non-goals for v1)

- No voice cloning. TTS uses a neutral browser voice.
- No fine-tuning. Personalization is a visible, editable, removable context file only (see §6).
- No speaker diarization or always-on listening. Push-to-talk only, one explicit mode toggle (Patient / Companion).
- No accounts, no cloud storage, no database. Sessions save to local JSON files.
- No medical claims anywhere in the UI or README. This is a communication aid, not a diagnostic or treatment device.
- No mobile app. Responsive web page is sufficient.

## 4. Architecture

```
get-through/
├── SEED.md                  # this file, kept in repo as the spec of record
├── README.md                # setup in under 10 lines, plus the 5 invariants restated
├── .env.example             # ANTHROPIC_API_KEY=
├── requirements.txt         # fastapi, uvicorn, anthropic, python-dotenv
├── server.py                # FastAPI app: serves static/, POST /interpret, POST /session/save
├── context.json             # patient-owned context (see §6), editable in-app
├── sessions/                # saved conversation logs, one JSON per session
└── static/
    ├── index.html           # single page: talk view + log + settings drawer
    ├── app.js               # mic capture, Web Speech API, card UI, TTS, fetch calls
    └── style.css            # accessible design system (see §7)
```

**Stack rationale:** Web Speech API and speechSynthesis are free, live, and keyless, which keeps the only secret server-side. One backend endpoint keeps the whole system auditable in a single file. Python because the maintainer's stack is Python.

**Model:** `claude-sonnet-4-6` via the Anthropic Messages API. Temperature 0.3. Max tokens 1000.

## 5. The /interpret contract

**Request** (JSON):
```json
{
  "fragment": "want the... the cold thing... door thing... juice no...",
  "recent_turns": [
    {"speaker": "companion", "text": "Do you want something to drink?"},
    {"speaker": "patient", "text": "yes... the uh..."}
  ],
  "context": { }
}
```
`recent_turns` is the last 6 confirmed turns. `context` is the parsed context.json.

**Response** (JSON):
```json
{
  "unclear": false,
  "candidates": [
    {"text": "I want something cold from the fridge, but not juice.", "confidence": "high"},
    {"text": "I want you to open the fridge door.", "confidence": "medium"},
    {"text": "I want a cold drink of water.", "confidence": "medium"}
  ]
}
```
When `unclear` is true, `candidates` is an empty array and the response includes `"reason"`: a one-sentence plain-language note.

**System prompt requirements** (write it carefully, this is the heart of the product):
- Role: an interpretation aid for a person with aphasia or dementia. Interpreter, not author.
- Reconstruct only from the fragment, the recent turns, and the provided context. Do not invent biographical facts, preferences, memories, or emotional statements not evidenced in the inputs.
- Candidates must be short (under 20 words), first person, present intent. They are things the person might be trying to say right now, not summaries about the person.
- The 3 candidates must be meaningfully different interpretations, not paraphrases of one guess.
- If the fragment plus context cannot support 3 distinct plausible interpretations, return fewer, or return unclear. Explicitly instruct: returning unclear is a correct and valued answer.
- Respond with JSON only, matching the schema exactly.

## 6. Patient-owned context (context.json)

A small, flat, human-readable file the patient and family control. Rendered in a settings drawer as editable fields, saved back to disk via POST /context.

```json
{
  "name": "",
  "people": ["Kirsti - wife", "..."],
  "common_needs": ["water", "bathroom", "blanket", "go outside"],
  "favorite_words_phrases": [],
  "places": ["kitchen", "porch"],
  "notes_from_family": "She says 'the cold thing' for the refrigerator."
}
```

Rules: this file is the ONLY personalization mechanism. It is passed into every /interpret call in full. It must be viewable, editable, and clearable from the UI in 2 taps. Deleting an entry removes it from all future inference immediately. This is the context-window architecture: documents visit the encounter, they are never absorbed.

## 7. Interface requirements

Primary user may have impaired language, motor, and vision function. Design accordingly:

- One screen. One giant press-and-hold (or tap-to-toggle) mic button, minimum 96px, centered.
- Live transcript appears as the person speaks, in at least 24px text.
- Candidate cards: minimum 80px tall, at least 20px text, generous spacing, obvious tap targets. Numbered 1-3 plus the "None of these" card.
- Confirmed meaning is spoken aloud immediately and slides into the conversation log with its provenance chip.
- Mode toggle: Patient / Companion. Companion turns skip interpretation and log directly as `companion`.
- A "Say it again" button on every confirmed patient turn (replays TTS).
- Settings drawer: context.json editor, voice rate slider (0.7 to 1.2), text size toggle, "Save session" and "New session" buttons.
- Color and tone: calm, warm, high contrast. WCAG AA minimum. No clinical white-and-gray dashboard aesthetic and no infantilizing design. This is a dignity product.
- Provenance chips: `patient-verbatim` in slate, `patient-confirmed-interpretation` in green, `companion` in blue. Legend visible in the log header.

## 8. Session log

Each session is an append-only array saved to `sessions/session-YYYYMMDD-HHMMSS.json`:

```json
{
  "started": "2026-07-12T14:30:00",
  "turns": [
    {"t": "...", "speaker": "patient", "provenance": "patient-verbatim", "text": "want the... cold thing..."},
    {"t": "...", "speaker": "patient", "provenance": "patient-confirmed-interpretation", "text": "I want something cold from the fridge.", "source_fragment": "want the... cold thing...", "rejected_candidates": ["...", "..."]},
    {"t": "...", "speaker": "companion", "provenance": "companion", "text": "Coming right up."}
  ]
}
```

Confirmed interpretations always store their source fragment and the rejected candidates. This is the audit trail: what the person said, what the model offered, what the person chose.

## 9. Acceptance criteria (test before declaring done)

1. `pip install -r requirements.txt`, add key to `.env`, `python server.py`, open localhost, and the app works in Chrome. Under 3 minutes from clone to first interpretation.
2. Speaking a garbled fragment returns 3 distinct candidates in under 4 seconds on a normal connection.
3. Nothing is ever spoken by TTS before a card is tapped. Verify by code inspection and by test.
4. Feeding the model pure noise ("buh... the... the...") with empty context produces the unclear state, not 3 confident inventions. Test this specific case.
5. Adding "she says 'the cold thing' for the refrigerator" to context.json measurably changes interpretation of a fragment containing "cold thing." Test this specific case.
6. Every turn in a saved session JSON has a valid provenance tag and confirmed interpretations carry source_fragment.
7. The whole app is 6-8 files. If it grew past that, simplify.

## 10. Build order

1. server.py with /interpret stubbed (canned response), static shell serving.
2. Mic capture, live transcript, mode toggle.
3. Real /interpret with the system prompt. Iterate the prompt against test fragments until criteria 4 and 5 pass.
4. Card UI, confirmation flow, TTS, log with provenance chips.
5. context.json editor, session save.
6. README, .env.example, final pass against §2 invariants and §9 criteria.

## 11. The one-sentence brief

You are not building a model that is the person. You are building an instrument that helps a voice still present get through, with the person's own signal visible in the room, and that can admit when it does not know what she meant.
