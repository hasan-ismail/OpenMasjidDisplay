/**
 * render/renderer.ts — manages the ffmpeg pipelines.
 *
 *  • TimetablePipeline: rasterizes the display SVG once per second (resvg) and
 *    pipes raw RGBA frames to ffmpeg, which encodes a steady low-fps H.264 RTSP
 *    stream published into MediaMTX. One per *active* timetable.
 *  • TranscodePipeline: pulls a camera/HDMI RTSP source and re-encodes it to a
 *    fixed H.264 geometry ("normalize" mode) for maximum TV-decoder compatibility.
 *
 * Pipelines self-heal: if ffmpeg exits unexpectedly it is respawned with backoff.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { config } from '../config';
import { makeLog } from '../logger';
import { fontOptions } from './fonts';
import { renderDisplaySvg, dimsFor, type Dims } from './svg';
import { backgroundDataUri } from './background';
import type { Timetable } from '../types';

const log = makeLog('render');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function levelFor(h: number): string {
  return h >= 1080 ? '4.0' : '3.1';
}

function timetableArgs(d: Dims, target: string): string[] {
  const br = d.height >= 1080 ? 3500 : 1800;
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${d.width}x${d.height}`, '-framerate', '1', '-i', 'pipe:0',
    '-vf', 'format=yuv420p,fps=15', '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-profile:v', 'baseline', '-level', levelFor(d.height),
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-bf', '0',
    '-x264-params', 'repeat-headers=1:nal-hrd=cbr',
    '-b:v', `${br}k`, '-maxrate', `${br}k`, '-bufsize', `${br}k`,
    '-an', '-f', 'rtsp', '-rtsp_transport', 'tcp', target,
  ];
}

function transcodeArgs(url: string, d: Dims, target: string): string[] {
  const br = d.height >= 1080 ? 4500 : 2500;
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-rtsp_transport', 'tcp', '-i', url,
    '-map', '0:v:0',
    '-vf', `scale=${d.width}:${d.height}:force_original_aspect_ratio=decrease,pad=${d.width}:${d.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fps=15`,
    '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-profile:v', 'main', '-level', levelFor(d.height),
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-bf', '0',
    '-x264-params', 'repeat-headers=1',
    '-b:v', `${br}k`, '-maxrate', `${br}k`, '-bufsize', `${br * 2}k`,
    '-an', '-f', 'rtsp', '-rtsp_transport', 'tcp', target,
  ];
}

/** Common ffmpeg lifecycle with self-healing restart. */
abstract class FfmpegPipeline {
  protected proc: ChildProcess | null = null;
  protected stopped = false;
  private stderrTail = '';
  private restartTimer: NodeJS.Timeout | null = null;

  protected constructor(protected readonly id: string) {}

  protected target(): string {
    return `${config.rtspInternal}/${this.id}`;
  }

  protected abstract args(): string[];
  /** Called right after spawn (e.g. to start the frame timer / write frames). */
  protected onSpawned(): void {}

  protected spawnProc(): void {
    if (this.stopped) return;
    const proc = spawn(FFMPEG, this.args(), { stdio: ['pipe', 'ignore', 'pipe'] });
    this.proc = proc;
    proc.stderr?.on('data', (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-600);
    });
    proc.on('error', (err) => log.error(`ffmpeg ${this.id} failed to start`, err));
    proc.on('exit', (code) => {
      // Ignore the exit of a process we've already replaced (e.g. a dims-change
      // SIGKILL): only the currently-tracked child may schedule a restart.
      if (this.stopped || this.proc !== proc) return;
      this.proc = null;
      if (this.stderrTail.trim()) log.debug(`ffmpeg ${this.id}: ${this.stderrTail.trim().split('\n').pop()}`);
      log.warn(`ffmpeg ${this.id} exited (code ${code}); restarting in 2s`);
      this.restartTimer = setTimeout(() => this.spawnProc(), 2000);
    });
    this.onSpawned();
  }

  protected clearRestart(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  start(): void {
    this.spawnProc();
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.proc) {
      try {
        this.proc.stdin?.end();
        this.proc.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      this.proc = null;
    }
  }
}

class TimetablePipeline extends FfmpegPipeline {
  private timer: NodeJS.Timeout | null = null;
  private dims: Dims;

  constructor(id: string, private readonly getTt: () => Timetable | undefined) {
    super(id);
    const tt = getTt();
    this.dims = tt ? dimsFor(tt.orientation, tt.quality) : { width: 1280, height: 720 };
  }

  protected args(): string[] {
    return timetableArgs(this.dims, this.target());
  }

  protected override onSpawned(): void {
    if (!this.timer) this.timer = setInterval(() => this.frame(), 1000);
    // Draw an immediate first frame so the stream comes up quickly.
    setImmediate(() => this.frame());
  }

  private frame(): void {
    if (this.stopped) return;
    const tt = this.getTt();
    if (!tt) {
      this.stop();
      return;
    }
    const want = dimsFor(tt.orientation, tt.quality);
    if (want.width !== this.dims.width || want.height !== this.dims.height) {
      this.dims = want;
      this.clearRestart();
      if (this.proc) {
        const old = this.proc;
        this.proc = null;
        try {
          old.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
      this.spawnProc();
      return;
    }
    const stdin = this.proc?.stdin;
    if (!stdin || !stdin.writable) return;
    try {
      const bg = tt.backgroundImage ? backgroundDataUri(tt.backgroundImage) : null;
      const svg = renderDisplaySvg(tt, new Date(), { bg });
      const img = new Resvg(svg, { font: fontOptions() }).render();
      // Avoid unbounded buffering if ffmpeg stalls.
      if (stdin.writableLength < img.pixels.length * 4) stdin.write(img.pixels);
    } catch (err) {
      log.error(`render ${this.id} failed`, err);
    }
  }

  override stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    super.stop();
  }
}

class TranscodePipeline extends FfmpegPipeline {
  constructor(id: string, private readonly url: string, private readonly dims: Dims) {
    super(id);
  }
  protected args(): string[] {
    return transcodeArgs(this.url, this.dims, this.target());
  }
}

export interface NormalizeSpec {
  id: string;
  url: string;
  dims: Dims;
}

export class RenderManager {
  private timetables = new Map<string, TimetablePipeline>();
  private transcodes = new Map<string, { pipe: TranscodePipeline; sig: string }>();

  /** Make the running pipelines match the desired active set. */
  reconcile(
    activeTimetables: Timetable[],
    normalizeSources: NormalizeSpec[],
    getTt: (id: string) => Timetable | undefined,
  ): void {
    const wantTt = new Set(activeTimetables.map((t) => t.id));
    for (const [id, pipe] of this.timetables) {
      if (!wantTt.has(id)) {
        pipe.stop();
        this.timetables.delete(id);
        log.info(`stopped timetable stream ${id}`);
      }
    }
    for (const t of activeTimetables) {
      if (!this.timetables.has(t.id)) {
        const pipe = new TimetablePipeline(t.id, () => getTt(t.id));
        pipe.start();
        this.timetables.set(t.id, pipe);
        log.info(`started timetable stream ${t.id}`);
      }
    }

    const wantSrc = new Set(normalizeSources.map((s) => s.id));
    for (const [id, e] of this.transcodes) {
      if (!wantSrc.has(id)) {
        e.pipe.stop();
        this.transcodes.delete(id);
        log.info(`stopped transcode ${id}`);
      }
    }
    for (const s of normalizeSources) {
      const sig = `${s.url}|${s.dims.width}x${s.dims.height}`;
      const cur = this.transcodes.get(s.id);
      if (cur && cur.sig === sig) continue;
      if (cur) cur.pipe.stop();
      const pipe = new TranscodePipeline(s.id, s.url, s.dims);
      pipe.start();
      this.transcodes.set(s.id, { pipe, sig });
      log.info(`started transcode ${s.id}`);
    }
  }

  stopAll(): void {
    for (const p of this.timetables.values()) p.stop();
    for (const e of this.transcodes.values()) e.pipe.stop();
    this.timetables.clear();
    this.transcodes.clear();
  }
}
