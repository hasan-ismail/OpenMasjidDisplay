/**
 * render/svg.ts — builds the full-screen prayer-times display as an SVG string,
 * which resvg rasterizes into video frames. Calm, dignified, TV-first; mirrors
 * the OpenMasjidOS design language (deep scene, emerald/cyan primary, gold
 * accent, geometric khatam motif). No sacred/Arabic text in decorative chrome.
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

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pad2 = (n: number) => String(n).padStart(2, '0');

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function rrect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  extra = '',
): string {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(
    1,
  )}" rx="${r.toFixed(1)}" ry="${r.toFixed(1)}" fill="${fill}" ${extra}/>`;
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

  // Build the visible rows (Dhuhr becomes Jumu'ah on Fridays).
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

/** "Setup needed" frame when no location is configured. */
function setupNeeded(p: Palette, W: number, H: number, masjidName: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${rrect(0, 0, W, H, 0, p.bg)}
  ${text(W / 2, H * 0.42, masjidName, { size: clamp(W * 0.04, 28, 64), fill: p.primarySoft, family: FONT_DISPLAY, weight: 600, anchor: 'middle' })}
  ${text(W / 2, H * 0.52, 'This screen needs the masjid location', { size: clamp(W * 0.02, 16, 30), fill: p.text, anchor: 'middle' })}
  ${text(W / 2, H * 0.58, 'Open the control panel and add the latitude and longitude.', { size: clamp(W * 0.015, 13, 22), fill: p.textDim, anchor: 'middle' })}
</svg>`;
}

export function renderDisplaySvg(tt: Timetable, now: Date): string {
  const { width: W, height: H } = dimsFor(tt.orientation, tt.quality);
  const p = getPalette(tt.themeId, tt.accent);
  const L = labels(tt.language);

  if (tt.latitude == null || tt.longitude == null) {
    return setupNeeded(p, W, H, tt.masjidName || 'Our Masjid');
  }

  const m = buildModel(tt, now);
  const nowHours = m.parts.hour + m.parts.minute / 60 + m.parts.second / 3600;
  const clock = fmtClock(nowHours, tt.timeFormat);

  // Countdown to next prayer.
  const remMin = (m.nextHours - nowHours) * 60;
  const ch = Math.floor(remMin / 60);
  const cm = Math.floor(remMin % 60);
  const cs = Math.floor((remMin * 60) % 60);
  const countdown = ch > 0 ? `${ch}h ${pad2(cm)}m` : `${cm}m ${pad2(cs)}s`;
  const nextLabel = L[m.rows.find((r) => r.next)?.label ?? 'fajr'] ?? '';

  const greg = gregorian(m.parts, tt.language, tt.timezone);
  const hij = hijri(m.parts, tt.language);

  const portrait = tt.orientation === 'portrait';
  const P = Math.round(Math.min(W, H) * 0.045);

  // ── Regions ──────────────────────────────────────────────────────────────
  const mastH = H * (portrait ? 0.11 : 0.14);
  const footerH = H * 0.06;
  const gridH = H * (portrait ? 0.42 : 0.34);
  const gridY = H - P - footerH - gridH;
  const mastY = P;
  const clockTop = mastY + mastH;
  const clockBottom = gridY;
  const clockCY = (clockTop + clockBottom) / 2;

  const out: string[] = [];

  // Defs: scene gradient, clock gradient, geometric pattern tile.
  out.push(`<defs>
    <radialGradient id="scene" cx="50%" cy="0%" r="120%">
      <stop offset="0%" stop-color="${p.bg2}"/>
      <stop offset="60%" stop-color="${p.bg}"/>
    </radialGradient>
    <linearGradient id="clockg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.text}"/>
      <stop offset="100%" stop-color="${p.textDim}"/>
    </linearGradient>
    <pattern id="khatam" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(0)">
      <g fill="none" stroke="${p.pattern}" stroke-width="1" opacity="0.05">
        <path d="M0 0 L56 56 M56 0 L0 56"/>
        <rect x="14" y="14" width="28" height="28" transform="rotate(45 28 28)"/>
      </g>
    </pattern>
  </defs>`);

  // Background.
  out.push(rrect(0, 0, W, H, 0, 'url(#scene)'));
  out.push(rrect(0, 0, W, H, 0, 'url(#khatam)'));

  // ── Masthead ───────────────────────────────────────────────────────────
  const markSize = mastH * 0.62;
  if (portrait) {
    // Centered stack on portrait.
    out.push(mark(W / 2 - markSize / 2, mastY, markSize, p.primary));
    out.push(text(W / 2, mastY + mastH * 0.86, tt.masjidName, { size: clamp(W * 0.06, 26, 72), fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'middle' }));
  } else {
    const markY = mastY + (mastH - markSize) / 2;
    out.push(mark(P, markY, markSize, p.primary));
    out.push(text(P + markSize + W * 0.012, mastY + mastH * 0.64, tt.masjidName, { size: clamp(mastH * 0.5, 24, 64), fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'start' }));
    if (hij) out.push(text(W - P, mastY + mastH * 0.42, hij, { size: clamp(mastH * 0.3, 16, 34), fill: p.goldSoft, family: FONT_DISPLAY, anchor: 'end' }));
    out.push(text(W - P, mastY + mastH * 0.78, greg, { size: clamp(mastH * 0.22, 13, 24), fill: p.textDim, anchor: 'end' }));
  }
  if (portrait) {
    if (hij) out.push(text(W / 2, mastY + mastH * 1.18, hij, { size: clamp(W * 0.03, 14, 30), fill: p.goldSoft, family: FONT_DISPLAY, anchor: 'middle' }));
    out.push(text(W / 2, mastY + mastH * 1.42, greg, { size: clamp(W * 0.022, 12, 22), fill: p.textDim, anchor: 'middle' }));
  }

  // ── Clock + next-up pill ─────────────────────────────────────────────────
  const clockSize = clamp(Math.min(W * (portrait ? 0.2 : 0.16), (clockBottom - clockTop) * 0.62), 60, 240);
  const periodSize = clockSize * 0.28;
  const clockBaseline = clockCY + clockSize * 0.18;
  const timeStr = clock.time;
  // Center the time+period group; approximate period width.
  const periodGap = clock.period ? clockSize * 0.18 : 0;
  out.push(text(W / 2 - (clock.period ? periodGap * 0.5 : 0), clockBaseline, timeStr, { size: clockSize, fill: 'url(#clockg)', family: FONT_DISPLAY, weight: 600, anchor: 'middle', letter: -1 }));
  if (clock.period) {
    out.push(text(W / 2 + clockSize * 1.1, clockBaseline, clock.period, { size: periodSize, fill: p.textDim, weight: 600, anchor: 'start' }));
  }

  // Next-up pill.
  const pillText = `${L.next.toUpperCase()}   ${nextLabel}  ·  ${countdown}`;
  const pillSize = clamp(Math.min(W, H) * 0.022, 14, 30);
  const pillW = Math.min(W * 0.7, pillText.length * pillSize * 0.62 + pillSize * 2);
  const pillH = pillSize * 2.1;
  const pillX = W / 2 - pillW / 2;
  const pillY = clockBaseline + clockSize * 0.28;
  out.push(rrect(pillX, pillY, pillW, pillH, pillH / 2, p.surface, `stroke="${p.border}" stroke-width="1"`));
  out.push(text(W / 2, pillY + pillH * 0.65, pillText, { size: pillSize, fill: p.textDim, anchor: 'middle', letter: 0.5 }));

  // ── Prayer grid ───────────────────────────────────────────────────────────
  const cols = portrait ? 2 : m.rows.length;
  const rowsCount = Math.ceil(m.rows.length / cols);
  const gap = Math.min(W, H) * 0.012;
  const gridX = P;
  const gridW = W - 2 * P;
  const cardW = (gridW - (cols - 1) * gap) / cols;
  const cardH = (gridH - (rowsCount - 1) * gap) / rowsCount;
  const cardR = Math.min(cardW, cardH) * 0.14;

  m.rows.forEach((r, i) => {
    const col = i % cols;
    const rowIdx = Math.floor(i / cols);
    const cx = gridX + col * (cardW + gap);
    const cy = gridY + rowIdx * (cardH + gap);
    const center = cx + cardW / 2;
    const fill = r.active ? p.surface2 : p.surface;
    const stroke = r.active ? p.primary : p.border;
    const sw = r.active ? 2 : 1;
    out.push(rrect(cx, cy, cardW, cardH, cardR, fill, `stroke="${stroke}" stroke-width="${sw}" ${r.minor ? 'opacity="0.72"' : ''}`));
    if (r.active) out.push(rrect(cx + cardR, cy, cardW - 2 * cardR, Math.max(2, cardH * 0.03), 2, p.primary));

    const nameSize = clamp(cardW * 0.16, 13, 30);
    const timeSize = clamp(cardW * 0.3, 22, 60);
    const iqLabelSize = clamp(cardW * 0.1, 9, 18);
    const iqTimeSize = clamp(cardW * 0.16, 13, 30);

    const nameColor = r.active ? p.primarySoft : r.next ? p.goldSoft : p.textDim;
    out.push(text(center, cy + cardH * 0.2 + nameSize * 0.5, L[r.label] ?? r.label, { size: nameSize, fill: nameColor, family: FONT_SANS, weight: 600, anchor: 'middle', letter: 0.5 }));
    out.push(text(center, cy + cardH * (r.iqamah != null ? 0.56 : 0.62), fmtShort(r.adhan, tt.timeFormat), { size: timeSize, fill: p.text, family: FONT_DISPLAY, weight: 600, anchor: 'middle' }));
    if (r.iqamah != null) {
      out.push(text(center, cy + cardH * 0.86, `${L.iqamah} ${fmtShort(r.iqamah, tt.timeFormat)}`, { size: iqTimeSize, fill: p.goldSoft, family: FONT_SANS, weight: 600, anchor: 'middle' }));
      void iqLabelSize;
    }
    if (r.next) {
      out.push(`<circle cx="${center.toFixed(1)}" cy="${(cy + cardH - cardH * 0.06).toFixed(1)}" r="${Math.max(2, cardW * 0.018).toFixed(1)}" fill="${p.gold}"/>`);
    }
  });

  // ── Footer ─────────────────────────────────────────────────────────────
  const methodNote = `${METHODS[tt.method]?.label ?? tt.method} · Asr: ${tt.asrMadhab}`;
  const footer = tt.footerNote ? `${tt.footerNote}` : methodNote;
  out.push(text(W / 2, H - P - footerH * 0.1, footer, { size: clamp(Math.min(W, H) * 0.014, 11, 20), fill: p.textFaint, anchor: 'middle', letter: 0.5 }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}
