/**
 * GET /start?discord_id=USER_ID
 *
 * Entry point. Generates a state token, builds the magic Epic redirect URL,
 * and sends the user's browser to Epic Games.
 *
 * Everything is logged — check Vercel function logs.
 * No DB. No installs. Pure browser redirect.
 */

import crypto from 'crypto';
import { storeState } from './_state.js';

// fortniteAndroidGameClient — can create device auth via the account endpoint
const EPIC_CLIENT_ID = '3f69e56c7649492c8cc29f1af08a8a12';

export default function handler(req, res) {
  const discordId = String(req.query.discord_id || 'UNKNOWN_USER').trim();
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[START] New auth attempt');
  console.log(`[START] discord_id = ${discordId}`);
  console.log(`[START] ip         = ${ip}`);
  console.log(`[START] user-agent = ${req.headers['user-agent']}`);

  // Generate a cryptographically random state token
  // This is how we know which Discord user the Epic callback belongs to
  const state = crypto.randomBytes(20).toString('hex'); // 40-char hex
  storeState(state, discordId);

  // The callback URL — must be publicly reachable (Vercel gives us this automatically)
  const base = `https://${req.headers.host}`;
  const callbackUrl = `${base}/callback`;

  // Build the nested redirect:
  //
  //  epicgames.com/id/login
  //    ?redirectUrl=
  //      epicgames.com/id/api/redirect        ← Epic's own redirect endpoint
  //        ?clientId=3f69e56c...              ← identifies which app is requesting
  //        &responseType=code                 ← "give me an auth code not a session"
  //        &redirectUrl=OUR_CALLBACK          ← where Epic sends the code
  //        &state=STATE_TOKEN                 ← passed through so we know the user
  //
  // What Epic does:
  //   1. Checks if user is logged in (session cookie in their browser)
  //   2. If not → shows login page, then continues
  //   3. /id/api/redirect sees its own redirectUrl param
  //   4. Instead of returning JSON, does 302 → OUR_CALLBACK?code=AUTH_CODE&state=STATE

  const innerRedirect = new URL('https://www.epicgames.com/id/api/redirect');
  innerRedirect.searchParams.set('clientId', EPIC_CLIENT_ID);
  innerRedirect.searchParams.set('responseType', 'code');
  innerRedirect.searchParams.set('redirectUrl', callbackUrl);
  innerRedirect.searchParams.set('state', state);

  const epicLoginUrl = new URL('https://www.epicgames.com/id/login');
  epicLoginUrl.searchParams.set('redirectUrl', innerRedirect.toString());

  const finalUrl = epicLoginUrl.toString();

  console.log(`[START] callback URL = ${callbackUrl}`);
  console.log(`[START] state token  = ${state}`);
  console.log(`[START] inner redirect URL:`);
  console.log(`        ${innerRedirect.toString()}`);
  console.log(`[START] final Epic login URL:`);
  console.log(`        ${finalUrl}`);
  console.log('[START] Redirecting browser to Epic...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Redirect the user's browser to Epic
  res.redirect(302, finalUrl);
}
