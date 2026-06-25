// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * A tiny in-memory failed-attempt limiter for the login endpoints. Keyed by client
 * IP, with exponential backoff after a few failures and a temporary lockout. This is
 * the real defence behind the short admin password / 4-digit volunteer PIN — without
 * it those credentials are trivially brute-forced over the LAN.
 */
import type { IncomingMessage } from 'node:http';

interface Entry {
  fails: number;
  lockedUntil: number;
}

const MAX_FREE = 5; // attempts before backoff kicks in
const BASE_MS = 2000; // first lockout step
const MAX_MS = 5 * 60 * 1000; // cap a single lockout at 5 minutes

export class LoginLimiter {
  private readonly map = new Map<string, Entry>();
  private readonly sweep: NodeJS.Timeout;

  constructor() {
    // Drop stale entries periodically so the map can't grow unbounded.
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const [k, e] of this.map) if (e.lockedUntil < now - 3_600_000 && e.fails === 0) this.map.delete(k);
    }, 10 * 60 * 1000);
    this.sweep.unref?.();
  }

  private key(req: IncomingMessage): string {
    return req.socket.remoteAddress || 'unknown';
  }

  /** ms the caller must wait before another attempt (0 = allowed now). */
  retryAfterMs(req: IncomingMessage): number {
    const e = this.map.get(this.key(req));
    if (!e) return 0;
    const left = e.lockedUntil - Date.now();
    return left > 0 ? left : 0;
  }

  fail(req: IncomingMessage): void {
    const k = this.key(req);
    const e = this.map.get(k) ?? { fails: 0, lockedUntil: 0 };
    e.fails += 1;
    if (e.fails > MAX_FREE) {
      const step = Math.min(MAX_MS, BASE_MS * 2 ** (e.fails - MAX_FREE - 1));
      e.lockedUntil = Date.now() + step;
    }
    this.map.set(k, e);
  }

  succeed(req: IncomingMessage): void {
    this.map.delete(this.key(req));
  }
}
