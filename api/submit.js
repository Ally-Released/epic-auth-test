/**
 * POST /submit  { code: "32hexchars", state: "state_token" }
 *
 * Receives the auth code that the user pasted from Epic's JSON page.
 * Validates state, exchanges code → access token → device auth.
 * Everything logged to Vercel console.
 */

import https from 'https';
import { consumeState } from './_state.js';

const PC_ID     = 'ec684b8c687f479fadea3cb2ad83f5c6';
const PC_SECRET = 'e1f31c211f28413186262d37a13fc84d';
const PC_BASIC  = Buffer.from(`${PC_ID}:${PC_SECRET}`).toString('base64');

const AND_ID     = '3f69e56c7649492c8cc29f1af08a8a12';
const AND_SECRET = 'b51ee9cb12234f50a69efa67ef53812e';
const AND_BASIC  = Buffer.from(`${AND_ID}:${AND_SECRET}`).toString('base64');

const LAUNCHER_ID     = '34a02cf8f4414e29b15921876da36f9a';
const LAUNCHER_SECRET = 'daafbccc737745039dffe53d94fc76cf';
const LAUNCHER_BASIC  = Buffer.from(`${LAUNCHER_ID}:${LAUNCHER_SECRET}`).toString('base64');

const EPIC_TOKEN_URL    = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token';
const EPIC_EXCHANGE_URL = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/exchange';
const EPIC_DEVICE_URL   = (id) => `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${id}/deviceAuth`;

function epicFetch(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method, headers };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'invalid-json' }); }

  const code  = String(body?.code  || '').trim().toLowerCase();
  const state = String(body?.state || '').trim();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[SUBMIT] code =', code, '| state =', state);

  if (!/^[a-f0-9]{32}$/.test(code)) {
    console.warn('[SUBMIT] invalid code format');
    return res.status(400).json({ error: 'Code must be 32 hex characters' });
  }

  const stateEntry = consumeState(state);
  if (!stateEntry) {
    console.warn('[SUBMIT] invalid/expired state:', state);
    return res.status(400).json({ error: 'State token invalid or expired. Restart the flow.' });
  }
  const { discordId } = stateEntry;
  console.log('[SUBMIT] state OK → discord_id =', discordId);

  // Step 1: Auth code → PC access token
  console.log('\n[STEP 1] auth code → PC token');
  const s1body = new URLSearchParams({ grant_type: 'authorization_code', code }).toString();
  const s1 = await epicFetch(EPIC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${PC_BASIC}`, 'Content-Length': Buffer.byteLength(s1body).toString() },
    body: s1body,
  });
  console.log('[STEP 1] status =', s1.status);
  console.log('[STEP 1] body =', JSON.stringify(s1.body, null, 2));

  if (s1.status !== 200) {
    return res.status(400).json({ error: `Token exchange failed: ${s1.body?.errorMessage || s1.body?.error || s1.status}` });
  }

  let { access_token, account_id, displayName } = s1.body;
  console.log('[STEP 1] ✅', displayName, account_id);

  // Step 2: PC token → exchange → Android token (for device auth)
  console.log('\n[STEP 2] PC token → Android token');
  try {
    const swapR = await epicFetch(EPIC_EXCHANGE_URL, { headers: { Authorization: `Bearer ${access_token}` } });
    if (swapR.status === 200 && swapR.body?.code) {
      const andBody = new URLSearchParams({ grant_type: 'exchange_code', exchange_code: swapR.body.code }).toString();
      const andR = await epicFetch(EPIC_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${AND_BASIC}`, 'Content-Length': Buffer.byteLength(andBody).toString() },
        body: andBody,
      });
      console.log('[STEP 2] Android swap status =', andR.status);
      if (andR.status === 200 && andR.body?.access_token) {
        access_token = andR.body.access_token;
        console.log('[STEP 2] ✅ Using Android token for device auth');
      }
    }
  } catch (e) { console.warn('[STEP 2] swap failed (non-fatal):', e.message); }

  // Step 3: Create device auth
  console.log('\n[STEP 3] Creating device auth for', account_id);
  const s3 = await epicFetch(EPIC_DEVICE_URL(account_id), {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json', 'Content-Length': '2' },
    body: '{}',
  });
  console.log('[STEP 3] status =', s3.status);
  const s3log = { ...s3.body };
  if (s3log.secret) s3log.secret = s3log.secret.slice(0, 6) + '...(redacted)';
  console.log('[STEP 3] body =', JSON.stringify(s3log, null, 2));

  if (s3.status !== 200) {
    return res.status(400).json({ error: `Device auth failed: ${s3.body?.errorMessage || s3.status}` });
  }

  const deviceData = s3.body;
  console.log('[STEP 3] ✅ deviceId =', deviceData.deviceId);

  // Step 4: launcherAppClient2 exchange code (for launch)
  console.log('\n[STEP 4] Generating launcherAppClient2 exchange code');
  let launchCode = null;
  try {
    const e1 = await epicFetch(EPIC_EXCHANGE_URL, { headers: { Authorization: `Bearer ${access_token}` } });
    if (e1.status === 200 && e1.body?.code) {
      const lBody = new URLSearchParams({ grant_type: 'exchange_code', exchange_code: e1.body.code }).toString();
      const lR = await epicFetch(EPIC_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${LAUNCHER_BASIC}`, 'Content-Length': Buffer.byteLength(lBody).toString() },
        body: lBody,
      });
      if (lR.status === 200 && lR.body?.access_token) {
        const e2 = await epicFetch(EPIC_EXCHANGE_URL, { headers: { Authorization: `Bearer ${lR.body.access_token}` } });
        if (e2.status === 200 && e2.body?.code) {
          launchCode = e2.body.code;
          console.log('[STEP 4] ✅ launchCode =', launchCode);
          console.log('[STEP 4] Launch cmd: start /d "C:\\...\\Win64" FortniteLauncher.exe -AUTH_LOGIN=unused -AUTH_PASSWORD=' + launchCode + ' -AUTH_TYPE=exchangecode -epicapp=Fortnite -epicenv=Prod -EpicPortal -epicuserid=' + account_id + ' & exit');
        }
      }
    }
  } catch (e) { console.warn('[STEP 4] non-fatal:', e.message); }

  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║           FULL CHAIN RESULT            ║');
  console.log(`║ Discord   : ${discordId}`);
  console.log(`║ Epic      : ${displayName} (${account_id})`);
  console.log(`║ Auth code : ${code}`);
  console.log(`║ Device ID : ${deviceData.deviceId}`);
  console.log(`║ Launch    : ${launchCode ?? 'n/a'}`);
  console.log('╚═══════════════════════════════════════╝');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return res.status(200).json({
    ok: true,
    displayName,
    accountId: account_id,
    deviceId: deviceData.deviceId,
    launchCode: launchCode ?? null,
  });
}
