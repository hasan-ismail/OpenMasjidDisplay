// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Minimal leveled logger. Never logs secrets. */
type Level = 'info' | 'warn' | 'error' | 'debug';

const DEBUG = process.env.OMD_DEBUG === '1';

function line(level: Level, scope: string, msg: string): string {
  const ts = new Date().toISOString();
  return `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
}

export function makeLog(scope: string) {
  return {
    info: (msg: string) => console.log(line('info', scope, msg)),
    warn: (msg: string) => console.warn(line('warn', scope, msg)),
    error: (msg: string, err?: unknown) =>
      console.error(line('error', scope, msg + (err ? ` — ${errText(err)}` : ''))),
    debug: (msg: string) => {
      if (DEBUG) console.log(line('debug', scope, msg));
    },
  };
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return 'unknown error';
  }
}
