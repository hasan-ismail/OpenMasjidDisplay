/** HTTP/JSON API + static SPA host. Mutations go through the store, whose change
 *  listener triggers a reconcile and a WebSocket status push. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { config } from './config';
import { makeLog } from './logger';
import type { Store } from './store';
import type { Orchestrator } from './orchestrator';
import {
  hashPassword,
  verifyPassword,
  hasValidSession,
  makeToken,
  setCookieHeader,
  clearCookieHeader,
} from './auth';
import { THEMES } from './render/theme';
import { renderDisplaySvg } from './render/svg';
import { fontOptions } from './render/fonts';
import {
  normTimetable,
  normSource,
  normTv,
  normSchedule,
  normSettings,
  normContent,
} from './validate';
import type { DB } from './types';

const log = makeLog('api');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

interface Deps {
  store: Store;
  orchestrator: Orchestrator;
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      data += c.toString();
    });
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res: ServerResponse, pathname: string): boolean {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.join(config.publicDir, rel);
  // Prevent path traversal outside the public dir.
  if (!full.startsWith(path.resolve(config.publicDir))) return false;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  const ext = path.extname(full).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(full).pipe(res);
  return true;
}

function serveIndex(res: ServerResponse): void {
  const idx = path.join(config.publicDir, 'index.html');
  if (fs.existsSync(idx)) {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
    fs.createReadStream(idx).pipe(res);
  } else {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OpenMasjid Display is running. The control panel build was not found.');
  }
}

function statePayload(store: Store, orchestrator: Orchestrator) {
  const db = store.db;
  const s = db.settings;
  return {
    authRequired: true,
    settings: s,
    timetables: db.timetables,
    sources: db.sources,
    tvs: db.tvs,
    schedules: db.schedules,
    themes: THEMES,
    statuses: orchestrator.getStatuses(),
    rtsp: {
      host: s.rtspPublicHost,
      port: s.rtspPublicPort,
      transport: 'tcp',
      base: s.rtspPublicHost ? `rtsp://${s.rtspPublicHost}:${s.rtspPublicPort}` : null,
    },
    serverNow: Date.now(),
  };
}

export function createApi(deps: Deps) {
  const { store, orchestrator } = deps;
  const authed = (req: IncomingMessage) => !!store.db.admin && hasValidSession(req, store.secret);

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // ---- Unauthenticated endpoints --------------------------------------
      if (pathname === '/healthz') return sendJson(res, 200, { ok: true });

      if (pathname === '/api/session' && method === 'GET') {
        return sendJson(res, 200, { needsSetup: !store.db.admin, authed: authed(req) });
      }
      if (pathname === '/api/setup' && method === 'POST') {
        const body = await readBody(req);
        if (store.db.admin) return sendJson(res, 409, { error: 'The control panel is already set up.' });
        const pw = String(body.password ?? '');
        if (pw.length < 4) return sendJson(res, 400, { error: 'Please choose a password of at least 4 characters.' });
        const { hash, salt } = hashPassword(pw);
        const name = String(body.name ?? '').slice(0, 80).trim();
        store.update((db) => {
          db.admin = { hash, salt, name: name || undefined, createdAt: new Date().toISOString() };
        });
        res.setHeader('set-cookie', setCookieHeader(makeToken(store.secret)));
        return sendJson(res, 200, { ok: true });
      }
      if (pathname === '/api/login' && method === 'POST') {
        const body = await readBody(req);
        if (!store.db.admin) return sendJson(res, 400, { error: 'This panel has not been set up yet.' });
        if (verifyPassword(String(body.password ?? ''), store.db.admin)) {
          res.setHeader('set-cookie', setCookieHeader(makeToken(store.secret)));
          return sendJson(res, 200, { ok: true });
        }
        return sendJson(res, 401, { error: 'Incorrect password.' });
      }
      if (pathname === '/api/logout' && method === 'POST') {
        res.setHeader('set-cookie', clearCookieHeader());
        return sendJson(res, 200, { ok: true });
      }

      // ---- Static + SPA (GET) ---------------------------------------------
      if (!pathname.startsWith('/api/') && method === 'GET') {
        if (serveStatic(res, pathname)) return;
        return serveIndex(res);
      }

      // ---- Everything else requires auth ----------------------------------
      if (!authed(req)) return sendJson(res, 401, { error: 'Please sign in.' });

      if (pathname === '/api/state' && method === 'GET') {
        return sendJson(res, 200, statePayload(store, orchestrator));
      }

      if (pathname === '/api/settings' && method === 'PUT') {
        const body = await readBody(req);
        store.update((db) => {
          db.settings = normSettings(body, db.settings);
        });
        return sendJson(res, 200, store.db.settings);
      }

      // ---- Timetables ------------------------------------------------------
      if (pathname === '/api/timetables' && method === 'POST') {
        const body = await readBody(req);
        const tt = normTimetable(body);
        store.update((db) => void db.timetables.push(tt));
        return sendJson(res, 200, tt);
      }
      const ttMatch = /^\/api\/timetables\/([\w-]+)$/.exec(pathname);
      if (ttMatch) {
        const id = ttMatch[1];
        if (method === 'PUT') {
          const body = await readBody(req);
          const idx = store.db.timetables.findIndex((t) => t.id === id);
          if (idx < 0) return sendJson(res, 404, { error: 'Timetable not found.' });
          const updated = normTimetable(body, store.db.timetables[idx]);
          store.update((db) => void (db.timetables[idx] = updated));
          return sendJson(res, 200, updated);
        }
        if (method === 'DELETE') {
          store.update((db) => void (db.timetables = db.timetables.filter((t) => t.id !== id)));
          return sendJson(res, 200, { ok: true });
        }
      }

      // ---- Sources ---------------------------------------------------------
      if (pathname === '/api/sources' && method === 'POST') {
        const body = await readBody(req);
        const src = normSource(body);
        store.update((db) => void db.sources.push(src));
        return sendJson(res, 200, src);
      }
      const srcMatch = /^\/api\/sources\/([\w-]+)$/.exec(pathname);
      if (srcMatch) {
        const id = srcMatch[1];
        if (method === 'PUT') {
          const body = await readBody(req);
          const idx = store.db.sources.findIndex((s) => s.id === id);
          if (idx < 0) return sendJson(res, 404, { error: 'Source not found.' });
          const updated = normSource(body, store.db.sources[idx]);
          store.update((db) => void (db.sources[idx] = updated));
          return sendJson(res, 200, updated);
        }
        if (method === 'DELETE') {
          store.update((db) => void (db.sources = db.sources.filter((s) => s.id !== id)));
          return sendJson(res, 200, { ok: true });
        }
      }

      // ---- Screens (TVs) ---------------------------------------------------
      if (pathname === '/api/tvs' && method === 'POST') {
        const body = await readBody(req);
        const tv = normTv(body);
        store.update((db) => void db.tvs.push(tv));
        return sendJson(res, 200, tv);
      }
      const tvMatch = /^\/api\/tvs\/([\w-]+)$/.exec(pathname);
      if (tvMatch) {
        const id = tvMatch[1];
        if (method === 'PUT') {
          const body = await readBody(req);
          const idx = store.db.tvs.findIndex((t) => t.id === id);
          if (idx < 0) return sendJson(res, 404, { error: 'Screen not found.' });
          const updated = normTv(body, store.db.tvs[idx]);
          store.update((db) => void (db.tvs[idx] = updated));
          return sendJson(res, 200, updated);
        }
        if (method === 'DELETE') {
          store.update((db) => void (db.tvs = db.tvs.filter((t) => t.id !== id)));
          return sendJson(res, 200, { ok: true });
        }
      }
      const setMatch = /^\/api\/tvs\/([\w-]+)\/set$/.exec(pathname);
      if (setMatch && method === 'POST') {
        const id = setMatch[1];
        const body = await readBody(req);
        const idx = store.db.tvs.findIndex((t) => t.id === id);
        if (idx < 0) return sendJson(res, 404, { error: 'Screen not found.' });
        const content = normContent(body.content);
        const until = body.until == null ? null : Number(body.until);
        store.update((db) => {
          db.tvs[idx].override = { content, until: Number.isFinite(until) ? until : null };
        });
        return sendJson(res, 200, store.db.tvs[idx]);
      }
      const resumeMatch = /^\/api\/tvs\/([\w-]+)\/resume$/.exec(pathname);
      if (resumeMatch && method === 'POST') {
        const id = resumeMatch[1];
        const idx = store.db.tvs.findIndex((t) => t.id === id);
        if (idx < 0) return sendJson(res, 404, { error: 'Screen not found.' });
        store.update((db) => void (db.tvs[idx].override = null));
        return sendJson(res, 200, store.db.tvs[idx]);
      }

      // ---- Schedules -------------------------------------------------------
      if (pathname === '/api/schedules' && method === 'POST') {
        const body = await readBody(req);
        const rule = normSchedule(body);
        store.update((db) => void db.schedules.push(rule));
        return sendJson(res, 200, rule);
      }
      const ruleMatch = /^\/api\/schedules\/([\w-]+)$/.exec(pathname);
      if (ruleMatch) {
        const id = ruleMatch[1];
        if (method === 'PUT') {
          const body = await readBody(req);
          const idx = store.db.schedules.findIndex((r) => r.id === id);
          if (idx < 0) return sendJson(res, 404, { error: 'Schedule not found.' });
          const updated = normSchedule(body, store.db.schedules[idx]);
          store.update((db) => void (db.schedules[idx] = updated));
          return sendJson(res, 200, updated);
        }
        if (method === 'DELETE') {
          store.update((db) => void (db.schedules = db.schedules.filter((r) => r.id !== id)));
          return sendJson(res, 200, { ok: true });
        }
      }

      // ---- Timetable PNG preview ------------------------------------------
      const prevMatch = /^\/api\/preview\/([\w-]+)$/.exec(pathname);
      if (prevMatch && method === 'GET') {
        const tt = store.db.timetables.find((t) => t.id === prevMatch[1]);
        if (!tt) return sendJson(res, 404, { error: 'Timetable not found.' });
        const svg = renderDisplaySvg(tt, new Date());
        const width = tt.orientation === 'portrait' ? 540 : 960;
        const png = new Resvg(svg, { font: fontOptions(), fitTo: { mode: 'width', value: width } })
          .render()
          .asPng();
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(png);
        return;
      }

      return sendJson(res, 404, { error: 'Not found.' });
    } catch (err) {
      log.error(`${method} ${pathname}`, err);
      if (!res.headersSent) sendJson(res, 400, { error: 'Something went wrong with that request.' });
    }
  };
}

export type { DB };
