/** Tunable timing and gossip parameters of the node engine. */
export const NODE_PARAMS = {
  LISTEN_BEFORE_MS: 200,
  JITTER_MS: 400,
  BACKOFF_MIN_MS: 500,
  BACKOFF_MAX_MS: 3000,
  MAX_BACKOFFS: 20,
  DEAF_TAIL_MS: 150,
  TRICKLE_IMIN_MS: 10_000,
  TRICKLE_IMAX_MS: 60_000,
  TRICKLE_K: 2,
  SWEEP_MS: 10_000,
};
