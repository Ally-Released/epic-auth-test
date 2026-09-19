/**
 * GET /status?t=TOKEN
 * Person A's page polls this every 2 seconds.
 * Returns the current session state from Supabase.
 */
import { getSession } from './_db.js';

export default async function handler(req, res) {
  const token = String(req.query.t || '').trim();
  if (!token) return res.status(400).json({ error: 'no-token' });

  const s = await getSession(token);
  if (!s) return res.status(410).json({ status: 'expired' });

  return res.status(200).json({
    status: s.status,
    code:   s.code   || null,
    result: s.result || null,
  });
}
