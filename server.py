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
from datetime import datetime
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Load ANTHROPIC_API_KEY from .env into the environment before anything else.
load_dotenv()

APP_DIR = Path(__file__).parent
SESSIONS_DIR = APP_DIR / "sessions"

app = FastAPI(title="GetThrough")


# ---------------------------------------------------------------------------
# /interpret -- the heart of the product
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


def call_model(fragment: str, recent_turns: list[RecentTurn], context: dict) -> dict:
    """Ask the model for candidate interpretations.

    STUB (build step 1): returns a canned response so the whole
    browser -> server -> cards -> confirm loop can be exercised before any
    API key exists. Replaced with the real Anthropic call in build step 3.
    """
    print(f"[interpret] (stub) fragment: {fragment!r}")
    return {
        "unclear": False,
        "candidates": [
            {"text": "I want something cold from the fridge, but not juice.", "confidence": "high"},
            {"text": "I want you to open the fridge door.", "confidence": "medium"},
            {"text": "I want a cold drink of water.", "confidence": "medium"},
        ],
    }


@app.post("/interpret")
def interpret(req: InterpretRequest) -> dict:
    """Return up to 3 candidate interpretations of a verbatim fragment.

    Response shape (see SEED.md section 5):
      {"unclear": false, "candidates": [{"text": ..., "confidence": ...}, ...]}
      {"unclear": true,  "candidates": [], "reason": "..."}
    """
    return call_model(req.fragment, req.recent_turns, req.context)


# ---------------------------------------------------------------------------
# Static site -- mounted last so the API routes above take precedence
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory=APP_DIR / "static", html=True), name="static")


if __name__ == "__main__":
    print("GetThrough starting -- open http://localhost:8000 in Chrome")
    uvicorn.run(app, host="127.0.0.1", port=8000)
