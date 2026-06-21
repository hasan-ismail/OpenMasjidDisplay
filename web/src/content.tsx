import type { AppState, ContentRef } from './types';
import { IconCamera, IconCast, IconClock, IconPower } from './ui';

export interface ContentOption {
  ref: ContentRef;
  label: string;
  kind: 'off' | 'timetable' | 'camera' | 'hdmi';
}

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function sameContent(a: ContentRef, b: ContentRef): boolean {
  return a.kind === b.kind && (a.id ?? '') === (b.id ?? '');
}

export function contentOptions(state: AppState): ContentOption[] {
  const opts: ContentOption[] = [{ ref: { kind: 'off' }, label: 'Off', kind: 'off' }];
  for (const t of state.timetables) opts.push({ ref: { kind: 'timetable', id: t.id }, label: t.name, kind: 'timetable' });
  for (const s of state.sources) if (s.enabled) opts.push({ ref: { kind: 'source', id: s.id }, label: s.name, kind: s.type });
  return opts;
}

export function contentLabel(c: ContentRef, state: AppState): string {
  if (c.kind === 'off') return 'Off';
  if (c.kind === 'timetable') return state.timetables.find((t) => t.id === c.id)?.name ?? 'Timetable (removed)';
  return state.sources.find((s) => s.id === c.id)?.name ?? 'Source (removed)';
}

function iconFor(kind: ContentOption['kind']) {
  if (kind === 'off') return IconPower;
  if (kind === 'camera') return IconCamera;
  if (kind === 'hdmi') return IconCast;
  return IconClock;
}

export function ContentPicker({
  options,
  value,
  onChange,
}: {
  options: ContentOption[];
  value: ContentRef;
  onChange: (c: ContentRef) => void;
}) {
  return (
    <div className="chips">
      {options.map((o) => {
        const Icon = iconFor(o.kind);
        return (
          <button
            key={`${o.ref.kind}:${o.ref.id ?? ''}`}
            className={`chip${sameContent(o.ref, value) ? ' is-active' : ''}`}
            onClick={() => onChange(o.ref)}
          >
            <Icon size={15} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
