/**
 * In-memory state store shared across the /start and /callback handlers.
 *
 * Vercel serverless functions CAN share module-level state within the same
 * runtime instance (warm lambda). For a short-lived test this is fine —
 * state expires in 10 minutes and we only need one round-trip per test.
 *
 * State structure: Map<state_token, { discordId, createdAt }>
 */

export const pendingStates = new Map();

/**
 * Store a new state → discordId mapping.
 * Cleans up entries older than 10 minutes automatically.
 */
export function storeState(state, discordId) {
  // Clean expired entries
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pendingStates) {
    if (v.createdAt < cutoff) pendingStates.delete(k);
  }
  pendingStates.set(state, { discordId, createdAt: Date.now() });
  console.log(`[STATE] stored state=${state} for discordId=${discordId} | total pending: ${pendingStates.size}`);
}

/**
 * Consume a state token (one-time use).
 * Returns { discordId } or null if not found / expired.
 */
export function consumeState(state) {
  const entry = pendingStates.get(state);
  if (!entry) {
    console.warn(`[STATE] consume miss — state=${state} not found`);
    return null;
  }
  if (Date.now() - entry.createdAt > 10 * 60 * 1000) {
    console.warn(`[STATE] consume miss — state=${state} expired`);
    pendingStates.delete(state);
    return null;
  }
  pendingStates.delete(state);
  console.log(`[STATE] consumed state=${state} → discordId=${entry.discordId}`);
  return entry;
}
