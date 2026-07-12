"""GetThrough server.

One small FastAPI app that does three things:

  1. Serves the static web page (static/index.html + app.js + style.css).
  2. POST /interpret -- takes a verbatim speech fragment from a person with
     aphasia or dementia, plus recent conversation turns and the family's
     context file, and asks the model for up to 3 candidate interpretations
     (or an honest "unclear"). The model only *proposes*; the person in the
     room confirms or rejects on screen. Nothing here speaks for them.
  3. POST /session/save -- writes the conversation log to a local JSON file.

The spec of record is SEED.md, especially the five invariants in section 2.
The design rule enforced throughout this file: the model is an interpreter,
not an author, and it is always allowed to say it does not know.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

import anthropic
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Load ANTHROPIC_API_KEY from .env into the environment before anything else.
load_dotenv()

APP_DIR = Path(__file__).parent
SESSIONS_DIR = APP_DIR / "sessions"

# Model settings, fixed by SEED.md section 4. Temperature is low so the
# interpreter stays anchored to the words it was given, but not zero, so it
# can still offer genuinely different readings of an ambiguous fragment.
MODEL = "claude-sonnet-4-6"
TEMPERATURE = 0.3
MAX_TOKENS = 1000

app = FastAPI(title="GetThrough")


# ---------------------------------------------------------------------------
# The Interpreter's Rite -- the heart of the product
# ---------------------------------------------------------------------------
# This prompt is written in the register of the COMPANION protocol
# (github.com/jethomasphd/THE_COMPANION_DOSSIER), GetThrough's sibling work:
# covenant, vessel, matter, prism. But where COMPANION summons minds across
# the boundary of time, the person served here is on THIS side of it --
# present, alive, and holding the final word. So the vessel summoned is
# never the person. It is the Interpreter only. Every law the seed calls an
# invariant appears below as an instruction the model can actually follow.

SYSTEM_PROMPT = """\
THE INTERPRETER'S RITE

You are the vessel inside GetThrough, a live communication aid. Read what
follows as covenant, not configuration.

A person with aphasia or dementia is present -- in the room, alive, speaking
for themself right now. Illness has broken the bridge between their meaning
and their words: what they intend arrives as fragments, repetitions, partial
garble. You are summoned as THE INTERPRETER -- never their voice, never
their author. The one you serve is not across the boundary of time; they are
on this side of it, and they hold the final word.

Your working: propose what this person may be TRYING to say, right now, as
up to 3 candidate readings. The candidates appear on screen as choices, and
the person (with their companion's help) taps the one that matches -- or
rejects them all, which costs them nothing. Nothing you write becomes their
meaning until they make it so.

WHAT YOU RECEIVE
- VERBATIM FRAGMENT: exactly what they just said, untouched. This is the
  true signal. Honor it.
- RECENT CONVERSATION: up to the last 6 turns, for situational context.
- CONTEXT FILE: the matter -- short notes the patient and family keep:
  people, common needs, places, favorite phrases, and family notes that
  decode private vocabulary (for example: "She says 'the cold thing' for the
  refrigerator."). This file is the prism. It does not tell you what they
  currently want; it selects WHICH knowledge dominates your reading --
  this one person's own words and world, not the culture's composite
  patient. It tells you what words mean to them, nothing more.

THE LAWS
1. EVIDENCE ONLY. Every candidate must be traceable to actual words in the
   fragment, or to a clear tie between the fragment and the recent
   conversation, decoded through the prism where it applies. Never introduce
   names, biography, preferences, memories, or feelings that are not in the
   evidence. An eloquent invention is not a translation; it replaces a
   present person's voice, which is the one harm this vessel must never
   cause.
2. SPEAK AS THEY WOULD, BRIEFLY. Each candidate is first person ("I ..."),
   present intent, under 20 words, in plain warm language -- something they
   might be trying to say right now. Not a summary about them, not a story,
   not a polished speech.
3. MEANINGFULLY DIFFERENT, AND AIM FOR THREE. When the fragment offers
   several content words or possible referents, give 3 genuinely different
   readings -- different needs, actions, or referents -- never three
   rewordings of one guess. Return fewer than 3 only when the evidence
   honestly cannot support three distinct readings.
4. UNCLEAR IS A CORRECT ANSWER. If the fragment carries no usable content --
   only fillers, articles, repeated syllables, or sounds with no tie to the
   conversation -- return unclear with a kind one-sentence reason. An honest
   "I cannot tell" invites the person to try again; a confident guess built
   on nothing speaks over them. Never stretch thin evidence into three
   confident-sounding candidates.
5. HONEST CONFIDENCE. "high": fragment plus context point clearly at this
   reading. "medium": a plausible reading with real support. "low": grounded
   but uncertain. If nothing would rise above "low", lean toward unclear.

THE FORBIDDEN -- what breaks the working
- Flattening: returning the composite -- what "a patient" might want --
  instead of what THIS person's words, refracted through their prism,
  actually support.
- Ventriloquism: emotional declarations, memories, or eloquence the fragment
  never carried. The mask is always likable. You are not here to be a mask.
- Padding: stretching thin evidence into confident-sounding guesses to seem
  more helpful. Helpfulness that invents is not help.

HOW TO DECIDE
1. List the content words: words for things, actions, people, places,
   qualities -- plus any clear echo of the recent conversation.
2. If there are none, return unclear. Do not guess from fillers alone.
3. Otherwise, translate the content words through the prism (private
   vocabulary first) and form up to 3 distinct readings, strongest first.

OUTPUT
Reply with ONE JSON object and nothing else -- no prose, no markdown fences.
Either:
{"unclear": false, "candidates": [{"text": "...", "confidence": "high"}, ...]}
with 1 to 3 candidates and confidence one of "high", "medium", "low" -- or:
{"unclear": true, "candidates": [], "reason": "one plain, kind sentence"}

EXAMPLES
Fragment: "mm... it... it... the... the..." with no helpful context
-> {"unclear": true, "candidates": [], "reason": "I only heard small \
connecting words, so I can't offer a meaning yet."}

Fragment: "want the... the cold thing... door thing... juice no..." with the
family note "She says 'the cold thing' for the refrigerator."
-> {"unclear": false, "candidates": [{"text": "I want something cold from \
the fridge, but not juice.", "confidence": "high"}, {"text": "I want you to \
open the fridge door.", "confidence": "medium"}, {"text": "I want a cold \
drink, not juice.", "confidence": "medium"}]}

THE SEAL
The person is present. The words are theirs. You only hold the lantern.
"""


# ---------------------------------------------------------------------------
# /interpret -- request shapes
# ---------------------------------------------------------------------------

class RecentTurn(BaseModel):
    """One prior conversation turn, sent along for context."""
    speaker: str
    text: str


class InterpretRequest(BaseModel):
    """What the browser sends when the patient finishes speaking."""
    fragment: str                          # verbatim transcript, untouched
    recent_turns: list[RecentTurn] = []    # up to the last 6 confirmed turns
    context: dict = {}                     # the parsed context.json


# The Anthropic client is created on first use so the server can still boot
# (and the UI can be explored) before an API key exists.
_client: anthropic.Anthropic | None = None


def get_client() -> anthropic.Anthropic:
    """Return a shared Anthropic client, created on first use.

    Reads ANTHROPIC_API_KEY from the environment (loaded from .env above).
    Raising here is fine: call_model() catches it and answers "unclear"
    honestly instead of crashing or bluffing.
    """
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def build_user_message(fragment: str, recent_turns: list[RecentTurn], context: dict) -> str:
    """Lay out the three evidence sources as plainly labeled text.

    Plain labels beat clever nesting: anyone auditing a request can read
    exactly what the model was given, and the model can't confuse the
    fragment with the context that merely surrounds it.
    """
    parts = [f'VERBATIM FRAGMENT (what the person just said):\n"{fragment}"']

    if recent_turns:
        turns = "\n".join(f'{turn.speaker}: "{turn.text}"' for turn in recent_turns)
        parts.append(f"RECENT CONVERSATION (oldest first):\n{turns}")
    else:
        parts.append("RECENT CONVERSATION: (none yet)")

    # Send only the context fields the family actually filled in.
    filled = {key: value for key, value in context.items() if value}
    if filled:
        parts.append(
            "CONTEXT FILE (kept by the patient and family):\n"
            + json.dumps(filled, indent=2, ensure_ascii=False)
        )
    else:
        parts.append("CONTEXT FILE: (empty)")

    return "\n\n".join(parts)


def unclear_response(reason: str) -> dict:
    """The honest fallback shape: no candidates, a plain-language reason."""
    return {"unclear": True, "candidates": [], "reason": reason}


def parse_model_json(raw: str) -> dict | None:
    """Pull one JSON object out of the model's reply, or give up cleanly.

    The prompt demands bare JSON, but a defensive parse costs nothing:
    take everything between the first '{' and the last '}' (which also
    strips any stray markdown fences) and try to load it.
    """
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


VALID_CONFIDENCE = {"high", "medium", "low"}


def sanitize_result(result: dict | None) -> dict:
    """Force whatever came back into the exact /interpret contract.

    Anything malformed collapses to "unclear" -- the one failure mode this
    tool is allowed, because it hands the moment back to the person instead
    of inventing words for them.
    """
    if not isinstance(result, dict):
        return unclear_response("I had trouble reading the interpretation. Please try again.")

    if result.get("unclear") is True:
        reason = str(result.get("reason") or "There wasn't enough there for me to work with.")
        return {"unclear": True, "candidates": [], "reason": reason}

    candidates: list[dict] = []
    for item in result.get("candidates") or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        confidence = str(item.get("confidence") or "").strip().lower()
        if confidence not in VALID_CONFIDENCE:
            confidence = "low"  # unknown confidence is reported, never upgraded
        candidates.append({"text": text, "confidence": confidence})
        if len(candidates) == 3:
            break

    if not candidates:
        return unclear_response("I couldn't form a reading of that. Want to try again?")

    return {"unclear": False, "candidates": candidates}


def call_model(fragment: str, recent_turns: list[RecentTurn], context: dict) -> dict:
    """Ask the model for candidate interpretations of one verbatim fragment.

    Every failure path -- missing key, network trouble, malformed reply --
    returns an honest "unclear" instead of an exception or a fabricated
    guess. The UI then invites the person to try again.
    """
    user_message = build_user_message(fragment, recent_turns, context)
    print(f"[interpret] fragment: {fragment!r}")

    try:
        response = get_client().messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            temperature=TEMPERATURE,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
    except anthropic.APIStatusError as err:
        print(f"[interpret] API error {err.status_code}: {err.message}")
        return unclear_response("I couldn't reach the interpreter just now. Please try again.")
    except Exception as err:  # missing key, network down, etc.
        print(f"[interpret] call failed: {err}")
        return unclear_response("I couldn't reach the interpreter just now. Please try again.")

    raw = "".join(block.text for block in response.content if block.type == "text")
    result = sanitize_result(parse_model_json(raw))

    if result["unclear"]:
        print(f"[interpret] -> unclear: {result['reason']}")
    else:
        print(f"[interpret] -> {len(result['candidates'])} candidate(s)")
    return result


@app.post("/interpret")
def interpret(req: InterpretRequest) -> dict:
    """Return up to 3 candidate interpretations of a verbatim fragment.

    Response shape (see SEED.md section 5):
      {"unclear": false, "candidates": [{"text": ..., "confidence": ...}, ...]}
      {"unclear": true,  "candidates": [], "reason": "..."}
    """
    return call_model(req.fragment, req.recent_turns, req.context)


# ---------------------------------------------------------------------------
# /context -- the patient-owned context file (SEED.md section 6)
# ---------------------------------------------------------------------------
# This small, flat, human-readable file is the ONLY personalization
# mechanism. It rides along in full on every /interpret call and lives
# nowhere else -- no fine-tuning, no hidden memory. Deleting an entry here
# removes it from all future inference immediately.

CONTEXT_PATH = APP_DIR / "context.json"

EMPTY_CONTEXT = {
    "name": "",
    "people": [],
    "common_needs": [],
    "favorite_words_phrases": [],
    "places": [],
    "notes_from_family": "",
}


@app.get("/context")
def get_context() -> dict:
    """Return the current context file (empty template if none exists)."""
    if not CONTEXT_PATH.exists():
        return dict(EMPTY_CONTEXT)
    try:
        return json.loads(CONTEXT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print("[context] context.json is not valid JSON; serving empty template")
        return dict(EMPTY_CONTEXT)


@app.post("/context")
def save_context(context: dict) -> dict:
    """Write the edited context back to disk, keeping it flat and readable."""
    # Keep only the known fields so the file stays the small, auditable
    # document the family expects to be able to read and edit by hand.
    cleaned = {key: context.get(key, EMPTY_CONTEXT[key]) for key in EMPTY_CONTEXT}
    CONTEXT_PATH.write_text(
        json.dumps(cleaned, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print("[context] saved context.json")
    return {"saved": True}


# ---------------------------------------------------------------------------
# /session/save -- the append-only conversation log (SEED.md section 8)
# ---------------------------------------------------------------------------

VALID_PROVENANCE = {"patient-verbatim", "patient-confirmed-interpretation", "companion"}


class SessionSaveRequest(BaseModel):
    """The whole session as the browser holds it: start time plus turns."""
    started: str
    turns: list[dict]


@app.post("/session/save")
def save_session(req: SessionSaveRequest) -> dict:
    """Validate provenance on every turn, then write one JSON file locally.

    Validation here enforces invariants 4 (every turn is tagged) and the
    audit trail (confirmed interpretations always carry their source
    fragment) in code, not just in front-end habit.
    """
    for i, turn in enumerate(req.turns):
        provenance = turn.get("provenance")
        if provenance not in VALID_PROVENANCE:
            raise HTTPException(400, f"turn {i} has invalid provenance: {provenance!r}")
        if provenance == "patient-confirmed-interpretation" and not turn.get("source_fragment"):
            raise HTTPException(400, f"turn {i} is a confirmed interpretation without its source_fragment")

    SESSIONS_DIR.mkdir(exist_ok=True)
    filename = f"session-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    path = SESSIONS_DIR / filename
    path.write_text(
        json.dumps({"started": req.started, "turns": req.turns},
                   indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"[session] saved {len(req.turns)} turns to {path}")
    return {"saved": filename}


# ---------------------------------------------------------------------------
# Static site -- mounted last so the API routes above take precedence
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory=APP_DIR / "static", html=True), name="static")


if __name__ == "__main__":
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("WARNING: ANTHROPIC_API_KEY is not set. Copy .env.example to .env "
              "and add your key; until then /interpret will answer 'unclear'.")
    print("GetThrough starting -- open http://localhost:8000 in Chrome")
    uvicorn.run(app, host="127.0.0.1", port=8000)
