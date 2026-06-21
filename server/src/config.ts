/** Environment configuration. Install settings seed first-run defaults only; all
 *  ongoing configuration lives in the data volume (store.ts). */
import path from 'node:path';
import type { Quality } from './types';

function env(name: string, def = ''): string {
  const v = process.env[name];
  return v == null || v === '' ? def : v;
}
function intEnv(name: string, def: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  port: intEnv('PORT', 8080),
  dataDir: env('DATA_DIR', path.resolve(process.cwd(), 'data')),
  publicDir: env('PUBLIC_DIR', path.resolve(__dirname, '..', 'public')),

  /** How the app talks to MediaMTX on the private compose network. */
  mediamtxApiUrl: env('MEDIAMTX_API_URL', 'http://127.0.0.1:9997'),
  /** Where the app PUBLISHES rendered timetables (app -> mediamtx). */
  rtspInternal: env('MEDIAMTX_RTSP_INTERNAL', 'rtsp://127.0.0.1:8554'),
  /** What MediaMTX uses to pull from ITSELF for per-TV self-relay paths. */
  rtspLoopback: env('MEDIAMTX_RTSP_LOOPBACK', 'rtsp://127.0.0.1:8554'),

  /** First-run seed values (from install settings). */
  seed: {
    rtspPublicHost: env('RTSP_PUBLIC_HOST', ''),
    rtspPublicPort: intEnv('RTSP_PUBLIC_PORT', 8554),
    quality: (env('DISPLAY_QUALITY', '720p') === '1080p' ? '1080p' : '720p') as Quality,
    masjidName: env('MASJID_NAME', 'Our Masjid'),
    latitude: env('LATITUDE', ''),
    longitude: env('LONGITUDE', ''),
    method: env('CALC_METHOD', 'MWL'),
    asrMadhab: env('ASR_MADHAB', 'Standard'),
    timezone: env('TIMEZONE', ''),
    timeFormat: env('TIME_FORMAT', '12h'),
    language: env('LANGUAGE', 'en'),
  },
};

export type Config = typeof config;
