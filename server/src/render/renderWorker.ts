/**
 * render/renderWorker.ts — runs the (CPU-heavy, synchronous) resvg rasterization
 * on a worker thread so it NEVER blocks the main event loop.
 *
 * Before this, `new Resvg(svg).render()` ran once per second on the main thread,
 * re-parsing the bundled fonts and rasterizing a full-screen, gradient-rich SVG.
 * On a small box that pegged a core and starved both the HTTP/WebSocket server and
 * ffmpeg's stdin — the timetable stream would take minutes to come online (or never
 * publish) and the control panel felt sluggish. Doing it here keeps the main thread
 * free; if a render is slow we simply produce frames a little less often.
 *
 * Messages in:  { id, kind: 'raw' | 'png', tt, nowMs, width?, bgFile? }
 * Messages out: { id, ok: true, ... } | { id, ok: false, error }
 *   • raw → { width, height, buf }  (RGBA pixels, ArrayBuffer transferred) for ffmpeg
 *   • png → { buf }                 (PNG bytes, ArrayBuffer transferred) for previews
 */
import { parentPort } from 'node:worker_threads';
import { Resvg } from '@resvg/resvg-js';
import { renderDisplaySvg } from './svg';
import { backgroundDataUri, logoDataUri } from './background';
import { fontOptions } from './fonts';
import type { Timetable } from '../types';

if (!parentPort) throw new Error('renderWorker must be run as a worker thread');
const port = parentPort;

interface Req {
  id: number;
  kind: 'raw' | 'png' | 'meta';
  tt: Timetable;
  nowMs: number;
  width?: number;
  bgFile?: string;
  logoFile?: string;
}

/** Resolve the background + logo data URIs for a timetable (cached by mtime). An
 *  override (from the raw form body) is used when given, else the stored field. */
function assets(tt: Timetable, bgOverride?: string, logoOverride?: string): { bg: string | null; logo: string | null } {
  const bgFile = bgOverride !== undefined ? bgOverride : tt.backgroundImage;
  const logoFile = logoOverride !== undefined ? logoOverride : tt.logoImage;
  return {
    bg: bgFile ? backgroundDataUri(bgFile) : null,
    logo: logoFile ? logoDataUri(logoFile) : null,
  };
}

port.on('message', (msg: Req) => {
  const { id, kind, tt, nowMs } = msg;
  try {
    const now = new Date(typeof nowMs === 'number' ? nowMs : Date.now());
    if (kind === 'meta') {
      // Just collect the click-to-edit regions; no rasterization (cheap).
      const sink = { hotspots: [] as unknown[] };
      renderDisplaySvg(tt, now, { sink: sink as never });
      port.postMessage({ id, ok: true, hotspots: sink.hotspots });
      return;
    }
    if (kind === 'png') {
      const { bg, logo } = assets(tt, msg.bgFile, msg.logoFile);
      const svg = renderDisplaySvg(tt, now, { bg, logo });
      const png = new Resvg(svg, {
        font: fontOptions(),
        fitTo: { mode: 'width', value: msg.width ?? 960 },
      })
        .render()
        .asPng();
      // Copy into a standalone ArrayBuffer so it can be transferred (a Buffer shares
      // a pooled backing store that must not be detached).
      const ab = new ArrayBuffer(png.byteLength);
      new Uint8Array(ab).set(png);
      port.postMessage({ id, ok: true, buf: ab }, [ab]);
      return;
    }
    // raw RGBA for the video pipeline
    const { bg, logo } = assets(tt);
    const svg = renderDisplaySvg(tt, now, { bg, logo });
    const r = new Resvg(svg, { font: fontOptions() }).render();
    const px = r.pixels;
    const ab = new ArrayBuffer(px.byteLength);
    new Uint8Array(ab).set(px);
    port.postMessage({ id, ok: true, width: r.width, height: r.height, buf: ab }, [ab]);
  } catch (e) {
    port.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
