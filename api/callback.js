/**
 * GET /callback?code=AUTH_CODE&state=TOKEN
 *
 * Epic redirects Person B's browser here after OAuth2 authorization.
 * This only works once EOS_CLIENT_ID + EOS_CLIENT_SECRET are set.
 *
 * The `state` param is the session token — maps this auth code back
 * to the Person A who generated the link.
 *
 * We immediately exchange the auth code for tokens server-side,
 * then show Person B a success page. Person A's polling sees 'done'.
 */
import { getSession } from './_db.js';

const EOS_CLIENT_ID     = process.env.EOS_CLIENT_ID;
const EOS_CLIENT_SECRET = process.env.EOS_CLIENT_SECRET;

export default async function handler(req, res) {
  const { code, state: token, error } = req.query;

  console.log(`[CALLBACK] code=${code?.slice(0,8)} token=${token?.slice(0,8)} error=${error}`);

  // Epic returned an error (user denied, etc.)
  if (error) {
    return res.status(400).send(page('❌ Epic returned an error', error, false));
  }

  if (!code || !token) {
    return res.status(400).send(page('❌ Missing parameters', 'No code or state in the callback URL.', false));
  }

  const s = await getSession(token);
  if (!s || s.status === 'done') {
    return res.status(410).send(page('⚠️ Session expired', 'This session has already been used or expired.', false));
  }

  if (!EOS_CLIENT_ID || !EOS_CLIENT_SECRET) {
    return res.status(500).send(page('⚙️ Not configured', 'EOS_CLIENT_ID and EOS_CLIENT_SECRET env vars are not set on the server.', false));
  }

  // Mark as clicked so Person A's UI updates
  const base        = `https://${req.headers.host}`;
  const callbackUrl = `${base}/callback`;
  const deliverUrl  = `${base}/deliver`;

  // Deliver the code to Person A via /deliver (runs the full Epic chain)
  // We do this async and show Person B the success page immediately
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(page('✅ Account Linked!', 'You can close this window. The operator has been notified.', true));

  // Fire and forget — deliver the auth code to Person A
  try {
    await fetch(deliverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, code }),
    });
    console.log(`[CALLBACK] delivered code for token=${token.slice(0,8)}`);
  } catch(e) {
    console.error(`[CALLBACK] deliver failed: ${e.message}`);
  }
}

function page(title, message, success) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#080808;color:#d0d0d0;font-family:-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#101010;border:1px solid ${success ? '#00e676' : '#3a1a1a'};border-radius:20px;padding:44px 40px;max-width:420px;width:100%;text-align:center}
    .icon{font-size:3em;margin-bottom:16px}
    h2{color:${success ? '#00e676' : '#ff5252'};font-size:1.4em;margin-bottom:10px}
    p{color:#555;font-size:0.88em;line-height:1.6}
  </style>
</head>
<body>
<div class="card">
  <div class="icon">${success ? '✅' : '❌'}</div>
  <h2>${title}</h2>
  <p>${message}</p>
</div>
</body>
</html>`;
}
