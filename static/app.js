/* GetThrough front-end.
 *
 * The five invariants (SEED.md section 2) live here as much as in the server:
 *   1. the verbatim transcript is always visible -- it is logged the moment
 *      the mic stops, and it sits above the cards that interpret it;
 *   2. nothing is spoken or logged as the patient's meaning until they tap
 *      it -- speak() is called from exactly two places: a confirmation tap
 *      and the "Say it again" button on an already-confirmed turn;
 *   3. "None of these" is always the last card, same size as the others;
 *   4. every log entry carries one of exactly three provenance chips;
 *   5. when the model can't tell, we show that honestly and invite another
 *      try -- no forced guesses.
 */

"use strict";

const $ = (id) => document.getElementById(id);

const PROVENANCE = {
  verbatim: "patient-verbatim",
  confirmed: "patient-confirmed-interpretation",
  companion: "companion",
};

/* ------------------------------------------------------------------ state */

const state = {
  mode: "patient",       // "patient" | "companion" -- who the mic belongs to
  listening: false,      // is the mic currently capturing?
  heardFinal: "",        // finalized transcript pieces accumulated this press
  log: [],               // the session log: turns with provenance (SEED.md s8)
  started: new Date().toISOString(),  // when this session began
  pending: null,         // { fragment, candidates } awaiting confirm/reject
  context: {},           // parsed context.json, fetched from the server
  voiceRate: 1.0,        // TTS rate, set by the settings slider (0.7-1.2)
};

/* ----------------------------------------------- speech capture (the mic) */

// Web Speech API -- free, live, keyless; ships in Chrome.
const SpeechRecognitionImpl =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;

function setupRecognition() {
  if (!SpeechRecognitionImpl) {
    $("mic-status").textContent =
      "This browser has no speech recognition. Please use Chrome.";
    $("mic-btn").disabled = true;
    return;
  }

  recognition = new SpeechRecognitionImpl();
  recognition.continuous = true;      // keep listening until tapped again
  recognition.interimResults = true;  // stream words as they are recognized
  recognition.lang = "en-US";

  // Render every partial result immediately: the person sees their own
  // words appear as they speak, verbatim, before anything interprets them.
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        state.heardFinal += piece;
      } else {
        interim += piece;
      }
    }
    renderTranscript(state.heardFinal, interim);
  };

  recognition.onerror = (event) => {
    if (event.error === "no-speech") return; // harmless; onend handles it
    console.warn("speech recognition error:", event.error);
    $("mic-status").textContent =
      event.error === "not-allowed"
        ? "Microphone access was blocked. Allow the mic and try again."
        : "The microphone hit a snag. Tap and try again.";
    stopListeningUI();
  };

  // Fires both when we call .stop() and when Chrome times out on silence.
  // Either way: finalize whatever was heard.
  recognition.onend = () => {
    if (!state.listening) return;
    stopListeningUI();
    finalizeUtterance();
  };
}

function startListening() {
  // Starting over withdraws any cards still on screen -- the person chose
  // to try again, which is always allowed and never logged against them.
  clearResponseArea();
  state.heardFinal = "";
  renderTranscript("", "");
  state.listening = true;
  $("mic-btn").classList.add("listening");
  $("mic-btn").setAttribute("aria-label", "Stop listening");
  $("mic-label").textContent = "Listening… tap to stop";
  $("mic-status").textContent =
    state.mode === "patient"
      ? "Listening to the patient."
      : "Listening to the companion.";
  recognition.start();
}

function stopListeningUI() {
  state.listening = false;
  $("mic-btn").classList.remove("listening");
  $("mic-btn").setAttribute("aria-label", "Start listening");
  $("mic-label").textContent = "Tap to talk";
}

/* Called once per press, after the mic stops, with the verbatim result. */
function finalizeUtterance() {
  const text = state.heardFinal.trim();
  if (!text) {
    $("mic-status").textContent = "I didn’t catch anything. Tap and try again.";
    return;
  }
  $("mic-status").textContent = "";
  if (state.mode === "patient") {
    handlePatientFragment(text);
  } else {
    handleCompanionTurn(text);
  }
}

function renderTranscript(finalText, interimText) {
  const box = $("transcript");
  box.innerHTML = "";
  if (!finalText && !interimText) {
    const hint = document.createElement("span");
    hint.className = "transcript-hint";
    hint.textContent = state.listening
      ? "Listening…"
      : "Tap the microphone, speak, then tap again.";
    box.appendChild(hint);
    return;
  }
  box.appendChild(document.createTextNode(finalText));
  if (interimText) {
    const interim = document.createElement("span");
    interim.className = "interim";
    interim.textContent = interimText;
    box.appendChild(interim);
  }
}

/* ------------------------------------------------- the interpretation flow */

async function handlePatientFragment(fragment) {
  // Invariant 1: the raw fragment enters the log first, before any
  // interpretation exists, and is never cleaned up or replaced.
  addTurn({ speaker: "patient", provenance: PROVENANCE.verbatim, text: fragment });

  state.pending = { fragment, candidates: [] };
  $("response-area").classList.remove("hidden");
  $("fragment-echo-text").textContent = `“${fragment}”`;
  $("cards").innerHTML = "";
  $("unclear-panel").classList.add("hidden");
  $("thinking").classList.remove("hidden");

  let result;
  try {
    const resp = await fetch("/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fragment,
        recent_turns: recentTurns(),
        context: state.context,
      }),
    });
    result = await resp.json();
  } catch (err) {
    console.warn("interpret failed:", err);
    result = {
      unclear: true,
      candidates: [],
      reason: "I couldn't reach the interpreter just now. Please try again.",
    };
  }

  $("thinking").classList.add("hidden");

  // Ignore stale replies if the person already started a new recording.
  if (!state.pending || state.pending.fragment !== fragment) return;

  if (result.unclear) {
    showUnclear(result.reason || "");
  } else {
    state.pending.candidates = result.candidates;
    renderCards(result.candidates);
  }
}

function handleCompanionTurn(text) {
  // Companion speech skips interpretation entirely -- it is context, spoken
  // by someone who can already speak for themself.
  addTurn({ speaker: "companion", provenance: PROVENANCE.companion, text });
  $("mic-status").textContent = "Added to the log.";
}

/* The last 6 turns, as context for the next interpretation. A verbatim
 * fragment is skipped when the very next turn is its confirmed meaning,
 * so the model sees each utterance once, in its clearest form. */
function recentTurns() {
  const turns = [];
  for (let i = 0; i < state.log.length; i++) {
    const turn = state.log[i];
    const next = state.log[i + 1];
    if (
      turn.provenance === PROVENANCE.verbatim &&
      next &&
      next.provenance === PROVENANCE.confirmed &&
      next.source_fragment === turn.text
    ) {
      continue;
    }
    turns.push({ speaker: turn.speaker, text: turn.text });
  }
  return turns.slice(-6);
}

/* --------------------------------------------------------- candidate cards */

function renderCards(candidates) {
  const box = $("cards");
  box.innerHTML = "";
  candidates.forEach((candidate, i) => {
    box.appendChild(
      buildCard({
        number: String(i + 1),
        text: candidate.text,
        confidence: candidate.confidence,
        onTap: () => confirmMeaning(candidate.text),
      })
    );
  });
  // Invariant 3: rejecting is always offered, same size and prominence.
  box.appendChild(
    buildCard({
      number: "✕",
      text: "None of these — let me try again.",
      none: true,
      onTap: rejectAll,
    })
  );
}

function buildCard({ number, text, confidence, none, onTap }) {
  const card = document.createElement("button");
  card.className = none ? "card none" : "card";
  card.type = "button";
  card.setAttribute(
    "aria-label",
    none ? "None of these, let me try again" : `Choice ${number}: ${text}`
  );

  const badge = document.createElement("span");
  badge.className = "card-number";
  badge.textContent = number;
  card.appendChild(badge);

  const body = document.createElement("span");
  body.className = "card-text";
  body.textContent = text;
  card.appendChild(body);

  // Confidence is information, not decoration -- it is always shown.
  if (confidence) {
    const tag = document.createElement("span");
    tag.className = "card-confidence";
    tag.textContent = confidence;
    card.appendChild(tag);
  }

  card.addEventListener("click", onTap);
  return card;
}

/* Confirmation: the single moment interpretation becomes the patient's
 * meaning -- because the patient made it so with a deliberate tap. */
function confirmMeaning(chosenText) {
  const pending = state.pending;
  if (!pending) return;

  const rejected = pending.candidates
    .map((c) => c.text)
    .filter((t) => t !== chosenText);

  // Invariant 2: TTS happens here, after the tap, and nowhere earlier.
  speak(chosenText);

  addTurn({
    speaker: "patient",
    provenance: PROVENANCE.confirmed,
    text: chosenText,
    source_fragment: pending.fragment,   // the audit trail: what was said,
    rejected_candidates: rejected,       // what was offered, what was chosen
  });

  clearResponseArea();
  $("mic-status").textContent = "Spoken aloud and added to the log.";
}

function rejectAll() {
  // No interpretation is logged. The verbatim fragment already stands in
  // the log on its own -- rejecting costs the person nothing.
  const pending = state.pending;
  showUnclear("");
  $("unclear-panel").querySelector(".unclear-title").textContent =
    "Okay — none of those.";
  if (pending) state.pending = { fragment: pending.fragment, candidates: [] };
}

function showUnclear(reason) {
  $("cards").innerHTML = "";
  const panel = $("unclear-panel");
  panel.querySelector(".unclear-title").textContent = "I couldn’t tell what you meant.";
  $("unclear-reason").textContent = reason || "";
  panel.classList.remove("hidden");
}

function clearResponseArea() {
  state.pending = null;
  $("response-area").classList.add("hidden");
  $("cards").innerHTML = "";
  $("unclear-panel").classList.add("hidden");
  $("thinking").classList.add("hidden");
  $("type-input").value = "";
}

/* Typing path: the typed text becomes one more card. It still takes the
 * confirming tap -- typing never skips confirmation (invariant 2). */
function offerTypedCandidate() {
  const text = $("type-input").value.trim();
  if (!text || !state.pending) return;
  $("unclear-panel").classList.add("hidden");
  const box = $("cards");
  box.innerHTML = "";
  box.appendChild(
    buildCard({
      number: "✎",
      text,
      onTap: () => confirmMeaning(text),
    })
  );
  box.appendChild(
    buildCard({
      number: "✕",
      text: "Not this — let me try again.",
      none: true,
      onTap: rejectAll,
    })
  );
}

/* ------------------------------------------------------- text-to-speech */

/* speak() is invoked from confirmMeaning() and the "Say it again" button
 * only. If you are adding a third call site, stop: it almost certainly
 * violates invariant 2. */
function speak(text) {
  window.speechSynthesis.cancel(); // never overlap two utterances
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = state.voiceRate;
  window.speechSynthesis.speak(utterance);
}

/* -------------------------------------------------- the conversation log */

function addTurn(turn) {
  state.log.push({ t: new Date().toISOString(), ...turn });
  renderLog();
}

function renderLog() {
  const list = $("log");
  list.innerHTML = "";
  $("log-empty").classList.toggle("hidden", state.log.length > 0);

  for (const turn of state.log) {
    const item = document.createElement("li");
    item.className = "log-entry";

    const top = document.createElement("div");
    top.className = "log-entry-top";

    const chip = document.createElement("span");
    chip.className = "chip " + chipClass(turn.provenance);
    chip.textContent = turn.provenance;
    top.appendChild(chip);

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = new Date(turn.t).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    top.appendChild(time);

    // Confirmed meanings can be spoken again at any time.
    if (turn.provenance === PROVENANCE.confirmed) {
      const again = document.createElement("button");
      again.className = "say-again";
      again.type = "button";
      again.textContent = "Say it again";
      again.addEventListener("click", () => speak(turn.text));
      top.appendChild(again);
    }

    item.appendChild(top);

    const text = document.createElement("div");
    text.className = "log-text";
    text.textContent = turn.text;
    item.appendChild(text);

    // The confirmed turn also shows the raw fragment it came from --
    // the verbatim is never hidden behind its interpretation.
    if (turn.source_fragment) {
      const source = document.createElement("div");
      source.className = "log-source";
      source.textContent = `from: “${turn.source_fragment}”`;
      item.appendChild(source);
    }

    list.appendChild(item);
  }

  list.lastElementChild?.scrollIntoView({ block: "nearest" });
}

function chipClass(provenance) {
  if (provenance === PROVENANCE.confirmed) return "chip-confirmed";
  if (provenance === PROVENANCE.companion) return "chip-companion";
  return "chip-verbatim";
}

/* --------------------------------------------------------- mode toggle */

function setMode(mode) {
  state.mode = mode;
  const patientOn = mode === "patient";
  $("mode-patient").classList.toggle("active", patientOn);
  $("mode-companion").classList.toggle("active", !patientOn);
  $("mode-patient").setAttribute("aria-pressed", String(patientOn));
  $("mode-companion").setAttribute("aria-pressed", String(!patientOn));
  $("mic-status").textContent = patientOn
    ? "Mic is set to the patient. Their words will be interpreted."
    : "Mic is set to the companion. Their words go straight to the log.";
}

/* ----------------------------------------------------- settings drawer */

function openDrawer() {
  $("drawer").classList.remove("hidden");
  $("drawer-overlay").classList.remove("hidden");
}

function closeDrawer() {
  $("drawer").classList.add("hidden");
  $("drawer-overlay").classList.add("hidden");
}

/* ------------------------------- patient-owned context (SEED.md s6) ----
 * The context file is the ONLY personalization there is. It is fetched
 * here, shown in plain editable fields, sent in full with every
 * /interpret call, and clearable in two taps. Nothing else remembers. */

const toLines = (items) => (items || []).join("\n");
const fromLines = (text) =>
  text.split("\n").map((line) => line.trim()).filter(Boolean);

async function loadContext() {
  try {
    const resp = await fetch("/context");
    if (resp.ok) state.context = await resp.json();
  } catch {
    state.context = {};
  }
  fillContextForm();
}

function fillContextForm() {
  const ctx = state.context || {};
  $("ctx-name").value = ctx.name || "";
  $("ctx-people").value = toLines(ctx.people);
  $("ctx-needs").value = toLines(ctx.common_needs);
  $("ctx-words").value = toLines(ctx.favorite_words_phrases);
  $("ctx-places").value = toLines(ctx.places);
  $("ctx-notes").value = ctx.notes_from_family || "";
}

function readContextForm() {
  return {
    name: $("ctx-name").value.trim(),
    people: fromLines($("ctx-people").value),
    common_needs: fromLines($("ctx-needs").value),
    favorite_words_phrases: fromLines($("ctx-words").value),
    places: fromLines($("ctx-places").value),
    notes_from_family: $("ctx-notes").value.trim(),
  };
}

async function saveContextForm() {
  const context = readContextForm();
  try {
    const resp = await fetch("/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.context = context; // takes effect on the very next /interpret
    $("ctx-status").textContent = "Saved. These notes ride along from the next interpretation on.";
  } catch (err) {
    console.warn("context save failed:", err);
    $("ctx-status").textContent = "Couldn't save. Is the server running?";
  }
}

/* Two taps to clear everything: open settings, tap "Clear all". Deleted
 * notes are gone from all future inference immediately. */
async function clearContext() {
  state.context = {
    name: "", people: [], common_needs: [],
    favorite_words_phrases: [], places: [], notes_from_family: "",
  };
  fillContextForm();
  try {
    await fetch("/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.context),
    });
    $("ctx-status").textContent = "Cleared. Nothing personal remains in future interpretations.";
  } catch {
    $("ctx-status").textContent = "Cleared here, but the server couldn't be reached.";
  }
}

/* ------------------------------------------------ session save / reset */

async function saveSession() {
  if (!state.log.length) {
    $("session-status").textContent = "Nothing to save yet.";
    return;
  }
  try {
    const resp = await fetch("/session/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ started: state.started, turns: state.log }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(data));
    $("session-status").textContent = `Saved as sessions/${data.saved}`;
  } catch (err) {
    console.warn("session save failed:", err);
    $("session-status").textContent = "Couldn't save. Is the server running?";
  }
}

function newSession() {
  if (
    state.log.length &&
    !window.confirm("Start a new session? Unsaved turns will be gone.")
  ) {
    return;
  }
  state.log = [];
  state.started = new Date().toISOString();
  renderLog();
  clearResponseArea();
  renderTranscript("", "");
  $("session-status").textContent = "New session started.";
  $("mic-status").textContent = "";
}

/* ------------------------------------------------------------- wiring */

function init() {
  setupRecognition();
  loadContext();

  $("mic-btn").addEventListener("click", () => {
    if (!recognition) return;
    if (state.listening) {
      recognition.stop(); // onend fires and finalizes
    } else {
      startListening();
    }
  });

  $("mode-patient").addEventListener("click", () => setMode("patient"));
  $("mode-companion").addEventListener("click", () => setMode("companion"));

  $("type-add").addEventListener("click", offerTypedCandidate);
  $("type-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") offerTypedCandidate();
  });

  $("settings-btn").addEventListener("click", openDrawer);
  $("drawer-close").addEventListener("click", closeDrawer);
  $("drawer-overlay").addEventListener("click", closeDrawer);

  $("ctx-save").addEventListener("click", saveContextForm);
  $("ctx-clear").addEventListener("click", clearContext);
  $("session-save").addEventListener("click", saveSession);
  $("session-new").addEventListener("click", newSession);

  // Voice rate (0.7-1.2), remembered across visits on this device.
  const savedRate = parseFloat(localStorage.getItem("getthrough-rate") || "1.0");
  state.voiceRate = Math.min(1.2, Math.max(0.7, savedRate));
  $("voice-rate").value = String(state.voiceRate);
  $("voice-rate-value").textContent = state.voiceRate.toFixed(2);
  $("voice-rate").addEventListener("input", (event) => {
    state.voiceRate = parseFloat(event.target.value);
    $("voice-rate-value").textContent = state.voiceRate.toFixed(2);
    localStorage.setItem("getthrough-rate", String(state.voiceRate));
  });

  // Larger-text mode, also remembered.
  const applyTextSize = (on) => {
    document.documentElement.classList.toggle("large-text", on);
    $("text-size").textContent = on ? "Larger text: on" : "Larger text: off";
    $("text-size").setAttribute("aria-pressed", String(on));
    localStorage.setItem("getthrough-large-text", on ? "1" : "0");
  };
  applyTextSize(localStorage.getItem("getthrough-large-text") === "1");
  $("text-size").addEventListener("click", () =>
    applyTextSize(!document.documentElement.classList.contains("large-text"))
  );
}

init();
