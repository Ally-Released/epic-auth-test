/**
 * GET /status?t=TOKEN
 * Person A's page polls this every 2 seconds.
 * No-cache headers so Vercel/CDN never serves a stale response.
 */
import { getSession } from './_db.js';

export default async function handler(req, res) {
  const token = String(req.query.t || '').trim();
  if (!token) return res.status(400).json({ error: 'no-token' });

  // Kill all caching — every poll must hit the DB
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  const s = await getSession(token);
  if (!s) return res.status(200).json({ status: 'expired' });

  return res.status(200).json({
    status: s.status,
    code:   s.code   || null,
    result: s.result || null,
  });
}
