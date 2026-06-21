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
const HAIR_SOFT = 'rgba(255,255,255,0.09)';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pad2 = (n: number) => String(n).padStart(2, '0');

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

function fmtClock(hours: number, timeFormat: string): ClockText {
  let total = Math.round(hours * 60);
  total = ((total % 1440) + 1440) % 1440;
  let h = Math.floor(total / 60);
  const m = total % 60;
  if (timeFormat === '24h') return { time: `${pad2(h)}:${pad2(m)}`, period: '' };
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { time: `${h}:${pad2(m)}`, period };
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
  parts.push(rect(x, y, w, h, r, 'none', `stroke="${stroke}" stroke-width="${sw}"`));
  return parts.join('');
}

/** Small dome + mihrab-arch brand mark in the primary colour. */
function mark(x: number, y: number, size: number, color: string): string {
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

function labels(lang: string): Record<string, string> {
  return PRAYER_LABELS[lang] ?? PRAYER_LABELS.en;
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

  const iq = (k: keyof typeof tt.iqamah, adhan: number) => iqamahHours(adhan, tt.iqamah[k]);
  const rows: Row[] = [];
  rows.push({ key: 'fajr', label: 'fajr', adhan: times.fajr, iqamah: iq('fajr', times.fajr) });
  if (tt.showSunrise) rows.push({ key: 'sunrise', label: 'sunrise', adhan: times.sunrise, iqamah: null, minor: true });
  if (isFriday) {
    const j = tt.jumuah.map(parseHHMM).filter((x): x is number => x != null);
    rows.push({ key: 'dhuhr', label: 'jumuah', adhan: j[0] ?? times.dhuhr, iqamah: j[1] ?? null });
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
    <radialGradient id="sun" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff6d8"/>
      <stop offset="45%" stop-color="#ffe49b"/>
      <stop offset="100%" stop-color="${hexToRgba('#f5b942', 0)}"/>
    </radialGradient>
    <radialGradient id="moon" cx="40%" cy="38%" r="65%">
      <stop offset="0%" stop-color="#f4f7ff"/>
      <stop offset="65%" stop-color="#d6def0"/>
      <stop offset="100%" stop-color="#aab8d6"/>
    </radialGradient>
    <radialGradient id="moonglow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${hexToRgba('#cdd9f2', 0.5)}"/>
      <stop offset="100%" stop-color="${hexToRgba('#cdd9f2', 0)}"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
      <stop offset="42%" stop-color="rgba(255,255,255,0.03)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
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

/** The sun (day) or moon (night) — soft edges come from the gradient fade, not a
 *  blur filter, so each video frame stays cheap to rasterize. */
function celestialBody(cel: Celestial, W: number, H: number): string {
  const r = Math.min(W, H) * 0.05;
  const cx = cel.x.toFixed(1);
  const cy = cel.y.toFixed(1);
  if (cel.isDay) {
    return (
      `<circle cx="${cx}" cy="${cy}" r="${(r * 2.4).toFixed(1)}" fill="url(#sun)"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${(r * 0.85).toFixed(1)}" fill="#fff3c4"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${(r * 0.5).toFixed(1)}" fill="#fffbe9"/>`
    );
  }
  return (
    `<circle cx="${cx}" cy="${cy}" r="${(r * 1.9).toFixed(1)}" fill="url(#moonglow)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="url(#moon)"/>`
  );
}

/** Prayer card — a tall stacked tile, or a wide row when much wider than tall. */
function prayerCard(x: number, y: number, w: number, h: number, r: Row, p: Palette, L: Record<string, string>, timeFormat: string): string {
  const cardR = Math.min(w, h) * 0.14;
  const fill = r.active ? hexToRgba(p.primary, 0.2) : r.minor ? HAIR_SOFT : GLASS;
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
    out.push(text(x + pad, y + h * 0.6, name, { size: nameSize, fill: nameColor, family: FONT_SANS, weight: 600, anchor: 'start', letter: 0.5 }));
    if (r.iqamah != null) {
      out.push(text(rightX, y + h * 0.46, fmtShort(r.adhan, timeFormat), { size: timeSize, fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'end' }));
      out.push(text(rightX, y + h * 0.82, `${L.iqamah} ${fmtShort(r.iqamah, timeFormat)}`, { size: iqSize, fill: p.goldSoft, family: FONT_SANS, weight: 600, anchor: 'end' }));
    } else {
      out.push(text(rightX, y + h * 0.64, fmtShort(r.adhan, timeFormat), { size: timeSize, fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'end' }));
    }
    return out.join('');
  }

  const center = x + w / 2;
  if (r.active) out.push(rect(x + cardR, y + Math.max(2, h * 0.05), w - 2 * cardR, Math.max(2, h * 0.025), 2, p.primarySoft));
  const timeStr = fmtShort(r.adhan, timeFormat);
  const iqStr = r.iqamah != null ? `${L.iqamah} ${fmtShort(r.iqamah, timeFormat)}` : '';
  // Fit each line to the card width so times never spill into a neighbouring card.
  const fitW = (s: string, max: number, cap: number, floor: number) =>
    clamp(Math.min(cap, max / Math.max(1, s.length * 0.6)), floor, cap);
  const nameSize = fitW(name, w * 0.9, clamp(Math.min(w * 0.16, h * 0.2), 12, 30), 11);
  const timeSize = fitW(timeStr, w * 0.92, clamp(Math.min(w * 0.3, h * 0.42), 20, 64), 15);
  const iqSize = iqStr ? fitW(iqStr, w * 0.94, clamp(Math.min(w * 0.15, h * 0.16), 10, 24), 9) : 0;
  out.push(text(center, y + h * 0.24 + nameSize * 0.4, name, { size: nameSize, fill: nameColor, family: FONT_SANS, weight: 600, anchor: 'middle', letter: 0.5 }));
  out.push(text(center, y + h * (r.iqamah != null ? 0.58 : 0.64), timeStr, { size: timeSize, fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'middle' }));
  if (iqStr) {
    out.push(text(center, y + h * 0.87, iqStr, { size: iqSize, fill: p.goldSoft, family: FONT_SANS, weight: 600, anchor: 'middle' }));
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

/** Clock (+ optional countdown pill) centred at (cx, cy). */
function clockGroup(cx: number, cy: number, size: number, clock: ClockText, showCountdown: boolean, pill: string, p: Palette): string {
  const out: string[] = [];
  const periodGap = clock.period ? size * 0.5 : 0;
  out.push(text(cx - periodGap * 0.5, cy + size * 0.34, clock.time, { size, fill: 'url(#clockg)', family: FONT_DISPLAY, weight: 600, anchor: 'middle', letter: -1 }));
  if (clock.period) out.push(text(cx - periodGap * 0.5 + size * 1.02, cy + size * 0.34, clock.period, { size: size * 0.26, fill: p.textDim, weight: 600, anchor: 'start' }));
  if (showCountdown && pill) {
    const ps = clamp(size * 0.16, 13, 30);
    const pw = pill.length * ps * 0.6 + ps * 2.2;
    const ph = ps * 2.2;
    out.push(glass(cx - pw / 2, cy + size * 0.5, pw, ph, ph / 2, { fill: GLASS_RAISED }));
    out.push(text(cx, cy + size * 0.5 + ph * 0.64, pill, { size: ps, fill: p.text, anchor: 'middle', letter: 0.5 }));
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
    out.push(mark(leftX + pad, cy, ms, p.primary));
    out.push(text(leftX + pad + ms + leftW * 0.04, cy + ms * 0.78, tt.masjidName, { size: clamp(leftW * 0.075, 14, 30), fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'start' }));
    cy += ms + pad * 0.7;
  } else {
    out.push(text(leftX + pad, cy + leftW * 0.08, tt.masjidName, { size: clamp(leftW * 0.085, 14, 32), fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'start' }));
    cy += leftW * 0.13;
  }
  const clockSize = clamp(leftW * 0.2, 34, 96);
  out.push(text(leftX + pad, cy + clockSize * 0.8, clock.time + (clock.period ? ` ${clock.period}` : ''), { size: clockSize, fill: 'url(#clockg)', family: FONT_DISPLAY, weight: 600, anchor: 'start', letter: -0.5 }));
  if (tt.showDates) {
    out.push(text(leftX + leftW - pad, cy + clockSize * 0.34, hij, { size: clamp(leftW * 0.05, 11, 22), fill: p.goldSoft, family: FONT_DISPLAY, anchor: 'end' }));
    out.push(text(leftX + leftW - pad, cy + clockSize * 0.7, greg, { size: clamp(leftW * 0.038, 9, 17), fill: p.textDim, anchor: 'end' }));
  }
  cy += clockSize + pad * 0.8;

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
    out.push(text(leftX + pad, midY, L[r.label] ?? r.label, { size: nameSize, fill: nameColor, family: FONT_SANS, weight: 600, anchor: 'start' }));
    out.push(text(colAdhan, midY, fmtShort(r.adhan, tt.timeFormat), { size: timeSize, fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'end' }));
    out.push(text(colIq, midY, r.iqamah != null ? fmtShort(r.iqamah, tt.timeFormat) : '—', { size: timeSize, fill: r.iqamah != null ? p.goldSoft : p.textFaint, family: FONT_DISPLAY, weight: 600, anchor: 'end' }));
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
}

const CAROUSEL: TimetableLayout[] = ['centered', 'clockTop', 'split'];

export function renderDisplaySvg(tt: Timetable, now: Date, opts: RenderOpts = {}): string {
  const { width: W, height: H } = dimsFor(tt.orientation, tt.quality);
  const p = getPalette(tt.themeId, tt.accent);
  const L = labels(tt.language);

  if (tt.latitude == null || tt.longitude == null) {
    return setupNeeded(p, W, H, tt.masjidName || 'Our Masjid');
  }

  const m = buildModel(tt, now);
  const nowHours = m.parts.hour + m.parts.minute / 60 + m.parts.second / 3600;
  const clock = fmtClock(nowHours, tt.timeFormat);

  const remMin = (m.nextHours - nowHours) * 60;
  const hms: [number, number, number] = [Math.floor(remMin / 60), Math.floor(remMin % 60), Math.floor((remMin * 60) % 60)];
  const countdown = hms[0] > 0 ? `${hms[0]}h ${pad2(hms[1])}m` : `${hms[1]}m ${pad2(hms[2])}s`;
  const nextLabel = L[m.rows.find((r) => r.next)?.label ?? 'fajr'] ?? '';
  const pillText = `${L.next.toUpperCase()}   ${nextLabel}  ·  ${countdown}`;

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
  out.push(rect(0, 0, W, H, 0, 'url(#khatam)'));

  if (layout === 'split') {
    out.push(splitView(tt, m, clock, hms, greg, hij, p, L, W, H, P));
  } else {
    // ── Masthead ──
    const mastH = H * (portrait ? 0.11 : 0.15);
    const mastY = P;
    const markSize = mastH * 0.62;
    if (portrait) {
      if (tt.showLogo) out.push(mark(W / 2 - markSize / 2, mastY, markSize, p.primary));
      out.push(text(W / 2, mastY + mastH * 0.9, tt.masjidName, { size: clamp(W * 0.06, 26, 72), fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'middle' }));
      if (tt.showDates) {
        if (hij) out.push(text(W / 2, mastY + mastH * 1.2, hij, { size: clamp(W * 0.03, 14, 30), fill: p.goldSoft, family: FONT_DISPLAY, anchor: 'middle' }));
        out.push(text(W / 2, mastY + mastH * 1.42, greg, { size: clamp(W * 0.022, 12, 22), fill: p.textDim, anchor: 'middle' }));
      }
    } else {
      let nameX = P;
      if (tt.showLogo) {
        out.push(mark(P, mastY + (mastH - markSize) / 2, markSize, p.primary));
        nameX = P + markSize + W * 0.012;
      }
      out.push(text(nameX, mastY + mastH * 0.62, tt.masjidName, { size: clamp(mastH * 0.46, 24, 64), fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'start' }));
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
  const methodNote = `${METHODS[tt.method]?.label ?? tt.method} · Asr: ${tt.asrMadhab}`;
  out.push(text(W / 2, H - P * 0.5, tt.footerNote || methodNote, { size: clamp(Math.min(W, H) * 0.014, 11, 20), fill: p.textFaint, anchor: 'middle', letter: 0.5 }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}
