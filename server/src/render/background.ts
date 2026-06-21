/**
 * Uploaded timetable images — custom backgrounds and masjid logos — stored under
 * /data/uploads and inlined into the rendered SVG as data: URIs (resvg only embeds
 * data URIs, not external files). Reads are cached by modification time so we don't
 * re-encode an image on every frame.
 *
 * Files are named `<id>.<ext>` for the background and `<id>.logo.<ext>` for the
 * logo, so the two never collide.
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
  '.svg': 'image/svg+xml',
};

/** Reject anything that isn't a plain filename (no traversal, no separators). */
function safeName(name: string): string | null {
  const base = path.basename(String(name || ''));
  return base && base !== '.' && base !== '..' && /^[A-Za-z0-9._-]+$/.test(base) ? base : null;
}

const cache = new Map<string, { uri: string; mtimeMs: number }>();

/** A data: URI for a stored upload `file`, or null if missing/invalid. */
function dataUri(file: string): string | null {
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
  'image/svg+xml': '.svg',
};

/** The on-disk basename (without extension) for an asset of a given kind. */
function prefixFor(id: string, kind: 'bg' | 'logo'): string | null {
  const safeId = safeName(id);
  if (!safeId) return null;
  return kind === 'logo' ? `${safeId}.logo` : safeId;
}

function saveAsset(id: string, kind: 'bg' | 'logo', mime: string, data: Buffer): string {
  const prefix = prefixFor(id, kind);
  if (!prefix) throw new Error('invalid id');
  const ext = EXT_BY_MIME[mime] ?? '.png';
  fs.mkdirSync(uploadsDir(), { recursive: true });
  removeAsset(id, kind); // clear any prior file (the extension may change)
  const name = `${prefix}${ext}`;
  fs.writeFileSync(path.join(uploadsDir(), name), data);
  cache.delete(name);
  return name;
}

function removeAsset(id: string, kind: 'bg' | 'logo'): void {
  const prefix = prefixFor(id, kind);
  if (!prefix) return;
  const dir = uploadsDir();
  try {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const matches = f === prefix || f.startsWith(`${prefix}.`);
      // The background prefix (`<id>`) would also match the logo (`<id>.logo.png`);
      // exclude logo files when clearing the background.
      if (matches && !(kind === 'bg' && f.includes('.logo.'))) {
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

/** Is this a content type we accept as an uploaded image? */
export function isAllowedImageMime(mime: string): boolean {
  return mime in EXT_BY_MIME;
}

// ── Backgrounds ──────────────────────────────────────────────────────────────
export const backgroundDataUri = (file: string): string | null => dataUri(file);
export const saveBackground = (id: string, mime: string, data: Buffer): string => saveAsset(id, 'bg', mime, data);
export const removeBackground = (id: string): void => removeAsset(id, 'bg');

// ── Logos ────────────────────────────────────────────────────────────────────
export const logoDataUri = (file: string): string | null => dataUri(file);
export const saveLogo = (id: string, mime: string, data: Buffer): string => saveAsset(id, 'logo', mime, data);
export const removeLogo = (id: string): void => removeAsset(id, 'logo');
