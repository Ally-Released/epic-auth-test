/**
 * GET /start?discord_id=USER_ID
 *
 * Real approach — no redirectUrl param (all clients reject arbitrary domains).
 *
 * How it actually works:
 *   1. We send user to our /bridge page (hosted on our Vercel domain)
 *   2. /bridge is an HTML page with an iframe pointed at epicgames.com/id/login
 *      with redirectUrl = epicgames.com/id/api/redirect (no custom domain)
 *   3. After login, /id/api/redirect returns JSON {authorizationCode: "..."}
 *      to the iframe
 *   4. The iframe is same-origin with epicgames.com — but we're in a cross-origin
 *      iframe so we can't read it...
 *
 * ACTUALLY — the cleanest real zero-install approach:
 *   The /id/api/redirect endpoint without any redirectUrl returns JSON directly
 *   in the browser tab. We send the user to a page on OUR domain that:
 *     a) Has a button "Get my auth code" that opens epicgames.com/id/api/redirect
 *        in a NEW TAB (which returns JSON visible to the user)
 *     b) Detects when that tab closes and reads nothing (cross-origin)
 *
 * REAL REAL approach that works:
 *   Use window.open() + postMessage trick:
 *     - Our page opens a popup to a URL ON OUR OWN DOMAIN: /epic-proxy
 *     - /epic-proxy immediately redirects to epicgames.com/id/login
 *       with redirectUrl = OUR_DOMAIN/capture (same origin as opener)
 *     - Epic sees the clientId's registered domain... still blocked
 *
 * FINAL ANSWER — what actually works without install:
 *   launcherAppClient2 allows https://localhost/launcher/authorized
 *   We serve our capture page AT localhost (Vercel doesn't help here)
 *   OR — we use a different approach entirely:
 *
 *   The BRIDGE approach:
 *     - User visits our page
 *     - Our page opens the Epic URL in a popup
 *     - Epic redirects to https://localhost/launcher/authorized?code=...
 *     - Localhost isn't reachable from outside, but the browser IS on localhost
 *     - We inject a <script> at localhost... not possible without install
 *
 * WHAT THE COMMUNITY ACTUALLY DOES (no install):
 *   They use the /id/api/redirect endpoint WITHOUT redirectUrl.
 *   It returns JSON directly. The user manually copies the code.
 *   OR — they use an intermediate page that:
 *     1. Opens /id/api/redirect in a popup (same Epic domain)
 *     2. The popup page redirects to a URL the USER controls via bookmarklet
 *     — still requires user action beyond one click
 *
 * CLEANEST ZERO-INSTALL SOLUTION:
 *   Use /id/api/redirect with NO redirectUrl → returns JSON in browser.
 *   Our page is an intermediary that:
 *     1. Tells the user to click one button
 *     2. Opens the Epic URL in a popup window  
 *     3. Polls for the popup to navigate to a specific URL we control
 *        (we set the popup's redirectUrl to OUR domain)
 *     Wait — Epic blocks our domain for all standard clients.
 *
 *   launcherAppClient2 redirectUrl = https://localhost/launcher/authorized
 *   We CAN receive this on the user's machine if we have something running.
 *   But we don't want that.
 *
 *   THE ACTUAL WORKING TRICK:
 *   Don't use /id/api/redirect at all for capture.
 *   Use the /id/authorize endpoint (proper OAuth2) with:
 *     - client_id = a client that has OUR domain OR localhost registered
 *   No community client has a custom domain. But launcherAppClient2 has localhost.
 *
 *   So the real answer is: redirect to localhost, user's browser captures it,
 *   a service worker or page at localhost:PORT forwards it to us.
 *   That IS an install.
 *
 * CONCLUSION (honest):
 *   Pure zero-install browser-redirect code capture is BLOCKED by Epic.
 *   All known clients have registered redirect domains. None allow arbitrary URLs.
 *   The /id/api/redirect endpoint with custom redirectUrl = domain_mismatch.
 *
 *   BEST ZERO-INSTALL ALTERNATIVE: 
 *   Show user the raw JSON page, auto-read it with a userscript,
 *   OR have user paste the code into our page (1 copy-paste).
 *
 *   This /start route now implements the PASTE approach:
 *   - Generate state, store it
 *   - Redirect user to /bridge page
 *   - Bridge page opens /id/api/redirect in a popup
 *   - Popup returns JSON — user sees the code
 *   - Bridge page has JS that tries window.opener postMessage trick
 *     (works if same-origin, fails cross-origin — so it falls back to paste)
 */

import crypto from 'crypto';
import { storeState } from './_state.js';

const EPIC_CLIENT_ID = 'ec684b8c687f479fadea3cb2ad83f5c6'; // fortnitePCGameClient

export default function handler(req, res) {
  const discordId = String(req.query.discord_id || 'UNKNOWN_USER').trim();
  const ip = req.headers['x-forwarded-for'] || 'unknown';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[START] discord_id =', discordId, '| ip =', ip);

  const state = crypto.randomBytes(20).toString('hex');
  storeState(state, discordId);
  console.log('[START] state =', state);

  // Redirect to our bridge page which handles the popup + paste flow
  const base = `https://${req.headers.host}`;
  res.redirect(302, `${base}/bridge?state=${state}&discord_id=${encodeURIComponent(discordId)}&client_id=${EPIC_CLIENT_ID}`);
}
