/* GetThrough front-end.
 *
 * The five invariants (SEED.md section 2) live here as much as in the server:
 *   1. the verbatim transcript is always visible;
 *   2. nothing is spoken or logged as the patient's meaning until they tap it;
 *   3. "None of these" is always offered, same size as the candidates;
 *   4. every log entry carries a provenance chip;
 *   5. when the model can't tell, we show that honestly.
 *
 * Build step 2: mic capture, live transcript, mode toggle.
 */

"use strict";

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ state */

const state = {
  mode: "patient",     // "patient" | "companion" -- who the mic belongs to now
  listening: false,    // is the mic currently capturing?
  heardFinal: "",      // finalized transcript pieces accumulated this press
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

/* --------------------------------------------------- fragment routing */
/* Placeholders in build step 2 -- the interpretation flow, cards, TTS and
 * the provenance log arrive in build steps 3-4. */

function handlePatientFragment(fragment) {
  console.log("patient fragment (interpretation arrives in step 3/4):", fragment);
  $("mic-status").textContent = `Heard: “${fragment}”`;
}

function handleCompanionTurn(text) {
  console.log("companion turn (log arrives in step 4):", text);
  $("mic-status").textContent = `Companion said: “${text}”`;
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

/* ------------------------------------------------------------- wiring */

function init() {
  setupRecognition();

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

  $("settings-btn").addEventListener("click", openDrawer);
  $("drawer-close").addEventListener("click", closeDrawer);
  $("drawer-overlay").addEventListener("click", closeDrawer);
}

init();
