# ◊ THE LANTERN ◊

### A chamber kept for a voice still here.

> *The word against the flood.*

Someone you love is speaking, and the words are breaking apart on the way
out — aphasia, dementia, the bridge between meaning and mouth giving way.
You are in the room with them, reaching for something. This is that
something.

**The Lantern listens, and shows their exact words.** Then it offers up to
three readings of what they might mean, as large tappable cards. **They
choose** — or refuse them all, which costs them nothing. Only after they
choose does it speak their meaning aloud and keep it in the record. When it
cannot tell, it says so, and waits.

It is a communication aid, not a diagnostic or treatment device. It never
speaks for anyone. The lantern only shines; it does not write.

---

## Setup

```
pip install -r requirements.txt
cp .env.example .env        # then paste your Anthropic API key into .env
python server.py
```

Open http://localhost:8000 in Chrome and allow the microphone. Without a
key the lantern still listens and keeps the verbatim record; readings need
the flame.

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

## The chamber

- **The threshold** — a first-visit arrival page for the one who carried
  the lantern here. Read once, cross, and it stands open (re-readable from
  settings).
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

- `server.py` — the whole backend in one readable file: serves the chamber,
  `POST /reading` (the model call and the Lantern's Rite), `GET/POST /prism`,
  `POST /record/save`.
- `static/` — one page, plain HTML/JS/CSS. Mic capture and speech use the
  browser's own Web Speech APIs, so the only secret is the server-side key.
- `prism.json` — the person-owned prism, the only personalization
  mechanism. It selects which knowledge dominates a reading — this person's
  own words and world, not the culture's composite patient. Editable and
  clearable from the settings drawer; sent along in full on every reading;
  absorbed nowhere.
- `records/` — conversation records saved locally as JSON, one file per
  session, provenance on every turn. Nothing leaves your machine except the
  reading requests to the model.

---

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
For Lynn.

<p align="center">◊ ◈ ◊</p>

<p align="center"><em>The person is present.<br>The words are theirs.<br>You only hold the lantern.</em></p>

<p align="center">◊ ◈ ◊</p>
