/**
 * OpenMasjidOS single sign-on (optional, server→server).
 *
 * When this app runs as an OpenMasjidOS app, the platform injects
 * OPENMASJID_BASE_URL and the browser also sends the platform's `omos_session`
 * cookie to us (same host, different port = same-site). We never trust that
 * cookie ourselves — we ask the platform to validate it. A positive result is
 * cached briefly per token so we don't call the platform on every request.
 *
 * Everything here degrades gracefully: no base URL, no cookie, or an unreachable
 * platform all simply mean "no SSO", and the app falls back to its own password.
 * See docs/PLATFORM_INTEGRATION.md.
 */
import type { IncomingMessage } from 'node:http';
import { config } from './config';
import { makeLog } from './logger';

const log = makeLog('omos');

/** Is platform SSO even possible (are we running under OpenMasjidOS)? */
export function ssoConfigured(): boolean {
  return !!config.omosBaseUrl;
}

/** Pull the platform's session token out of the request's Cookie header. */
function omosCookie(req: IncomingMessage): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const m = /(?:^|;\s*)omos_session=([^;]+)/.exec(raw);
  return m ? m[1] : null;
}

interface CacheEntry {
  username: string;
  expires: number;
}
const positiveCache = new Map<string, CacheEntry>();
const CACHE_MS = 45_000;

function nowMs(): number {
  return Date.now();
}

/**
 * Returns the platform username if the request carries a session the platform
 * confirms, or null otherwise. Only ever validates the cookie actually present
 * on THIS request (never a client-supplied username).
 */
export async function platformUser(req: IncomingMessage): Promise<string | null> {
  if (!config.omosBaseUrl) return null;
  const token = omosCookie(req);
  if (!token) return null;

  const cached = positiveCache.get(token);
  if (cached && cached.expires > nowMs()) return cached.username;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${config.omosBaseUrl}/api/auth/session`, {
      headers: { cookie: `omos_session=${token}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as { authenticated?: boolean; username?: string };
    if (j.authenticated) {
      const username = String(j.username ?? 'OpenMasjidOS');
      positiveCache.set(token, { username, expires: nowMs() + CACHE_MS });
      // Keep the cache from growing without bound on a busy panel.
      if (positiveCache.size > 256) {
        for (const [k, v] of positiveCache) if (v.expires <= nowMs()) positiveCache.delete(k);
      }
      return username;
    }
    return null;
  } catch (err) {
    log.debug(`platform session check failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
