import type {
  AppState,
  Timetable,
  Source,
  Tv,
  ScheduleRule,
  Settings,
  ContentRef,
} from './types';

let onUnauth: () => void = () => {};
export function setUnauthHandler(fn: () => void): void {
  onUnauth = fn;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    onUnauth();
    throw new Error('Please sign in.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  session: () =>
    req<{
      needsSetup: boolean;
      authed: boolean;
      hasPassword: boolean;
      sso: { enabled: boolean; username?: string };
    }>('GET', '/api/session'),
  setup: (password: string) => req<{ ok: boolean }>('POST', '/api/setup', { password }),
  login: (password: string) => req<{ ok: boolean }>('POST', '/api/login', { password }),
  logout: () => req<{ ok: boolean }>('POST', '/api/logout'),
  state: () => req<AppState>('GET', '/api/state'),

  saveSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/api/settings', s),

  createTimetable: (b: Partial<Timetable>) => req<Timetable>('POST', '/api/timetables', b),
  updateTimetable: (id: string, b: Partial<Timetable>) => req<Timetable>('PUT', `/api/timetables/${id}`, b),
  deleteTimetable: (id: string) => req('DELETE', `/api/timetables/${id}`),
  uploadBackground: (id: string, dataUrl: string) =>
    req<Timetable>('POST', `/api/timetables/${id}/background`, { data: dataUrl }),
  removeBackground: (id: string) => req<Timetable>('DELETE', `/api/timetables/${id}/background`),

  /** Live PNG preview of an unsaved timetable form; returns an object URL. */
  previewLive: async (body: Partial<Timetable>): Promise<string> => {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      onUnauth();
      throw new Error('Please sign in.');
    }
    if (!res.ok) throw new Error('Could not render the preview.');
    return URL.createObjectURL(await res.blob());
  },

  createSource: (b: Partial<Source>) => req<Source>('POST', '/api/sources', b),
  updateSource: (id: string, b: Partial<Source>) => req<Source>('PUT', `/api/sources/${id}`, b),
  deleteSource: (id: string) => req('DELETE', `/api/sources/${id}`),

  createTv: (b: Partial<Tv>) => req<Tv>('POST', '/api/tvs', b),
  updateTv: (id: string, b: Partial<Tv>) => req<Tv>('PUT', `/api/tvs/${id}`, b),
  deleteTv: (id: string) => req('DELETE', `/api/tvs/${id}`),
  setTv: (id: string, content: ContentRef, until: number | null) =>
    req<Tv>('POST', `/api/tvs/${id}/set`, { content, until }),
  resumeTv: (id: string) => req<Tv>('POST', `/api/tvs/${id}/resume`),

  createSchedule: (b: Partial<ScheduleRule>) => req<ScheduleRule>('POST', '/api/schedules', b),
  updateSchedule: (id: string, b: Partial<ScheduleRule>) => req<ScheduleRule>('PUT', `/api/schedules/${id}`, b),
  deleteSchedule: (id: string) => req('DELETE', `/api/schedules/${id}`),
};
