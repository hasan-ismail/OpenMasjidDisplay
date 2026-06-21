/** Single-admin auth: a signed, HTTP-only session cookie. When no password is
 *  configured the control panel is open (the UI shows a warning). */
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from './config';

const COOKIE = 'omd_session';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export function authEnabled(): boolean {
  return config.adminPassword.length > 0;
}

function hmac(secret: Buffer, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function makeToken(secret: Buffer): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE_MS })).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

function verify(secret: Buffer, token: string): boolean {
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

export function checkPassword(input: string): boolean {
  const a = Buffer.from(String(input ?? ''));
  const b = Buffer.from(config.adminPassword);
  // Constant-time compare (lengths may differ; timingSafeEqual needs equal len).
  const max = Math.max(a.length, b.length, 1);
  const pa = Buffer.alloc(max);
  const pb = Buffer.alloc(max);
  a.copy(pa);
  b.copy(pb);
  return crypto.timingSafeEqual(pa, pb) && a.length === b.length;
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

export function isAuthed(req: IncomingMessage, secret: Buffer): boolean {
  if (!authEnabled()) return true;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  return !!token && verify(secret, token);
}

export function setCookieHeader(token: string): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`;
}

export function clearCookieHeader(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
