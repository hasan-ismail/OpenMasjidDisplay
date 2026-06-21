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
import type { Timetable, TimetableLayout } from '../types';
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

const FONT_DISPLAY = 'Noto Serif, Noto Naskh Arabic, DejaVu Serif, serif';
const FONT_SANS = 'Noto Sans, Noto Sans Arabic, DejaVu Sans, sans-serif';

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
    // Minute precision (round) — matches the conventional prayer-time display.
    let total = Math.round(hours * 60);
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
  return c.period ? `${c.time} ${c.period.toLowerCase()}` : c.time;
}

function gregorian(parts: { year: number; month: number; day: number }, lang: string, tz: string): string {
  return new Intl.DateTimeFormat(lang, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: tz || undefined,
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}

function hijri(parts: { year: number; month: number; day: number }, lang: string): string {
  try {
    return new Intl.DateTimeFormat(`${lang}-u-ca-islamic-umalqura`, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
  } catch {
    return '';
  }
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
  return `<text ${attrs.join(' ')}>${esc(content)}</text>`;
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
}

const PRAYER_LABELS: Record<string, Record<string, string>> = {
  en: { fajr: 'Fajr', sunrise: 'Sunrise', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha', jumuah: "Jumu'ah", iqamah: 'Iqāmah', athan: 'Adhan', next: 'Next prayer' },
  ar: { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء', jumuah: 'الجمعة', iqamah: 'الإقامة', athan: 'الأذان', next: 'الصلاة القادمة' },
  ur: { fajr: 'فجر', sunrise: 'طلوع', dhuhr: 'ظہر', asr: 'عصر', maghrib: 'مغرب', isha: 'عشاء', jumuah: 'جمعہ', iqamah: 'اقامہ', athan: 'اذان', next: 'اگلی نماز' },
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
  isFriday: boolean;
}

function buildModel(tt: Timetable, now: Date): Model {
  const tz = tt.timezone || undefined;
  const parts = localParts(now, tz);
  const off = timezoneOffsetHours(now, tz);
  const times = prayerTimes(parts, tt.latitude!, tt.longitude!, off, tt.method, tt.asrMadhab);

  const tomorrow = new Date(now.getTime() + 86400000);
  const tParts = localParts(tomorrow, tz);
  const tOff = timezoneOffsetHours(tomorrow, tz);
  const tomorrowFajr = prayerTimes(tParts, tt.latitude!, tt.longitude!, tOff, tt.method, tt.asrMadhab).fajr;

  const nowHours = parts.hour + parts.minute / 60 + parts.second / 3600;
  const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
  let activeKey: string | null = null;
  let nextKey: string | null = null;
  let nextHours = 0;
  const tv = times as unknown as Record<string, number>;
  for (const k of order) if (tv[k] <= nowHours) activeKey = k;
  for (const k of order) {
    if (tv[k] > nowHours) {
      nextKey = k;
      nextHours = tv[k];
      break;
    }
  }
  if (!nextKey) {
    nextKey = 'fajr';
    nextHours = tomorrowFajr + 24;
    activeKey = 'isha';
  }
  if (!activeKey) activeKey = 'isha';

  const isFriday = dayOfWeek(now, tz) === 5;

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
  if (isFriday) {
    const j = tt.jumuah.map(parseHHMM).filter((x): x is number => x != null);
    const jIq = yearRow?.jumuah ? parseHHMM(yearRow.jumuah) : null;
    rows.push({ key: 'dhuhr', label: 'jumuah', adhan: j[0] ?? times.dhuhr, iqamah: jIq ?? j[1] ?? null });
  } else {
    rows.push({ key: 'dhuhr', label: 'dhuhr', adhan: times.dhuhr, iqamah: iq('dhuhr', times.dhuhr) });
  }
  rows.push({ key: 'asr', label: 'asr', adhan: times.asr, iqamah: iq('asr', times.asr) });
  rows.push({ key: 'maghrib', label: 'maghrib', adhan: times.maghrib, iqamah: iq('maghrib', times.maghrib) });
  rows.push({ key: 'isha', label: 'isha', adhan: times.isha, iqamah: iq('isha', times.isha) });

  for (const r of rows) {
    if (r.key === activeKey) r.active = true;
    if (r.key === nextKey) r.next = true;
  }
  return { parts, times, rows, activeKey, nextKey, nextHours, isFriday };
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
      <stop offset="0%" stop-color="#ffffff"/>
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

/** Prayer card — a tall stacked tile, or a wide row when much wider than tall. */
function prayerCard(x: number, y: number, w: number, h: number, r: Row, p: Palette, L: Record<string, string>, timeFormat: string): string {
  const cardR = Math.min(w, h) * 0.14;
  // Sunrise (minor) used to be dimmer; render it like the others so it matches.
  const fill = r.active ? hexToRgba(p.primary, 0.2) : GLASS;
  const stroke = r.active ? p.primary : HAIR;
  const nameColor = r.active ? p.primarySoft : r.next ? p.goldSoft : p.textDim;
  const name = L[r.label] ?? r.label;
  const out: string[] = [];
  out.push(glass(x, y, w, h, cardR, { fill, stroke, sw: r.active ? 2 : 1, glow: r.active ? p.primary : undefined }));

  if (w / h > 2) {
    const pad = cardR + Math.min(w, h) * 0.08;
    if (r.active) out.push(rect(x + cardR * 0.5, y + cardR, Math.max(3, w * 0.01), h - 2 * cardR, 2, p.primarySoft));
    const nameSize = clamp(h * 0.3, 13, 30);
    const timeSize = clamp(h * 0.42, 18, 46);
    const iqSize = clamp(h * 0.22, 10, 22);
    const rightX = x + w - pad;
    out.push(text(x + pad, y + h * 0.6, name, { size: nameSize, fill: nameColor, family: FONT_SANS, weight: 600, anchor: 'start', letter: 0.5, editId: `label.${r.label}` }));
    if (r.iqamah != null) {
      // Iqamah is what the congregation cares about → show it big; Adhan small.
      out.push(text(rightX, y + h * 0.46, fmtShort(r.iqamah, timeFormat), { size: timeSize, fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'end' }));
      out.push(text(rightX, y + h * 0.82, `${L.athan} ${fmtShort(r.adhan, timeFormat)}`, { size: iqSize, fill: p.goldSoft, family: FONT_SANS, weight: 600, anchor: 'end' }));
    } else {
      out.push(text(rightX, y + h * 0.64, fmtShort(r.adhan, timeFormat), { size: timeSize, fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'end' }));
    }
    return out.join('');
  }

  const center = x + w / 2;
  if (r.active) out.push(rect(x + cardR, y + Math.max(2, h * 0.05), w - 2 * cardR, Math.max(2, h * 0.025), 2, p.primarySoft));
  // The big number is the Iqamah (jamā'ah) time — what people line up for; the Adhan
  // is shown small underneath. Sunrise (no iqamah) just shows its single time big.
  const primaryStr = fmtShort(r.iqamah != null ? r.iqamah : r.adhan, timeFormat);
  const secondaryStr = r.iqamah != null ? `${L.athan} ${fmtShort(r.adhan, timeFormat)}` : '';
  // Fit each line to the card width so times never spill into a neighbouring card.
  const fitW = (s: string, max: number, cap: number, floor: number) =>
    clamp(Math.min(cap, max / Math.max(1, s.length * 0.6)), floor, cap);
  const nameSize = fitW(name, w * 0.9, clamp(Math.min(w * 0.16, h * 0.2), 12, 30), 11);
  const timeSize = fitW(primaryStr, w * 0.92, clamp(Math.min(w * 0.3, h * 0.42), 20, 64), 15);
  const secSize = secondaryStr ? fitW(secondaryStr, w * 0.94, clamp(Math.min(w * 0.15, h * 0.16), 10, 24), 9) : 0;
  out.push(text(center, y + h * 0.24 + nameSize * 0.4, name, { size: nameSize, fill: nameColor, family: FONT_SANS, weight: 600, anchor: 'middle', letter: 0.5, editId: `label.${r.label}` }));
  out.push(text(center, y + h * (secondaryStr ? 0.58 : 0.64), primaryStr, { size: timeSize, fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'middle' }));
  if (secondaryStr) {
    out.push(text(center, y + h * 0.87, secondaryStr, { size: secSize, fill: p.goldSoft, family: FONT_SANS, weight: 600, anchor: 'middle' }));
  }
  if (r.next) out.push(`<circle cx="${center.toFixed(1)}" cy="${(y + h - h * 0.06).toFixed(1)}" r="${Math.max(2, w * 0.018).toFixed(1)}" fill="${p.gold}"/>`);
  return out.join('');
}

function prayerGrid(rows: Row[], x: number, y: number, w: number, h: number, cols: number, p: Palette, L: Record<string, string>, timeFormat: string, gap: number): string {
  const rowsCount = Math.ceil(rows.length / cols);
  const cardW = (w - (cols - 1) * gap) / cols;
  const cardH = (h - (rowsCount - 1) * gap) / rowsCount;
  return rows
    .map((r, i) => prayerCard(x + (i % cols) * (cardW + gap), y + Math.floor(i / cols) * (cardH + gap), cardW, cardH, r, p, L, timeFormat))
    .join('');
}

/** Clock (+ optional countdown pill) centred at (cx, cy). The AM/PM marker is
 *  placed just past the measured end of the time so it never overlaps the digits
 *  (which matters once seconds are shown and the time string is longer). */
function clockGroup(cx: number, cy: number, size: number, clock: ClockText, showCountdown: boolean, pill: string, p: Palette): string {
  const out: string[] = [];
  const baseline = cy + size * 0.34;
  const letter = -size * 0.02;
  const timeW = approxWidth(clock.time, size) + letter * (clock.time.length - 1);
  const periodSize = size * 0.3;
  const periodPad = size * 0.16;
  const periodW = clock.period ? periodPad + approxWidth(clock.period, periodSize) : 0;
  const startX = cx - (timeW + periodW) / 2;
  out.push(text(startX, baseline, clock.time, { size, fill: 'url(#clockg)', family: FONT_DISPLAY, weight: 600, anchor: 'start', letter }));
  if (clock.period) {
    out.push(text(startX + timeW + periodPad, baseline, clock.period, { size: periodSize, fill: p.textDim, weight: 700, anchor: 'start' }));
  }
  if (showCountdown && pill) {
    const ps = clamp(size * 0.16, 13, 30);
    const pw = approxWidth(pill, ps) + ps * 2.4;
    const ph = ps * 2.2;
    out.push(glass(cx - pw / 2, cy + size * 0.5, pw, ph, ph / 2, { fill: GLASS_RAISED }));
    out.push(text(cx, cy + size * 0.5 + ph * 0.64, pill, { size: ps, fill: p.text, anchor: 'middle', letter: 0.3 }));
  }
  return out.join('');
}

/** Big H : M : S countdown hero (used by the split / MasjidBox-style layout). */
function countdownHero(cx: number, cy: number, w: number, nextLabel: string, hms: [number, number, number], p: Palette, L: Record<string, string>): string {
  const out: string[] = [];
  const numSize = clamp(w * 0.2, 38, 168);
  const gapX = numSize * 1.18;
  const colon = numSize * 0.62;
  const xs = [cx - gapX, cx, cx + gapX];
  const baseline = cy + numSize * 0.34;
  const nums = [pad2(hms[0]), pad2(hms[1]), pad2(hms[2])];
  const lab = ['HOURS', 'MINUTES', 'SECONDS'];
  out.push(text(cx, cy - numSize * 0.78, `${(L[nextLabel] ?? nextLabel).toUpperCase()} ${L.athan?.toUpperCase() ?? 'ADHAN'} IN`, { size: clamp(numSize * 0.18, 14, 34), fill: p.primarySoft, weight: 700, anchor: 'middle', letter: 2 }));
  for (let i = 0; i < 3; i++) {
    out.push(text(xs[i], baseline, nums[i], { size: numSize, fill: 'url(#clockg)', family: FONT_DISPLAY, weight: 700, anchor: 'middle', letter: -1 }));
    out.push(text(xs[i], cy + numSize * 0.62, lab[i], { size: clamp(numSize * 0.13, 9, 20), fill: p.textFaint, weight: 700, anchor: 'middle', letter: 2 }));
  }
  out.push(text((xs[0] + xs[1]) / 2, baseline - numSize * 0.06, ':', { size: colon, fill: p.textDim, family: FONT_DISPLAY, weight: 700, anchor: 'middle' }));
  out.push(text((xs[1] + xs[2]) / 2, baseline - numSize * 0.06, ':', { size: colon, fill: p.textDim, family: FONT_DISPLAY, weight: 700, anchor: 'middle' }));
  return out.join('');
}

/** The MasjidBox-style split: a dense prayer list on the left, big countdown right. */
function splitView(
  tt: Timetable,
  m: Model,
  clock: ClockText,
  hms: [number, number, number],
  greg: string,
  hij: string,
  p: Palette,
  L: Record<string, string>,
  W: number,
  H: number,
  P: number,
  logo: string | null,
): string {
  const out: string[] = [];
  const gap = Math.min(W, H) * 0.014;
  const top = P;
  const bottom = H - P - H * 0.05;
  const leftW = (W - 2 * P - gap * 1.6) * 0.44;
  const leftX = P;
  const leftH = bottom - top;
  const pad = leftW * 0.075;

  // ── Left panel: brand, clock, date, then the prayer list ──
  out.push(glass(leftX, top, leftW, leftH, Math.min(leftW, leftH) * 0.05));
  let cy = top + pad;
  if (tt.showLogo) {
    const ms = leftW * 0.13;
    out.push(mark(leftX + pad, cy, ms, p.primary, logo));
    out.push(text(leftX + pad + ms + leftW * 0.04, cy + ms * 0.78, tt.masjidName, { size: clamp(leftW * 0.075, 14, 30), fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'start', editId: 'masjidName' }));
    cy += ms + pad * 0.7;
  } else {
    out.push(text(leftX + pad, cy + leftW * 0.08, tt.masjidName, { size: clamp(leftW * 0.085, 14, 32), fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'start', editId: 'masjidName' }));
    cy += leftW * 0.13;
  }
  // Clock on its own line, fit to the panel width (so a seconds clock can't run
  // into the dates), then the dates stacked below it.
  const clockStr = clock.time + (clock.period ? ` ${clock.period}` : '');
  const maxW = leftW - 2 * pad;
  let clockSize = clamp(leftW * 0.2, 30, 92);
  const cw = approxWidth(clockStr, clockSize);
  if (cw > maxW) clockSize = Math.max(22, clockSize * (maxW / cw));
  out.push(text(leftX + pad, cy + clockSize * 0.82, clockStr, { size: clockSize, fill: 'url(#clockg)', family: FONT_DISPLAY, weight: 600, anchor: 'start', letter: -0.5 }));
  cy += clockSize * 1.06;
  if (tt.showDates) {
    let dateSize = clamp(leftW * 0.045, 11, 20);
    const dstr = hij ? `${hij}  ·  ${greg}` : greg;
    const dw = approxWidth(dstr, dateSize);
    if (dw > maxW) dateSize = Math.max(9, dateSize * (maxW / dw));
    out.push(text(leftX + pad, cy + dateSize, dstr, { size: dateSize, fill: p.goldSoft, family: FONT_DISPLAY, anchor: 'start' }));
    cy += dateSize * 1.7;
  } else {
    cy += pad * 0.4;
  }

  // List header + rows.
  const colAdhan = leftX + leftW * 0.66;
  const colIq = leftX + leftW - pad;
  const headSize = clamp(leftW * 0.04, 9, 16);
  out.push(text(colAdhan, cy, L.athan?.toUpperCase() ?? 'ADHAN', { size: headSize, fill: p.textFaint, weight: 700, anchor: 'end', letter: 1 }));
  out.push(text(colIq, cy, L.iqamah?.toUpperCase() ?? 'IQAMAH', { size: headSize, fill: p.textFaint, weight: 700, anchor: 'end', letter: 1 }));
  cy += headSize * 0.6;
  const listH = bottom - pad - cy;
  const rowH = listH / m.rows.length;
  m.rows.forEach((r, i) => {
    const ry = cy + i * rowH;
    if (r.active) out.push(glass(leftX + pad * 0.4, ry + rowH * 0.08, leftW - pad * 0.8, rowH * 0.84, rowH * 0.18, { fill: hexToRgba(p.primary, 0.18), stroke: p.primary, sw: 1.5 }));
    const midY = ry + rowH * 0.64;
    const nameColor = r.active ? p.primarySoft : r.next ? p.goldSoft : p.text;
    const nameSize = clamp(rowH * 0.34, 12, 30);
    const timeSize = clamp(rowH * 0.34, 12, 30);
    out.push(text(leftX + pad, midY, L[r.label] ?? r.label, { size: nameSize, fill: nameColor, family: FONT_SANS, weight: 600, anchor: 'start', editId: `label.${r.label}` }));
    // Adhan is the muted column; Iqamah is emphasised (bright) — that's the one people line up for.
    out.push(text(colAdhan, midY, fmtShort(r.adhan, tt.timeFormat), { size: timeSize * 0.92, fill: p.textDim, family: FONT_DISPLAY, weight: 600, anchor: 'end' }));
    out.push(text(colIq, midY, r.iqamah != null ? fmtShort(r.iqamah, tt.timeFormat) : '—', { size: timeSize, fill: r.iqamah != null ? p.text : p.textFaint, family: FONT_DISPLAY, weight: 700, anchor: 'end' }));
  });

  // ── Right: big countdown hero ──
  const heroX = leftX + leftW + gap * 1.6;
  const heroW = W - P - heroX;
  out.push(countdownHero(heroX + heroW / 2, (top + bottom) / 2, heroW, m.rows.find((r) => r.next)?.label ?? 'fajr', hms, p, L));
  return out.join('');
}

/** "Setup needed" frame when no location is configured. */
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
  /** data: URI of an uploaded masjid logo, or null for the built-in mark */
  logo?: string | null;
  /** when present, click-to-edit text regions are collected here (no extra cost
   *  for the video pipeline, which never passes a sink) */
  sink?: { hotspots: Hotspot[] };
}

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
  const p = getPalette(tt.themeId, tt.accent);
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
  const nextLabel = L[m.rows.find((r) => r.next)?.label ?? 'fajr'] ?? '';
  const pillText = `${nextLabel.toUpperCase()} ${(L.athan ?? 'Adhan').toUpperCase()} IN   ${counter}`;

  const greg = gregorian(m.parts, tt.language, tt.timezone);
  const hij = hijri(m.parts, tt.language);

  const portrait = tt.orientation === 'portrait';
  const base = tt.layoutCarousel ? CAROUSEL[Math.floor((m.parts.hour * 60 + m.parts.minute) / 15) % 3] : tt.layout;
  const layout = portrait && base === 'split' ? 'centered' : base;
  const P = Math.round(Math.min(W, H) * 0.05);
  const hasImage = !!opts.bg;
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
  out.push(rect(0, 0, W, H, 0, 'url(#cglow)')); // light from the sun/moon
  out.push(celestialBody(cel, W, H)); // the sun or moon itself
  out.push(lightBeams(cel, W, H)); // soft shafts falling over the scene
  out.push(rect(0, 0, W, H, 0, 'url(#khatam)'));

  if (layout === 'split') {
    out.push(splitView(tt, m, clock, hms, greg, hij, p, L, W, H, P, logo));
  } else {
    // ── Masthead ──
    const mastH = H * (portrait ? 0.11 : 0.15);
    const mastY = P;
    const markSize = mastH * 0.62;
    if (portrait) {
      if (tt.showLogo) out.push(mark(W / 2 - markSize / 2, mastY, markSize, p.primary, logo));
      out.push(text(W / 2, mastY + mastH * 0.9, tt.masjidName, { size: clamp(W * 0.06, 26, 72), fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'middle', editId: 'masjidName' }));
      if (tt.showDates) {
        if (hij) out.push(text(W / 2, mastY + mastH * 1.2, hij, { size: clamp(W * 0.03, 14, 30), fill: p.goldSoft, family: FONT_DISPLAY, anchor: 'middle' }));
        out.push(text(W / 2, mastY + mastH * 1.42, greg, { size: clamp(W * 0.022, 12, 22), fill: p.textDim, anchor: 'middle' }));
      }
    } else {
      let nameX = P;
      if (tt.showLogo) {
        out.push(mark(P, mastY + (mastH - markSize) / 2, markSize, p.primary, logo));
        nameX = P + markSize + W * 0.012;
      }
      out.push(text(nameX, mastY + mastH * 0.62, tt.masjidName, { size: clamp(mastH * 0.46, 24, 64), fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'start', editId: 'masjidName' }));
      if (tt.showDates) {
        if (hij) out.push(text(W - P, mastY + mastH * 0.42, hij, { size: clamp(mastH * 0.28, 16, 34), fill: p.goldSoft, family: FONT_DISPLAY, anchor: 'end' }));
        out.push(text(W - P, mastY + mastH * 0.74, greg, { size: clamp(mastH * 0.2, 13, 24), fill: p.textDim, anchor: 'end' }));
      }
    }

    const footerH = H * 0.05;
    const bodyTop = mastY + mastH * (portrait && tt.showDates ? 1.55 : 1.15);
    const bodyBottom = H - P - footerH;
    const gap = Math.min(W, H) * 0.014;

    if (layout === 'clockTop') {
      const bandH = (bodyBottom - bodyTop) * 0.3;
      out.push(glass(P, bodyTop, W - 2 * P, bandH, Math.min(W, bandH) * 0.05));
      const clockSize = clamp(bandH * 0.5, 50, 170);
      out.push(clockGroup(W / 2, bodyTop + bandH * (tt.showCountdown ? 0.36 : 0.46), clockSize, clock, tt.showCountdown, pillText, p));
      const gridY = bodyTop + bandH + gap * 1.5;
      out.push(prayerGrid(m.rows, P, gridY, W - 2 * P, bodyBottom - gridY, portrait ? 2 : m.rows.length, p, L, tt.timeFormat, gap));
    } else {
      const gridH = (bodyBottom - bodyTop) * (portrait ? 0.5 : 0.42);
      const gridY = bodyBottom - gridH;
      const clockSize = clamp(Math.min(W * (portrait ? 0.2 : 0.15), (gridY - bodyTop) * 0.5), 60, 240);
      out.push(clockGroup(W / 2, (bodyTop + gridY) / 2 - clockSize * 0.1, clockSize, clock, tt.showCountdown, pillText, p));
      out.push(prayerGrid(m.rows, P, gridY, W - 2 * P, gridH, portrait ? 2 : m.rows.length, p, L, tt.timeFormat, gap));
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  if (tt.showFooter) {
    const methodNote = `${METHODS[tt.method]?.label ?? tt.method} · Asr: ${tt.asrMadhab}`;
    out.push(text(W / 2, H - P * 0.5, tt.footerNote || methodNote, { size: clamp(Math.min(W, H) * 0.014, 11, 20), fill: p.textFaint, anchor: 'middle', letter: 0.5, editId: 'footerNote' }));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}
