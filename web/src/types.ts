// Client-side mirror of the server domain types (see server/src/types.ts).

export type Quality = '720p' | '1080p';
export type Orientation = 'landscape' | 'portrait';
export type Lang = 'en' | 'ar' | 'ur';
export type CalcMethod = 'MWL' | 'ISNA' | 'Egypt' | 'Makkah' | 'Karachi' | 'Tehran' | 'Jafari';
export type AsrMadhab = 'Standard' | 'Hanafi';
export type TimeFormat = '12h' | '24h';

export interface IqamahRule {
  mode: 'offset' | 'fixed' | 'none';
  offset?: number;
  fixed?: string;
}
export interface IqamahConfig {
  fajr: IqamahRule;
  dhuhr: IqamahRule;
  asr: IqamahRule;
  maghrib: IqamahRule;
  isha: IqamahRule;
}
export interface Timetable {
  id: string;
  name: string;
  themeId: string;
  accent?: string;
  orientation: Orientation;
  quality: Quality;
  masjidName: string;
  latitude: number | null;
  longitude: number | null;
  method: CalcMethod;
  asrMadhab: AsrMadhab;
  timezone: string;
  timeFormat: TimeFormat;
  language: Lang;
  iqamah: IqamahConfig;
  jumuah: string[];
  showSunrise: boolean;
  footerNote: string;
  createdAt: string;
}

export type SourceType = 'camera' | 'hdmi';
export type SourceMode = 'direct' | 'normalize';
export interface Source {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  mode: SourceMode;
  quality: Quality;
  enabled: boolean;
  createdAt: string;
}

export interface ContentRef {
  kind: 'timetable' | 'source' | 'off';
  id?: string;
}

export interface Tv {
  id: string;
  name: string;
  room?: string;
  defaultContent: ContentRef;
  override?: { content: ContentRef; until: number | null } | null;
  createdAt: string;
}

export interface ScheduleRule {
  id: string;
  name: string;
  enabled: boolean;
  targets: string[];
  content: ContentRef;
  days: number[];
  start: string;
  end: string;
  priority: number;
  createdAt: string;
}

export interface Settings {
  rtspPublicHost: string;
  rtspPublicPort: number;
  defaultQuality: Quality;
  scheduleTimezone: string;
}

export interface TvStatus {
  tvId: string;
  effective: ContentRef;
  source: 'override' | 'schedule' | 'default';
  ruleId?: string;
  streamReady: boolean;
}

export interface ThemePreset {
  id: string;
  label: string;
  palette: Record<string, string>;
}

export interface AppState {
  authRequired: boolean;
  settings: Settings;
  timetables: Timetable[];
  sources: Source[];
  tvs: Tv[];
  schedules: ScheduleRule[];
  themes: ThemePreset[];
  statuses: TvStatus[];
  rtsp: { host: string; port: number; transport: string; base: string | null };
  serverNow: number;
}
