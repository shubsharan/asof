import Exa from "exa-js";

export const exa = new Exa(Bun.env.EXA_API_KEY);

/**
 * Retries a call that hit Exa's per-second rate limit (429), backing off with jitter; other errors
 * pass through. Parallel backfills share one limit across every process.
 */
export async function withRateLimitRetry<T>(call: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (e) {
      if (i >= attempts || (e as { statusCode?: number }).statusCode !== 429) throw e;
      await Bun.sleep(1000 * i + Math.random() * 1000);
    }
  }
}
