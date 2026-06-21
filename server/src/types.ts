/**
 * Shared domain types for OpenMasjid Display.
 *
 * The platform injects no masjid profile, so everything masjid-specific lives
 * here and is persisted to the app's own data volume (see store.ts). Install
 * settings only seed sensible defaults on first run.
 */

export type Quality = '720p' | '1080p';
export type Orientation = 'landscape' | 'portrait';
export type Lang = 'en' | 'ar' | 'ur';
export type CalcMethod = 'MWL' | 'ISNA' | 'Egypt' | 'Makkah' | 'Karachi' | 'Tehran' | 'Jafari';
export type AsrMadhab = 'Standard' | 'Hanafi';
export type TimeFormat = '12h' | '24h';

/** How a prayer's Iqamah time is decided. */
export interface IqamahRule {
  mode: 'offset' | 'fixed' | 'none';
  /** minutes after the Adhan (mode: 'offset') */
  offset?: number;
  /** wall-clock "HH:MM" (mode: 'fixed') */
  fixed?: string;
}

export interface IqamahConfig {
  fajr: IqamahRule;
  dhuhr: IqamahRule;
  asr: IqamahRule;
  maghrib: IqamahRule;
  isha: IqamahRule;
}

/** A full-screen prayer-times display, themeable per room. */
export interface Timetable {
  id: string;
  name: string;
  /** palette preset key (see render/theme.ts) */
  themeId: string;
  /** optional custom primary colour (hex) overriding the preset */
  accent?: string;
  orientation: Orientation;
  quality: Quality;
  masjidName: string;
  latitude: number | null;
  longitude: number | null;
  method: CalcMethod;
  asrMadhab: AsrMadhab;
  /** IANA timezone; '' = use the server's zone */
  timezone: string;
  timeFormat: TimeFormat;
  language: Lang;
  iqamah: IqamahConfig;
  /** Friday khutbah/Jumu'ah times "HH:MM" (one or more) */
  jumuah: string[];
  showSunrise: boolean;
  footerNote: string;
  createdAt: string;
}

export type SourceType = 'camera' | 'hdmi';
/** direct = MediaMTX relays the source as-is (lightest); normalize = transcode
 *  to a fixed H.264 geometry for the widest TV-decoder compatibility. */
export type SourceMode = 'direct' | 'normalize';

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  /** rtsp:// or rtsps:// URL (may embed credentials) */
  url: string;
  mode: SourceMode;
  /** output resolution when mode is 'normalize' (ignored for 'direct') */
  quality: Quality;
  enabled: boolean;
  createdAt: string;
}

/** What a screen shows: a timetable, a source, or nothing. */
export interface ContentRef {
  kind: 'timetable' | 'source' | 'off';
  id?: string;
}

/** A physical screen, addressed by a stable RTSP path its decoder connects to. */
export interface Tv {
  id: string;
  name: string;
  room?: string;
  defaultContent: ContentRef;
  /** Manual override set by a volunteer; until = epoch ms (null = until changed). */
  override?: { content: ContentRef; until: number | null } | null;
  createdAt: string;
}

export interface ScheduleRule {
  id: string;
  name: string;
  enabled: boolean;
  /** TV ids, or ['*'] for every screen */
  targets: string[];
  content: ContentRef;
  /** days the window applies on: 0=Sunday … 6=Saturday */
  days: number[];
  /** window start/end as "HH:MM" (end <= start means it wraps past midnight) */
  start: string;
  end: string;
  /** higher wins when two rules overlap */
  priority: number;
  createdAt: string;
}

export interface Settings {
  /** the server's LAN address the TV decoders connect to */
  rtspPublicHost: string;
  rtspPublicPort: number;
  defaultQuality: Quality;
  /** IANA timezone used to evaluate schedules ('' = server zone) */
  scheduleTimezone: string;
}

/** The single control-panel admin, created in-app on first run. */
export interface AdminAccount {
  hash: string;
  salt: string;
  name?: string;
  createdAt: string;
}

export interface DB {
  version: number;
  /** null until first-run setup creates the admin. */
  admin: AdminAccount | null;
  settings: Settings;
  timetables: Timetable[];
  sources: Source[];
  tvs: Tv[];
  schedules: ScheduleRule[];
}

/** Live status for one screen, pushed to the UI over WebSocket. */
export interface TvStatus {
  tvId: string;
  effective: ContentRef;
  source: 'override' | 'schedule' | 'default';
  /** the schedule rule currently driving it, if any */
  ruleId?: string;
  /** is the underlying content pipeline currently healthy */
  streamReady: boolean;
}
