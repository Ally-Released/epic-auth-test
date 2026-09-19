/**
 * _state.js — Shared in-memory store
 *
 * sessions Map:  token → { discordId, createdAt, sseRes, code, result }
 *
 * When Person B delivers the code via /deliver:
 *   - If Person A's SSE is connected → push immediately
 *   - If not yet connected → store, push when they connect
 */

export const sessions = new Map();

const TTL_MS = 10 * 60 * 1000; // 10 minutes

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of sessions) {
    if (v.createdAt < cutoff) sessions.delete(k);
  }
}

export function createSession(token, discordId) {
  prune();
  sessions.set(token, {
    discordId,
    createdAt: Date.now(),
    sseRes: null,
    code: null,
    result: null,
  });
  console.log(`[STATE] created  token=${token.slice(0,8)} discordId=${discordId}`);
}

export function attachSSE(token, sseRes) {
  const s = sessions.get(token);
  if (!s) return false;
  s.sseRes = sseRes;
  // Code already arrived before SSE connected — flush now
  if (s.code) {
    pushToSSE(sseRes, 'code', s.result || { code: s.code });
    sessions.delete(token);
  }
  return true;
}

/**
 * @param {string} token
 * @param {string} code          - raw 32-char auth code
 * @param {object} [result=null] - enriched result from runChain
 */
export function deliverCode(token, code, result = null) {
  const s = sessions.get(token);
  if (!s) {
    console.warn(`[STATE] deliverCode miss token=${token.slice(0,8)}`);
    return false;
  }
  s.code   = code;
  s.result = result ? { code, ...result } : { code };

  console.log(`[STATE] deliverCode token=${token.slice(0,8)} code=${code}`);

  if (s.sseRes) {
    pushToSSE(s.sseRes, 'code', s.result);
    sessions.delete(token);
  }
  // else stored — will be flushed when SSE connects
  return true;
}

export function getSession(token) {
  return sessions.get(token) || null;
}

export function pushToSSE(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {}
}
