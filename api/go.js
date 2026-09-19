/**
 * GET /go/:token   (routed from /go/*)
 * Person B lands here. Marks session as 'clicked', redirects to /pop/:token.
 */
import { getSession, setStatus } from './_db.js';

export default async function handler(req, res) {
  const token = String(req.url.split('/go/')[1] || '').split('?')[0].trim();

  const s = await getSession(token);
  if (!s || s.status === 'done') {
    res.setHeader('Content-Type', 'text/html');
    return res.status(410).send(`<!DOCTYPE html><html><head><title>Expired</title>
<style>body{background:#080808;color:#888;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;}</style>
</head><body><p>This link has expired or already been used.<br>Ask for a new one.</p></body></html>`);
  }

  await setStatus(token, 'clicked');
  console.log(`[GO] token=${token.slice(0,8)} clicked, redirecting to /pop`);

  const base = `https://${req.headers.host}`;
  res.setHeader('Location', `${base}/pop/${token}`);
  res.status(302).end();
}
