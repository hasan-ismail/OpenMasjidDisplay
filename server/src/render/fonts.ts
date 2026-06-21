/** Locate a small, curated set of bundled font files for resvg to render with.
 *
 *  We pick only the BASE families we actually draw with (Latin sans/serif +
 *  Arabic). `fonts-noto-core` ships dozens of per-script files (NotoSansThai,
 *  NotoSansHebrew, …); loading all of them makes every render parse far more font
 *  data, and if the base Latin face gets crowded out resvg can hang on glyph
 *  fallback. DejaVu is the always-present safety net when Noto isn't installed.
 *
 *  Rendering runs on a worker thread (see render/renderWorker.ts), so the per-frame
 *  cost no longer blocks the event loop; the OS page cache keeps these few files
 *  hot after the first read. The scan + selection is done once and memoised. */
import fs from 'node:fs';
import path from 'node:path';
import { makeLog } from '../logger';

const log = makeLog('fonts');

const DIRS = ['/usr/share/fonts', '/usr/local/share/fonts'];

// The curated faces, in priority order. Matched on the file's basename (without
// extension). Keep this small — every entry is parsed on every render.
const PRIORITY = [
  'NotoSans-Regular',
  'NotoSans-Bold',
  'NotoSerif-Regular',
  'NotoSerif-Bold',
  'NotoNaskhArabic-Regular',
  'NotoSansArabic-Regular',
  'DejaVuSans',
  'DejaVuSerif',
];
const MAX_FONTS = 8;

export interface ResvgFontOptions {
  fontFiles?: string[];
  fontDirs?: string[];
  loadSystemFonts: boolean;
  defaultFontFamily: string;
  serifFamily?: string;
  sansSerifFamily?: string;
}

let cached: ResvgFontOptions | null = null;

function scan(): string[] {
  const found: string[] = [];
  for (const dir of DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
        const name = String(rel);
        if (/\.(ttf|otf)$/i.test(name)) found.push(path.join(dir, name));
      }
    } catch {
      log.debug(`scan ${dir} failed`);
    }
  }
  return found;
}

export function fontOptions(): ResvgFontOptions {
  if (cached) return cached;

  const all = scan();
  // Pick our curated files in priority order (matched on basename, sans extension).
  const chosen: string[] = [];
  for (const want of PRIORITY) {
    const hit = all.find((f) => path.basename(f).replace(/\.(ttf|otf)$/i, '') === want);
    if (hit && !chosen.includes(hit)) chosen.push(hit);
    if (chosen.length >= MAX_FONTS) break;
  }

  if (chosen.length === 0) {
    log.warn('no bundled fonts found; loading system fonts (slower)');
    cached = { fontDirs: DIRS, loadSystemFonts: true, defaultFontFamily: 'sans-serif' };
    return cached;
  }

  const haveNotoSans = chosen.some((f) => /NotoSans-/.test(path.basename(f)));
  const haveNotoSerif = chosen.some((f) => /NotoSerif-/.test(path.basename(f)));
  log.info(`using ${chosen.length} of ${all.length} bundled font file(s) for rendering`);
  cached = {
    fontFiles: chosen,
    loadSystemFonts: false,
    defaultFontFamily: haveNotoSans ? 'Noto Sans' : 'DejaVu Sans',
    serifFamily: haveNotoSerif ? 'Noto Serif' : 'DejaVu Serif',
    sansSerifFamily: haveNotoSans ? 'Noto Sans' : 'DejaVu Sans',
  };
  return cached;
}
