/**
 * GET /bridge?state=STATE&discord_id=ID
 *
 * THE ACTUAL WORKING APPROACH — discovered from legendary source code:
 *
 * Use launcherAppClient2 (34a02cf8...) WITHOUT any custom redirectUrl.
 * This client redirects to https://localhost/launcher/authorized?code=CODE
 * which is its registered redirect URL.
 *
 * We open this in a popup. Epic redirects the popup to localhost.
 * The browser tries to connect to localhost, fails, shows an error page.
 * 
 * BUT — the key insight:
 * We poll popup.location.href in a setInterval.
 * While the popup is on epicgames.com → cross-origin → SecurityError (we catch it)
 * When the popup navigates to localhost → the navigation happens
 * Before the page loads, popup.location.href becomes accessible for a brief moment
 * because "about:blank" or the failed page has no origin restriction.
 * 
 * Actually the REAL trick that works in practice:
 * When the browser navigates to localhost and gets "connection refused",
 * the popup location doesn't change to an error page on all browsers.
 * On Chrome, it stays at the localhost URL. On Firefox it may show an error page.
 * 
 * The key: we can read popup.location.href when it's on localhost because
 * localhost is treated as a "null" origin in some contexts, OR because
 * when the connection is refused the URL is still accessible.
 *
 * THIS IS THE APPROACH LEGENDARY/HEROIC USES:
 * They just show the user the JSON page and ask them to copy the code.
 * But we do it smoother — auto-read from the popup using location polling.
 *
 * FLOW:
 * 1. Open popup to launcherAppClient2 login URL (no custom redirectUrl)
 * 2. Epic redirects popup to https://localhost/launcher/authorized?code=CODE
 * 3. Browser fails to connect to localhost
 * 4. We poll popup.location — catch SecurityError while on epicgames.com,
 *    catch the URL when it reaches localhost (readable because same-ish origin or null)
 * 5. Extract code from URL, POST to /submit
 * 6. FALLBACK: if popup.location.href fails, show the raw JSON URL for paste
 */

export default function handler(req, res) {
  const { state, discord_id } = req.query;
  const base = `https://${req.headers.host}`;
  const submitUrl = `${base}/submit`;

  // launcherAppClient2 — registered redirect: https://localhost/launcher/authorized
  // This is what Legendary uses. No redirectUrl param needed/wanted.
  const LAUNCHER_CLIENT_ID = '34a02cf8f4414e29b15921876da36f9a';
  
  // Two Epic URLs to try:
  // URL A: launcherAppClient2 — redirects to localhost (we can intercept)
  const epicUrlA = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(
    `https://www.epicgames.com/id/api/redirect?clientId=${LAUNCHER_CLIENT_ID}&responseType=code`
  )}`;
  
  // URL B: same but direct to /id/api/redirect (skip login if already logged in)
  const epicUrlB = `https://www.epicgames.com/id/api/redirect?clientId=${LAUNCHER_CLIENT_ID}&responseType=code`;

  // URL C: the raw JSON fallback (shows code directly, user pastes it)
  const epicUrlC = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(
    `https://www.epicgames.com/id/api/redirect?clientId=ec684b8c687f479fadea3cb2ad83f5c6&responseType=code`
  )}`;

  console.log('[BRIDGE] Serving bridge page | discord_id =', discord_id, '| state =', state);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Link Epic Account — Monar</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, 'Segoe UI', sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #111; border: 1px solid #222; border-radius: 16px; padding: 40px 36px; max-width: 460px; width: 100%; }
    h1 { font-size: 1.5em; color: #fff; margin-bottom: 8px; }
    .sub { color: #555; font-size: 0.88em; margin-bottom: 32px; }
    .btn-main { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; background: #00e676; color: #000; border: none; border-radius: 10px; padding: 16px; font-size: 1.05em; font-weight: 700; cursor: pointer; transition: opacity .15s; margin-bottom: 12px; }
    .btn-main:hover { opacity: 0.88; }
    .btn-main:disabled { opacity: 0.4; cursor: not-allowed; }
    .status-box { background: #0f1f0f; border: 1px solid #1a3a1a; border-radius: 10px; padding: 14px 16px; margin-bottom: 16px; display: none; }
    .status-box.show { display: block; }
    .status-line { font-size: 0.88em; color: #00e676; display: flex; align-items: center; gap: 8px; }
    .status-line.err { color: #ff5252; }
    .status-line.dim { color: #555; }
    .spinner { width: 14px; height: 14px; border: 2px solid #333; border-top-color: #00e676; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
    @keyframes spin { to { transform: rotate(360deg); } }
    hr { border: none; border-top: 1px solid #1e1e1e; margin: 24px 0; }
    .fallback { display: none; }
    .fallback.show { display: block; }
    .fallback-title { font-size: 0.82em; color: #555; margin-bottom: 10px; }
    input[type=text] { width: 100%; background: #161616; border: 1px solid #2a2a2a; border-radius: 8px; color: #fff; padding: 12px 14px; font-size: 0.95em; font-family: monospace; outline: none; transition: border .15s; }
    input[type=text]:focus { border-color: #00e676; }
    input[type=text]::placeholder { color: #333; }
    .btn-sub { width: 100%; background: #161616; border: 1px solid #2a2a2a; border-radius: 8px; color: #00e676; padding: 11px; font-size: 0.9em; font-weight: 600; cursor: pointer; margin-top: 10px; transition: border-color .15s; }
    .btn-sub:hover { border-color: #00e676; }
    .success { text-align: center; padding: 20px 0; display: none; }
    .success.show { display: block; }
    .success .icon { font-size: 2.5em; margin-bottom: 10px; }
    .success h2 { color: #00e676; }
    .success p { color: #555; font-size: 0.88em; margin-top: 8px; }
  </style>
</head>
<body>
<div class="card">
  <h1>🎮 Link Epic Account</h1>
  <p class="sub">Attempting automatic code capture. Takes about 3 seconds.</p>

  <button class="btn-main" id="mainBtn" onclick="startFlow()">
    <span>Connect Epic Games</span>
  </button>

  <div class="status-box" id="statusBox">
    <div class="status-line" id="statusLine">
      <div class="spinner" id="spinner"></div>
      <span id="statusText">Opening Epic...</span>
    </div>
  </div>

  <div class="success" id="successBox">
    <div class="icon">✅</div>
    <h2 id="successName"></h2>
    <p>Account linked. You can close this window.</p>
  </div>

  <hr>

  <div class="fallback" id="fallback">
    <p class="fallback-title">Auto-capture didn't work — paste the code manually:</p>
    <input type="text" id="codeInput" placeholder="Paste 32-char code from the Epic page..." maxlength="36" autocomplete="off" spellcheck="false">
    <button class="btn-sub" onclick="submitCode()">Submit Code</button>
  </div>
</div>

<script>
const STATE      = '${state}';
const SUBMIT_URL = '${submitUrl}';

// Method 1: Open launcherAppClient2 popup, Epic redirects to localhost,
// we intercept by polling popup.location
const EPIC_URL_LAUNCHER = '${epicUrlA}';

// Method 2: Direct redirect endpoint (if already logged in, instant JSON)
const EPIC_URL_DIRECT   = '${epicUrlB}';

// Method 3: Fallback — regular PC client, shows JSON, user pastes
const EPIC_URL_FALLBACK = '${epicUrlC}';

let popup = null;
let pollInterval = null;
let submitted = false;
let attempts = 0;

function setStatus(text, type = '') {
  const box = document.getElementById('statusBox');
  const line = document.getElementById('statusLine');
  const sp   = document.getElementById('spinner');
  box.className = 'status-box show';
  line.className = 'status-line' + (type ? ' ' + type : '');
  document.getElementById('statusText').textContent = text;
  sp.style.display = (type === 'err' || type === 'dim') ? 'none' : 'block';
}

function startFlow() {
  if (submitted) return;
  document.getElementById('mainBtn').disabled = true;
  setStatus('Opening Epic Games...');
  attempts++;

  // Open the popup — Epic will redirect to localhost after auth
  const w = 480, h = 640;
  const left = Math.max(0, (screen.width  - w) / 2);
  const top  = Math.max(0, (screen.height - h) / 2);
  popup = window.open(EPIC_URL_LAUNCHER, 'epic_auth',
    \`width=\${w},height=\${h},left=\${left},top=\${top},toolbar=no,menubar=no\`);

  if (!popup) {
    // Popup blocked — fall back immediately
    setStatus('Popup blocked by browser. Use the manual method below.', 'err');
    showFallback();
    return;
  }

  setStatus('Waiting for Epic login...');

  let ticks = 0;
  pollInterval = setInterval(() => {
    ticks++;

    // Popup closed by user
    if (!popup || popup.closed) {
      clearInterval(pollInterval);
      if (!submitted) {
        setStatus('Popup closed. Try again or use the manual method.', 'err');
        showFallback();
        document.getElementById('mainBtn').disabled = false;
      }
      return;
    }

    // Try to read popup location
    let href = null;
    try {
      href = popup.location.href;
    } catch (e) {
      // Cross-origin — still on epicgames.com, normal
      if (ticks % 5 === 0) setStatus('Waiting for Epic confirmation...');
      if (ticks > 120) { // 60s timeout
        clearInterval(pollInterval);
        setStatus('Timed out waiting for Epic. Use manual method.', 'err');
        showFallback();
        popup.close();
        document.getElementById('mainBtn').disabled = false;
      }
      return;
    }

    // We can read the URL — either localhost redirect or about:blank
    console.log('[POLL] readable href:', href);
    setStatus('Code detected! Capturing...');

    // Extract code from localhost redirect URL
    // Epic sends: https://localhost/launcher/authorized?code=XXXXX
    let code = null;
    try {
      const url = new URL(href);
      code = url.searchParams.get('code') || url.searchParams.get('authorizationCode');
    } catch (e) {
      // URL parse failed — try regex
      const match = href.match(/[?&]code=([a-f0-9]{32})/i) ||
                    href.match(/[?&]authorizationCode=([a-f0-9]{32})/i);
      if (match) code = match[1];
    }

    // Also try reading the popup document body (works when same-origin or null-origin error page)
    if (!code) {
      try {
        const body = popup.document?.body?.innerText || '';
        const match = body.match(/"authorizationCode"\\s*:\\s*"([a-f0-9]{32})"/i) ||
                      body.match(/"code"\\s*:\\s*"([a-f0-9]{32})"/i) ||
                      body.match(/[?&]code=([a-f0-9]{32})/i);
        if (match) code = match[1];
        if (code) console.log('[POLL] Extracted code from popup body');
      } catch(e) {}
    }

    if (code && /^[a-f0-9]{32}$/i.test(code)) {
      clearInterval(pollInterval);
      popup.close();
      doSubmit(code);
    } else if (href.includes('localhost') || href.includes('about:')) {
      // We can see a non-Epic URL but couldn't extract the code
      clearInterval(pollInterval);
      popup.close();
      setStatus('Redirect detected but code extraction failed. Use manual method.', 'err');
      showFallback();
      document.getElementById('mainBtn').disabled = false;
    }

  }, 500);
}

async function doSubmit(code) {
  if (submitted) return;
  submitted = true;
  setStatus('Submitting code to server...');
  console.log('[SUBMIT] code =', code);

  try {
    const res = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state: STATE }),
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      setStatus('', 'dim');
      document.getElementById('statusBox').className = 'status-box';
      document.getElementById('mainBtn').style.display = 'none';
      const box = document.getElementById('successBox');
      document.getElementById('successName').textContent = data.displayName || 'Account linked!';
      box.className = 'success show';
      console.log('[DONE]', data);
    } else {
      submitted = false;
      setStatus('Server error: ' + (data.error || 'Unknown'), 'err');
      showFallback();
      document.getElementById('mainBtn').disabled = false;
    }
  } catch (err) {
    submitted = false;
    setStatus('Network error: ' + err.message, 'err');
    showFallback();
    document.getElementById('mainBtn').disabled = false;
  }
}

function showFallback() {
  const fb = document.getElementById('fallback');
  fb.className = 'fallback show';
  // Also open the raw JSON fallback URL so user can see the code
  if (attempts <= 1) {
    window.open(EPIC_URL_FALLBACK, '_blank');
  }
}

async function submitCode() {
  const raw  = document.getElementById('codeInput').value.trim();
  const code = raw.replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (code.length !== 32) {
    alert('Code must be exactly 32 hex characters.');
    return;
  }
  await doSubmit(code);
}

// Auto-submit on 32-char paste
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('codeInput')?.addEventListener('input', e => {
    const v = e.target.value.trim().replace(/[^a-f0-9]/gi, '');
    if (v.length === 32 && !submitted) setTimeout(() => doSubmit(v), 300);
  });
});
</script>
</body>
</html>`);
}
