/** HTTP/JSON API + static SPA host. Mutations go through the store, whose change
 *  listener triggers a reconcile and a WebSocket status push. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
import { platformUser, ssoConfigured } from './omos';
import { THEMES } from './render/theme';
import {
  saveBackground,
  removeBackground,
  saveLogo,
  removeLogo,
  saveAnnouncement,
  removeAnnouncement,
  removeAllAnnouncements,
  uploadFilePath,
  isAllowedImageMime,
} from './render/background';
import { renderPreviewPng, renderPreviewMeta } from './render/renderPool';
import { parseIqamahCsv, toCsv, templateCsv } from './iqamahCsv';
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

function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
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
    // The screens connect to rtsp://<this server>:<port>/<screen>. The host is
    // whatever address the panel was opened with (filled in by the browser), so
    // there is no server IP to configure here.
    rtsp: {
      port: config.rtspPort,
      transport: 'tcp',
    },
    omosBase: config.omosBaseUrl,
    // Volunteer mode (the simple mobile page on its own port). We never send the
    // PIN itself — only whether one is set, and the host port to show in the URL.
    volunteer: {
      pinSet: !!store.db.volunteerAuth,
      port: config.volunteerPublicPort,
    },
    serverNow: Date.now(),
  };
}

export function createApi(deps: Deps) {
  const { store, orchestrator } = deps;
  // A request is authenticated if it carries a valid local session cookie. That
  // cookie is minted by first-run setup, by password login, or by confirmed
  // OpenMasjidOS SSO (see /api/session) — so every other endpoint stays a simple,
  // synchronous check.
  const authed = (req: IncomingMessage) => hasValidSession(req, store.secret);

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // ---- Unauthenticated endpoints --------------------------------------
      if (pathname === '/healthz') return sendJson(res, 200, { ok: true });

      if (pathname === '/api/session' && method === 'GET') {
        let isAuthed = authed(req);
        let username: string | undefined;
        // OpenMasjidOS SSO: if not already signed in here but the visitor carries
        // a platform session the platform confirms, mint a local session so the
        // rest of the API (and the WebSocket) treats them as signed in. Falls back
        // silently to local login when SSO is absent or the platform is down.
        if (!isAuthed && ssoConfigured()) {
          const user = await platformUser(req);
          if (user) {
            res.setHeader('set-cookie', setCookieHeader(makeToken(store.secret)));
            isAuthed = true;
            username = user;
          }
        }
        return sendJson(res, 200, {
          // Standalone: first run creates a password. Under OpenMasjidOS, signing
          // in happens through the dashboard, so we never block on local setup.
          needsSetup: !store.db.admin && !ssoConfigured(),
          authed: isAuthed,
          hasPassword: !!store.db.admin,
          sso: { enabled: ssoConfigured(), username },
        });
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

      // ---- Volunteer mode config (enable + 4-digit PIN) -------------------
      if (pathname === '/api/volunteer-config' && method === 'PUT') {
        const body = await readBody(req);
        const enabled = body.enabled === true;
        const pinRaw = body.pin == null ? undefined : String(body.pin).trim();
        // A change to the PIN: '' clears it, 4-8 digits sets it, anything else is rejected.
        if (pinRaw !== undefined && pinRaw !== '' && !/^\d{4,8}$/.test(pinRaw)) {
          return sendJson(res, 400, { error: 'The PIN must be 4 to 8 digits.' });
        }
        const willHavePin = pinRaw === '' ? false : pinRaw ? true : !!store.db.volunteerAuth;
        if (enabled && !willHavePin) {
          return sendJson(res, 400, { error: 'Choose a 4-digit PIN before turning on the volunteer page.' });
        }
        store.update((db) => {
          if (pinRaw === '') db.volunteerAuth = null;
          else if (pinRaw) db.volunteerAuth = hashPassword(pinRaw);
          db.settings.volunteerEnabled = enabled;
        });
        return sendJson(res, 200, { ok: true, enabled, pinSet: !!store.db.volunteerAuth });
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
          removeBackground(id);
          removeLogo(id);
          removeAllAnnouncements(id);
          store.update((db) => void (db.timetables = db.timetables.filter((t) => t.id !== id)));
          return sendJson(res, 200, { ok: true });
        }
      }

      // ---- Timetable custom background ------------------------------------
      const bgMatch = /^\/api\/timetables\/([\w-]+)\/background$/.exec(pathname);
      if (bgMatch) {
        const id = bgMatch[1];
        const idx = store.db.timetables.findIndex((t) => t.id === id);
        if (idx < 0) return sendJson(res, 404, { error: 'Timetable not found.' });
        if (method === 'POST') {
          const body = await readBody(req, 8_000_000);
          const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(body.data ?? ''));
          if (!m || !isAllowedImageMime(m[1])) {
            return sendJson(res, 400, { error: 'Please choose a PNG, JPG, WebP or GIF image.' });
          }
          let buf: Buffer;
          try {
            buf = Buffer.from(m[2], 'base64');
          } catch {
            return sendJson(res, 400, { error: 'That image could not be read.' });
          }
          if (buf.length > 6_000_000) {
            return sendJson(res, 400, { error: 'That image is too large — please keep it under about 6 MB.' });
          }
          const file = saveBackground(id, m[1], buf);
          store.update((db) => void (db.timetables[idx].backgroundImage = file));
          return sendJson(res, 200, store.db.timetables[idx]);
        }
        if (method === 'DELETE') {
          removeBackground(id);
          store.update((db) => void (db.timetables[idx].backgroundImage = ''));
          return sendJson(res, 200, store.db.timetables[idx]);
        }
      }

      // ---- Timetable masjid logo ------------------------------------------
      const logoMatch = /^\/api\/timetables\/([\w-]+)\/logo$/.exec(pathname);
      if (logoMatch) {
        const id = logoMatch[1];
        const idx = store.db.timetables.findIndex((t) => t.id === id);
        if (idx < 0) return sendJson(res, 404, { error: 'Timetable not found.' });
        if (method === 'POST') {
          const body = await readBody(req, 4_000_000);
          const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(body.data ?? ''));
          if (!m || !isAllowedImageMime(m[1])) {
            return sendJson(res, 400, { error: 'Please choose a PNG, JPG, WebP, GIF or SVG image.' });
          }
          let buf: Buffer;
          try {
            buf = Buffer.from(m[2], 'base64');
          } catch {
            return sendJson(res, 400, { error: 'That image could not be read.' });
          }
          if (buf.length > 2_500_000) {
            return sendJson(res, 400, { error: 'That logo is too large — please keep it under about 2 MB.' });
          }
          const file = saveLogo(id, m[1], buf);
          store.update((db) => void (db.timetables[idx].logoImage = file));
          return sendJson(res, 200, store.db.timetables[idx]);
        }
        if (method === 'DELETE') {
          removeLogo(id);
          store.update((db) => void (db.timetables[idx].logoImage = ''));
          return sendJson(res, 200, store.db.timetables[idx]);
        }
      }

      // ---- Timetable yearly Iqamah CSV (import / export / template / clear) ----
      const csvMatch = /^\/api\/timetables\/([\w-]+)\/iqamah-csv$/.exec(pathname);
      if (csvMatch) {
        const id = csvMatch[1];
        const idx = store.db.timetables.findIndex((t) => t.id === id);
        if (idx < 0) return sendJson(res, 404, { error: 'Timetable not found.' });
        if (method === 'POST') {
          const body = await readBody(req, 2_000_000);
          const parsed = parseIqamahCsv(String(body.data ?? ''));
          if (parsed.rows === 0) {
            return sendJson(res, 400, {
              error: parsed.errors[0] ?? 'No usable rows found. Each row needs a date and at least one time.',
            });
          }
          store.update((db) => void (db.timetables[idx].iqamahYear = parsed.data));
          return sendJson(res, 200, { ok: true, rows: parsed.rows, errors: parsed.errors.slice(0, 5) });
        }
        if (method === 'GET') {
          const mode = url.searchParams.get('mode');
          const tt = store.db.timetables[idx];
          const csv = mode === 'template' ? templateCsv(tt) : toCsv(tt.iqamahYear);
          const fname = mode === 'template' ? 'iqamah-template.csv' : 'iqamah-times.csv';
          res.writeHead(200, {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="${fname}"`,
            'cache-control': 'no-store',
          });
          res.end(csv);
          return;
        }
        if (method === 'DELETE') {
          store.update((db) => void delete db.timetables[idx].iqamahYear);
          return sendJson(res, 200, store.db.timetables[idx]);
        }
      }

      // ---- Announcement slideshow images ----------------------------------
      const annMatch = /^\/api\/timetables\/([\w-]+)\/announcements$/.exec(pathname);
      if (annMatch && method === 'POST') {
        const id = annMatch[1];
        const idx = store.db.timetables.findIndex((t) => t.id === id);
        if (idx < 0) return sendJson(res, 404, { error: 'Timetable not found.' });
        const body = await readBody(req, 8_000_000);
        const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(body.data ?? ''));
        if (!m || !isAllowedImageMime(m[1])) {
          return sendJson(res, 400, { error: 'Please choose a PNG, JPG, WebP or GIF image.' });
        }
        let buf: Buffer;
        try {
          buf = Buffer.from(m[2], 'base64');
        } catch {
          return sendJson(res, 400, { error: 'That image could not be read.' });
        }
        if (buf.length > 6_000_000) {
          return sendJson(res, 400, { error: 'That image is too large — please keep it under about 6 MB.' });
        }
        const file = saveAnnouncement(id, m[1], buf);
        store.update((db) => {
          const a = db.timetables[idx].announcements ?? {
            enabled: false, images: [], start: '', end: '', everySeconds: 60, forSeconds: 20, imageSeconds: 8,
          };
          a.images = [...a.images, file].slice(0, 30);
          db.timetables[idx].announcements = a;
        });
        return sendJson(res, 200, store.db.timetables[idx]);
      }
      const annFileMatch = /^\/api\/timetables\/([\w-]+)\/announcements\/(.+)$/.exec(pathname);
      if (annFileMatch && (method === 'DELETE' || method === 'GET')) {
        const id = annFileMatch[1];
        const file = decodeURIComponent(annFileMatch[2]);
        const idx = store.db.timetables.findIndex((t) => t.id === id);
        if (idx < 0) return sendJson(res, 404, { error: 'Timetable not found.' });
        if (method === 'GET') {
          // Serve the image so the editor can show a thumbnail (must belong to this id).
          const f = file.startsWith(`${id}.ann.`) ? uploadFilePath(file) : null;
          if (!f) return sendJson(res, 404, { error: 'Image not found.' });
          res.writeHead(200, { 'content-type': f.mime, 'cache-control': 'private, max-age=300' });
          fs.createReadStream(f.path).pipe(res);
          return;
        }
        removeAnnouncement(file);
        store.update((db) => {
          const a = db.timetables[idx].announcements;
          if (a) a.images = a.images.filter((f) => f !== file);
        });
        return sendJson(res, 200, store.db.timetables[idx]);
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
      // Live preview of unsaved edits (POST the form body) or the stored one (GET by id).
      if (pathname === '/api/preview' && method === 'POST') {
        const body = await readBody(req);
        const tt = normTimetable(body);
        // Background + logo are stripped by the validator, so take them from the raw
        // body — an unsaved upload should still appear in the live preview.
        const bgFile = typeof body.backgroundImage === 'string' ? body.backgroundImage : '';
        const logoFile = typeof body.logoImage === 'string' ? body.logoImage : '';
        const width = tt.orientation === 'portrait' ? 540 : 960;
        const png = await renderPreviewPng(tt, Date.now(), width, bgFile, logoFile);
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(png);
        return;
      }
      // Click-to-edit regions for the live editor (fractional coordinates).
      if (pathname === '/api/preview-meta' && method === 'POST') {
        const body = await readBody(req);
        const tt = normTimetable(body);
        const hotspots = await renderPreviewMeta(tt, Date.now());
        return sendJson(res, 200, { hotspots });
      }
      const prevMatch = /^\/api\/preview\/([\w-]+)$/.exec(pathname);
      if (prevMatch && method === 'GET') {
        const tt = store.db.timetables.find((t) => t.id === prevMatch[1]);
        if (!tt) return sendJson(res, 404, { error: 'Timetable not found.' });
        const width = tt.orientation === 'portrait' ? 540 : 960;
        const png = await renderPreviewPng(tt, Date.now(), width, tt.backgroundImage || '', tt.logoImage || '');
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
