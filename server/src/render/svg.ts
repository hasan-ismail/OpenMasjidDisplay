// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * render/svg.ts — builds the full-screen prayer-times display as an SVG string,
 * which resvg rasterizes into video frames.
 *
 * The look mirrors the OpenMasjidOS "liquid glass" language: a soft aurora scene
 * (or the masjid's own background image, gently frosted), a live **sun or moon**
 * that arcs across the sky by the real time of day and casts its glow onto the
 * translucent glass panels (top sheen + hairline borders), emerald/cyan primary
 * and a gold accent. Three arrangement presets (centered / clockTop / split) and
 * per-element toggles are honoured; a carousel option rotates the layout over the
 * day to avoid screen burn-in. No sacred/Arabic text appears in decorative chrome.
 */
import type { Timetable, TimetableLayout, HadithItem, TimeFormat, Lang } from '../types';
import { getPalette, type Palette } from './theme';
import {
  prayerTimes,
  iqamahHours,
  localParts,
  timezoneOffsetHours,
  dayOfWeek,
  parseHHMM,
  METHODS,
  type PrayerTimes,
} from '../prayer/engine';

export interface Dims {
  width: number;
  height: number;
}

export function dimsFor(orientation: string, quality: string): Dims {
  const long = quality === '1080p' ? 1920 : 1280;
  const short = quality === '1080p' ? 1080 : 720;
  return orientation === 'portrait'
    ? { width: short, height: long }
    : { width: long, height: short };
}

// Match the OpenMasjidOS UI, which uses a clean system sans everywhere (no serif).
// Noto Sans is the bundled equivalent; weight carries the "display" emphasis.
const FONT_DISPLAY = 'Noto Sans, Noto Sans Arabic, DejaVu Sans, sans-serif';
const FONT_SANS = 'Noto Sans, Noto Sans Arabic, DejaVu Sans, sans-serif';
// Arabic-first stack: name the Arabic faces FIRST so resvg shapes Arabic with them
// directly (it doesn't always fall back from a Latin-only face). Naskh is the
// traditional hand; Sans Arabic is the modern fallback. Used for Arabic hadith text.
const FONT_ARABIC = 'Noto Naskh Arabic, Noto Sans Arabic, Noto Sans, DejaVu Sans, sans-serif';

// Glass surfaces are white-translucent regardless of theme, so the scene (or the
// masjid's photo) shows through them — that is what reads as "glass".
const GLASS = 'rgba(255,255,255,0.06)';
const GLASS_RAISED = 'rgba(255,255,255,0.10)';
const HAIR = 'rgba(255,255,255,0.16)';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Rough rendered width of a string at a given font size (no real metrics; good
 *  enough to place an AM/PM marker and to size click-to-edit hotspots). */
function approxWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    if (ch === ':' || ch === '.' || ch === ' ' || ch === "'") w += 0.3;
    else if (/[0-9]/.test(ch)) w += 0.56;
    else if (/[A-Z]/.test(ch)) w += 0.64;
    else w += 0.52;
  }
  return w * size;
}

/** A click-to-edit region collected during a render (only when a sink is given);
 *  coordinates are fractions of the canvas so the UI can overlay them at any size. */
export interface Hotspot {
  id: string;
  /** the text currently rendered there (used to prefill the edit field) */
  value: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}
interface RawHotspot {
  id: string;
  value: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
let HOT: RawHotspot[] | null = null;
// When true, time colons are drawn dim this frame (the "blink"). Toggled per second
// in build() from the frame time; the 1fps render gives a gentle 1s-on/1s-off blink.
let COLON_DIM = false;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Lighten a solid hex toward white by `amt` (0..1). Used so the clock gradient
 *  follows the chosen text colour instead of always starting at white. */
function lighten(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * clamp(amt, 0, 1));
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Blend two solid hex colours: t=0 → a, t=1 → b. */
function mixHex(a: string, b: string, t: number): string {
  const pa = /^#?([0-9a-f]{6})$/i.exec(a.trim());
  const pb = /^#?([0-9a-f]{6})$/i.exec(b.trim());
  if (!pa || !pb) return a;
  const na = parseInt(pa[1], 16), nb = parseInt(pb[1], 16);
  const k = clamp(t, 0, 1);
  const ch = (sh: number) => Math.round(((na >> sh) & 255) + (((nb >> sh) & 255) - ((na >> sh) & 255)) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Derive the dim/faint text shades from a chosen main text colour. We blend toward
 *  a neutral grey to make them *solid* (de-emphasised but readable), rather than
 *  semi-transparent — a translucent dim text lets a busy photo show through and
 *  washes out to an unreadable grey (that was the "grey Adhan column" bug). This
 *  mirrors how the theme palettes define solid textDim/textFaint. */
function derivedText(hex: string): Pick<Palette, 'text' | 'textDim' | 'textFaint'> {
  const NEUTRAL = '#7c7c7c';
  return { text: hex, textDim: mixHex(hex, NEUTRAL, 0.34), textFaint: mixHex(hex, NEUTRAL, 0.56) };
}

/**
 * Resolve the effective text colours for a timetable. A manual `textColor`
 * (hex) always wins. Otherwise "auto": keep the theme's tuned text, except when
 * a custom background photo is light enough that light text would wash out — then
 * flip to dark text. `bgLight` is decided by the render worker (it can sample the
 * photo); themed scenes leave it undefined and use the theme palette as-is.
 */
function applyTextColor(base: Palette, textColor: string | undefined, hasImage: boolean, bgLight: boolean): Palette {
  if (textColor && /^#?[0-9a-f]{6}$/i.test(textColor.trim())) {
    const hex = textColor.trim().startsWith('#') ? textColor.trim() : `#${textColor.trim()}`;
    return { ...base, ...derivedText(hex) };
  }
  if (hasImage && bgLight) {
    return { ...base, ...derivedText('#10161d') };
  }
  return base;
}

interface ClockText {
  time: string;
  period: string;
}

function fmtClock(hours: number, timeFormat: string, withSeconds = false): ClockText {
  let h: number, m: number, s = 0;
  if (withSeconds) {
    // Second precision (floor) — a live wall clock shouldn't round the minute up.
    let total = Math.floor(hours * 3600);
    total = ((total % 86400) + 86400) % 86400;
    h = Math.floor(total / 3600);
    m = Math.floor((total % 3600) / 60);
    s = total % 60;
  } else {
    // Minute precision — FLOOR, never round: a wall clock must not show the next
    // minute early (rounding made 10:53:40 read as 10:54, i.e. up to a minute fast).
    let total = Math.floor(hours * 60);
    total = ((total % 1440) + 1440) % 1440;
    h = Math.floor(total / 60);
    m = total % 60;
  }
  const sec = withSeconds ? `:${pad2(s)}` : '';
  if (timeFormat === '24h') return { time: `${pad2(h)}:${pad2(m)}${sec}`, period: '' };
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { time: `${h}:${pad2(m)}${sec}`, period };
}

function fmtShort(hours: number | null, timeFormat: string): string {
  if (hours == null || !Number.isFinite(hours)) return '—';
  const c = fmtClock(hours, timeFormat);
  return c.period ? `${c.time} ${c.period}` : c.time; // AM/PM stays uppercase
}

function gregorian(parts: { year: number; month: number; day: number }, lang: string, offsetDays = 0): string {
  return new Intl.DateTimeFormat(lang, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays, 12)));
}

function hijri(parts: { year: number; month: number; day: number }, lang: string, offsetDays = 0): string {
  try {
    return new Intl.DateTimeFormat(`${lang}-u-ca-islamic-umalqura`, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays, 12)));
  } catch {
    return '';
  }
}

/** Is the current minute-of-day inside a daily "HH:MM"–"HH:MM" window? Empty/equal
 *  bounds = always on. Handles windows that wrap past midnight. */
function inDailyWindow(nowMin: number, start: string, end: string): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s == null || e == null) return true;
  const sm = Math.round(s * 60);
  const em = Math.round(e * 60);
  if (sm === em) return true;
  return sm < em ? nowMin >= sm && nowMin < em : nowMin >= sm || nowMin < em;
}

/** Which announcement image (if any) should be the backdrop right now. The display
 *  alternates: `everySeconds` of normal timetable, then `forSeconds` of cycling
 *  images (each `imageSeconds`), within the daily window. Stateless — derived from
 *  the clock so every screen/worker agrees. Returns the image filename or null. */
export function activeAnnouncementImage(tt: Timetable, now: Date): string | null {
  const a = tt.announcements;
  if (!a || !a.enabled || !a.images || a.images.length === 0) return null;
  const parts = localParts(now, tt.timezone || undefined);
  if (!inDailyWindow(parts.hour * 60 + parts.minute, a.start, a.end)) return null;
  const every = Math.max(1, Math.floor(a.everySeconds));
  const forS = Math.max(1, Math.floor(a.forSeconds));
  const imgS = Math.max(1, Math.floor(a.imageSeconds));
  const cycle = every + forS;
  const phase = ((Math.floor(now.getTime() / 1000) % cycle) + cycle) % cycle;
  if (phase < every) return null; // showing the normal timetable
  const idx = Math.floor((phase - every) / imgS) % a.images.length;
  return a.images[idx] ?? null;
}

// Separator between ticker messages. Uses non-breaking spaces ( ) because SVG
// <text> collapses ordinary whitespace runs to a single space — nbsp keeps the gap,
// and ffmpeg drawtext renders it fine too.
const TICKER_SEP = '     •     ';

/** The combined ticker text active right now (messages within their windows), or ''. */
function activeTickerText(tt: Timetable, parts: ReturnType<typeof localParts>): string {
  const tk = tt.ticker;
  if (!tk || !tk.enabled || !tk.messages || tk.messages.length === 0) return '';
  const nowMin = parts.hour * 60 + parts.minute;
  return tk.messages
    .filter((mm) => mm.text.trim() && inDailyWindow(nowMin, mm.start, mm.end))
    .map((mm) => mm.text.trim())
    .join(TICKER_SEP);
}

/** The active ticker string for the given instant (used by the renderer to drive the
 *  smooth ffmpeg-side scroll). */
export function activeTickerString(tt: Timetable, now: Date): string {
  // A full-screen overlay (zawāl notice, pre-Iqāmah countdown, during-salah hadith)
  // takes over the whole screen — hide the scrolling ticker while it shows.
  if (overlayActiveNow(tt, now)) return '';
  return activeTickerText(tt, localParts(now, tt.timezone || undefined));
}

/** Whether the timetable currently has a scrolling ticker. */
export function tickerActive(tt: Timetable, now: Date): boolean {
  if (!tt.ticker?.enabled || !tt.ticker.messages?.length) return false;
  return activeTickerString(tt, now).length > 0;
}

/** Geometry of the bottom ticker strip — shared by the SVG band and the ffmpeg
 *  drawtext overlay so the moving text lands exactly on the strip. */
export function tickerLayout(_W: number, H: number): { y: number; bandH: number; fs: number } {
  const bandH = clamp(H * 0.07, 30, 92);
  return { y: H - bandH, bandH, fs: clamp(bandH * 0.46, 14, 40) };
}

interface TextOpts {
  size: number;
  fill: string;
  family?: string;
  weight?: number;
  anchor?: 'start' | 'middle' | 'end';
  letter?: number;
  opacity?: number;
  /** marks this text as click-to-edit in the live editor (collected into a sink) */
  editId?: string;
  /** clock/countdown time → the colons blink (dim every other second) like a digital clock */
  blink?: boolean;
}

function text(x: number, baseline: number, content: string, o: TextOpts): string {
  const attrs = [
    `x="${x.toFixed(1)}"`,
    `y="${baseline.toFixed(1)}"`,
    `font-family="${o.family ?? FONT_SANS}"`,
    `font-size="${o.size.toFixed(1)}"`,
    `font-weight="${o.weight ?? 400}"`,
    `fill="${o.fill}"`,
    `text-anchor="${o.anchor ?? 'start'}"`,
    o.letter ? `letter-spacing="${o.letter}"` : '',
    o.opacity != null ? `opacity="${o.opacity}"` : '',
    'font-variant-numeric="tabular-nums"',
  ].filter(Boolean);
  if (HOT && o.editId) {
    const w = Math.max(o.size * 1.2, approxWidth(content, o.size) + (o.letter ?? 0) * Math.max(0, content.length - 1));
    const anchor = o.anchor ?? 'start';
    const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    HOT.push({ id: o.editId, value: content, x: left - o.size * 0.15, y: baseline - o.size * 0.92, w: w + o.size * 0.3, h: o.size * 1.28 });
  }
  let inner = esc(content);
  // Blink the colon(s) by dimming just those glyphs (wrapped in a tspan so the digit
  // positions never move — only its opacity changes between frames).
  if (o.blink && COLON_DIM && inner.includes(':')) {
    inner = inner.split(':').join('<tspan fill-opacity="0.12">:</tspan>');
  }
  return `<text ${attrs.join(' ')}>${inner}</text>`;
}

function rect(x: number, y: number, w: number, h: number, r: number, fill: string, extra = ''): string {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(
    1,
  )}" rx="${r.toFixed(1)}" ry="${r.toFixed(1)}" fill="${fill}" ${extra}/>`;
}

/** A frosted-glass panel: translucent fill + a top sheen + a hairline border. */
function glass(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  opts: { fill?: string; stroke?: string; sw?: number; glow?: string } = {},
): string {
  const fill = opts.fill ?? GLASS;
  const stroke = opts.stroke ?? HAIR;
  const sw = opts.sw ?? 1;
  const parts: string[] = [];
  if (opts.glow) {
    // A subtle outer ring (no blur — keeps per-frame rendering cheap for live video).
    parts.push(
      `<rect x="${(x - 2).toFixed(1)}" y="${(y - 2).toFixed(1)}" width="${(w + 4).toFixed(1)}" height="${(h + 4).toFixed(1)}" rx="${(r + 2).toFixed(1)}" fill="none" stroke="${opts.glow}" stroke-width="2" opacity="0.4"/>`,
    );
  }
  parts.push(rect(x, y, w, h, r, fill));
  parts.push(rect(x, y, w, h, r, 'url(#sheen)'));
  parts.push(rect(x, y, w, h, r, 'url(#litsheen)')); // light from the sun/moon falls on the glass
  parts.push(rect(x, y, w, h, r, 'none', `stroke="${stroke}" stroke-width="${sw}"`));
  return parts.join('');
}

/** The masjid brand: an uploaded logo image if provided, else the built-in
 *  dome + mihrab-arch mark in the primary colour. */
function mark(x: number, y: number, size: number, color: string, logo?: string | null): string {
  if (logo) {
    return `<image href="${logo}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  const s = size / 48;
  const t = `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s.toFixed(3)})`;
  return `<g transform="${t}" fill="${color}">
    <path d="M24 3c1.6 0 3 .6 4 1.6A5.6 5.6 0 0 0 24 14a5.6 5.6 0 0 0 4-1.4A5.8 5.8 0 0 1 24 3Z"/>
    <path d="M12 26c0-8 5.4-12 12-12s12 4 12 12v2H12v-2Z" opacity="0.9"/>
    <path d="M10 28h28v15H10V28Zm10 15V36a4 4 0 0 1 8 0v7h-8Z" opacity="0.55"/>
  </g>`;
}

interface Row {
  key: string;
  label: string;
  adhan: number | null;
  iqamah: number | null;
  minor?: boolean;
  active?: boolean;
  next?: boolean;
  /** when set (>0) the row is the Nth Jumu'ah → label reads "Jumu'ah 1", "Jumu'ah 2", … */
  jumuahNum?: number;
}

/** The on-screen name for a row: the (localized, overridable) label, plus a Jumu'ah
 *  number when there is more than one Jumu'ah (so two times don't read as Adhan/Iqamah). */
function rowName(r: Row, L: Record<string, string>): string {
  const base = L[r.label] ?? r.label;
  return r.jumuahNum ? `${base} ${r.jumuahNum}` : base;
}

const PRAYER_LABELS: Record<string, Record<string, string>> = {
  en: { fajr: 'Fajr', sunrise: 'Sunrise', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha', jumuah: "Jumu'ah", iqamah: 'Iqāmah', athan: 'Adhan', next: 'Next prayer', prayer: 'Prayer' },
  ar: { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء', jumuah: 'الجمعة', iqamah: 'الإقامة', athan: 'الأذان', next: 'الصلاة القادمة', prayer: 'الصلاة' },
  ur: { fajr: 'فجر', sunrise: 'طلوع', dhuhr: 'ظہر', asr: 'عصر', maghrib: 'مغرب', isha: 'عشاء', jumuah: 'جمعہ', iqamah: 'اقامہ', athan: 'اذان', next: 'اگلی نماز', prayer: 'نماز' },
};

function labels(lang: string, overrides?: Record<string, string>): Record<string, string> {
  const base = PRAYER_LABELS[lang] ?? PRAYER_LABELS.en;
  if (!overrides) return base;
  // Only non-empty overrides win, so clearing a custom label restores the default.
  const merged: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(overrides)) if (typeof v === 'string' && v.trim()) merged[k] = v;
  return merged;
}

interface Model {
  parts: ReturnType<typeof localParts>;
  times: PrayerTimes;
  rows: Row[];
  activeKey: string;
  nextKey: string;
  nextHours: number;
  /** true when nextHours/nextKey point at the CURRENT prayer's Iqāmah (its adhan has
   *  passed, iqamah hasn't) — so the countdown reads "Iqāmah in" and the next prayer
   *  isn't highlighted until this one is over. */
  countdownToIqamah: boolean;
  isFriday: boolean;
  /** configured Jumu'ah time(s), decimal hours, sorted — shown as a separate strip
   *  on every day (NOT part of the daily prayer rows). */
  jumuah: number[];
}

function buildModel(tt: Timetable, now: Date): Model {
  const tz = tt.timezone || undefined;
  const parts = localParts(now, tz);
  const off = timezoneOffsetHours(now, tz);
  // A 'Custom' method uses the masjid's own Fajr/Isha sun-depression angles.
  const method = tt.method === 'Custom' ? { label: 'Custom', fajr: tt.fajrAngle ?? 18, isha: tt.ishaAngle ?? 17 } : tt.method;
  const times = prayerTimes(parts, tt.latitude!, tt.longitude!, off, method, tt.asrMadhab);

  const tomorrow = new Date(now.getTime() + 86400000);
  const tParts = localParts(tomorrow, tz);
  const tOff = timezoneOffsetHours(tomorrow, tz);
  const tomorrowFajr = prayerTimes(tParts, tt.latitude!, tt.longitude!, tOff, method, tt.asrMadhab).fajr;

  const nowHours = parts.hour + parts.minute / 60 + parts.second / 3600;
  const isFriday = dayOfWeek(now, tz) === 5;
  // Jumu'ah times are shown as a SEPARATE strip on EVERY day; they don't replace
  // Dhuhr in the daily table and don't drive the active/next countdown (which always
  // tracks the five daily prayers, Dhuhr included).
  const jumuah = tt.jumuah.map(parseHHMM).filter((x): x is number => x != null).sort((a, b) => a - b);
  const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
  const eff: Record<string, number> = { ...(times as unknown as Record<string, number>) };
  let activeKey: string | null = null;
  let nextKey: string | null = null;
  let nextHours = 0;
  for (const k of order) if (eff[k] <= nowHours) activeKey = k;
  for (const k of order) {
    if (eff[k] > nowHours) {
      nextKey = k;
      nextHours = eff[k];
      break;
    }
  }
  if (!nextKey) {
    nextKey = 'fajr';
    nextHours = tomorrowFajr + 24;
    activeKey = 'isha';
  }
  if (!activeKey) activeKey = 'isha';

  // A CSV-imported per-day override (keyed by month-day) wins over the rule.
  const dayKey = `${pad2(parts.month)}-${pad2(parts.day)}`;
  const yearRow = tt.iqamahYear?.[dayKey];
  const iq = (k: keyof typeof tt.iqamah, adhan: number): number | null => {
    const csv = yearRow?.[k];
    const csvH = csv ? parseHHMM(csv) : null;
    if (csvH != null) return csvH;
    return iqamahHours(adhan, tt.iqamah[k]);
  };
  const rows: Row[] = [];
  rows.push({ key: 'fajr', label: 'fajr', adhan: times.fajr, iqamah: iq('fajr', times.fajr) });
  if (tt.showSunrise) rows.push({ key: 'sunrise', label: 'sunrise', adhan: times.sunrise, iqamah: null, minor: true });
  rows.push({ key: 'dhuhr', label: 'dhuhr', adhan: times.dhuhr, iqamah: iq('dhuhr', times.dhuhr) });
  rows.push({ key: 'asr', label: 'asr', adhan: times.asr, iqamah: iq('asr', times.asr) });
  rows.push({ key: 'maghrib', label: 'maghrib', adhan: times.maghrib, iqamah: iq('maghrib', times.maghrib) });
  rows.push({ key: 'isha', label: 'isha', adhan: times.isha, iqamah: iq('isha', times.isha) });

  // Highlight/countdown fix: while a prayer's Adhan has passed but its Iqāmah hasn't,
  // THAT prayer stays the focus — count down to its Iqāmah, and don't promote the next
  // prayer yet. Only once the Iqāmah passes does the upcoming prayer become "next".
  let countdownToIqamah = false;
  const inWindow = rows.find(
    (r) => r.adhan != null && r.iqamah != null && r.adhan <= nowHours && nowHours < r.iqamah,
  );
  if (inWindow) {
    nextKey = inWindow.key;
    nextHours = inWindow.iqamah!;
    countdownToIqamah = true;
  }

  for (const r of rows) {
    if (r.key === activeKey) r.active = true;
    if (r.key === nextKey) r.next = true;
  }
  return { parts, times, rows, activeKey, nextKey, nextHours, countdownToIqamah, isFriday, jumuah };
}

/** One prayer line for the public web widget. */
export interface WidgetRow {
  key: string;
  /** display name (localized + Jumu'ah-numbered) */
  label: string;
  /** "h:mm" formatted Adhan time (or null) */
  adhan: string | null;
  /** "h:mm" formatted Iqamah time (or null) */
  iqamah: string | null;
  active: boolean;
  next: boolean;
}
export interface WidgetData {
  masjidName: string;
  hijri: string;
  gregorian: string;
  timeFormat: TimeFormat;
  language: Lang;
  /** RTL languages render the widget right-to-left */
  rtl: boolean;
  rows: WidgetRow[];
}

/** Compute today's prayer + Jumu'ah times for the embeddable widget (just the times,
 *  not the full TV scene). Sunrise and other "minor" rows are omitted. */
export function widgetData(tt: Timetable, now: Date): WidgetData {
  const m = buildModel(tt, now);
  const L = labels(tt.language, tt.labels);
  const lang = (tt.language || 'en') as Lang;
  return {
    masjidName: tt.masjidName || 'Our Masjid',
    hijri: hijri(m.parts, tt.language, tt.hijriOffset ?? 0),
    gregorian: gregorian(m.parts, tt.language, tt.gregorianOffset ?? 0),
    timeFormat: tt.timeFormat,
    language: lang,
    rtl: lang === 'ar' || lang === 'ur',
    rows: [
      ...m.rows
        .filter((r) => !r.minor) // drop Sunrise — widget shows the 5 prayers + Jumu'ah
        .map((r) => ({
          key: r.key,
          label: rowName(r, L),
          adhan: r.adhan != null ? fmtShort(r.adhan, tt.timeFormat) : null,
          iqamah: r.iqamah != null ? fmtShort(r.iqamah, tt.timeFormat) : null,
          active: !!r.active,
          next: !!r.next,
        })),
      // Jumu'ah as separate entries (every day), numbered when there's more than one.
      ...m.jumuah.map((t, i) => ({
        key: `jumuah${i + 1}`,
        label: (L.jumuah ?? "Jumu'ah") + (m.jumuah.length > 1 ? ` ${i + 1}` : ''),
        adhan: null,
        iqamah: fmtShort(t, tt.timeFormat),
        active: false,
        next: false,
      })),
    ],
  };
}

/** Where the sun/moon sits right now (an arc across the sky) + day/night. */
interface Celestial {
  isDay: boolean;
  x: number;
  y: number;
}
function celestialPos(times: PrayerTimes, nowHours: number, W: number, H: number, P: number): Celestial {
  const { sunrise, sunset } = times;
  const isDay = nowHours >= sunrise && nowHours < sunset;
  let t: number;
  if (isDay) {
    t = clamp((nowHours - sunrise) / Math.max(0.1, sunset - sunrise), 0, 1);
  } else {
    const span = sunrise + 24 - sunset;
    const elapsed = nowHours >= sunset ? nowHours - sunset : nowHours + 24 - sunset;
    t = clamp(elapsed / Math.max(0.1, span), 0, 1);
  }
  const left = P + W * 0.08;
  const right = W - P - W * 0.08;
  const x = left + t * (right - left);
  const y = H * 0.34 - Math.sin(t * Math.PI) * H * 0.2;
  return { isDay, x, y };
}

/** Shared <defs>. The celestial glow is centred on the sun/moon position. */
function defs(p: Palette, hasImage: boolean, cel: Celestial, W: number, H: number): string {
  const glowColor = cel.isDay ? '#ffd98a' : '#cdd9f2';
  const cxPct = ((cel.x / W) * 100).toFixed(1);
  const cyPct = ((cel.y / H) * 100).toFixed(1);
  return `<defs>
    <radialGradient id="scene" cx="50%" cy="-10%" r="130%">
      <stop offset="0%" stop-color="${p.bg2}"/>
      <stop offset="55%" stop-color="${p.bg}"/>
      <stop offset="100%" stop-color="${p.bg}"/>
    </radialGradient>
    <radialGradient id="cglow" cx="${cxPct}%" cy="${cyPct}%" r="60%">
      <stop offset="0%" stop-color="${hexToRgba(glowColor, cel.isDay ? 0.4 : 0.28)}"/>
      <stop offset="45%" stop-color="${hexToRgba(p.primary, 0.12)}"/>
      <stop offset="100%" stop-color="${hexToRgba(p.primary, 0)}"/>
    </radialGradient>
    <radialGradient id="suncorona" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${hexToRgba('#fff3cc', 0.34)}"/>
      <stop offset="34%" stop-color="${hexToRgba('#ffd98a', 0.16)}"/>
      <stop offset="66%" stop-color="${hexToRgba('#ffc869', 0.05)}"/>
      <stop offset="100%" stop-color="${hexToRgba('#ffc869', 0)}"/>
    </radialGradient>
    <radialGradient id="sun" cx="50%" cy="48%" r="50%">
      <stop offset="0%" stop-color="#fff7db"/>
      <stop offset="48%" stop-color="#ffe7a3"/>
      <stop offset="82%" stop-color="#ffd277"/>
      <stop offset="100%" stop-color="${hexToRgba('#f6c256', 0.85)}"/>
    </radialGradient>
    <radialGradient id="sunray" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${hexToRgba('#ffe9b0', 0.35)}"/>
      <stop offset="100%" stop-color="${hexToRgba('#ffe9b0', 0)}"/>
    </radialGradient>
    <radialGradient id="moon" cx="38%" cy="34%" r="68%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#dde4f4"/>
      <stop offset="100%" stop-color="#b6c2dc"/>
    </radialGradient>
    <radialGradient id="moonglow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${hexToRgba('#cdd9f2', 0.45)}"/>
      <stop offset="60%" stop-color="${hexToRgba('#cdd9f2', 0.12)}"/>
      <stop offset="100%" stop-color="${hexToRgba('#cdd9f2', 0)}"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
      <stop offset="42%" stop-color="rgba(255,255,255,0.03)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
    <linearGradient id="litsheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${hexToRgba(glowColor, cel.isDay ? 0.22 : 0.14)}"/>
      <stop offset="55%" stop-color="${hexToRgba(glowColor, 0)}"/>
      <stop offset="100%" stop-color="${hexToRgba(glowColor, 0)}"/>
    </linearGradient>
    <linearGradient id="clockg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${lighten(p.text, 0.3)}"/>
      <stop offset="100%" stop-color="${p.textDim}"/>
    </linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${hexToRgba(p.bg, 0.55)}"/>
      <stop offset="50%" stop-color="${hexToRgba(p.bg, 0.35)}"/>
      <stop offset="100%" stop-color="${hexToRgba(p.bg, 0.7)}"/>
    </linearGradient>
    ${hasImage ? `<filter id="frost" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>` : ''}
    <pattern id="khatam" width="58" height="58" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="${p.pattern}" stroke-width="1" opacity="0.05">
        <path d="M0 0 L58 58 M58 0 L0 58"/>
        <rect x="15" y="15" width="28" height="28" transform="rotate(45 29 29)"/>
      </g>
    </pattern>
  </defs>`;
}

/** A whisper-soft sunburst: thin tapered rays that fade out via the #sunray
 *  gradient. Kept very subtle (low opacity, short) so it reads as a gentle shimmer,
 *  not hard spikes. Blur-free, so each video frame stays cheap to rasterize. */
function sunburst(cx: number, cy: number, r: number): string {
  const N = 12;
  const inner = r * 1.2;
  const out: string[] = [`<g opacity="0.16">`];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const long = i % 2 === 0;
    const len = inner + r * (long ? 1.7 : 1.0);
    const halfBase = r * 0.09;
    const tx = cx + Math.cos(a) * len;
    const ty = cy + Math.sin(a) * len;
    const px = Math.cos(a + Math.PI / 2);
    const py = Math.sin(a + Math.PI / 2);
    const b1x = cx + Math.cos(a) * inner + px * halfBase;
    const b1y = cy + Math.sin(a) * inner + py * halfBase;
    const b2x = cx + Math.cos(a) * inner - px * halfBase;
    const b2y = cy + Math.sin(a) * inner - py * halfBase;
    out.push(
      `<path d="M${b1x.toFixed(1)} ${b1y.toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)} L${b2x.toFixed(1)} ${b2y.toFixed(1)} Z" fill="url(#sunray)" opacity="${long ? 1 : 0.6}"/>`,
    );
  }
  out.push(`</g>`);
  return out.join('');
}

/** The sun (day) or moon (night). Soft edges come from gradient fades, not a blur
 *  filter. The sun is a gentle warm orb with a faint corona + the lightest ray
 *  shimmer; the glow it casts onto the glass comes from #cglow + #litsheen. */
function celestialBody(cel: Celestial, W: number, H: number): string {
  const r = Math.min(W, H) * 0.04;
  const cx = cel.x.toFixed(1);
  const cy = cel.y.toFixed(1);
  if (cel.isDay) {
    return (
      `<circle cx="${cx}" cy="${cy}" r="${(r * 3.0).toFixed(1)}" fill="url(#suncorona)"/>` +
      sunburst(cel.x, cel.y, r) +
      `<circle cx="${cx}" cy="${cy}" r="${(r * 1.0).toFixed(1)}" fill="url(#sun)"/>`
    );
  }
  return (
    `<circle cx="${cx}" cy="${cy}" r="${(r * 2.6).toFixed(1)}" fill="url(#moonglow)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="url(#moon)"/>` +
    // a couple of faint craters for a less "fake" moon
    `<circle cx="${(cel.x - r * 0.3).toFixed(1)}" cy="${(cel.y - r * 0.25).toFixed(1)}" r="${(r * 0.16).toFixed(1)}" fill="rgba(120,135,165,0.22)"/>` +
    `<circle cx="${(cel.x + r * 0.28).toFixed(1)}" cy="${(cel.y + r * 0.18).toFixed(1)}" r="${(r * 0.12).toFixed(1)}" fill="rgba(120,135,165,0.18)"/>` +
    `<circle cx="${(cel.x + r * 0.05).toFixed(1)}" cy="${(cel.y + r * 0.4).toFixed(1)}" r="${(r * 0.09).toFixed(1)}" fill="rgba(120,135,165,0.16)"/>`
  );
}

/** Barely-there light shafts spilling from the sun/moon across the scene, so the
 *  light just softly falls over the glass. Extremely low opacity; no blur. */
function lightBeams(cel: Celestial, W: number, H: number): string {
  const color = cel.isDay ? '#ffe9b0' : '#c9d6f0';
  const baseA = cel.isDay ? 0.022 : 0.014;
  const out: string[] = [`<g>`];
  // two soft beams fanning toward the lower part of the screen
  const spread = [-0.16, 0.2];
  for (let i = 0; i < spread.length; i++) {
    const ang = Math.PI / 2 + spread[i]; // mostly downward
    const len = H * 1.2;
    const tipx = cel.x + Math.cos(ang) * len;
    const tipy = cel.y + Math.sin(ang) * len;
    const halfBase = Math.min(W, H) * 0.04;
    const px = Math.cos(ang + Math.PI / 2) * halfBase;
    const py = Math.sin(ang + Math.PI / 2) * halfBase;
    const wideEnd = Math.min(W, H) * 0.13;
    const wx = Math.cos(ang + Math.PI / 2) * wideEnd;
    const wy = Math.sin(ang + Math.PI / 2) * wideEnd;
    out.push(
      `<path d="M${(cel.x + px).toFixed(1)} ${(cel.y + py).toFixed(1)} L${(tipx + wx).toFixed(1)} ${(tipy + wy).toFixed(1)} L${(tipx - wx).toFixed(1)} ${(tipy - wy).toFixed(1)} L${(cel.x - px).toFixed(1)} ${(cel.y - py).toFixed(1)} Z" fill="${hexToRgba(color, baseA)}"/>`,
    );
  }
  out.push(`</g>`);
  return out.join('');
}

// English ordinals for the Jumu'ah label (1st, 2nd, …); other languages use a number.
const JUMUAH_ORD = ['1st', '2nd', '3rd', '4th', '5th'];

// ── Display widgets ──────────────────────────────────────────────────────────
// Each widget draws itself into a box {x,y,w,h}. A layout is just an arrangement
// of these glass panels over the sky scene, so panels are easy to move/resize and
// to shuffle between layouts for burn-in. The sun/moon glow shows through the gaps.
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Everything a widget needs that isn't geometry, bundled so layouts stay tidy. */
interface Ctx {
  p: Palette;
  L: Record<string, string>;
  logo: string | null;
  timeFormat: string;
  lang: string;
  masjidName: string;
  clock: ClockText;
  greg: string;
  hij: string;
  /** the (localized) prayer the countdown points at, e.g. "Asr" */
  nextLabel: string;
  /** "ADHAN" | "IQAMAH" (uppercased) — which event the countdown is to */
  eventWord: string;
  /** live "H:MM:SS" / "M:SS" string until that event */
  counter: string;
  showLogo: boolean;
  showDates: boolean;
  showCountdown: boolean;
}

/** Brand panel: logo + masjid name on one glass card. */
function panelHeader(b: Box, c: Ctx): string {
  const out: string[] = [];
  out.push(glass(b.x, b.y, b.w, b.h, clamp(Math.min(b.w, b.h) * 0.2, 10, 34), { fill: GLASS_RAISED }));
  const pad = b.w * 0.06;
  const midY = b.y + b.h / 2;
  let nameX = b.x + pad;
  if (c.showLogo) {
    const ms = Math.min(b.h * 0.56, b.w * 0.22);
    out.push(mark(b.x + pad, midY - ms / 2, ms, c.p.primary, c.logo));
    nameX = b.x + pad + ms + b.w * 0.035;
  }
  const avail = b.x + b.w - pad - nameX;
  let ns = clamp(b.h * 0.34, 16, 60);
  const nw = approxWidth(c.masjidName, ns);
  if (nw > avail) ns = Math.max(13, ns * (avail / nw));
  out.push(text(nameX, midY + ns * 0.34, c.masjidName, { size: ns, fill: c.p.text, family: FONT_DISPLAY, weight: 700, anchor: 'start', editId: 'masjidName' }));
  return out.join('');
}

/** Clock panel: big right-aligned time, the dates, and a small live countdown to the
 *  next prayer underneath (replaces the old big central clock / countdown ring). */
function panelClock(b: Box, c: Ctx): string {
  const out: string[] = [];
  out.push(glass(b.x, b.y, b.w, b.h, clamp(Math.min(b.w, b.h) * 0.1, 10, 30), { fill: GLASS_RAISED }));
  const pad = b.w * 0.06;
  const right = b.x + b.w - pad;
  // Big time, with a smaller AM/PM marker just after it; shrink to fit the panel.
  let ts = clamp(b.h * 0.4, 28, 120);
  const need = approxWidth(c.clock.time, ts) + (c.clock.period ? ts * 0.12 + approxWidth(c.clock.period, ts * 0.32) : 0);
  const avail = b.w - 2 * pad;
  if (need > avail) ts *= avail / need;
  const ps = ts * 0.32;
  const pW = c.clock.period ? approxWidth(c.clock.period, ps) : 0;
  const pGap = c.clock.period ? ts * 0.12 : 0;
  const tBase = b.y + b.h * 0.4;
  out.push(text(right - pW - pGap, tBase, c.clock.time, { size: ts, fill: 'url(#clockg)', family: FONT_DISPLAY, weight: 700, anchor: 'end', letter: -ts * 0.01, blink: true }));
  if (c.clock.period) out.push(text(right, tBase - ts * 0.02, c.clock.period, { size: ps, fill: c.p.textDim, family: FONT_DISPLAY, weight: 700, anchor: 'end' }));
  if (c.showDates) {
    const ds = clamp(b.h * 0.095, 11, 22);
    out.push(text(right, b.y + b.h * 0.6, c.greg, { size: ds, fill: c.p.textDim, family: FONT_DISPLAY, anchor: 'end' }));
    if (c.hij) out.push(text(right, b.y + b.h * 0.74, c.hij, { size: ds * 0.96, fill: c.p.goldSoft, family: FONT_DISPLAY, anchor: 'end' }));
  }
  if (c.showCountdown) {
    const cs = clamp(b.h * 0.088, 10, 22);
    const line = `${c.nextLabel.toUpperCase()} ${c.eventWord} IN   ${c.counter}`;
    let s = cs;
    const lw = approxWidth(line, s);
    if (lw > avail) s *= avail / lw;
    out.push(text(right, b.y + b.h * 0.92, line, { size: s, fill: c.p.primarySoft, family: FONT_DISPLAY, weight: 700, anchor: 'end', letter: 0.5, blink: true }));
  }
  return out.join('');
}

/** The prayer list as a glass table: PRAYER · ADHAN · IQAMAH, names on the leading
 *  side (no Arabic gloss), the active prayer highlighted with a primary accent bar. */
function panelTable(b: Box, m: Model, c: Ctx): string {
  const out: string[] = [];
  out.push(glass(b.x, b.y, b.w, b.h, clamp(Math.min(b.w, b.h) * 0.06, 12, 34), { fill: GLASS_RAISED }));
  const pad = b.w * 0.045;
  const innerX = b.x + pad;
  const innerR = b.x + b.w - pad;
  // For very wide tables, pull the time columns inward so they don't strand at the edge.
  const wide = b.w > b.h * 2.2;
  const colIq = wide ? b.x + b.w * 0.84 : innerR;
  const colAd = wide ? b.x + b.w * 0.62 : b.x + b.w * 0.7;
  const headSize = clamp(b.h * 0.05, 10, 20);
  let y = b.y + pad + headSize;
  out.push(text(innerX, y, (c.L.prayer ?? 'Prayer').toUpperCase(), { size: headSize, fill: c.p.textDim, weight: 700, anchor: 'start', letter: 1.5 }));
  out.push(text(colAd, y, (c.L.athan ?? 'Adhan').toUpperCase(), { size: headSize, fill: c.p.textDim, weight: 700, anchor: 'end', letter: 1.5 }));
  out.push(text(colIq, y, (c.L.iqamah ?? 'Iqamah').toUpperCase(), { size: headSize, fill: c.p.textDim, weight: 700, anchor: 'end', letter: 1.5 }));
  y += headSize * 0.5;
  out.push(rect(innerX, y, b.w - 2 * pad, Math.max(1, b.h * 0.004), 0, hexToRgba(c.p.text, 0.12)));
  const listTop = y + headSize * 0.3;
  const listH = b.y + b.h - pad - listTop;
  const rowH = listH / m.rows.length;
  m.rows.forEach((row, i) => {
    const ry = listTop + i * rowH;
    const midY = ry + rowH * 0.66;
    if (row.active) {
      out.push(rect(b.x + pad * 0.45, ry + rowH * 0.1, b.w - pad * 0.9, rowH * 0.8, rowH * 0.22, hexToRgba(c.p.primary, 0.16)));
      out.push(rect(b.x + pad * 0.45, ry + rowH * 0.1, Math.max(3, b.w * 0.008), rowH * 0.8, 1.5, c.p.primary));
    }
    const nameColor = row.active ? c.p.primarySoft : row.next ? c.p.goldSoft : c.p.text;
    const nameSize = clamp(rowH * 0.4, 12, 36);
    out.push(text(innerX + (row.active ? b.w * 0.01 : 0), midY, rowName(row, c.L), { size: nameSize, fill: nameColor, family: FONT_SANS, weight: 600, anchor: 'start', editId: `label.${row.label}` }));
    out.push(text(colAd, midY, fmtShort(row.adhan, c.timeFormat), { size: nameSize * 0.92, fill: c.p.textDim, family: FONT_DISPLAY, weight: 600, anchor: 'end' }));
    out.push(text(colIq, midY, row.iqamah != null ? fmtShort(row.iqamah, c.timeFormat) : '—', { size: nameSize, fill: row.iqamah != null ? c.p.text : c.p.textFaint, family: FONT_DISPLAY, weight: 700, anchor: 'end' }));
  });
  return out.join('');
}

/** Jumu'ah box (shown every day): a gold-tinted glass card titled JUMU'AH, with a
 *  column per configured time — big time + a small "1st Jumu'ah" / "2nd Jumu'ah" label. */
function panelJumuah(b: Box, m: Model, c: Ctx): string {
  if (!m.jumuah.length) return '';
  const out: string[] = [];
  out.push(glass(b.x, b.y, b.w, b.h, clamp(Math.min(b.w, b.h) * 0.14, 10, 30), { fill: hexToRgba(c.p.gold, 0.06), stroke: hexToRgba(c.p.gold, 0.32) }));
  const base = c.L.jumuah ?? "Jumu'ah";
  const n = m.jumuah.length;
  const hs = clamp(b.h * 0.16, 12, 30);
  out.push(text(b.x + b.w / 2, b.y + b.h * 0.22 + hs * 0.3, base.toUpperCase(), { size: hs, fill: c.p.gold, family: FONT_DISPLAY, weight: 700, anchor: 'middle', letter: 2, editId: 'label.jumuah' }));
  out.push(rect(b.x + b.w * 0.12, b.y + b.h * 0.33, b.w * 0.76, Math.max(1, b.h * 0.006), 0, hexToRgba(c.p.gold, 0.3)));
  const slotW = b.w / n;
  const timeY = b.y + b.h * 0.64;
  const labY = b.y + b.h * 0.86;
  const timeSize = clamp(Math.min(b.h * 0.28, slotW * 0.34), 16, 60);
  const labSize = clamp(b.h * 0.11, 10, 22);
  m.jumuah.forEach((t, i) => {
    const cx = b.x + slotW * (i + 0.5);
    if (i > 0) out.push(rect(b.x + slotW * i, b.y + b.h * 0.42, Math.max(1, b.w * 0.003), b.h * 0.46, 0, hexToRgba(c.p.text, 0.1)));
    out.push(text(cx, timeY, fmtShort(t, c.timeFormat), { size: timeSize, fill: c.p.text, family: FONT_DISPLAY, weight: 700, anchor: 'middle' }));
    const lab = n === 1 ? base : c.lang === 'en' ? `${JUMUAH_ORD[i] ?? `${i + 1}th`} ${base}` : `${base} ${i + 1}`;
    out.push(text(cx, labY, lab, { size: labSize, fill: c.p.goldSoft, family: FONT_SANS, weight: 600, anchor: 'middle' }));
  });
  return out.join('');
}

/** A scrolling ticker strip along the bottom. The text is tiled and offset by the
 *  clock so it scrolls continuously; smoothness depends on the frame cadence (the
 *  renderer speeds up while a ticker is active). */
function tickerBand(msg: string, now: Date, p: Palette, W: number, H: number, bandOnly: boolean): string {
  const { y, bandH, fs } = tickerLayout(W, H);
  const out: string[] = [];
  out.push(rect(0, y, W, bandH, 0, hexToRgba(p.bg, 0.6)));
  out.push(rect(0, y, W, Math.max(1.5, bandH * 0.025), 0, hexToRgba(p.primary, 0.55)));
  // In the video pipeline the moving text is drawn by ffmpeg (smooth at output fps),
  // so we only paint the strip here. For previews (bandOnly=false) draw the text in
  // the SVG so the editor shows it.
  if (!bandOnly) {
    const seg = `${msg}${TICKER_SEP}`;
    const segW = Math.max(60, approxWidth(seg, fs));
    const speed = clamp(Math.min(W, H) * 0.04, 30, 90);
    const offset = ((now.getTime() / 1000) * speed) % segW;
    const baseline = y + bandH * 0.66;
    for (let x = -offset; x < W; x += segW) {
      out.push(text(x, baseline, seg, { size: fs, fill: p.text, family: FONT_SANS, weight: 600, anchor: 'start' }));
    }
  }
  return out.join('');
}

/** Default "Columns" arrangement (the reference look): brand top-left, clock top-right,
 *  the prayer table filling the left, the Jumu'ah box on the right — the sun/moon glows
 *  through the open gap. Portrait stacks the same widgets top-to-bottom. */
function layoutCentered(a: Box, m: Model, c: Ctx): string {
  const out: string[] = [];
  const gap = Math.min(a.w, a.h) * 0.025;
  if (a.w < a.h) {
    let y = a.y;
    const hH = a.h * 0.1;
    out.push(panelHeader({ x: a.x, y, w: a.w, h: hH }, c));
    y += hH + gap;
    const cH = a.h * 0.22;
    out.push(panelClock({ x: a.x, y, w: a.w, h: cH }, c));
    y += cH + gap;
    const jH = m.jumuah.length ? a.h * 0.16 : 0;
    const tH = a.y + a.h - (jH ? jH + gap : 0) - y;
    out.push(panelTable({ x: a.x, y, w: a.w, h: tH }, m, c));
    if (jH) out.push(panelJumuah({ x: a.x, y: a.y + a.h - jH, w: a.w, h: jH }, m, c));
    return out.join('');
  }
  const leftW = a.w * 0.54;
  const rightX = a.x + leftW + gap;
  const rightW = a.x + a.w - rightX;
  const headerH = a.h * 0.18;
  out.push(panelHeader({ x: a.x, y: a.y, w: leftW, h: headerH }, c));
  const tableY = a.y + headerH + gap;
  out.push(panelTable({ x: a.x, y: tableY, w: leftW, h: a.y + a.h - tableY }, m, c));
  const clockH = a.h * 0.32;
  out.push(panelClock({ x: rightX, y: a.y, w: rightW, h: clockH }, c));
  if (m.jumuah.length) {
    const jH = Math.min(a.h * 0.26, a.h - clockH - gap);
    out.push(panelJumuah({ x: rightX, y: a.y + a.h - jH, w: rightW, h: jH }, m, c));
  }
  return out.join('');
}

/** "Sidebar" arrangement: the prayer table fills the right; brand, a tall clock and
 *  the Jumu'ah box stack down the left. (Mirror of Columns — moves the table across
 *  the screen for burn-in.) */
function layoutSidebar(a: Box, m: Model, c: Ctx): string {
  const out: string[] = [];
  const gap = Math.min(a.w, a.h) * 0.025;
  const leftW = a.w * 0.42;
  const rightX = a.x + leftW + gap;
  const rightW = a.x + a.w - rightX;
  out.push(panelTable({ x: rightX, y: a.y, w: rightW, h: a.h }, m, c));
  const headerH = a.h * 0.16;
  out.push(panelHeader({ x: a.x, y: a.y, w: leftW, h: headerH }, c));
  const jH = m.jumuah.length ? a.h * 0.22 : 0;
  const clockY = a.y + headerH + gap;
  const clockBottom = a.y + a.h - (jH ? jH + gap : 0);
  out.push(panelClock({ x: a.x, y: clockY, w: leftW, h: clockBottom - clockY }, c));
  if (jH) out.push(panelJumuah({ x: a.x, y: a.y + a.h - jH, w: leftW, h: jH }, m, c));
  return out.join('');
}

/** "Spotlight" arrangement: brand + clock span the top, the prayer table spans the
 *  middle full-width, and the Jumu'ah box sits along the bottom. */
function layoutSpotlight(a: Box, m: Model, c: Ctx): string {
  const out: string[] = [];
  const gap = Math.min(a.w, a.h) * 0.025;
  const topH = a.h * 0.26;
  const headerW = a.w * 0.46;
  out.push(panelHeader({ x: a.x, y: a.y, w: headerW, h: topH }, c));
  const clockX = a.x + headerW + gap;
  out.push(panelClock({ x: clockX, y: a.y, w: a.x + a.w - clockX, h: topH }, c));
  const midY = a.y + topH + gap;
  const jH = m.jumuah.length ? a.h * 0.2 : 0;
  const tableH = a.y + a.h - (jH ? jH + gap : 0) - midY;
  out.push(panelTable({ x: a.x, y: midY, w: a.w, h: tableH }, m, c));
  if (jH) out.push(panelJumuah({ x: a.x, y: a.y + a.h - jH, w: a.w, h: jH }, m, c));
  return out.join('');
}

/** Announcement layout: the timetable becomes a compact left sidebar (brand + clock +
 *  table) and the cycling image fills the right (shown sharp, contained, no crop). */
function announcementView(a: Box, m: Model, c: Ctx, image: string): string {
  const out: string[] = [];
  const gap = Math.min(a.w, a.h) * 0.02;
  const sideW = clamp(a.w * 0.32, 220, 560);
  const headerH = a.h * 0.15;
  const clockH = a.h * 0.26;
  out.push(panelHeader({ x: a.x, y: a.y, w: sideW, h: headerH }, c));
  out.push(panelClock({ x: a.x, y: a.y + headerH + gap, w: sideW, h: clockH }, c));
  const tY = a.y + headerH + gap + clockH + gap;
  out.push(panelTable({ x: a.x, y: tY, w: sideW, h: a.y + a.h - tY }, m, c));
  const availX = a.x + sideW + gap;
  const availW = a.x + a.w - availX;
  const availH = a.h;
  let fw = availW;
  let fh = (availW * 9) / 16;
  if (fh > availH) {
    fh = availH;
    fw = (availH * 16) / 9;
  }
  const fx = availX + (availW - fw) / 2;
  const fy = a.y + (availH - fh) / 2;
  const r = Math.min(fw, fh) * 0.04;
  out.push(rect(fx, fy, fw, fh, r, hexToRgba(c.p.bg, 0.85)));
  out.push(`<clipPath id="annclip"><rect x="${fx.toFixed(1)}" y="${fy.toFixed(1)}" width="${fw.toFixed(1)}" height="${fh.toFixed(1)}" rx="${r.toFixed(1)}" ry="${r.toFixed(1)}"/></clipPath>`);
  out.push(`<image href="${image}" x="${fx.toFixed(1)}" y="${fy.toFixed(1)}" width="${fw.toFixed(1)}" height="${fh.toFixed(1)}" preserveAspectRatio="xMidYMid meet" clip-path="url(#annclip)"/>`);
  out.push(rect(fx, fy, fw, fh, r, 'none', `stroke="${HAIR}" stroke-width="1"`));
  return out.join('');
}

/** "Setup needed" frame when no location is configured. */
/** Clean text copied from the web for on-screen rendering: drop invisible bidi /
 *  zero-width control marks (the source hadith was full of U+200F RLM), and fold
 *  "smart" punctuation to plain forms. The bundled Arabic face (Noto Naskh Arabic)
 *  has no glyph for curly quotes/dashes, so an embedded “ ” — etc. rendered as a
 *  single .notdef tofu box mid-text; plain " ' - render (or fall back) cleanly. */
function sanitizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[​-‏‪-‮⁦-⁩؜﻿]/g, '') // bidi / zero-width
    .replace(/[“”„‟«»]/g, '"') // smart / guillemet double quotes
    .replace(/[‘’‚‛]/g, "'") // smart single quotes
    .replace(/[–—―]/g, '-') // en / em / horizontal-bar dashes
    .replace(/…/g, '...') // ellipsis
    // Whitelist: keep tab/newline, ASCII, Latin-1/Extended-A, the Arabic blocks AND the
    // Arabic Presentation Forms (U+FB50-FDFF incl. the sallallahu-alayhi-wasallam ligature
    // U+FDFA, U+FE70-FEFF). Drop anything else the bundled fonts cannot draw (it tofus).
    .replace(/[^\t\n -~ -ɏ؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g, '')
    .replace(/[ \t]{2,}/g, ' ') // collapse runs of spaces left by stripped marks
    .trim();
}

/** Greedy word-wrap: break `s` into lines that each fit within `maxW` at `size`. */
function wrapLines(s: string, size: number, maxW: number, maxLines = 6): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (approxWidth(trial, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
    return kept;
  }
  return lines;
}

/** A full-screen takeover that suppresses the normal layout (and the ffmpeg ticker). */
type Overlay =
  | { kind: 'prohibited'; secs: number }
  | { kind: 'iqamah'; secs: number; key: string }
  | { kind: 'hadith'; item: HadithItem };

/** Which full-screen overlay (if any) is active right now. Precedence: the zawāl
 *  notice, then the pre-Iqāmah countdown, then the during-salah hadith. */
function activeOverlay(tt: Timetable, m: Model, nowHours: number, now: Date): Overlay | null {
  // 1) Prohibited (zawāl) window before the Dhuhr Adhan.
  const pn = tt.prohibitedNotice;
  if (pn?.enabled) {
    const dhuhr = m.times.dhuhr; // astronomical zenith / Dhuhr Adhan
    const win = Math.max(1, pn.minutes) / 60;
    if (nowHours >= dhuhr - win && nowHours < dhuhr) {
      return { kind: 'prohibited', secs: Math.max(0, (dhuhr - nowHours) * 3600) };
    }
  }
  // 2) Full-screen countdown for the last minutes before any Iqāmah.
  const ic = tt.iqamahCountdown;
  if (ic?.enabled) {
    const win = Math.max(1, ic.minutes) / 60;
    const row = m.rows.find(
      (r) =>
        r.adhan != null && r.iqamah != null &&
        r.adhan <= nowHours && nowHours >= r.iqamah - win && nowHours < r.iqamah,
    );
    if (row) return { kind: 'iqamah', secs: Math.max(0, (row.iqamah! - nowHours) * 3600), key: row.key };
  }
  // 3) Hadith during salah (the minutes after each Iqāmah), rotating every ~15s.
  const sh = tt.salahHadith;
  if (sh?.enabled && sh.items.length) {
    const win = Math.max(1, sh.minutes) / 60;
    const inSalah = m.rows.some(
      (r) => r.iqamah != null && r.iqamah <= nowHours && nowHours < r.iqamah + win,
    );
    if (inSalah) {
      const idx = Math.floor(now.getTime() / 15000) % sh.items.length;
      return { kind: 'hadith', item: sh.items[idx] };
    }
  }
  return null;
}

/** True if any full-screen overlay is showing now — used to hide the ffmpeg ticker. */
function overlayActiveNow(tt: Timetable, now: Date): boolean {
  if (tt.latitude == null || tt.longitude == null) return false;
  const m = buildModel(tt, now);
  const nowHours = m.parts.hour + m.parts.minute / 60 + m.parts.second / 3600;
  return activeOverlay(tt, m, nowHours, now) != null;
}

/** Calm hadith card over a dimmed scene, shown during salah (Arabic above English). */
/** How long each language is shown before switching, in ms (Arabic, then English). */
const HADITH_PHASE_MS = 10_000;

function salahHadithView(item: HadithItem, now: Date, clock: ClockText, p: Palette, W: number, H: number): string {
  const out: string[] = [];
  out.push(rect(0, 0, W, H, 0, 'rgba(0,0,0,0.66)'));
  const cardW = Math.min(W * 0.84, 1500);
  const cardH = Math.min(H * 0.72, cardW * 0.6);
  const cx = W / 2;
  const cy = H / 2;
  out.push(glass(cx - cardW / 2, cy - cardH / 2, cardW, cardH, Math.min(cardW, cardH) * 0.05, { glow: p.primary }));

  const ar = sanitizeText(item.ar);
  const en = sanitizeText(item.en);
  // ONE language at a time: Arabic for 10s, then English for 10s, alternating. If only
  // one is provided, always show it.
  const both = !!ar && !!en;
  const showArabic = both ? Math.floor(now.getTime() / HADITH_PHASE_MS) % 2 === 0 : !!ar;
  const content = showArabic ? ar : en;
  const isArabic = showArabic && !!ar;

  // Autofit: shrink the font until the wrapped text fits the card, so a long hadith
  // never overflows the box. Arabic gets a slightly tighter width budget + taller
  // line-height (it sits taller and connects), and the Arabic font stack.
  const family = isArabic ? FONT_ARABIC : FONT_DISPLAY;
  const maxW = cardW * (isArabic ? 0.78 : 0.86);
  const maxH = cardH * 0.74;
  const lineFactor = isArabic ? 1.75 : 1.4;
  let fs = clamp(W * 0.04, 22, 76);
  let lines = wrapLines(content, fs, maxW, 14);
  while (lines.length * fs * lineFactor > maxH && fs > 14) {
    fs -= 2;
    lines = wrapLines(content, fs, maxW, 14);
  }
  const lh = fs * lineFactor;
  let ly = cy - (lines.length * lh) / 2 + fs * (isArabic ? 0.95 : 0.75);
  for (const ln of lines) {
    out.push(text(cx, ly, ln, { size: fs, fill: p.text, family, weight: 500, anchor: 'middle' }));
    ly += lh;
  }

  // Keep the current time on screen (small, top corner) so the display still tells
  // the time while the congregation prays.
  const timeStr = clock.period ? `${clock.time} ${clock.period}` : clock.time;
  out.push(text(W - clamp(W * 0.03, 22, 60), clamp(H * 0.075, 28, 72), timeStr, { size: clamp(W * 0.018, 16, 34), fill: p.textDim, family: FONT_DISPLAY, weight: 600, anchor: 'end' }));
  return out.join('');
}

/** Full-screen countdown to a prayer's Iqāmah ("line up for prayer"). */
function iqamahCountdownView(secsLeft: number, prayerKey: string, p: Palette, L: Record<string, string>, W: number, H: number): string {
  const out: string[] = [];
  out.push(rect(0, 0, W, H, 0, 'rgba(0,0,0,0.72)'));
  const cx = W / 2;
  const mm = Math.floor(secsLeft / 60);
  const ss = Math.floor(secsLeft % 60);
  const counter = `${pad2(mm)}:${pad2(ss)}`;
  const pname = (L[prayerKey] ?? prayerKey).toUpperCase();
  out.push(text(cx, H * 0.34, `${pname} ${(L.iqamah ?? 'Iqamah').toUpperCase()} IN`, { size: clamp(W * 0.02, 18, 44), fill: p.primarySoft, weight: 700, anchor: 'middle', letter: 4 }));
  out.push(text(cx, H * 0.6, counter, { size: clamp(W * 0.16, 90, 360), fill: 'url(#clockg)', family: FONT_DISPLAY, weight: 700, anchor: 'middle', blink: true }));
  out.push(text(cx, H * 0.74, 'Please line up for prayer', { size: clamp(W * 0.016, 14, 30), fill: p.textDim, anchor: 'middle' }));
  return out.join('');
}

/** Full-screen "prohibited time" (zawāl) notice counting down to the Dhuhr Adhan. */
function prohibitedView(secsLeft: number, p: Palette, L: Record<string, string>, W: number, H: number): string {
  const out: string[] = [];
  out.push(rect(0, 0, W, H, 0, 'rgba(0,0,0,0.66)'));
  const cx = W / 2;
  const mm = Math.floor(secsLeft / 60);
  const ss = Math.floor(secsLeft % 60);
  const counter = `${pad2(mm)}:${pad2(ss)}`;
  out.push(text(cx, H * 0.3, 'PROHIBITED TIME', { size: clamp(W * 0.022, 20, 48), fill: p.gold, weight: 800, anchor: 'middle', letter: 5 }));
  const lines = wrapLines(
    'This is the time of zawāl, when the sun is at its zenith. Voluntary prayer is discouraged until the sun has passed.',
    clamp(W * 0.018, 16, 32),
    W * 0.72,
    4,
  );
  let ly = H * 0.42;
  const fs = clamp(W * 0.018, 16, 32);
  for (const ln of lines) {
    out.push(text(cx, ly, ln, { size: fs, fill: p.text, anchor: 'middle' }));
    ly += fs * 1.45;
  }
  const dhuhr = (L.dhuhr ?? 'Dhuhr').toUpperCase();
  out.push(text(cx, H * 0.66, `${dhuhr} ${(L.athan ?? 'Adhan').toUpperCase()} IN`, { size: clamp(W * 0.014, 13, 28), fill: p.primarySoft, weight: 700, anchor: 'middle', letter: 3 }));
  out.push(text(cx, H * 0.78, counter, { size: clamp(W * 0.09, 60, 200), fill: 'url(#clockg)', family: FONT_DISPLAY, weight: 700, anchor: 'middle', blink: true }));
  return out.join('');
}

function setupNeeded(p: Palette, W: number, H: number, masjidName: string): string {
  const cel: Celestial = { isDay: true, x: W * 0.5, y: H * 0.18 };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs(p, false, cel, W, H)}
  ${rect(0, 0, W, H, 0, 'url(#scene)')}
  ${rect(0, 0, W, H, 0, 'url(#cglow)')}
  ${rect(0, 0, W, H, 0, 'url(#khatam)')}
  ${text(W / 2, H * 0.42, masjidName, { size: clamp(W * 0.04, 28, 64), fill: p.primarySoft, family: FONT_DISPLAY, weight: 600, anchor: 'middle' })}
  ${text(W / 2, H * 0.52, 'This screen needs the masjid location', { size: clamp(W * 0.02, 16, 30), fill: p.text, anchor: 'middle' })}
  ${text(W / 2, H * 0.58, 'Open the control panel and add the latitude and longitude.', { size: clamp(W * 0.015, 13, 22), fill: p.textDim, anchor: 'middle' })}
</svg>`;
}

export interface RenderOpts {
  /** data: URI of a custom background image, or null for the themed scene */
  bg?: string | null;
  /** data: URI of an announcement image → timetable becomes a left sidebar, image fills the right */
  announcement?: string | null;
  /** data: URI of an uploaded masjid logo, or null for the built-in mark */
  logo?: string | null;
  /** auto text-contrast: the render worker sets this true when the custom background
   *  photo is light enough that the theme's light text would wash out (→ use dark text).
   *  Only consulted when the timetable's textColor is "auto" (empty). */
  bgLight?: boolean;
  /** auto accent: a vivid colour the worker pulled from the wallpaper. Used as the
   *  primary colour only when the user hasn't picked a manual accent. */
  autoAccent?: string;
  /** video pipeline: draw only the ticker strip (ffmpeg overlays the moving text) */
  tickerBandOnly?: boolean;
  /** when present, click-to-edit text regions are collected here (no extra cost
   *  for the video pipeline, which never passes a sink) */
  sink?: { hotspots: Hotspot[] };
}

// Burn-in rotation: Centered → Spotlight (id clockTop) → Split, every 5 min.
const CAROUSEL: TimetableLayout[] = ['centered', 'clockTop', 'split'];

export function renderDisplaySvg(tt: Timetable, now: Date, opts: RenderOpts = {}): string {
  const prevHot = HOT;
  HOT = opts.sink ? [] : null;
  try {
    return build(tt, now, opts);
  } finally {
    if (opts.sink && HOT) {
      const { width: W, height: H } = dimsFor(tt.orientation, tt.quality);
      opts.sink.hotspots = HOT.map((h) => ({
        id: h.id,
        value: h.value,
        xPct: (h.x / W) * 100,
        yPct: (h.y / H) * 100,
        wPct: (h.w / W) * 100,
        hPct: (h.h / H) * 100,
      }));
    }
    HOT = prevHot;
  }
}

function build(tt: Timetable, now: Date, opts: RenderOpts): string {
  const { width: W, height: H } = dimsFor(tt.orientation, tt.quality);
  // Blink the time colons once a second (dim on odd seconds).
  COLON_DIM = Math.floor(now.getTime() / 1000) % 2 === 1;
  const hasImage = !!opts.bg;
  let p = applyTextColor(getPalette(tt.themeId, tt.accent), tt.textColor, hasImage, !!opts.bgLight);
  // Auto accent from the wallpaper (only when no manual accent is set).
  if (!tt.accent && opts.autoAccent && /^#?[0-9a-f]{6}$/i.test(opts.autoAccent)) {
    const a = opts.autoAccent.startsWith('#') ? opts.autoAccent : `#${opts.autoAccent}`;
    p = { ...p, primary: a, primarySoft: lighten(a, 0.2), pattern: a };
  }
  const L = labels(tt.language, tt.labels);
  const logo = opts.logo ?? null;

  if (tt.latitude == null || tt.longitude == null) {
    return setupNeeded(p, W, H, tt.masjidName || 'Our Masjid');
  }

  const m = buildModel(tt, now);
  const nowHours = m.parts.hour + m.parts.minute / 60 + m.parts.second / 3600;
  const clock = fmtClock(nowHours, tt.timeFormat, tt.showSeconds);

  const remMin = (m.nextHours - nowHours) * 60;
  const hms: [number, number, number] = [Math.floor(remMin / 60), Math.floor(remMin % 60), Math.floor((remMin * 60) % 60)];
  // A live ticking "time until next prayer" counter (H:MM:SS), like the split hero.
  const counter = hms[0] > 0 ? `${hms[0]}:${pad2(hms[1])}:${pad2(hms[2])}` : `${hms[1]}:${pad2(hms[2])}`;
  const nextLabel = rowName(m.rows.find((r) => r.next) ?? m.rows[0], L);
  // "Iqāmah in" while inside the current prayer's Adhan→Iqāmah window, else "Adhan in".
  const eventWord = (m.countdownToIqamah ? (L.iqamah ?? 'Iqamah') : (L.athan ?? 'Adhan')).toUpperCase();

  const greg = gregorian(m.parts, tt.language, tt.gregorianOffset ?? 0);
  const hij = hijri(m.parts, tt.language, tt.hijriOffset ?? 0);
  const tickerText = activeTickerText(tt, m.parts);

  const portrait = tt.orientation === 'portrait';
  const base = tt.layoutCarousel ? CAROUSEL[Math.floor((m.parts.hour * 60 + m.parts.minute) / 5) % 3] : tt.layout;
  const layout = portrait && base === 'split' ? 'centered' : base;
  const P = Math.round(Math.min(W, H) * 0.05);
  const cel = celestialPos(m.times, nowHours, W, H, P);

  const out: string[] = [];
  out.push(defs(p, hasImage, cel, W, H));

  // ── Background + sky ───────────────────────────────────────────────────────
  if (hasImage) {
    out.push(`<image href="${opts.bg}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" filter="url(#frost)"/>`);
    out.push(rect(0, 0, W, H, 0, 'url(#scrim)'));
  } else {
    out.push(rect(0, 0, W, H, 0, 'url(#scene)'));
  }
  // The sun/moon and the glow it casts can be turned off (showCelestial); the subtle
  // khatam pattern always stays.
  if (tt.showCelestial !== false) {
    out.push(rect(0, 0, W, H, 0, 'url(#cglow)')); // light from the sun/moon
    out.push(celestialBody(cel, W, H)); // the sun or moon itself
    out.push(lightBeams(cel, W, H)); // soft shafts falling over the scene
  }
  out.push(rect(0, 0, W, H, 0, 'url(#khatam)'));

  // ── Full-takeover overlays (drawn over the scene, suppress the normal layout
  //    AND the scrolling ticker — see activeTickerString) ──────────────────────
  const overlay = activeOverlay(tt, m, nowHours, now);
  if (overlay) {
    if (overlay.kind === 'prohibited') out.push(prohibitedView(overlay.secs, p, L, W, H));
    else if (overlay.kind === 'iqamah') out.push(iqamahCountdownView(overlay.secs, overlay.key, p, L, W, H));
    else out.push(salahHadithView(overlay.item, now, clock, p, W, H));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
  }

  // Working area: inset by P, with a reserved bottom band for the ticker (or the small
  // footer line). The Jumu'ah box now lives INSIDE each layout, not a global bottom bar.
  const bottomBand = tickerText ? tickerLayout(W, H).bandH : tt.showFooter ? clamp(H * 0.05, 24, 60) : P;
  const area: Box = { x: P, y: P, w: W - 2 * P, h: H - P - bottomBand };
  const ctx: Ctx = {
    p,
    L,
    logo,
    timeFormat: tt.timeFormat,
    lang: tt.language,
    masjidName: tt.masjidName,
    clock,
    greg,
    hij,
    nextLabel,
    eventWord,
    counter,
    showLogo: tt.showLogo,
    showDates: tt.showDates,
    showCountdown: tt.showCountdown,
  };

  if (opts.announcement) {
    // Slideshow: the timetable becomes a left sidebar, the image fills the right.
    out.push(announcementView(area, m, ctx, opts.announcement));
  } else if (layout === 'split') {
    out.push(layoutSidebar(area, m, ctx));
  } else if (layout === 'clockTop') {
    out.push(layoutSpotlight(area, m, ctx));
  } else {
    out.push(layoutCentered(area, m, ctx));
  }

  // ── Footer (hidden when the ticker is running — they share the bottom strip) ──
  if (tt.showFooter && !tickerText) {
    const methodNote =
      tt.method === 'Custom'
        ? `Custom ${tt.fajrAngle ?? 18}° / ${tt.ishaAngle ?? 17}° · Asr: ${tt.asrMadhab}`
        : `${METHODS[tt.method]?.label ?? tt.method} · Asr: ${tt.asrMadhab}`;
    out.push(text(W / 2, H - P * 0.5, tt.footerNote || methodNote, { size: clamp(Math.min(W, H) * 0.014, 11, 20), fill: p.textFaint, anchor: 'middle', letter: 0.5, editId: 'footerNote' }));
  }

  // ── Scrolling ticker (drawn last, over everything) ───────────────────────────
  if (tickerText) out.push(tickerBand(tickerText, now, p, W, H, !!opts.tickerBandOnly));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}
