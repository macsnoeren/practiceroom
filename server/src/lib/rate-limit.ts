import { env } from '../env.js';

/**
 * Route option that applies a stricter rate limit to sensitive endpoints
 * (credentials, pairing) to slow brute-force/abuse. The global limiter still
 * applies to everything else. Relaxed under test so suites with many logins
 * don't trip it.
 */
export const sensitiveRateLimit = {
  config: { rateLimit: { max: env.NODE_ENV === 'test' ? 10_000 : 10, timeWindow: '1 minute' } },
};
