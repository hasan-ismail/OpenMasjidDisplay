/** Normalizers that turn untrusted request bodies into safe, fully-formed
 *  domain objects. Every field is clamped/defaulted; ids and createdAt are
 *  preserved on update or generated on create. */
import { rid, defaultIqamah } from './store';
import { THEMES } from './render/theme';
import { parseHHMM } from './prayer/engine';
import type {
  Timetable,
  Source,
  Tv,
  ScheduleRule,
  Settings,
  ContentRef,
  IqamahRule,
  IqamahConfig,
  CalcMethod,
  AsrMadhab,
  TimeFormat,
  Lang,
  Quality,
  Orientation,
} from './types';

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

function str(v: unknown, def = '', max = 2000): string {
  if (v == null) return def;
  return String(v).slice(0, max);
}
function oneOf<T extends string>(v: unknown, list: readonly T[], def: T): T {
  return (list as readonly string[]).includes(String(v)) ? (v as T) : def;
}
function bool(v: unknown, def = false): boolean {
  return typeof v === 'boolean' ? v : def;
}
function intIn(v: unknown, def: number, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function numOrNull(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** A coordinate within range, or null (so the display shows "Setup needed"
 *  rather than nonsensical times for an out-of-range typo). */
function geoOrNull(v: unknown, lo: number, hi: number): number | null {
  const n = numOrNull(v);
  return n == null || n < lo || n > hi ? null : n;
}
function hhmmOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return parseHHMM(s) != null ? s : null;
}

const THEME_IDS = THEMES.map((t) => t.id);
const METHODS_LIST: CalcMethod[] = ['MWL', 'ISNA', 'Egypt', 'Makkah', 'Karachi', 'Tehran', 'Jafari'];

export function normContent(v: unknown): ContentRef {
  const o = asObj(v);
  const kind = oneOf(o.kind, ['timetable', 'source', 'off'] as const, 'off');
  if (kind === 'off') return { kind: 'off' };
  const id = str(o.id, '', 80);
  return id ? { kind, id } : { kind: 'off' };
}

function normIqamahRule(v: unknown): IqamahRule {
  const o = asObj(v);
  const mode = oneOf(o.mode, ['offset', 'fixed', 'none'] as const, 'offset');
  if (mode === 'fixed') return { mode, fixed: hhmmOrNull(o.fixed) ?? '00:00' };
  if (mode === 'none') return { mode };
  return { mode: 'offset', offset: intIn(o.offset, 10, 0, 240) };
}

function normIqamah(v: unknown): IqamahConfig {
  const o = asObj(v);
  const d = defaultIqamah();
  return {
    fajr: o.fajr ? normIqamahRule(o.fajr) : d.fajr,
    dhuhr: o.dhuhr ? normIqamahRule(o.dhuhr) : d.dhuhr,
    asr: o.asr ? normIqamahRule(o.asr) : d.asr,
    maghrib: o.maghrib ? normIqamahRule(o.maghrib) : d.maghrib,
    isha: o.isha ? normIqamahRule(o.isha) : d.isha,
  };
}

export function normTimetable(input: unknown, base?: Timetable): Timetable {
  const o = asObj(input);
  const accentRaw = str(o.accent, '', 7).trim();
  const accent = /^#?[0-9a-fA-F]{6}$/.test(accentRaw)
    ? accentRaw.startsWith('#') ? accentRaw : `#${accentRaw}`
    : undefined;
  const jumuahIn = Array.isArray(o.jumuah) ? o.jumuah : base?.jumuah ?? ['13:30'];
  const jumuah = jumuahIn.map((x) => hhmmOrNull(x)).filter((x): x is string => x != null);
  return {
    id: base?.id ?? rid('tt'),
    name: str(o.name, base?.name ?? 'Timetable', 80) || 'Timetable',
    themeId: oneOf(o.themeId, THEME_IDS, base?.themeId ?? 'emerald'),
    accent,
    orientation: oneOf(o.orientation, ['landscape', 'portrait'] as const, base?.orientation ?? 'landscape') as Orientation,
    quality: oneOf(o.quality, ['720p', '1080p'] as const, base?.quality ?? '720p') as Quality,
    masjidName: str(o.masjidName, base?.masjidName ?? 'Our Masjid', 80) || 'Our Masjid',
    latitude: o.latitude === undefined ? base?.latitude ?? null : geoOrNull(o.latitude, -90, 90),
    longitude: o.longitude === undefined ? base?.longitude ?? null : geoOrNull(o.longitude, -180, 180),
    method: oneOf(o.method, METHODS_LIST, base?.method ?? 'MWL'),
    asrMadhab: oneOf(o.asrMadhab, ['Standard', 'Hanafi'] as const, base?.asrMadhab ?? 'Standard') as AsrMadhab,
    timezone: str(o.timezone, base?.timezone ?? '', 64).trim(),
    timeFormat: oneOf(o.timeFormat, ['12h', '24h'] as const, base?.timeFormat ?? '12h') as TimeFormat,
    language: oneOf(o.language, ['en', 'ar', 'ur'] as const, base?.language ?? 'en') as Lang,
    iqamah: o.iqamah ? normIqamah(o.iqamah) : base?.iqamah ?? defaultIqamah(),
    jumuah: jumuah.length ? jumuah : ['13:30'],
    showSunrise: o.showSunrise === undefined ? base?.showSunrise ?? true : bool(o.showSunrise, true),
    footerNote: str(o.footerNote, base?.footerNote ?? '', 160),
    createdAt: base?.createdAt ?? new Date().toISOString(),
  };
}

export function normSource(input: unknown, base?: Source): Source {
  const o = asObj(input);
  const url = str(o.url, base?.url ?? '', 1000).trim();
  return {
    id: base?.id ?? rid('src'),
    name: str(o.name, base?.name ?? 'Source', 80) || 'Source',
    type: oneOf(o.type, ['camera', 'hdmi'] as const, base?.type ?? 'camera'),
    url,
    mode: oneOf(o.mode, ['direct', 'normalize'] as const, base?.mode ?? 'direct'),
    quality: oneOf(o.quality, ['720p', '1080p'] as const, base?.quality ?? '720p') as Quality,
    enabled: o.enabled === undefined ? base?.enabled ?? true : bool(o.enabled, true),
    createdAt: base?.createdAt ?? new Date().toISOString(),
  };
}

export function normTv(input: unknown, base?: Tv): Tv {
  const o = asObj(input);
  return {
    id: base?.id ?? rid('tv'),
    name: str(o.name, base?.name ?? 'Screen', 80) || 'Screen',
    room: str(o.room, base?.room ?? '', 80),
    defaultContent: o.defaultContent ? normContent(o.defaultContent) : base?.defaultContent ?? { kind: 'off' },
    override: base?.override ?? null,
    createdAt: base?.createdAt ?? new Date().toISOString(),
  };
}

export function normSchedule(input: unknown, base?: ScheduleRule): ScheduleRule {
  const o = asObj(input);
  const targetsIn = Array.isArray(o.targets) ? o.targets : base?.targets ?? ['*'];
  const targets = targetsIn.map((x) => str(x, '', 80)).filter(Boolean);
  const daysIn = Array.isArray(o.days) ? o.days : base?.days ?? [];
  const days = [...new Set(daysIn.map((d) => intIn(d, -1, 0, 6)).filter((d) => d >= 0))];
  return {
    id: base?.id ?? rid('rule'),
    name: str(o.name, base?.name ?? 'Schedule', 80) || 'Schedule',
    enabled: o.enabled === undefined ? base?.enabled ?? true : bool(o.enabled, true),
    targets: targets.length ? targets : ['*'],
    content: o.content ? normContent(o.content) : base?.content ?? { kind: 'off' },
    days,
    start: hhmmOrNull(o.start) ?? base?.start ?? '13:00',
    end: hhmmOrNull(o.end) ?? base?.end ?? '14:00',
    priority: intIn(o.priority, base?.priority ?? 0, 0, 100),
    createdAt: base?.createdAt ?? new Date().toISOString(),
  };
}

export function normSettings(input: unknown, base: Settings): Settings {
  const o = asObj(input);
  return {
    defaultQuality: oneOf(o.defaultQuality, ['720p', '1080p'] as const, base.defaultQuality) as Quality,
    scheduleTimezone: str(o.scheduleTimezone, base.scheduleTimezone, 64).trim(),
  };
}
