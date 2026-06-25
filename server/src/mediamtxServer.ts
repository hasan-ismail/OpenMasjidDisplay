// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Supervises the embedded MediaMTX process.
 *
 * The RTSP server now runs INSIDE this same container, so a masjid installs and
 * updates exactly one thing. We launch MediaMTX as a child process, stream its
 * logs through ours, restart it (with backoff) if it ever exits unexpectedly,
 * and shut it down cleanly when the app stops.
 *
 * For local development you usually run your own MediaMTX — set
 * MEDIAMTX_MANAGED=no to disable the embedded one.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { config } from './config';
import { makeLog } from './logger';

const log = makeLog('mediamtx-proc');

export class MediaMtxServer {
  private proc: ChildProcess | null = null;
  private stopped = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private steadyTimer: NodeJS.Timeout | null = null;
  private backoffMs = 500;

  /** Launch MediaMTX (unless disabled / not installed). Safe to call once. */
  start(): void {
    if (!config.mediamtxManaged) {
      log.info('embedded MediaMTX disabled (MEDIAMTX_MANAGED=no); expecting an external server');
      return;
    }
    if (!fs.existsSync(config.mediamtxConfig)) {
      log.warn(
        `MediaMTX config not found at ${config.mediamtxConfig}; not starting the embedded RTSP server`,
      );
      return;
    }
    this.spawnOnce();
  }

  private spawnOnce(): void {
    if (this.stopped) return;
    log.info('starting embedded MediaMTX (RTSP server)');
    let proc: ChildProcess;
    try {
      // MediaMTX logs straight to our stdout/stderr ("inherit"), so its output
      // shows up in `docker logs` alongside the app's.
      proc = spawn(config.mediamtxBin, [config.mediamtxConfig], { stdio: 'inherit' });
    } catch (err) {
      log.error('could not launch MediaMTX', err);
      this.scheduleRestart();
      return;
    }
    this.proc = proc;

    proc.on('error', (err) => {
      if (this.stopped || this.proc !== proc) return;
      log.error('MediaMTX process error', err);
      this.proc = null;
      this.scheduleRestart();
    });
    proc.on('exit', (code, signal) => {
      if (this.stopped || this.proc !== proc) return;
      log.warn(`MediaMTX exited (code=${code ?? 'null'} signal=${signal ?? 'none'}); restarting`);
      this.proc = null;
      this.scheduleRestart();
    });

    // Once it has stayed up for a while, reset the restart backoff.
    this.steadyTimer = setTimeout(() => {
      if (this.proc === proc) this.backoffMs = 500;
    }, 10_000);
  }

  private scheduleRestart(): void {
    if (this.stopped || this.restartTimer) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 10_000);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnOnce();
    }, wait);
  }

  /** Stop MediaMTX and prevent any further restarts. */
  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.steadyTimer) clearTimeout(this.steadyTimer);
    this.restartTimer = null;
    this.steadyTimer = null;
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      this.proc = null;
    }
  }
}
