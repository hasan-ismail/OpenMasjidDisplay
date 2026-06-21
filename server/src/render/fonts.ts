/** Locate a small, curated set of bundled font files so resvg renders text fast
 *  and deterministically (no full system-font scan per frame). Falls back to
 *  loading system fonts if the expected files aren't present. */
import fs from 'node:fs';
import { makeLog } from '../logger';

const log = makeLog('fonts');

const WANT = /(NotoSerif|NotoSans|NotoNaskhArabic|NotoSansArabic|DejaVuSans|DejaVuSerif)/i;
const DIRS = ['/usr/share/fonts', '/usr/local/share/fonts'];

export interface ResvgFontOptions {
  fontFiles?: string[];
  fontDirs?: string[];
  loadSystemFonts: boolean;
  defaultFontFamily: string;
  serifFamily?: string;
  sansSerifFamily?: string;
}

let cached: ResvgFontOptions | null = null;

export function fontOptions(): ResvgFontOptions {
  if (cached) return cached;
  const files: string[] = [];
  for (const dir of DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
        const name = String(rel);
        if (/\.(ttf|otf)$/i.test(name) && WANT.test(name)) {
          files.push(`${dir}/${name}`);
        }
      }
    } catch (err) {
      log.debug(`scan ${dir} failed`);
    }
  }
  if (files.length > 0) {
    // We construct a Resvg renderer per video frame, so it parses these files every
    // frame — keep it to just the Regular/Bold weights of the families we use.
    const preferred = files.filter((f) => /(-Regular|-Bold)\.(ttf|otf)$|DejaVuSans(-Bold)?\.ttf$|DejaVuSerif\.ttf$/i.test(f));
    const use = (preferred.length ? preferred : files).slice(0, 12);
    log.info(`using ${use.length} of ${files.length} bundled font file(s) for rendering`);
    cached = {
      fontFiles: use,
      loadSystemFonts: false,
      defaultFontFamily: 'Noto Sans',
      serifFamily: 'Noto Serif',
      sansSerifFamily: 'Noto Sans',
    };
  } else {
    log.warn('no bundled fonts found; loading system fonts (slower)');
    cached = {
      fontDirs: DIRS,
      loadSystemFonts: true,
      defaultFontFamily: 'sans-serif',
    };
  }
  return cached;
}
