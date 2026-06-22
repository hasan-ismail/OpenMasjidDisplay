/**
 * OpenMasjidOS Fabric — single sign-on (optional, server→server).
 *
 * The Fabric is the platform↔app integration layer (appearance + SSO). When this
 * app runs under OpenMasjidOS, the platform injects OPENMASJID_BASE_URL and a
 * per-app OPENMASJID_APP_SECRET, and the browser also sends the platform's
 * `omos_session` cookie to us (same host, different port = same-site). We never
 * trust that cookie ourselves — we ask the platform to validate it.
 *
 * SSO is IDENTITY-BOUND: the platform fails closed unless we present our per-app
 * secret in the X-OpenMasjid-App-Secret header, so the shared session cookie can't
 * let some other installed app validate (or impersonate) the session as us. A
 * positive result is cached briefly per token so we don't call on every request.
 *
 * Everything here degrades gracefully: no base URL, no secret, no cookie, or an
 * unreachable platform all simply mean "no SSO", and the app falls back to its own
 * password. The wire identifiers (env vars, header, cookie, endpoint) are the
 * shared Fabric contract — do not rename them. See docs/FABRIC.md.
 */
import type { IncomingMessage } from 'node:http';
import { config } from './config';
import { makeLog } from './logger';

const log = makeLog('fabric');

/** Is Fabric SSO even possible? Needs the platform's address AND our per-app
 *  secret — without the secret the identity-bound platform fails closed, so we
 *  treat SSO as unavailable and fall back to our own login. */
export function ssoConfigured(): boolean {
  return !!config.omosBaseUrl && !!config.omosAppSecret;
}

export interface NotifyPayload {
  text: string;
  title?: string;
  level?: 'info' | 'success' | 'warning' | 'error';
}

/**
 * Relay a message to the masjid's configured webhook via the Fabric (server→server,
 * authenticated with our per-app secret). The platform owns the destination — we
 * never see the webhook URL — and it requires the notifications capability
 * (manifest `notifications: true`). FAILS SOFT: no platform, no secret, the admin
 * hasn't enabled notifications, or any error → returns delivered:false and the app
 * carries on. Never throws. See docs/FABRIC.md.
 */
export async function notify(payload: NotifyPayload): Promise<{ delivered: boolean; reason?: string }> {
  if (!config.omosBaseUrl || !config.omosAppSecret) return { delivered: false, reason: 'no-fabric' };
  if (!payload.text?.trim()) return { delivered: false, reason: 'empty' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${config.omosBaseUrl}/api/fabric/notify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openmasjid-app-secret': config.omosAppSecret,
      },
      body: JSON.stringify({ text: payload.text, title: payload.title, level: payload.level ?? 'info' }),
      signal: ctrl.signal,
      redirect: 'error',
    });
    clearTimeout(t);
    if (!res.ok) {
      log.warn(`Fabric notify not delivered: platform returned HTTP ${res.status} (is this app allowed to send notifications, and updated in OpenMasjidOS?)`);
      return { delivered: false, reason: `http_${res.status}` };
    }
    const j = (await res.json().catch(() => ({}))) as { delivered?: boolean; reason?: string };
    if (j.delivered !== true) {
      log.warn(`Fabric notify not delivered (reason: ${j.reason ?? 'unknown'}) — e.g. notifications not enabled in OpenMasjidOS Settings.`);
    }
    return { delivered: j.delivered === true, reason: j.reason };
  } catch (err) {
    log.warn(`Fabric notify could not reach the platform at ${config.omosBaseUrl || '(unset)'}: ${err instanceof Error ? err.message : err}`);
    return { delivered: false, reason: 'unreachable' };
  }
}

/** Pull the platform's session token out of the request's Cookie header. */
function omosCookie(req: IncomingMessage): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const m = /(?:^|;\s*)omos_session=([^;]+)/.exec(raw);
  if (!m) return null;
  const token = m[1].trim();
  // Only forward a token that looks like a cookie value, so nothing odd can be
  // injected into the outbound Cookie header we send to the platform.
  return /^[A-Za-z0-9._~%+/=-]{1,4096}$/.test(token) ? token : null;
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
  if (!config.omosBaseUrl || !config.omosAppSecret) return null;
  const token = omosCookie(req);
  if (!token) return null;

  const cached = positiveCache.get(token);
  if (cached && cached.expires > nowMs()) return cached.username;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${config.omosBaseUrl}/api/auth/session`, {
      headers: {
        cookie: `omos_session=${token}`,
        // Identity-bound SSO: prove which app is asking. Without this the platform
        // (v0.19+) fails closed. A credential — never logged.
        'x-openmasjid-app-secret': config.omosAppSecret,
      },
      signal: ctrl.signal,
      redirect: 'error', // don't follow a redirect to some other (internal) host
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as { authenticated?: boolean; username?: unknown };
    if (j.authenticated === true) {
      const username = (typeof j.username === 'string' ? j.username : '').trim().slice(0, 64) || 'OpenMasjidOS';
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
