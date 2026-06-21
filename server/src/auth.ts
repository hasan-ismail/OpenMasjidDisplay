/** Single-admin auth. The admin account is created in-app on first run (no
 *  install-time password). Password is stored as a scrypt hash in the data
 *  volume; the session is a signed, HTTP-only cookie. */
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const COOKIE = 'omd_session';
const VOL_COOKIE = 'omd_vol';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const VOL_MAX_AGE_MS = 12 * 3600 * 1000; // volunteer sessions are short-lived

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(password, salt, 32);
  return { hash: dk.toString('hex'), salt: salt.toString('hex') };
}

export function verifyPassword(password: string, cred: { hash: string; salt: string }): boolean {
  try {
    const dk = crypto.scryptSync(password, Buffer.from(cred.salt, 'hex'), 32);
    const stored = Buffer.from(cred.hash, 'hex');
    return stored.length === dk.length && crypto.timingSafeEqual(stored, dk);
  } catch {
    return false;
  }
}

function hmac(secret: Buffer, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function makeToken(secret: Buffer, maxAgeMs = MAX_AGE_MS): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + maxAgeMs })).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

function verifyToken(secret: Buffer, token: string): boolean {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(secret, payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number };
    return typeof obj.exp === 'number' && obj.exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** A valid, unexpired session cookie. (The caller separately checks that an
 *  admin account exists — before setup, nobody is authed.) */
export function hasValidSession(req: IncomingMessage, secret: Buffer): boolean {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  return !!token && verifyToken(secret, token);
}

export function setCookieHeader(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`;
}

export function clearCookieHeader(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// ── Volunteer session (separate cookie + scope from the admin) ────────────────
export function makeVolunteerToken(secret: Buffer): string {
  return makeToken(secret, VOL_MAX_AGE_MS);
}

export function hasValidVolunteerSession(req: IncomingMessage, secret: Buffer): boolean {
  const token = parseCookies(req.headers.cookie)[VOL_COOKIE];
  return !!token && verifyToken(secret, token);
}

export function setVolunteerCookieHeader(token: string): string {
  return `${VOL_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(VOL_MAX_AGE_MS / 1000)}`;
}

export function clearVolunteerCookieHeader(): string {
  return `${VOL_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
