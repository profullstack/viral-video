/**
 * c0mpute first, the library's own vendor code second.
 *
 * Text generation goes to the c0mpute peer network through
 * @profullstack/ai-providers. When c0mpute fails (no node, timeout, free tier
 * used up), the caller runs its existing OpenAI code exactly as before, so a
 * failure on both looks the same as a failure did before c0mpute.
 *
 *   C0MPUTE_API_KEY     Infernet account key (ik_live_...). Without one the
 *                       network still answers, on a free tier of 10 calls a day.
 *   C0MPUTE_TIMEOUT_MS  whole call. c0mpute runs at a few tokens a second, so
 *                       a 60-second script can take several minutes.
 *   C0MPUTE_DISABLED    1 skips c0mpute entirely
 */
import { createAiProviders } from "@profullstack/ai-providers";

const ON = /^(1|true|yes|on)$/i;
const routers = new Map();

/** True when C0MPUTE_DISABLED turns c0mpute off. */
export const isC0mputeDisabled = (env = process.env) =>
  ON.test(env.C0MPUTE_DISABLED ?? "");

/**
 * A c0mpute-only router (no paid fallback inside it: the library keeps its
 * own), or null when c0mpute is disabled. One router per key and timeout, so
 * the concurrency cap and parking cover every call in the process.
 * @param {object} [opts]
 * @param {string} [opts.apiKey] overrides C0MPUTE_API_KEY
 * @param {number} [opts.defaultTimeoutMs] used when C0MPUTE_TIMEOUT_MS is unset
 * @param {Record<string, string|undefined>} [opts.env]
 */
export const createC0mpute = ({
  apiKey,
  defaultTimeoutMs,
  env = process.env,
} = {}) => {
  if (isC0mputeDisabled(env)) return null;
  const key = apiKey || env.C0MPUTE_API_KEY || env.INFERNET_API_KEY || "";
  const timeoutMs = env.C0MPUTE_TIMEOUT_MS ? undefined : defaultTimeoutMs;
  const id = `${key}\0${timeoutMs ?? ""}`;
  if (!routers.has(id)) {
    routers.set(
      id,
      createAiProviders({
        env: { ...env, C0MPUTE_API_KEY: key },
        paidFallback: false,
        c0mpute: timeoutMs ? { timeoutMs } : {},
      }),
    );
  }
  return routers.get(id);
};
