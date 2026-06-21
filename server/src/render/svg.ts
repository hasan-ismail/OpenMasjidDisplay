/**
 * render/svg.ts — builds the full-screen prayer-times display as an SVG string,
 * which resvg rasterizes into video frames.
 *
 * The look mirrors the OpenMasjidOS "liquid glass" language: a soft aurora scene
 * (or the masjid's own background image, gently frosted), translucent glass panels
 * with a top sheen and hairline borders, emerald/cyan primary and a gold accent.
 * Three arrangement presets (centered / clockTop / split) and per-element toggles
 * are honoured. No sacred/Arabic text appears in decorative chrome.
 */
import type { Timetable } from '../types';
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

/** "h:mm" / "HH:mm" without the period suffix (for compact card use). */
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
    parts.push(
      `<rect x="${(x - 1).toFixed(1)}" y="${(y - 1).toFixed(1)}" width="${(w + 2).toFixed(1)}" height="${(h + 2).toFixed(1)}" rx="${(r + 1).toFixed(1)}" fill="none" stroke="${opts.glow}" stroke-width="6" opacity="0.5" filter="url(#soft)"/>`,
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
  en: { fajr: 'Fajr', sunrise: 'Sunrise', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha', jumuah: "Jumu'ah", iqamah: 'Iqāmah', next: 'Next prayer' },
  ar: { fajr: 'الفجر', sunrise: 'الشروق', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء', jumuah: 'الجمعة', iqamah: 'الإقامة', next: 'الصلاة القادمة' },
  ur: { fajr: 'فجر', sunrise: 'طلوع', dhuhr: 'ظہر', asr: 'عصر', maghrib: 'مغرب', isha: 'عشاء', jumuah: 'جمعہ', iqamah: 'اقامہ', next: 'اگلی نماز' },
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

  // Tomorrow's Fajr for post-Isha rollover.
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

/** Shared <defs>: scene + glow + sheen + clock gradient + image frost + pattern. */
function defs(p: Palette, hasImage: boolean): string {
  return `<defs>
    <radialGradient id="scene" cx="50%" cy="-10%" r="130%">
      <stop offset="0%" stop-color="${p.bg2}"/>
      <stop offset="55%" stop-color="${p.bg}"/>
      <stop offset="100%" stop-color="${p.bg}"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="0%" r="70%">
      <stop offset="0%" stop-color="${hexToRgba(p.primary, 0.5)}"/>
      <stop offset="100%" stop-color="${hexToRgba(p.primary, 0)}"/>
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
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="8"/>
    </filter>
    ${hasImage ? `<filter id="frost" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>` : ''}
    <pattern id="khatam" width="58" height="58" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="${p.pattern}" stroke-width="1" opacity="0.05">
        <path d="M0 0 L58 58 M58 0 L0 58"/>
        <rect x="15" y="15" width="28" height="28" transform="rotate(45 29 29)"/>
      </g>
    </pattern>
  </defs>`;
}

/** The clock + countdown, drawn centred in a box (clockTop / centered presets). */
function clockGroup(
  cx: number,
  cy: number,
  size: number,
  clock: ClockText,
  showCountdown: boolean,
  pill: string,
  p: Palette,
): string {
  const out: string[] = [];
  const periodGap = clock.period ? size * 0.5 : 0;
  out.push(text(cx - periodGap * 0.5, cy + size * 0.34, clock.time, { size, fill: 'url(#clockg)', family: FONT_DISPLAY, weight: 600, anchor: 'middle', letter: -1 }));
  if (clock.period) {
    out.push(text(cx - periodGap * 0.5 + size * 1.02, cy + size * 0.34, clock.period, { size: size * 0.26, fill: p.textDim, weight: 600, anchor: 'start' }));
  }
  if (showCountdown && pill) {
    const ps = clamp(size * 0.16, 13, 30);
    const pw = pill.length * ps * 0.6 + ps * 2.2;
    const ph = ps * 2.2;
    const px = cx - pw / 2;
    const py = cy + size * 0.5;
    out.push(glass(px, py, pw, ph, ph / 2, { fill: GLASS_RAISED }));
    out.push(text(cx, py + ph * 0.64, pill, { size: ps, fill: p.text, anchor: 'middle', letter: 0.5 }));
  }
  return out.join('');
}

/** A prayer card. Lays out as a tall stacked tile, or — when the cell is much
 *  wider than tall (a vertical list, e.g. the "split" layout) — as a row. */
function prayerCard(
  x: number,
  y: number,
  w: number,
  h: number,
  r: Row,
  p: Palette,
  L: Record<string, string>,
  timeFormat: string,
): string {
  const cardR = Math.min(w, h) * 0.14;
  const fill = r.active ? hexToRgba(p.primary, 0.2) : r.minor ? HAIR_SOFT : GLASS;
  const stroke = r.active ? p.primary : HAIR;
  const nameColor = r.active ? p.primarySoft : r.next ? p.goldSoft : p.textDim;
  const name = L[r.label] ?? r.label;
  const out: string[] = [];
  out.push(glass(x, y, w, h, cardR, { fill, stroke, sw: r.active ? 2 : 1, glow: r.active ? p.primary : undefined }));

  if (w / h > 2) {
    // ── Row (name left, adhan + iqamah right) ──
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

  // ── Tall stacked tile ──
  const center = x + w / 2;
  if (r.active) out.push(rect(x + cardR, y + Math.max(2, h * 0.05), w - 2 * cardR, Math.max(2, h * 0.025), 2, p.primarySoft));
  const nameSize = clamp(Math.min(w * 0.16, h * 0.2), 12, 30);
  const timeSize = clamp(Math.min(w * 0.3, h * 0.42), 20, 64);
  const iqSize = clamp(Math.min(w * 0.15, h * 0.16), 10, 26);
  out.push(text(center, y + h * 0.24 + nameSize * 0.4, name, { size: nameSize, fill: nameColor, family: FONT_SANS, weight: 600, anchor: 'middle', letter: 0.5 }));
  out.push(text(center, y + h * (r.iqamah != null ? 0.58 : 0.64), fmtShort(r.adhan, timeFormat), { size: timeSize, fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'middle' }));
  if (r.iqamah != null) {
    out.push(text(center, y + h * 0.87, `${L.iqamah} ${fmtShort(r.iqamah, timeFormat)}`, { size: iqSize, fill: p.goldSoft, family: FONT_SANS, weight: 600, anchor: 'middle' }));
  }
  if (r.next) out.push(`<circle cx="${center.toFixed(1)}" cy="${(y + h - h * 0.06).toFixed(1)}" r="${Math.max(2, w * 0.018).toFixed(1)}" fill="${p.gold}"/>`);
  return out.join('');
}

/** A grid of prayer cards filling (x,y,w,h) in `cols` columns. */
function prayerGrid(
  rows: Row[],
  x: number,
  y: number,
  w: number,
  h: number,
  cols: number,
  p: Palette,
  L: Record<string, string>,
  timeFormat: string,
  gap: number,
): string {
  const rowsCount = Math.ceil(rows.length / cols);
  const cardW = (w - (cols - 1) * gap) / cols;
  const cardH = (h - (rowsCount - 1) * gap) / rowsCount;
  return rows
    .map((r, i) => {
      const col = i % cols;
      const rowIdx = Math.floor(i / cols);
      return prayerCard(x + col * (cardW + gap), y + rowIdx * (cardH + gap), cardW, cardH, r, p, L, timeFormat);
    })
    .join('');
}

/** "Setup needed" frame when no location is configured. */
function setupNeeded(p: Palette, W: number, H: number, masjidName: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${defs(p, false)}
  ${rect(0, 0, W, H, 0, 'url(#scene)')}
  ${rect(0, 0, W, H, 0, 'url(#glow)')}
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
  const ch = Math.floor(remMin / 60);
  const cm = Math.floor(remMin % 60);
  const cs = Math.floor((remMin * 60) % 60);
  const countdown = ch > 0 ? `${ch}h ${pad2(cm)}m` : `${cm}m ${pad2(cs)}s`;
  const nextLabel = L[m.rows.find((r) => r.next)?.label ?? 'fajr'] ?? '';
  const pillText = `${L.next.toUpperCase()}   ${nextLabel}  ·  ${countdown}`;

  const greg = gregorian(m.parts, tt.language, tt.timezone);
  const hij = hijri(m.parts, tt.language);

  const portrait = tt.orientation === 'portrait';
  const layout = portrait && tt.layout === 'split' ? 'centered' : tt.layout;
  const P = Math.round(Math.min(W, H) * 0.05);
  const hasImage = !!opts.bg;

  const out: string[] = [];
  out.push(defs(p, hasImage));

  // ── Background ────────────────────────────────────────────────────────────
  if (hasImage) {
    out.push(`<image href="${opts.bg}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" filter="url(#frost)"/>`);
    out.push(rect(0, 0, W, H, 0, 'url(#scrim)'));
  } else {
    out.push(rect(0, 0, W, H, 0, 'url(#scene)'));
    out.push(rect(0, 0, W, H, 0, 'url(#glow)'));
  }
  out.push(rect(0, 0, W, H, 0, 'url(#khatam)'));

  // ── Masthead (logo + name + dates) ─────────────────────────────────────────
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

  // ── Body regions per layout ────────────────────────────────────────────────
  const footerH = H * 0.05;
  const bodyTop = mastY + mastH * (portrait && tt.showDates ? 1.55 : 1.15);
  const bodyBottom = H - P - footerH;
  const gap = Math.min(W, H) * 0.014;

  if (layout === 'split') {
    // Left: clock + countdown in a tall glass panel. Right: vertical prayer list.
    const colGap = gap * 1.5;
    const leftW = (W - 2 * P - colGap) * 0.42;
    const leftX = P;
    const rightX = leftX + leftW + colGap;
    const rightW = W - P - rightX;
    const panelY = bodyTop;
    const panelH = bodyBottom - bodyTop;
    out.push(glass(leftX, panelY, leftW, panelH, Math.min(leftW, panelH) * 0.06));
    const clockSize = clamp(leftW * 0.34, 60, 200);
    out.push(clockGroup(leftX + leftW / 2, panelY + panelH * 0.4, clockSize, clock, tt.showCountdown, pillText, p));
    out.push(prayerGrid(m.rows, rightX, panelY, rightW, panelH, 1, p, L, tt.timeFormat, gap));
  } else if (layout === 'clockTop') {
    // Clock band right under the masthead, grid fills the rest.
    const bandH = (bodyBottom - bodyTop) * 0.3;
    const bandY = bodyTop;
    out.push(glass(P, bandY, W - 2 * P, bandH, Math.min(W, bandH) * 0.05));
    const clockSize = clamp(bandH * 0.5, 50, 170);
    out.push(clockGroup(W / 2, bandY + bandH * (tt.showCountdown ? 0.36 : 0.46), clockSize, clock, tt.showCountdown, pillText, p));
    const gridY = bandY + bandH + gap * 1.5;
    const cols = portrait ? 2 : m.rows.length;
    out.push(prayerGrid(m.rows, P, gridY, W - 2 * P, bodyBottom - gridY, cols, p, L, tt.timeFormat, gap));
  } else {
    // centered: clock floats between masthead and a bottom grid.
    const gridH = (bodyBottom - bodyTop) * (portrait ? 0.5 : 0.42);
    const gridY = bodyBottom - gridH;
    const clockSize = clamp(Math.min(W * (portrait ? 0.2 : 0.15), (gridY - bodyTop) * 0.5), 60, 240);
    out.push(clockGroup(W / 2, (bodyTop + gridY) / 2 - clockSize * 0.1, clockSize, clock, tt.showCountdown, pillText, p));
    const cols = portrait ? 2 : m.rows.length;
    out.push(prayerGrid(m.rows, P, gridY, W - 2 * P, gridH, cols, p, L, tt.timeFormat, gap));
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  const methodNote = `${METHODS[tt.method]?.label ?? tt.method} · Asr: ${tt.asrMadhab}`;
  const footer = tt.footerNote ? tt.footerNote : methodNote;
  out.push(text(W / 2, H - P * 0.5, footer, { size: clamp(Math.min(W, H) * 0.014, 11, 20), fill: p.textFaint, anchor: 'middle', letter: 0.5 }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}
