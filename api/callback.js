/**
 * GET /callback?code=AUTH_CODE&state=STATE_TOKEN
 *
 * Epic redirects here after the user is authenticated.
 * The auth code is in the URL — no install, no JS on the user's machine.
 *
 * This handler:
 *   1. Validates the state token → finds the Discord user
 *   2. Exchanges auth code → Epic access token (server-side, user never sees it)
 *   3. Creates device auth (permanent re-login credential)
 *   4. Logs EVERYTHING to console (Vercel logs)
 *   5. Shows a success page in the browser
 *
 * Check Vercel Dashboard → Functions → Logs to see all output.
 */

import https from 'https';
import { consumeState } from './_state.js';

// fortnitePCGameClient — used for the initial auth code exchange
// This client has NO redirect URL restriction on Epic's side (no domain whitelist)
// which is why the redirectUrl param works with it.
const PC_ID     = 'ec684b8c687f479fadea3cb2ad83f5c6';
const PC_SECRET = 'e1f31c211f28413186262d37a13fc84d';
const PC_BASIC  = Buffer.from(`${PC_ID}:${PC_SECRET}`).toString('base64');

// fortniteAndroidGameClient — used AFTER exchanging from PC token
// Android is needed for device auth creation (has that permission, PC does not)
const AND_ID     = '3f69e56c7649492c8cc29f1af08a8a12';
const AND_SECRET = 'b51ee9cb12234f50a69efa67ef53812e';
const AND_BASIC  = Buffer.from(`${AND_ID}:${AND_SECRET}`).toString('base64');

// launcherAppClient2 — the real Epic Launcher client (used for launch exchange code)
const LAUNCHER_ID     = '34a02cf8f4414e29b15921876da36f9a';
const LAUNCHER_SECRET = 'daafbccc737745039dffe53d94fc76cf';
const LAUNCHER_BASIC  = Buffer.from(`${LAUNCHER_ID}:${LAUNCHER_SECRET}`).toString('base64');

const EPIC_TOKEN_URL  = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token';
const EPIC_DEVICE_URL = (id) => `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${id}/deviceAuth`;
const EPIC_EXCHANGE_URL = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/exchange';

// ── Simple HTTPS fetch helper (no deps needed) ────────────────────────
function epicFetch(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'User-Agent': 'EpicGamesLauncher/15.0.0-0 UnrealEngine/4.26.0',
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export default async function handler(req, res) {
  const { code, state, error: epicError } = req.query;
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[CALLBACK] Browser arrived at callback');
  console.log(`[CALLBACK] ip         = ${ip}`);
  console.log(`[CALLBACK] user-agent = ${req.headers['user-agent']}`);
  console.log(`[CALLBACK] code       = ${code ?? 'MISSING'}`);
  console.log(`[CALLBACK] state      = ${state ?? 'MISSING'}`);
  console.log(`[CALLBACK] epic error = ${epicError ?? 'none'}`);

  // Epic returned an error (user denied, session issue, etc.)
  if (epicError) {
    console.error(`[CALLBACK] Epic returned error: ${epicError}`);
    return res.status(400).send(errorPage(`Epic returned error: ${epicError}`));
  }

  // No code — Epic might have returned JSON instead of redirecting
  // (happens if /id/api/redirect doesn't honor the redirectUrl param for this client)
  if (!code) {
    console.error('[CALLBACK] No code in URL — Epic did not redirect with code');
    console.error('[CALLBACK] Full query:', JSON.stringify(req.query));
    return res.status(400).send(errorPage(
      'No auth code received. Epic may not have honored the redirectUrl param for this clientId. ' +
      'Check Vercel logs for the exact URL that was built in /start.'
    ));
  }

  // Validate state token — maps callback back to Discord user
  const stateEntry = consumeState(state);
  if (!stateEntry) {
    console.error(`[CALLBACK] Invalid or expired state token: ${state}`);
    return res.status(400).send(errorPage('State token invalid or expired. Try the link again.'));
  }

  const { discordId } = stateEntry;
  console.log(`[CALLBACK] State valid → Discord user: ${discordId}`);
  console.log(`[CALLBACK] Auth code: ${code}`);
  console.log('[CALLBACK] Starting server-side token exchange...');

  // ── Step 1: Auth code → PC access token ──────────────────────────
  // fortnitePCGameClient has no redirect domain restriction so it accepted our
  // redirectUrl. We get a PC token here, then immediately swap to Android
  // because only Android client can create device auth.
  console.log('\n[STEP 1] Exchanging auth code for PC access token...');
  console.log(`[STEP 1] POST ${EPIC_TOKEN_URL}`);
  console.log(`[STEP 1] grant_type=authorization_code&code=${code}`);

  let tokenData;
  try {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code }).toString();
    const resp = await epicFetch(EPIC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${PC_BASIC}`,
        'Content-Length': Buffer.byteLength(body).toString(),
      },
      body,
    });

    console.log(`[STEP 1] Response status: ${resp.status}`);
    console.log('[STEP 1] Response body:', JSON.stringify(resp.body, null, 2));

    if (resp.status !== 200) {
      console.error('[STEP 1] FAILED — auth code exchange rejected by Epic');
      return res.status(400).send(errorPage(
        `Token exchange failed (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`
      ));
    }

    tokenData = resp.body;
  } catch (err) {
    console.error('[STEP 1] EXCEPTION:', err.message);
    return res.status(500).send(errorPage(`Token exchange threw: ${err.message}`));
  }

  let { access_token, account_id, displayName, expires_in } = tokenData;
  console.log(`\n[STEP 1] ✅ PC token OK`);
  console.log(`[STEP 1] display_name = ${displayName}`);
  console.log(`[STEP 1] account_id   = ${account_id}`);
  console.log(`[STEP 1] expires_in   = ${expires_in}s`);

  // ── Step 1b: Swap PC token → Android token (needed for device auth) ──
  // fortnitePCGameClient does NOT have permission to create device auth.
  // We exchange the PC token to an Android token which does.
  console.log('\n[STEP 1b] Swapping PC token → Android token (device auth needs Android client)...');
  try {
    const swapResp = await epicFetch(EPIC_EXCHANGE_URL, {
      headers: { 'Authorization': `Bearer ${access_token}` },
    });
    console.log(`[STEP 1b] Swap code status: ${swapResp.status}`);

    if (swapResp.status === 200 && swapResp.body?.code) {
      const andBody = new URLSearchParams({
        grant_type: 'exchange_code',
        exchange_code: swapResp.body.code,
      }).toString();
      const andResp = await epicFetch(EPIC_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${AND_BASIC}`,
          'Content-Length': Buffer.byteLength(andBody).toString(),
        },
        body: andBody,
      });
      console.log(`[STEP 1b] Android token status: ${andResp.status}`);
      if (andResp.status === 200 && andResp.body?.access_token) {
        access_token = andResp.body.access_token;
        console.log(`[STEP 1b] ✅ Android token obtained — will use for device auth`);
      } else {
        console.warn('[STEP 1b] Android swap failed — proceeding with PC token (device auth may fail)');
        console.warn('[STEP 1b]', JSON.stringify(andResp.body));
      }
    } else {
      console.warn('[STEP 1b] Could not get swap code — proceeding with PC token');
    }
  } catch (err) {
    console.warn('[STEP 1b] EXCEPTION (non-fatal):', err.message);
  }

  // ── Step 2: Create device auth (permanent re-login credential) ────
  console.log(`\n[STEP 2] Creating device auth for ${account_id}...`);
  console.log(`[STEP 2] POST ${EPIC_DEVICE_URL(account_id)}`);

  let deviceData;
  try {
    const resp = await epicFetch(EPIC_DEVICE_URL(account_id), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'Content-Length': '2',
      },
      body: '{}',
    });

    console.log(`[STEP 2] Response status: ${resp.status}`);
    // Redact the secret from logs — log everything else
    const logBody = { ...resp.body };
    if (logBody.secret) logBody.secret = logBody.secret.slice(0, 6) + '... (redacted)';
    console.log('[STEP 2] Response body:', JSON.stringify(logBody, null, 2));

    if (resp.status !== 200) {
      console.error('[STEP 2] FAILED — device auth creation rejected');
      return res.status(400).send(errorPage(
        `Device auth failed (HTTP ${resp.status}): ${JSON.stringify(resp.body)}`
      ));
    }

    deviceData = resp.body;
  } catch (err) {
    console.error('[STEP 2] EXCEPTION:', err.message);
    return res.status(500).send(errorPage(`Device auth threw: ${err.message}`));
  }

  console.log(`\n[STEP 2] ✅ SUCCESS`);
  console.log(`[STEP 2] accountId = ${deviceData.accountId}`);
  console.log(`[STEP 2] deviceId  = ${deviceData.deviceId}`);
  console.log(`[STEP 2] secret    = ${deviceData.secret?.slice(0, 6)}... (redacted from logs)`);

  // ── Step 3: Test device auth re-login (prove it works) ───────────
  console.log('\n[STEP 3] Testing device auth re-login to confirm it works...');

  let refreshData;
  try {
    const body = new URLSearchParams({
      grant_type: 'device_auth',
      account_id: deviceData.accountId,
      device_id: deviceData.deviceId,
      secret: deviceData.secret,
    }).toString();

    const resp = await epicFetch(EPIC_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${AND_BASIC}`,
        'Content-Length': Buffer.byteLength(body).toString(),
      },
      body,
    });

    console.log(`[STEP 3] Response status: ${resp.status}`);

    if (resp.status !== 200) {
      console.warn('[STEP 3] Device auth re-login failed — device auth may need a moment to activate');
      console.warn('[STEP 3] Response:', JSON.stringify(resp.body));
      refreshData = null;
    } else {
      refreshData = resp.body;
      console.log(`[STEP 3] ✅ Device auth re-login works for ${refreshData.displayName}`);
    }
  } catch (err) {
    console.warn('[STEP 3] EXCEPTION (non-fatal):', err.message);
    refreshData = null;
  }

  // ── Step 4: Generate launcherAppClient2 exchange code (launch test) ─
  console.log('\n[STEP 4] Generating launcherAppClient2 exchange code (VPN-free launch test)...');

  let launchCode = null;
  try {
    const tokenForExchange = refreshData?.access_token || access_token;

    // 4a: get swap code from current token
    const swapResp = await epicFetch(EPIC_EXCHANGE_URL, {
      headers: { 'Authorization': `Bearer ${tokenForExchange}` },
    });
    console.log(`[STEP 4a] Exchange swap status: ${swapResp.status}`);

    if (swapResp.status === 200 && swapResp.body?.code) {
      // 4b: exchange into launcherAppClient2
      const lBody = new URLSearchParams({
        grant_type: 'exchange_code',
        exchange_code: swapResp.body.code,
      }).toString();

      const launcherResp = await epicFetch(EPIC_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${LAUNCHER_BASIC}`,
          'Content-Length': Buffer.byteLength(lBody).toString(),
        },
        body: lBody,
      });
      console.log(`[STEP 4b] Launcher token status: ${launcherResp.status}`);

      if (launcherResp.status === 200 && launcherResp.body?.access_token) {
        // 4c: final exchange code from launcher token
        const finalResp = await epicFetch(EPIC_EXCHANGE_URL, {
          headers: { 'Authorization': `Bearer ${launcherResp.body.access_token}` },
        });
        console.log(`[STEP 4c] Final exchange code status: ${finalResp.status}`);

        if (finalResp.status === 200 && finalResp.body?.code) {
          launchCode = finalResp.body.code;
          console.log(`[STEP 4] ✅ Launch exchange code: ${launchCode}`);
          console.log(`[STEP 4] Launch command:`);
          console.log(`         start /d "C:\\...\\Win64" FortniteLauncher.exe -AUTH_LOGIN=unused -AUTH_PASSWORD=${launchCode} -AUTH_TYPE=exchangecode -epicapp=Fortnite -epicenv=Prod -EpicPortal -epicuserid=${account_id} & exit`);
        }
      }
    }
  } catch (err) {
    console.warn('[STEP 4] EXCEPTION (non-fatal):', err.message);
  }

  // ── Final summary ─────────────────────────────────────────────────
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║         FULL CHAIN RESULT               ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Discord user  : ${discordId}`);
  console.log(`║ Epic account  : ${displayName} (${account_id})`);
  console.log(`║ Auth code     : ${code}`);
  console.log(`║ Access token  : ${access_token?.slice(0, 20)}...`);
  console.log(`║ Device auth   : ${deviceData.deviceId}`);
  console.log(`║ Re-login test : ${refreshData ? '✅ WORKS' : '⚠️ skipped'}`);
  console.log(`║ Launch code   : ${launchCode ?? '⚠️ skipped'}`);
  console.log('╚════════════════════════════════════════╝');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Browser response — clean success page ─────────────────────────
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Linked!</title>
  <style>
    body { background: #0d0d0d; color: #e0e0e0; font-family: monospace; padding: 40px; max-width: 700px; margin: auto; }
    .green { color: #00ff99; }
    .dim { color: #666; }
    .box { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 20px; margin: 16px 0; }
    .label { color: #888; font-size: 0.8em; margin-bottom: 4px; }
    .val { color: #00aaff; }
  </style>
</head>
<body>
  <h1 class="green">✅ Auth Capture Successful</h1>
  <p>Epic Games auth code was captured and the full chain ran server-side. Check Vercel logs for full output.</p>

  <div class="box">
    <div class="label">Epic Account</div>
    <div class="val">${displayName} <span class="dim">(${account_id})</span></div>
  </div>

  <div class="box">
    <div class="label">Auth Code (one-time, now consumed)</div>
    <div class="val">${code}</div>
  </div>

  <div class="box">
    <div class="label">Device Auth Created</div>
    <div class="val">✅ ${deviceData.deviceId}</div>
  </div>

  <div class="box">
    <div class="label">Device Auth Re-login Test</div>
    <div class="val">${refreshData ? '✅ Works — permanent login confirmed' : '⚠️ Skipped (see logs)'}</div>
  </div>

  <div class="box">
    <div class="label">launcherAppClient2 Exchange Code</div>
    <div class="val">${launchCode ?? '⚠️ See logs'}</div>
    ${launchCode ? `<div class="dim" style="margin-top:8px;font-size:0.8em">Valid for 5 minutes · Use with -AUTH_TYPE=exchangecode · No VPN kick</div>` : ''}
  </div>

  <p class="dim">Full token details (access token, device secret) are in Vercel logs only — not shown here.</p>
  <p class="dim">You can close this window.</p>
</body>
</html>`);
}

function errorPage(msg) {
  return `<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body style="background:#0d0d0d;color:#ff4444;font-family:monospace;padding:40px">
  <h1>❌ Auth Capture Failed</h1>
  <pre style="background:#1a1a1a;padding:20px;border-radius:8px;color:#ff8888;white-space:pre-wrap">${msg}</pre>
  <p style="color:#666">Check Vercel logs for full details. Try the link again from the home page.</p>
</body>
</html>`;
}
