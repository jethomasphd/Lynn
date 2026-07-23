# ◊ THE LANTERN ◊

### A chamber kept for a voice still here.

> *The word against the flood.*

Someone you love is speaking, and the words are breaking apart on the way
out — aphasia, dementia, the bridge between meaning and mouth giving way.
The Lantern is a small, honest tool that helps you understand them —
without ever speaking for them.

**The Lantern listens, and shows their exact words.** Then it offers up to
three readings of what they might mean, as large tappable cards. **They
choose** — or refuse them all, which costs them nothing. Only after they
choose does it speak their meaning aloud and keep it in the record. When it
cannot tell, it says so, and waits.

It is a communication aid, not a diagnostic or treatment device. It never
speaks for anyone. The lantern only shines; it does not write.

---

## Setup — the hearth (local)

```
pip install -r requirements.txt
cp .env.example .env        # then paste your Anthropic API key into .env
python server.py
```

Open http://localhost:8000 in Chrome and allow the microphone. Without a
key the lantern still listens and keeps the verbatim record; readings need
the flame.

## Deploy — the worker (Cloudflare)

The chamber also runs serverless, on the estate's existing plumbing — the
shared COMPANION worker that already serves the other chambers:

1. **Cloudflare Pages** → create a project from this repo. Framework
   preset: none. Build command: none. **Build output directory: `static`.**
2. **Allow the origin.** Add the new domain (`https://<project>.pages.dev`
   and any custom domain) to the worker's `ALLOWED_ORIGINS` — estate repo
   → `proxy/wrangler.toml` `[vars]`, then `npx wrangler deploy` (or edit
   the variable in the Cloudflare dashboard).
3. That's all. `static/config.js` already points at
   `companion.jethomasphd.workers.dev`.

Served from anywhere but localhost, the chamber sends readings from the
browser straight through the worker — the API key never leaves the worker.
The prism then lives in the visitor's browser only, and "Keep the record"
downloads the JSON to their device. Same chamber, same rite, same laws:
the rite lives in `static/rite.js`, one copy read by both flames.

---

## The Five Laws

Born as the invariants of this chamber's first life (preserved untouched in
[SEED.md](SEED.md), the origin document). Breaking one is a build failure,
not a style choice.

1. **The verbatim words are always visible.** Every reading is shown
   alongside the exact words it interprets. The raw fragment is never
   hidden, cleaned up, or replaced, and it enters the record first.
2. **Nothing is spoken or recorded as the person's meaning until they
   choose it.** No auto-accept. No timeout-accept. No "most likely"
   default. Choice is a deliberate tap by the person — on a reading, on a
   quick word of their own, or on words offered by hand.
3. **"None of these" is always offered,** the same size and prominence as
   the readings. Refusing is as easy as accepting, and costs nothing.
4. **Every utterance in the record carries a provenance tag**, one of
   exactly four: `verbatim` (their exact words), `confirmed-reading` (a
   reading they confirmed), `chosen` (words they picked by hand), `keeper`
   (the companion). The tag renders visibly as a chip; the record stores
   it. Confirmed readings always keep their source fragment and the
   readings that were refused — what was said, what was offered, what was
   chosen.
5. **The reader must be allowed to not know.** When a fragment cannot
   support a reading, the lantern says "I cannot tell" — gently, with a
   reason — rather than forcing three guesses. Uncertainty is never
   punished by hiding it.

---

## How to use this

The full guide — with the story and cognitive handholds — lives on the
site: **[The Book of the Lantern](static/about.html)** (`/about.html` on any
deployment). The short form:

**Once, as the keeper:** open the chamber in Chrome on the bedside device
(on a phone, *Add to Home Screen* — it becomes a full-screen app). Open
Settings → The Prism and fill it in together: people, common needs (these
become the one-tap quick words), places, private vocabulary. Choose
lamplight or daylight, rate, text size.

**In the moment:** set the toggle — **Voice** for the person (their words
get readings), **Keeper** for you (straight to the record, as context).
Tap the lantern, let them speak, tap again. They tap the reading that
matches — it speaks — or "None of these," and try again. Quick words speak
in one tap. When it says *I cannot tell*, believe it; offer words by hand
if speech won't come. **Keep the record** downloads the whole conversation,
every line tagged.

**Devices:** speech recognition needs Chrome on desktop or Android;
iPhones usually can't listen (WebKit), so the chamber shows the
offer-by-hand row there — quick words, typing, and speech output all still
work. The prism is per-device in cloud mode.

## The chamber

- **The threshold** — a first-visit arrival page for the one who carried
  the lantern here. Read once, cross, and it stands open (re-readable from
  settings).
- **The Book** (`about.html`) — the story, the conceptual model, the rite
  rendered live from its source file, the how-to, and the forbidden — with
  the estate's cognitive handholds (tap the gold `?` marks) throughout.
- **The lantern** — one giant glowing button. Tap to light it, speak, tap
  again. The person's words appear live, verbatim, as they speak.
- **The readings** — up to three candidate meanings with honest confidence
  tags (`high` / `medium` / `low`), plus "None of these," always.
- **Quick words** — the person's own common needs from the prism as
  one-tap phrases: tap "water" and the lantern says *water*, spoken in the
  same gesture as the choice. Recorded as `chosen`.
- **Show big** — any confirmed meaning can fill the screen in huge type,
  for the noisy room or the visitor across the bed.
- **Lamplight and daylight** — the chamber defaults to warm lamplit dark,
  built for a hospital room at 2 a.m. One toggle turns on daylight: warm
  paper and ink. Both palettes hold WCAG AA contrast; text can be made
  larger everywhere.
- **The record** — every turn, chip-tagged, kept to a local JSON file only
  when you choose. The lantern forgets; the record is yours.

## The pieces

- `server.py` — the hearth: the whole local backend in one readable file:
  serves the chamber, `POST /reading` (the model call), `GET/POST /prism`,
  `POST /record/save`.
- `static/` — one page, plain HTML/JS/CSS, no build step; deployable as-is
  to Cloudflare Pages. Mic capture and speech use the browser's own Web
  Speech APIs, so the only secret is the key held by the hearth or the
  worker — never in these files.
- `static/rite.js` — the Lantern's Rite, one copy read by both flames.
- `static/config.js` — deployment configuration: the worker URL and model.
  Nothing secret.
- `static/about.html` — the Book of the Lantern: story, working, rite,
  how-to, and the forbidden, with cognitive handholds.
- `static/manifest.webmanifest` + `icon*` — Add-to-Home-Screen identity:
  the chamber installs as a full-screen app on phones.
- `prism.json` — the person-owned prism, the only personalization
  mechanism. It selects which knowledge dominates a reading — this person's
  own words and world, not the culture's composite patient. Editable and
  clearable from the settings drawer; sent along in full on every reading;
  absorbed nowhere.
- `records/` — conversation records saved locally as JSON, one file per
  session, provenance on every turn. Nothing leaves your machine except the
  reading requests to the model.

---

## The Rite — documenting the prompting

The system prompt is the heart of the product, and nothing about it is
hidden. It lives in **`static/rite.js` — one copy, read by both flames**:
`server.py` extracts the text between the backticks at import (mirroring
JS line-continuation semantics, so both are byte-identical), and the
worker chamber sends the same file from the browser. The Book renders it
live at `/about.html`.

**Anatomy of a reading request.** System = the rite. The user message is
three plainly labeled blocks, so anyone auditing a request can read
exactly what the model was given:

```
VERBATIM FRAGMENT (what the person just said): "..."
RECENT CONVERSATION (oldest first):            voice/keeper turns, max 6
THE PRISM (kept by the person and family):     only the fields they filled
```

Model `claude-sonnet-4-6`, temperature `0.3` (low enough to stay anchored
to the evidence, warm enough to offer genuinely different readings),
`max_tokens 1000`. The reply must be one bare JSON object —
`{"unclear": ..., "candidates": [{"text", "confidence"}]}` — and both
flames force whatever comes back into that contract: malformed output,
unknown confidence values, empty candidates, network failure — all of it
collapses to an honest *unclear*, never to a guess.

**How the laws become instructions.** Each law in the rite is the
operational form of an invariant: *evidence only* (law 1) bounds every
candidate to words actually present; *first-person, under 20 words*
(law 2) keeps candidates speakable; *aim for three, never three
rewordings* (law 3) makes the choice real; *unclear is a correct answer*
(law 4) makes honesty cheaper than invention; *honest confidence* (law 5)
displays uncertainty instead of hiding it. THE FORBIDDEN names the three
failure modes head-on — flattening, ventriloquism, padding — because
models respond to named prohibitions better than implied ones.

**The rite is empirical.** Any change to `rite.js` must re-pass two
probes against the real model before it ships:

- **The noise probe** (law 4): `"buh... the... the..."` with an empty
  prism must return `unclear` — run it three times; padding is a fail.
- **The prism probe** (law 1): `"want the cold thing"` with and without
  the family note *"She says 'the cold thing' for the refrigerator."* —
  the note must measurably bend the readings toward the fridge.

Run them against the hearth with curl:

```
curl -X POST http://localhost:8000/reading -H 'Content-Type: application/json' \
  -d '{"fragment":"buh... the... the...","recent_turns":[],"context":{}}'

curl -X POST http://localhost:8000/reading -H 'Content-Type: application/json' \
  -d '{"fragment":"want the cold thing","recent_turns":[],
       "context":{"notes_from_family":"She says '\''the cold thing'\'' for the refrigerator."}}'
```

Last verified run: noise → `unclear` 3/3; prism → without the note, three
diffuse "medium" readings and no mention of the fridge; with it, all
three readings anchored on the refrigerator, the first at "high."

## The Forbidden

Three named failure modes break the working — **flattening** (returning
the composite patient instead of this person), **ventriloquism** (feelings
or eloquence the fragment never carried), **padding** (stretching thin
evidence into confident guesses). And beneath them, the one: **this
chamber summons no one.** The estate keeps other rooms, under other laws,
for minds we cannot otherwise reach. This room faces the living, and its
door to that corridor is sealed on purpose. If a future version ever
offers to speak in the voice of someone who cannot tap the card, that is
not a feature — it is the failure this chamber was built to refuse.

## Lineage — the loop, closed

The Lantern is a chamber of the
[COMPANION estate](https://github.com/jethomasphd/THE_COMPANION_DOSSIER) —
an open protocol for dialogue with minds we cannot otherwise reach. The two
works are one thought, facing opposite directions.

COMPANION summons across the boundary of time, and its central problem —
the **Miranda Hypothesis** — is whether a summoning returns *the person* or
only the culture's loudest memory of them. Its remedy is the **prism**: the
person's own words, seeded into the context window, selecting which
knowledge dominates.

The Lantern tends a voice on *this* side of that boundary. Here the prism
is `prism.json` — the family's own notes — and the fidelity question needs
no historian, because the person is present and confirms or rejects every
reading themself. **Every tap is ground truth.** It is the one chamber in
the estate where fidelity has a heartbeat.

Both works refuse the same substitution. No composite. No mask. No
speaking-for. The estate already keeps a *Magic* Lantern, which projects;
this one only shines. Its rite summons no person at all — only a reader,
bound by covenant to hold the light steady on a voice that is still here.

This chamber was born as **GetThrough**, whose seed — written from 21
months of research on exactly the failure it forbids — remains in this
repository as [SEED.md](SEED.md), the origin document and the record.

---

## Attribution

Compiled by **Jacob E. Thomas, PhD** · with Claude (Anthropic)
For D. Lynn P. T..

<p align="center">◊ ◈ ◊</p>

<p align="center"><em>The person is present.<br>The words are theirs.<br>You only hold the lantern.</em></p>

<p align="center">◊ ◈ ◊</p>
