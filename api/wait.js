/**
 * GET /wait/:token
 *
 * SSE endpoint. Person A's browser connects here and listens.
 * Stays open until the code arrives or 9 minutes pass (Vercel 10m limit).
 *
 * Events emitted:
 *   ping     — keepalive every 20s (prevents proxy/browser timeouts)
 *   clicked  — Person B opened the link
 *   code     — { code, displayName? } — the auth code arrived
 */

import { attachSSE, pushToSSE } from './_state.js';

export const config = { maxDuration: 55 }; // Vercel Pro allows up to 60s; hobby 10s

export default function handler(req, res) {
  const token = String(req.url.split('/').pop().split('?')[0]).trim();

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  console.log(`[WAIT] SSE connected token=${token.slice(0,8)}`);

  const ok = attachSSE(token, res);
  if (!ok) {
    pushToSSE(res, 'error', { reason: 'session-expired' });
    return res.end();
  }

  // Keepalive ping every 20s
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { clearInterval(ping); }
  }, 20_000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(ping);
    console.log(`[WAIT] SSE disconnected token=${token.slice(0,8)}`);
  });
}
