/* THE LANTERN -- front-end.
 *
 * The chamber's five laws (born as the GetThrough invariants, SEED.md s2)
 * live here as much as in the server:
 *   1. the verbatim words are always visible -- recorded the moment the
 *      lantern stops listening, shown above the readings that interpret
 *      them, never cleaned up, never replaced;
 *   2. nothing is spoken or recorded as the person's meaning until THEY
 *      choose it -- speak() fires only inside the same gesture as the
 *      person's own tap: confirming a reading, choosing a quick word, or
 *      replaying words already confirmed;
 *   3. "None of these" is always offered, same size as the readings;
 *   4. every entry in the record carries one of exactly four provenance
 *      chips -- verbatim, confirmed-reading, chosen, keeper;
 *   5. when the reader can't tell, the lantern says so and waits -- no
 *      forced guesses, ever.
 */

"use strict";

const $ = (id) => document.getElementById(id);

const PROVENANCE = {
  verbatim: "verbatim",             // the person's exact words, untouched
  confirmed: "confirmed-reading",   // a reading the person confirmed by tap
  chosen: "chosen",                 // words the person picked by hand
  keeper: "keeper",                 // the companion, speaking for themself
};

/* ------------------------------------------------------- the two flames --
 * THE HEARTH: served from localhost by server.py, which holds the key in
 *   .env -- readings go to /reading, the prism to /prism, records to
 *   /record/save.
 * THE WORKER: served as static files (Cloudflare Pages), readings go from
 *   this browser through the shared COMPANION worker (key server-side
 *   there); the prism lives in this browser only; records download.
 * Same chamber, same rite, same laws either way. */

const CONFIG = window.LANTERN_CONFIG || {};

function usingWorker() {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return Boolean(CONFIG.proxyUrl) && (CONFIG.forceWorker === true || !local);
}

/* The prism the chamber starts with before a family makes it their own. */
const STARTER_PRISM = {
  name: "",
  people: [],
  common_needs: ["water", "bathroom", "blanket", "go outside"],
  favorite_words_phrases: [],
  places: ["kitchen", "porch"],
  notes_from_family: "",
};

/* --- worker-flame ports of the hearth's reading pipeline (server.py) ---
 * Kept behaviorally identical: same labels, same defensive parse, same
 * collapse-to-unclear. If you change one side, change the other. */

function buildUserMessage(fragment, recentTurns, prism) {
  const parts = [`VERBATIM FRAGMENT (what the person just said):\n"${fragment}"`];

  if (recentTurns.length) {
    const turns = recentTurns.map((t) => `${t.speaker}: "${t.text}"`).join("\n");
    parts.push(`RECENT CONVERSATION (oldest first):\n${turns}`);
  } else {
    parts.push("RECENT CONVERSATION: (none yet)");
  }

  // Send only the prism fields the family actually filled in.
  const filled = {};
  for (const [key, value] of Object.entries(prism || {})) {
    if (value && (!Array.isArray(value) || value.length)) filled[key] = value;
  }
  if (Object.keys(filled).length) {
    parts.push(
      "THE PRISM (kept by the person and their family):\n" +
      JSON.stringify(filled, null, 2)
    );
  } else {
    parts.push("THE PRISM: (empty)");
  }

  return parts.join("\n\n");
}

function parseModelJson(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

function sanitizeResult(result) {
  const unclear = (reason) => ({ unclear: true, candidates: [], reason });

  if (!result || typeof result !== "object") {
    return unclear("I had trouble reading that. Please try again.");
  }
  if (result.unclear === true) {
    return {
      unclear: true,
      candidates: [],
      reason: String(result.reason || "There wasn't enough there for me to work with."),
    };
  }
  const candidates = [];
  for (const item of result.candidates || []) {
    if (!item || typeof item !== "object") continue;
    const text = String(item.text || "").trim();
    if (!text) continue;
    let confidence = String(item.confidence || "").trim().toLowerCase();
    if (!VALID_CONFIDENCE.has(confidence)) confidence = "low"; // reported, never upgraded
    candidates.push({ text, confidence });
    if (candidates.length === 3) break;
  }
  if (!candidates.length) {
    return unclear("I couldn't form a reading of that. Want to try again?");
  }
  return { unclear: false, candidates };
}

/* One reading request, whichever flame is lit. Every failure path returns
 * an honest "unclear" -- the chamber never crashes and never bluffs. */
let lastReadingAt = 0;

async function requestReading(fragment) {
  if (!usingWorker()) {
    // THE HEARTH: the local server builds the message and holds the key.
    const resp = await fetch("/reading", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fragment,
        recent_turns: recentTurns(),
        context: state.prism,
      }),
    });
    return await resp.json();
  }

  // THE WORKER: this browser speaks to the shared COMPANION proxy
  // directly, with the same rite and the same message shape.
  const wait = (CONFIG.cooldownSeconds || 0) * 1000 - (Date.now() - lastReadingAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReadingAt = Date.now();

  const resp = await fetch(`${CONFIG.proxyUrl.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CONFIG.model || "claude-sonnet-4-6",
      max_tokens: CONFIG.maxTokens || 1000,
      temperature: CONFIG.temperature ?? 0.3,
      system: window.LANTERN_RITE,
      messages: [
        { role: "user", content: buildUserMessage(fragment, recentTurns(), state.prism) },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`worker HTTP ${resp.status}`);
  const message = await resp.json();
  const raw = (message.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return sanitizeResult(parseModelJson(raw));
}

/* ------------------------------------------------------------------ state */

const state = {
  mode: "voice",         // "voice" (the person) | "keeper" (the companion)
  listening: false,      // is the lantern currently lit and listening?
  heardFinal: "",        // finalized transcript pieces accumulated this press
  record: [],            // the session record: turns with provenance
  started: new Date().toISOString(),  // when this record began
  pending: null,         // { fragment, candidates } awaiting the person's tap
  prism: {},             // parsed prism.json, fetched from the server
  voiceRate: 1.0,        // TTS rate, set by the settings slider (0.7-1.2)
};

/* ------------------------------------------------ speech capture (the ear) */

// Web Speech API -- free, live, keyless; ships in Chrome.
const SpeechRecognitionImpl =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;

function setupRecognition() {
  if (!SpeechRecognitionImpl) {
    $("lantern-status").textContent =
      "This browser has no speech recognition. Please use Chrome.";
    $("lantern-btn").disabled = true;
    return;
  }

  recognition = new SpeechRecognitionImpl();
  recognition.continuous = true;      // keep listening until tapped again
  recognition.interimResults = true;  // stream words as they are recognized

  // Show every partial result immediately: the person sees their own words
  // appear as they speak, verbatim, before anything reads into them.
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
    $("lantern-status").textContent =
      event.error === "not-allowed"
        ? "Microphone access was blocked. Allow the mic and try again."
        : "The lantern flickered. Tap and try again.";
    dimLanternUI();
  };

  // Fires both when we call .stop() and when Chrome times out on silence.
  // Either way: finalize whatever was heard.
  recognition.onend = () => {
    if (!state.listening) return;
    dimLanternUI();
    finalizeUtterance();
  };
}

function lightLantern() {
  // Lighting the lantern again withdraws any readings still on screen --
  // the person chose to try again, which is always allowed and never
  // recorded against them.
  clearResponseArea();
  state.heardFinal = "";
  renderTranscript("", "");
  state.listening = true;
  $("lantern-btn").classList.add("lit");
  $("lantern-btn").setAttribute("aria-label", "Stop listening");
  $("lantern-label").textContent = "Listening… tap to stop";
  $("lantern-status").textContent =
    state.mode === "voice"
      ? "The lantern is listening to them."
      : "The lantern is listening to the keeper.";
  recognition.start();
}

function dimLanternUI() {
  state.listening = false;
  $("lantern-btn").classList.remove("lit");
  $("lantern-btn").setAttribute("aria-label", "Light the lantern and listen");
  $("lantern-label").textContent = "Tap to talk";
}

/* Called once per press, after the lantern dims, with the verbatim result. */
function finalizeUtterance() {
  const text = state.heardFinal.trim();
  if (!text) {
    $("lantern-status").textContent = "The lantern didn’t catch anything. Tap and try again.";
    return;
  }
  $("lantern-status").textContent = "";
  if (state.mode === "voice") {
    handleVoiceFragment(text);
  } else {
    handleKeeperTurn(text);
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
      : "Tap the lantern, speak, then tap again.";
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

/* ------------------------------------------------------------ the readings */

async function handleVoiceFragment(fragment) {
  // First law: the raw fragment enters the record before any reading
  // exists, and is never cleaned up or replaced.
  addTurn({ speaker: "voice", provenance: PROVENANCE.verbatim, text: fragment });

  state.pending = { fragment, candidates: [] };
  $("response-area").classList.remove("hidden");
  $("fragment-echo-text").textContent = `“${fragment}”`;
  $("cards").innerHTML = "";
  $("unclear-panel").classList.add("hidden");
  $("thinking").classList.remove("hidden");

  let result;
  try {
    result = await requestReading(fragment);
  } catch (err) {
    console.warn("reading failed:", err);
    result = {
      unclear: true,
      candidates: [],
      reason: "The lantern couldn't reach its reader just now. Please try again.",
    };
  }

  $("thinking").classList.add("hidden");

  // Ignore stale replies if the person already lit the lantern again.
  if (!state.pending || state.pending.fragment !== fragment) return;

  if (result.unclear) {
    showUnclear(result.reason || "");
  } else {
    state.pending.candidates = result.candidates;
    renderCards(result.candidates);
  }
}

function handleKeeperTurn(text) {
  // Keeper speech gets no readings -- it is context, spoken by someone who
  // can already speak for themself.
  addTurn({ speaker: "keeper", provenance: PROVENANCE.keeper, text });
  $("lantern-status").textContent = "Added to the record.";
}

/* The last 6 turns, as context for the next reading. A verbatim fragment
 * is skipped when the very next turn is its confirmed reading, so the
 * reader sees each utterance once, in its clearest form. */
function recentTurns() {
  const turns = [];
  for (let i = 0; i < state.record.length; i++) {
    const turn = state.record[i];
    const next = state.record[i + 1];
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

/* ------------------------------------------------------------ the cards */

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
  // Third law: refusing is always offered, same size and prominence.
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
    none ? "None of these, let me try again" : `Reading ${number}: ${text}`
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

/* Confirmation: the single moment a reading becomes the person's meaning --
 * because the person made it so with a deliberate tap. */
function confirmMeaning(chosenText) {
  const pending = state.pending;
  if (!pending) return;

  const rejected = pending.candidates
    .map((c) => c.text)
    .filter((t) => t !== chosenText);

  // Second law: the voice is given here, inside the person's own tap.
  speak(chosenText);

  addTurn({
    speaker: "voice",
    provenance: PROVENANCE.confirmed,
    text: chosenText,
    source_fragment: pending.fragment,   // the audit trail: what was said,
    rejected_candidates: rejected,       // what was offered, what was chosen
  });

  clearResponseArea();
  $("lantern-status").textContent = "Spoken aloud and kept in the record.";
}

function rejectAll() {
  // No reading is recorded. The verbatim fragment already stands in the
  // record on its own -- refusing costs the person nothing.
  const pending = state.pending;
  showUnclear("");
  $("unclear-panel").querySelector(".unclear-title").textContent =
    "Okay — none of those.";
  if (pending) state.pending = { fragment: pending.fragment, candidates: [] };
}

function showUnclear(reason) {
  $("cards").innerHTML = "";
  const panel = $("unclear-panel");
  panel.querySelector(".unclear-title").textContent =
    "The lantern can’t make this out yet.";
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

/* Words offered by hand become one more reading card. The person still
 * taps to confirm -- offering never skips their choice (second law). */
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

/* ---------------------------------------------------------- quick words */

/* The person's own common needs, from the prism, as one-tap choices.
 * A tap here IS the person choosing: it speaks in the same gesture and is
 * recorded as their chosen words -- no reading step in between. */
function renderQuickWords() {
  const box = $("quick-words");
  box.innerHTML = "";
  for (const phrase of state.prism.common_needs || []) {
    const btn = document.createElement("button");
    btn.className = "quick-word";
    btn.type = "button";
    btn.textContent = phrase;
    btn.setAttribute("aria-label", `Say: ${phrase}`);
    btn.addEventListener("click", () => chooseQuickWord(phrase));
    box.appendChild(btn);
  }
}

function chooseQuickWord(phrase) {
  // Second law: spoken inside the person's own tap.
  speak(phrase);
  addTurn({ speaker: "voice", provenance: PROVENANCE.chosen, text: phrase });
  $("lantern-status").textContent = "Spoken aloud and kept in the record.";
}

/* ------------------------------------------------------- text-to-speech */

/* speak() fires from exactly three gestures, each one the person's own
 * tap: confirming a reading, choosing a quick word, or replaying words
 * already confirmed. If you are adding a fourth call site, stop: it
 * almost certainly breaks the second law. */
function speak(text) {
  window.speechSynthesis.cancel(); // never overlap two utterances
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = state.voiceRate;
  window.speechSynthesis.speak(utterance);
}

/* ------------------------------------------------------------ the record */

function addTurn(turn) {
  state.record.push({ t: new Date().toISOString(), ...turn });
  renderRecord();
}

function chipClass(provenance) {
  if (provenance === PROVENANCE.confirmed) return "chip-confirmed";
  if (provenance === PROVENANCE.chosen) return "chip-chosen";
  if (provenance === PROVENANCE.keeper) return "chip-keeper";
  return "chip-verbatim";
}

function renderRecord() {
  const list = $("record");
  list.innerHTML = "";
  $("record-empty").classList.toggle("hidden", state.record.length > 0);

  for (const turn of state.record) {
    const item = document.createElement("li");
    item.className = "record-entry";

    const top = document.createElement("div");
    top.className = "record-entry-top";

    const chip = document.createElement("span");
    chip.className = "chip " + chipClass(turn.provenance);
    chip.textContent = turn.provenance;
    top.appendChild(chip);

    const time = document.createElement("span");
    time.className = "record-time";
    time.textContent = new Date(turn.t).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    top.appendChild(time);

    // Words the person made theirs can be spoken again, or shown big
    // across the room, at any time.
    if (
      turn.provenance === PROVENANCE.confirmed ||
      turn.provenance === PROVENANCE.chosen
    ) {
      const actions = document.createElement("span");
      actions.className = "entry-actions";

      const again = document.createElement("button");
      again.className = "say-again";
      again.type = "button";
      again.textContent = "Say it again";
      again.addEventListener("click", () => speak(turn.text));
      actions.appendChild(again);

      const big = document.createElement("button");
      big.className = "show-big";
      big.type = "button";
      big.textContent = "Show big";
      big.addEventListener("click", () => showBig(turn.text));
      actions.appendChild(big);

      top.appendChild(actions);
    }

    item.appendChild(top);

    const text = document.createElement("div");
    text.className = "record-text";
    text.textContent = turn.text;
    item.appendChild(text);

    // The confirmed reading also shows the raw fragment it came from --
    // the verbatim is never hidden behind its reading.
    if (turn.source_fragment) {
      const source = document.createElement("div");
      source.className = "record-source";
      source.textContent = `from: “${turn.source_fragment}”`;
      item.appendChild(source);
    }

    list.appendChild(item);
  }

  list.lastElementChild?.scrollIntoView({ block: "nearest" });
}

/* Show one confirmed meaning across the room: dark ground, huge words. */
function showBig(text) {
  $("show-big-text").textContent = text;
  $("show-big").classList.remove("hidden");
}

/* ----------------------------------------------------------- mode toggle */

function setMode(mode) {
  state.mode = mode;
  const voiceOn = mode === "voice";
  $("mode-voice").classList.toggle("active", voiceOn);
  $("mode-keeper").classList.toggle("active", !voiceOn);
  $("mode-voice").setAttribute("aria-pressed", String(voiceOn));
  $("mode-keeper").setAttribute("aria-pressed", String(!voiceOn));
  $("lantern-status").textContent = voiceOn
    ? "The lantern is set to their voice. Their words will get readings."
    : "The lantern is set to the keeper. Keeper words go straight to the record.";
}

/* ------------------------------------------------------ settings drawer */

function openDrawer() {
  $("drawer").classList.remove("hidden");
  $("drawer-overlay").classList.remove("hidden");
}

function closeDrawer() {
  $("drawer").classList.add("hidden");
  $("drawer-overlay").classList.add("hidden");
}

/* --------------------------------------------------------- the prism ----
 * Fetched here, shown in plain editable fields, sent in full with every
 * reading, clearable in two taps. Nothing else remembers. */

const toLines = (items) => (items || []).join("\n");
const fromLines = (text) =>
  text.split("\n").map((line) => line.trim()).filter(Boolean);

async function loadPrism() {
  if (usingWorker()) {
    // THE WORKER: the prism lives in this browser, and nowhere else.
    try {
      const stored = localStorage.getItem("lantern-prism");
      state.prism = stored ? JSON.parse(stored) : { ...STARTER_PRISM };
    } catch {
      state.prism = { ...STARTER_PRISM };
    }
  } else {
    try {
      const resp = await fetch("/prism");
      if (resp.ok) state.prism = await resp.json();
    } catch {
      state.prism = {};
    }
  }
  fillPrismForm();
  renderQuickWords();
}

function fillPrismForm() {
  const prism = state.prism || {};
  $("prism-name").value = prism.name || "";
  $("prism-people").value = toLines(prism.people);
  $("prism-needs").value = toLines(prism.common_needs);
  $("prism-words").value = toLines(prism.favorite_words_phrases);
  $("prism-places").value = toLines(prism.places);
  $("prism-notes").value = prism.notes_from_family || "";
}

function readPrismForm() {
  return {
    name: $("prism-name").value.trim(),
    people: fromLines($("prism-people").value),
    common_needs: fromLines($("prism-needs").value),
    favorite_words_phrases: fromLines($("prism-words").value),
    places: fromLines($("prism-places").value),
    notes_from_family: $("prism-notes").value.trim(),
  };
}

async function savePrismForm() {
  const prism = readPrismForm();
  if (usingWorker()) {
    localStorage.setItem("lantern-prism", JSON.stringify(prism));
    state.prism = prism; // takes effect on the very next reading
    renderQuickWords();
    $("prism-status").textContent =
      "Saved on this device. The prism refracts from the next reading on.";
    return;
  }
  try {
    const resp = await fetch("/prism", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prism),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.prism = prism; // takes effect on the very next reading
    renderQuickWords();
    $("prism-status").textContent = "Saved. The prism refracts from the next reading on.";
  } catch (err) {
    console.warn("prism save failed:", err);
    $("prism-status").textContent = "Couldn't save. Is the server running?";
  }
}

/* Two taps to clear everything: open settings, tap "Clear all". Deleted
 * notes are gone from all future readings immediately. */
async function clearPrism() {
  state.prism = {
    name: "", people: [], common_needs: [],
    favorite_words_phrases: [], places: [], notes_from_family: "",
  };
  fillPrismForm();
  renderQuickWords();
  if (usingWorker()) {
    localStorage.setItem("lantern-prism", JSON.stringify(state.prism));
    $("prism-status").textContent = "Cleared. Nothing personal remains in future readings.";
    return;
  }
  try {
    await fetch("/prism", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.prism),
    });
    $("prism-status").textContent = "Cleared. Nothing personal remains in future readings.";
  } catch {
    $("prism-status").textContent = "Cleared here, but the server couldn't be reached.";
  }
}

/* ------------------------------------------------- the record: keep / new */

async function saveRecord() {
  if (!state.record.length) {
    $("record-status").textContent = "Nothing to keep yet.";
    return;
  }

  if (usingWorker()) {
    // THE WORKER: no server holds the record -- it downloads to the
    // device, same JSON shape the hearth writes, provenance and all.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
    const filename = `record-${stamp}.json`;
    const blob = new Blob(
      [JSON.stringify({ started: state.started, turns: state.record }, null, 2) + "\n"],
      { type: "application/json" }
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    $("record-status").textContent = `Kept as a download: ${filename}`;
    return;
  }

  try {
    const resp = await fetch("/record/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ started: state.started, turns: state.record }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(data));
    $("record-status").textContent = `Kept as records/${data.saved}`;
  } catch (err) {
    console.warn("record save failed:", err);
    $("record-status").textContent = "Couldn't save. Is the server running?";
  }
}

function newRecord() {
  if (
    state.record.length &&
    !window.confirm("Start a new record? Unkept turns will be gone.")
  ) {
    return;
  }
  state.record = [];
  state.started = new Date().toISOString();
  renderRecord();
  clearResponseArea();
  renderTranscript("", "");
  $("record-status").textContent = "New record started.";
  $("lantern-status").textContent = "";
}

/* ---------------------------------------------------------- the threshold */

function showThreshold() {
  $("threshold").classList.remove("hidden");
}

function crossThreshold() {
  $("threshold").classList.add("hidden");
  localStorage.setItem("lantern-crossed", "1");
}

/* ------------------------------------------------------------- wiring */

function init() {
  setupRecognition();
  loadPrism();

  // The threshold greets the first arrival, then stands open.
  if (localStorage.getItem("lantern-crossed") !== "1") {
    showThreshold();
  }
  $("threshold-begin").addEventListener("click", crossThreshold);
  $("threshold-again").addEventListener("click", () => {
    closeDrawer();
    showThreshold();
  });

  $("lantern-btn").addEventListener("click", () => {
    if (!recognition) return;
    if (state.listening) {
      recognition.stop(); // onend fires and finalizes
    } else {
      lightLantern();
    }
  });

  $("mode-voice").addEventListener("click", () => setMode("voice"));
  $("mode-keeper").addEventListener("click", () => setMode("keeper"));

  $("type-add").addEventListener("click", offerTypedCandidate);
  $("type-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") offerTypedCandidate();
  });

  $("show-big").addEventListener("click", () => {
    $("show-big").classList.add("hidden");
  });

  $("settings-btn").addEventListener("click", openDrawer);
  $("drawer-close").addEventListener("click", closeDrawer);
  $("drawer-overlay").addEventListener("click", closeDrawer);

  $("prism-save").addEventListener("click", savePrismForm);
  $("prism-clear").addEventListener("click", clearPrism);
  $("record-save").addEventListener("click", saveRecord);
  $("record-new").addEventListener("click", newRecord);

  // Voice rate (0.7-1.2), remembered across visits on this device.
  const savedRate = parseFloat(localStorage.getItem("lantern-rate") || "1.0");
  state.voiceRate = Math.min(1.2, Math.max(0.7, savedRate));
  $("voice-rate").value = String(state.voiceRate);
  $("voice-rate-value").textContent = state.voiceRate.toFixed(2);
  $("voice-rate").addEventListener("input", (event) => {
    state.voiceRate = parseFloat(event.target.value);
    $("voice-rate-value").textContent = state.voiceRate.toFixed(2);
    localStorage.setItem("lantern-rate", String(state.voiceRate));
  });

  // Daylight / lamplight, remembered.
  const applyLight = (daylight) => {
    document.documentElement.classList.toggle("daylight", daylight);
    $("light-toggle").textContent = daylight ? "Daylight: on" : "Daylight: off";
    $("light-toggle").setAttribute("aria-pressed", String(daylight));
    localStorage.setItem("lantern-daylight", daylight ? "1" : "0");
  };
  applyLight(localStorage.getItem("lantern-daylight") === "1");
  $("light-toggle").addEventListener("click", () =>
    applyLight(!document.documentElement.classList.contains("daylight"))
  );

  // Larger-text mode, also remembered.
  const applyTextSize = (on) => {
    document.documentElement.classList.toggle("large-text", on);
    $("text-size").textContent = on ? "Larger text: on" : "Larger text: off";
    $("text-size").setAttribute("aria-pressed", String(on));
    localStorage.setItem("lantern-large-text", on ? "1" : "0");
  };
  applyTextSize(localStorage.getItem("lantern-large-text") === "1");
  $("text-size").addEventListener("click", () =>
    applyTextSize(!document.documentElement.classList.contains("large-text"))
  );
}

init();
