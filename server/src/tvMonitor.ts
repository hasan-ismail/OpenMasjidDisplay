/**
 * Screen (decoder) reachability monitor.
 *
 * Each screen can carry the IP/hostname of its RTSP decoder box. Every 30s we probe
 * it; after 3 consecutive failures (~90s) the screen is considered OFFLINE and we
 * relay an alert to the masjid through the OpenMasjidOS Fabric, and another when it
 * comes back. The Fabric call fails soft (no webhook / standalone install = no-op),
 * so monitoring never affects streaming.
 *
 * We probe with a plain TCP connect (no ICMP) because the container runs
 * least-privilege — no NET_RAW, no `ping` binary assumed. A host that is UP answers
 * a TCP SYN with either a SYN-ACK (port open) or a RST (port closed) almost
 * instantly; only an unreachable host stays silent until timeout. So "connected OR
 * refused = online, timeout/unreachable = offline" reliably distinguishes the two on
 * a LAN without needing to know which port the decoder listens on.
 */
import net from 'node:net';
import type { Tv } from './types';
import { makeLog } from './logger';
import type { NotifyPayload } from './fabric';

const log = makeLog('tvmon');

const PROBE_PORTS = [80, 443, 8080, 554]; // any response on any of these ⇒ host up
const PROBE_TIMEOUT_MS = 4000;
const INTERVAL_MS = 30_000;
const FAILS_TO_OFFLINE = 3;

/** One TCP connect attempt → resolves true if the host answered (open or refused). */
function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (up: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(up);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true)); // port open ⇒ host up
    sock.once('timeout', () => finish(false)); // no reply ⇒ treat as unreachable
    sock.once('error', (e: NodeJS.ErrnoException) => {
      // A reset/refused means the host is reachable; only true unreachability is down.
      finish(e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET');
    });
    try {
      sock.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

/** Is the decoder reachable? Probe a few common ports in parallel; up if ANY answers. */
async function pingDecoder(host: string): Promise<boolean> {
  const results = await Promise.all(PROBE_PORTS.map((p) => tcpProbe(host, p, PROBE_TIMEOUT_MS)));
  return results.some(Boolean);
}

interface MonState {
  ip: string;
  failStreak: number;
  offline: boolean; // confirmed offline (≥3 fails) and already notified
}

export class TvMonitor {
  private states = new Map<string, MonState>();
  private timer: NodeJS.Timeout | null = null;
  /** Called when any screen's confirmed online/offline state changes (for the UI). */
  onChange: (() => void) | null = null;

  constructor(
    private readonly getTvs: () => Tv[],
    private readonly notify: (p: NotifyPayload) => unknown,
  ) {}

  /** Confirmed reachability for the live status: true/false, or undefined if the
   *  screen has no decoder IP (not monitored). */
  reachable(tvId: string): boolean | undefined {
    const st = this.states.get(tvId);
    return st ? !st.offline : undefined;
  }

  start(): void {
    if (this.timer) return;
    // A first probe shortly after boot so the UI has state without waiting 30s.
    setTimeout(() => void this.tick(), 4000);
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const tvs = this.getTvs().filter((t) => (t.decoderIp ?? '').trim());
    const present = new Set(tvs.map((t) => t.id));
    for (const id of [...this.states.keys()]) if (!present.has(id)) this.states.delete(id);

    let changed = false;
    await Promise.all(
      tvs.map(async (tv) => {
        const ip = (tv.decoderIp ?? '').trim();
        let st = this.states.get(tv.id);
        if (!st || st.ip !== ip) {
          st = { ip, failStreak: 0, offline: false }; // reset when the IP changes
          this.states.set(tv.id, st);
        }
        const up = await pingDecoder(ip);
        const name = (tv.name || 'Screen').slice(0, 60);
        if (up) {
          if (st.offline) {
            st.offline = false;
            changed = true;
            void this.notify({
              title: 'Screen back online',
              text: `✅ "${name}" is reachable again (${ip}).`,
              level: 'success',
            });
            log.info(`screen "${name}" back online (${ip})`);
          }
          st.failStreak = 0;
        } else {
          st.failStreak++;
          if (st.failStreak >= FAILS_TO_OFFLINE && !st.offline) {
            st.offline = true;
            changed = true;
            void this.notify({
              title: 'Screen offline',
              text: `📺 "${name}" hasn't responded for about 90 seconds — the screen or its decoder may be turned off or disconnected (${ip}).`,
              level: 'warning',
            });
            log.warn(`screen "${name}" offline (${ip})`);
          }
        }
      }),
    );
    if (changed) this.onChange?.();
  }
}
