/**
 * GET /bridge?state=STATE&discord_id=ID&client_id=CLIENT_ID
 *
 * The intermediary page. Opens Epic's redirect endpoint in a popup.
 * The popup returns raw JSON with the authorizationCode.
 *
 * Since Epic's /id/api/redirect is cross-origin from our page,
 * we can't read the popup's content directly. Instead:
 *
 * Approach A — postMessage (works if Epic's page cooperates — it won't):
 *   Inject a script into the popup... blocked by cross-origin policy.
 *
 * Approach B — What we actually do:
 *   The popup navigates to epicgames.com/id/api/redirect which returns JSON.
 *   We tell the user: "Copy the code from that popup and paste it here."
 *   One copy-paste. No install. The JSON is right there on screen.
 *
 * Approach C — launcherAppClient2 localhost trick:
 *   Use launcherAppClient2 (redirect = https://localhost/launcher/authorized)
 *   The popup navigates to localhost which is the user's own machine.
 *   If nothing is listening there, browser shows "connection refused."
 *   BUT — we can catch it with a service worker on localhost... still needs install.
 *
 * Approach D — THE ACTUAL MAGIC that works:
 *   Use launcherAppClient2 with redirectUrl=https://localhost/launcher/authorized
 *   The browser popup will navigate to localhost.
 *   We intercept the popup's location BEFORE it actually loads localhost
 *   using popup.location check in a polling loop.
 *   Cross-origin: can't read popup.location when it's on epicgames.com.
 *   Same-origin: CAN read popup.location when it moves to localhost!
 *   localhost is NOT same-origin with our Vercel page... so still can't read it.
 *
 *   BUT — we can catch the error! When the popup navigates to localhost and
 *   nothing is there, popup.location.href becomes readable IF the navigation
 *   failed in a way that keeps the URL accessible... actually no, browsers
 *   don't expose the URL of a failed cross-origin navigation.
 *
 * REAL FINAL APPROACH that requires minimum user friction:
 *   Use a bookmarklet / the raw JSON page approach.
 *   The user opens one URL, the JSON with the code appears.
 *   They click a button on our page that opens the Epic URL in a new tab.
 *   Our page auto-focuses after 1s (when Epic redirect is instant for logged-in users).
 *   User pastes the 32-char code. That's it.
 *
 * This page implements that cleanly.
 */

export default function handler(req, res) {
  const { state, discord_id, client_id } = req.query;
  const epicUrl = `https://www.epicgames.com/id/api/redirect?clientId=${client_id}&responseType=code`;
  const base = `https://${req.headers.host}`;
  const submitUrl = `${base}/submit`;

  console.log('[BRIDGE] Serving bridge page for discord_id =', discord_id, '| state =', state);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Link Epic Account</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0d0d0d; color: #e0e0e0; font-family: -apple-system, 'Segoe UI', monospace; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #161616; border: 1px solid #2a2a2a; border-radius: 12px; padding: 36px; max-width: 480px; width: 100%; }
    h1 { font-size: 1.4em; color: #fff; margin-bottom: 6px; }
    .sub { color: #666; font-size: 0.9em; margin-bottom: 28px; }
    .step { display: flex; gap: 14px; margin-bottom: 20px; align-items: flex-start; }
    .num { background: #00ff99; color: #000; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.85em; flex-shrink: 0; margin-top: 2px; }
    .step-text { color: #ccc; font-size: 0.92em; line-height: 1.5; }
    .step-text strong { color: #fff; }
    .btn { display: block; width: 100%; background: #00ff99; color: #000; border: none; border-radius: 8px; padding: 14px; font-size: 1em; font-weight: bold; cursor: pointer; text-align: center; text-decoration: none; margin: 24px 0 16px; transition: opacity .2s; }
    .btn:hover { opacity: 0.85; }
    .btn.secondary { background: #1e1e1e; color: #00ff99; border: 1px solid #00ff99; margin-top: 0; }
    input[type=text] { width: 100%; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #fff; padding: 12px 14px; font-size: 1em; font-family: monospace; outline: none; transition: border .2s; }
    input[type=text]:focus { border-color: #00ff99; }
    input[type=text]::placeholder { color: #444; }
    .status { margin-top: 12px; font-size: 0.85em; color: #666; text-align: center; min-height: 20px; }
    .status.ok { color: #00ff99; }
    .status.err { color: #ff4444; }
    .divider { border: none; border-top: 1px solid #222; margin: 20px 0; }
    .hint { font-size: 0.78em; color: #555; text-align: center; margin-top: 16px; }
  </style>
</head>
<body>
<div class="card">
  <h1>🎮 Link Your Epic Account</h1>
  <p class="sub">One button + one paste. Nothing installs on your PC.</p>

  <div class="step">
    <div class="num">1</div>
    <div class="step-text">Click <strong>Open Epic</strong> below. A new tab opens and immediately shows a code. You should be already logged into Epic — if not, log in first.</div>
  </div>
  <div class="step">
    <div class="num">2</div>
    <div class="step-text">The page shows JSON. Find <strong>"authorizationCode"</strong> and copy the 32-character value next to it.</div>
  </div>
  <div class="step">
    <div class="num">3</div>
    <div class="step-text">Paste it in the box below and click <strong>Submit</strong>.</div>
  </div>

  <a href="${epicUrl}" target="_blank" class="btn" id="openBtn" onclick="onOpen()">
    Open Epic → Get Code
  </a>

  <hr class="divider">

  <input type="text" id="codeInput" placeholder="Paste your 32-char code here..." maxlength="36" autocomplete="off" autocorrect="off" spellcheck="false">
  <button class="btn secondary" onclick="submitCode()" id="submitBtn">Submit Code</button>
  <div class="status" id="status"></div>

  <p class="hint">Code expires in ~5 minutes. State: <code style="color:#444">${state.slice(0,8)}...</code></p>
</div>

<script>
const STATE     = '${state}';
const SUBMIT_URL = '${submitUrl}';

function onOpen() {
  document.getElementById('status').textContent = 'Epic tab opened — copy the code from there ↗';
  document.getElementById('codeInput').focus();
  setTimeout(() => document.getElementById('codeInput').focus(), 1200);
}

async function submitCode() {
  const raw = document.getElementById('codeInput').value.trim();
  const code = raw.replace(/[^a-f0-9]/gi, '');
  const status = document.getElementById('status');
  const btn = document.getElementById('submitBtn');

  if (code.length !== 32) {
    status.className = 'status err';
    status.textContent = 'Code must be exactly 32 characters (hex). Check your paste.';
    return;
  }

  status.className = 'status';
  status.textContent = 'Submitting...';
  btn.disabled = true;

  try {
    const res = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state: STATE }),
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      status.className = 'status ok';
      status.textContent = '✅ Account linked! ' + (data.displayName ? data.displayName : '');
      document.getElementById('codeInput').disabled = true;
      btn.disabled = true;
    } else {
      status.className = 'status err';
      status.textContent = '❌ ' + (data.error || 'Failed. Try a fresh code.');
      btn.disabled = false;
    }
  } catch (err) {
    status.className = 'status err';
    status.textContent = '❌ Network error: ' + err.message;
    btn.disabled = false;
  }
}

// Allow pressing Enter in input
document.getElementById('codeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitCode();
});

// Auto-submit if exactly 32 hex chars are pasted
document.getElementById('codeInput').addEventListener('input', e => {
  const v = e.target.value.trim().replace(/[^a-f0-9]/gi, '');
  if (v.length === 32) {
    setTimeout(submitCode, 300);
  }
});
</script>
</body>
</html>`);
}
