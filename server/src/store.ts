/** Durable JSON store for all app state, kept in the data volume. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config';
import { makeLog } from './logger';
import type {
  DB,
  Timetable,
  CalcMethod,
  AsrMadhab,
  TimeFormat,
  Lang,
  Quality,
  IqamahConfig,
} from './types';

const log = makeLog('store');
const DB_VERSION = 1;

const VALID_METHODS: CalcMethod[] = ['MWL', 'ISNA', 'Egypt', 'Makkah', 'Karachi'];

function pick<T extends string>(value: string, allowed: T[], fallback: T): T {
  return (allowed as string[]).includes(value) ? (value as T) : fallback;
}

/** Short, URL-safe id with a kind prefix, e.g. "tv_a1b2c3". */
export function rid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

export function defaultIqamah(): IqamahConfig {
  return {
    fajr: { mode: 'offset', offset: 20 },
    dhuhr: { mode: 'offset', offset: 10 },
    asr: { mode: 'offset', offset: 10 },
    maghrib: { mode: 'offset', offset: 5 },
    isha: { mode: 'offset', offset: 10 },
  };
}

function seededTimetable(): Timetable {
  const s = config.seed;
  const lat = Number.parseFloat(s.latitude);
  const lng = Number.parseFloat(s.longitude);
  return {
    id: rid('tt'),
    name: 'Main timetable',
    themeId: 'emerald',
    orientation: 'landscape',
    quality: s.quality,
    layout: 'centered',
    layoutCarousel: false,
    masjidName: s.masjidName || 'Our Masjid',
    latitude: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
    longitude: Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null,
    method: pick<CalcMethod>(s.method, VALID_METHODS, 'MWL'),
    asrMadhab: pick<AsrMadhab>(s.asrMadhab, ['Standard', 'Hanafi'], 'Standard'),
    timezone: s.timezone,
    timeFormat: pick<TimeFormat>(s.timeFormat, ['12h', '24h'], '12h'),
    language: pick<Lang>(s.language, ['en', 'ar', 'ur'], 'en'),
    iqamah: defaultIqamah(),
    jumuah: ['13:30'],
    showSunrise: true,
    showCountdown: true,
    showDates: true,
    showLogo: true,
    showSeconds: false,
    backgroundImage: '',
    logoImage: '',
    footerNote: '',
    createdAt: new Date().toISOString(),
  };
}

/** Backfill fields added in later versions onto a stored timetable, so an upgrade
 *  never silently hides elements that didn't exist as toggles before. */
function migrateTimetable(t: Timetable): Timetable {
  return {
    ...t,
    layout: t.layout ?? 'centered',
    layoutCarousel: t.layoutCarousel ?? false,
    showCountdown: t.showCountdown ?? true,
    showDates: t.showDates ?? true,
    showLogo: t.showLogo ?? true,
    showSeconds: t.showSeconds ?? false,
    backgroundImage: t.backgroundImage ?? '',
    logoImage: t.logoImage ?? '',
    // Drop methods we no longer support (was Tehran/Jafari) → safe default.
    method: VALID_METHODS.includes(t.method) ? t.method : 'MWL',
  };
}

function freshDB(): DB {
  return {
    version: DB_VERSION,
    admin: null,
    settings: {
      defaultQuality: config.seed.quality as Quality,
      scheduleTimezone: config.seed.timezone,
    },
    timetables: [seededTimetable()],
    sources: [],
    tvs: [],
    schedules: [],
  };
}

export type ChangeListener = () => void;

export class Store {
  db: DB;
  /** HMAC secret for signing session cookies (generated once, persisted). */
  readonly secret: Buffer;
  private readonly file: string;
  private readonly listeners = new Set<ChangeListener>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.file = path.join(config.dataDir, 'db.json');
    this.db = this.load();
    this.secret = this.loadSecret();
  }

  private load(): DB {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as DB;
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.timetables)) {
          parsed.timetables = parsed.timetables.map(migrateTimetable);
          return { ...freshDB(), ...parsed, version: DB_VERSION };
        }
      }
    } catch (err) {
      log.error('could not read db.json, starting fresh', err);
    }
    const db = freshDB();
    this.persist(db);
    log.info('initialised a fresh data store');
    return db;
  }

  private loadSecret(): Buffer {
    const f = path.join(config.dataDir, 'session.secret');
    try {
      if (fs.existsSync(f)) return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
    } catch {
      /* regenerate below */
    }
    const secret = crypto.randomBytes(32);
    try {
      fs.writeFileSync(f, secret.toString('hex'), { mode: 0o600 });
    } catch (err) {
      log.warn('could not persist session secret; sessions reset on restart');
    }
    return secret;
  }

  private persist(db: DB): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** Mutate the DB, persist (debounced), and notify listeners synchronously. */
  update(fn: (db: DB) => void): void {
    fn(this.db);
    this.scheduleSave();
    for (const l of this.listeners) {
      try {
        l();
      } catch (err) {
        log.error('change listener failed', err);
      }
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        this.persist(this.db);
      } catch (err) {
        log.error('failed to persist db.json', err);
      }
    }, 150);
  }

  onChange(fn: ChangeListener): void {
    this.listeners.add(fn);
  }
}
