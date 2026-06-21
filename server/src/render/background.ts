/**
 * Custom timetable backgrounds: uploaded images stored under /data/uploads and
 * inlined into the rendered SVG as data: URIs (resvg only embeds data URIs, not
 * external files). Reads are cached by modification time so we don't re-encode a
 * multi-megabyte image on every frame.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

const uploadsDir = () => path.join(config.dataDir, 'uploads');

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Reject anything that isn't a plain filename (no traversal, no separators). */
function safeName(name: string): string | null {
  const base = path.basename(String(name || ''));
  return base && base !== '.' && base !== '..' && /^[A-Za-z0-9._-]+$/.test(base) ? base : null;
}

const cache = new Map<string, { uri: string; mtimeMs: number }>();

/** A data: URI for the stored background `file`, or null if missing/invalid. */
export function backgroundDataUri(file: string): string | null {
  const name = safeName(file);
  if (!name) return null;
  const full = path.join(uploadsDir(), name);
  let st: fs.Stats;
  try {
    st = fs.statSync(full);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const cached = cache.get(name);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.uri;
  const mime = MIME[path.extname(name).toLowerCase()] ?? 'image/png';
  let buf: Buffer;
  try {
    buf = fs.readFileSync(full);
  } catch {
    return null;
  }
  const uri = `data:${mime};base64,${buf.toString('base64')}`;
  cache.set(name, { uri, mtimeMs: st.mtimeMs });
  return uri;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** Is this a content type we accept as a background? */
export function isAllowedImageMime(mime: string): boolean {
  return mime in EXT_BY_MIME;
}

/** Store `data` as the background for timetable `id`; returns the stored filename. */
export function saveBackground(id: string, mime: string, data: Buffer): string {
  const safeId = safeName(id);
  if (!safeId) throw new Error('invalid id');
  const ext = EXT_BY_MIME[mime] ?? '.png';
  fs.mkdirSync(uploadsDir(), { recursive: true });
  removeBackground(safeId); // clear any prior file (the extension may change)
  const name = `${safeId}${ext}`;
  fs.writeFileSync(path.join(uploadsDir(), name), data);
  cache.delete(name);
  return name;
}

/** Delete any background file(s) belonging to timetable `id`. */
export function removeBackground(id: string): void {
  const safeId = safeName(id);
  if (!safeId) return;
  const dir = uploadsDir();
  try {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f === safeId || f.startsWith(`${safeId}.`)) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          /* ignore */
        }
        cache.delete(f);
      }
    }
  } catch {
    /* ignore */
  }
}
