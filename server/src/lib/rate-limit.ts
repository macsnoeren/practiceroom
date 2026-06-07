/**
 * Route option that applies a stricter rate limit to sensitive endpoints
 * (credentials, pairing) to slow brute-force/abuse. The global limiter still
 * applies to everything else.
 */
export const sensitiveRateLimit = {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
};
