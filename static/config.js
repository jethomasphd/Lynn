/* ═══════════════════════════════════════════════════════════════
   THE LANTERN — Deployment Configuration

   Two flames, one chamber:

   THE HEARTH (local)  — run `python server.py`. When the chamber is
     served from localhost, readings go to the local server, which
     holds the key in .env; the prism lives in prism.json on disk and
     records save to records/.

   THE WORKER (cloud)  — deploy the static/ folder (Cloudflare Pages,
     no build step). Served from anywhere else, readings go straight
     from the browser through the shared COMPANION worker below, which
     holds the key server-side. The prism lives in this browser only;
     records download to the device. Nothing secret in this file.

   The worker's origin allowlist must include the domain you deploy
   to (see proxy/wrangler.toml ALLOWED_ORIGINS in the estate repo).
   ═══════════════════════════════════════════════════════════════ */

window.LANTERN_CONFIG = {
  // The shared COMPANION worker (same proxy the estate's chambers use).
  // Leave "" to use the hearth only.
  proxyUrl: "https://companion.jethomasphd.workers.dev",

  // Must be on the worker's ALLOWED_MODELS list.
  model: "claude-sonnet-4-6",
  temperature: 0.3,
  maxTokens: 1000,

  // Gentle client-side safeguard for the shared worker: minimum seconds
  // between readings. Never a daily cap — this chamber must not lock a
  // family out at 2 a.m.
  cooldownSeconds: 2,

  // Testing hook: use the worker even when served from localhost.
  forceWorker: false
};
