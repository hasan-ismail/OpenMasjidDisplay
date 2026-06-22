/**
 * orchestrator.ts — the brain that keeps reality matching intent.
 *
 * On every reconcile it: resolves each screen's effective content, starts/stops
 * the timetable + transcode pipelines that are actually needed, and programs
 * MediaMTX so each screen's stable path (tv_<id>) relays the right content. It
 * also samples each path's live state for the status feed.
 *
 * Model:
 *   • Timetables publish to a runtime path named by their id (tt_<id>).
 *   • Direct sources become a MediaMTX proxy path (src_<id>, sourceOnDemand).
 *   • Normalize sources are transcoded by us and published to src_<id>.
 *   • Each screen path (tv_<id>) self-relays from rtsp://<loopback>/<contentPath>,
 *     so switching a screen is a single PATCH of its source.
 */
import { config } from './config';
import { makeLog } from './logger';
import type { Store } from './store';
import { RenderManager, type NormalizeSpec } from './render/renderer';
import { dimsFor } from './render/svg';
import { resolveTv } from './scheduler';
import {
  ping,
  listConfiguredPaths,
  addPath,
  patchPath,
  deletePath,
  getPathState,
  type PathConf,
} from './mediamtx';
import type { ContentRef, TvStatus } from './types';

const log = makeLog('orchestrator');

export class Orchestrator {
  private running = false;
  private rerun = false;
  private statuses: TvStatus[] = [];
  /** last config applied per path, so we don't re-PATCH (and force a MediaMTX
   *  config reload) every reconcile when nothing actually changed. */
  private applied = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly render: RenderManager,
    private readonly onStatus: (s: TvStatus[]) => void,
    /** optional decoder-reachability source for the live status (the ping monitor) */
    private readonly reachable?: (tvId: string) => boolean | undefined,
  ) {}

  getStatuses(): TvStatus[] {
    return this.statuses;
  }

  /** Resolve a content ref to its MediaMTX path name, or null if invalid/off. */
  private contentPath(c: ContentRef): string | null {
    const db = this.store.db;
    if (c.kind === 'timetable' && c.id && db.timetables.some((t) => t.id === c.id)) return c.id;
    if (c.kind === 'source' && c.id) {
      const s = db.sources.find((x) => x.id === c.id);
      if (s && s.enabled) return s.id;
    }
    return null;
  }

  /** Run a reconcile; coalesces overlapping calls into a single trailing rerun. */
  async reconcile(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        await this.runOnce();
      } while (this.rerun);
    } catch (err) {
      log.error('reconcile failed', err);
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<void> {
    const db = this.store.db;
    const tz = db.settings.scheduleTimezone;
    const now = new Date();

    const resolutions = db.tvs.map((tv) => ({ tv, res: resolveTv(tv, db.schedules, now, tz) }));

    const refTt = new Set<string>();
    const refSrc = new Set<string>();
    for (const { res } of resolutions) {
      const cp = this.contentPath(res.content);
      if (!cp) continue;
      if (res.content.kind === 'timetable') refTt.add(cp);
      else if (res.content.kind === 'source') refSrc.add(cp);
    }

    const activeTts = db.timetables.filter((t) => refTt.has(t.id));
    const refSources = db.sources.filter((s) => refSrc.has(s.id) && s.enabled);
    const directSources = refSources.filter((s) => s.mode === 'direct');
    const normalizeSources: NormalizeSpec[] = refSources
      .filter((s) => s.mode === 'normalize')
      .map((s) => ({ id: s.id, url: s.url, dims: dimsFor('landscape', s.quality) }));

    const reachable = await ping();

    // Program MediaMTX BEFORE (re)starting pipelines, and delete now-unwanted
    // paths BEFORE adding, so a source switching direct→normalize has its stale
    // proxy path removed before the transcode publishes into that same name.
    if (reachable) {
      const configured = await listConfiguredPaths();
      const desired = new Map<string, PathConf>();

      for (const s of directSources) {
        desired.set(s.id, {
          source: s.url,
          sourceOnDemand: true,
          sourceOnDemandStartTimeout: '10s',
          sourceOnDemandCloseAfter: '10s',
        });
      }
      for (const { tv, res } of resolutions) {
        const cp = this.contentPath(res.content);
        if (!cp) continue;
        desired.set(tv.id, {
          source: `${config.rtspLoopback}/${cp}`,
          sourceOnDemand: true,
          sourceOnDemandStartTimeout: '10s',
          sourceOnDemandCloseAfter: '60s',
        });
      }

      // Remove screen/source paths we own that are no longer wanted (first).
      for (const name of configured) {
        if ((name.startsWith('tv_') || name.startsWith('src_')) && !desired.has(name)) {
          await deletePath(name);
          this.applied.delete(name);
        }
      }
      for (const [name, conf] of desired) {
        const key = JSON.stringify(conf);
        if (configured.has(name)) {
          // Only patch (which reloads MediaMTX) when the config actually changed.
          if (this.applied.get(name) !== key) {
            await patchPath(name, conf);
            this.applied.set(name, key);
          }
        } else {
          await addPath(name, conf);
          this.applied.set(name, key);
        }
      }
    } else {
      this.applied.clear(); // re-add everything once it comes back
      log.warn('MediaMTX API unreachable; will retry on next reconcile');
    }

    // Start/stop the timetable + transcode pipelines to match the active set.
    this.render.reconcile(activeTts, normalizeSources, (id) =>
      db.timetables.find((t) => t.id === id),
    );

    const statuses: TvStatus[] = [];
    for (const { tv, res } of resolutions) {
      const cp = this.contentPath(res.content);
      let ready = false;
      if (reachable && cp) {
        const st = await getPathState(tv.id);
        ready = !!st && st.ready;
      }
      statuses.push({
        tvId: tv.id,
        effective: res.content,
        source: res.source,
        ruleId: res.ruleId,
        streamReady: ready,
        decoderReachable: this.reachable?.(tv.id),
      });
    }
    this.statuses = statuses;
    this.onStatus(this.statuses);
  }
}
