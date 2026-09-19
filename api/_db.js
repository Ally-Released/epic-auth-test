/**
 * _db.js — Supabase state (replaces in-memory _state.js)
 *
 * Uses a single table: epic_auth_sessions
 *   token TEXT PRIMARY KEY
 *   discord_id TEXT
 *   status TEXT  ('pending' | 'clicked' | 'done' | 'error')
 *   code TEXT
 *   result JSONB
 *   created_at TIMESTAMPTZ DEFAULT now()
 *
 * No SDK needed — plain HTTPS fetch to Supabase REST API.
 * Every Vercel function instance can read/write it independently.
 */

const SUPA_URL  = process.env.SUPABASE_URL;
const SUPA_KEY  = process.env.SUPABASE_SERVICE_KEY; // service role
const TABLE     = 'epic_auth_sessions';
const BASE      = `${SUPA_URL}/rest/v1/${TABLE}`;

function headers(extra = {}) {
  return {
    'apikey':        SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
    ...extra,
  };
}

async function supaFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...headers(), ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

export async function createSession(token, discordId) {
  const r = await supaFetch('', {
    method: 'POST',
    body: JSON.stringify({
      token,
      discord_id: discordId,
      status: 'pending',
      code: null,
      result: null,
    }),
  });
  console.log('[DB] createSession', token.slice(0,8), r.status);
  return r.status < 300;
}

export async function getSession(token) {
  const r = await supaFetch(`?token=eq.${token}&limit=1`);
  if (r.status !== 200) return null;
  const rows = Array.isArray(r.body) ? r.body : [];
  return rows[0] || null;
}

export async function setStatus(token, status) {
  const r = await supaFetch(`?token=eq.${token}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  console.log('[DB] setStatus', token.slice(0,8), status, r.status);
  return r.status < 300;
}

export async function deliverCode(token, code, result = null) {
  const r = await supaFetch(`?token=eq.${token}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done', code, result }),
  });
  console.log('[DB] deliverCode', token.slice(0,8), code, r.status);
  return r.status < 300;
}

export async function deleteSession(token) {
  await supaFetch(`?token=eq.${token}`, { method: 'DELETE' });
}
