import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AppState, Timetable, IqamahRule, IqamahConfig } from '../types';
import { Modal, Field, Toggle, IconPlus, IconEdit, IconTrash, IconClock, useToast } from '../ui';

interface Props {
  state: AppState;
  refetch: () => Promise<void>;
}

const METHODS = ['MWL', 'ISNA', 'Egypt', 'Makkah', 'Karachi', 'Tehran', 'Jafari'] as const;

export function Timetables({ state, refetch }: Props) {
  const toast = useToast();
  const [edit, setEdit] = useState<Timetable | 'new' | null>(null);
  const [confirm, setConfirm] = useState<Timetable | null>(null);
  const [tick, setTick] = useState(0);

  // Refresh the live previews periodically.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 20000);
    return () => clearInterval(t);
  }, []);

  const remove = async (tt: Timetable) => {
    try {
      await api.deleteTimetable(tt.id);
      setConfirm(null);
      await refetch();
      toast('Timetable removed.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove the timetable.', 'error');
    }
  };

  return (
    <div>
      <div className="page-head row-between">
        <div>
          <h1 className="page-title">Timetables</h1>
          <p className="page-sub">Make a prayer display for each look you need. Give each its own colours to match the room.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setEdit('new')}><IconPlus size={16} /> New timetable</button>
      </div>

      <div className="screens-grid">
        {state.timetables.map((tt) => (
          <div key={tt.id} className="screen-card glass">
            <PreviewImg
              src={`/api/preview/${tt.id}?v=${tick}`}
              portrait={tt.orientation === 'portrait'}
              alt={`Preview of ${tt.name}`}
            />
            <div className="row-between">
              <div style={{ minWidth: 0 }}>
                <div className="screen-name">{tt.name}</div>
                <div className="screen-room">
                  {tt.latitude == null || tt.longitude == null ? 'Location needed' : `${tt.method} · Asr ${tt.asrMadhab}`}
                </div>
              </div>
              <div className="row" style={{ gap: '0.2rem' }}>
                <button className="icon-btn" aria-label="Edit" onClick={() => setEdit(tt)}><IconEdit size={16} /></button>
                <button className="icon-btn" aria-label="Delete" onClick={() => setConfirm(tt)}><IconTrash size={16} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {edit && (
        <TimetableModal
          state={state}
          tt={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            setEdit(null);
            await refetch();
            setTick((n) => n + 1);
          }}
        />
      )}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={`Delete ${confirm?.name ?? 'timetable'}?`}
        footer={
          <>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn btn--danger" onClick={() => confirm && remove(confirm)}>Delete</button>
          </>
        }
      >
        <p className="muted">Any screen set to this timetable will show nothing until you pick another.</p>
      </Modal>
    </div>
  );
}

type Form = Omit<Timetable, 'latitude' | 'longitude'> & { latitude: string; longitude: string };

function toForm(tt: Timetable | null, state: AppState): Form {
  if (tt) {
    return { ...tt, latitude: tt.latitude == null ? '' : String(tt.latitude), longitude: tt.longitude == null ? '' : String(tt.longitude) };
  }
  return {
    id: '', name: 'New timetable', themeId: 'emerald', accent: undefined,
    orientation: 'landscape', quality: state.settings.defaultQuality,
    masjidName: state.timetables[0]?.masjidName ?? 'Our Masjid',
    latitude: '', longitude: '',
    method: 'MWL', asrMadhab: 'Standard', timezone: state.settings.scheduleTimezone ?? '',
    timeFormat: '12h', language: 'en',
    iqamah: { fajr: { mode: 'offset', offset: 20 }, dhuhr: { mode: 'offset', offset: 10 }, asr: { mode: 'offset', offset: 10 }, maghrib: { mode: 'offset', offset: 5 }, isha: { mode: 'offset', offset: 10 } },
    jumuah: ['13:30'], showSunrise: true, footerNote: '', createdAt: '',
  };
}

function TimetableModal({ state, tt, onClose, onSaved }: { state: AppState; tt: Timetable | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(() => toForm(tt, state));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const body: Partial<Timetable> = { ...f, latitude: f.latitude as unknown as number, longitude: f.longitude as unknown as number };
      if (tt) await api.updateTimetable(tt.id, body);
      else await api.createTimetable(body);
      onSaved();
      toast(tt ? 'Timetable saved.' : 'Timetable created.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save.', 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={tt ? 'Edit timetable' : 'New timetable'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={busy}>{tt ? 'Save' : 'Create'}</button>
        </>
      }
    >
      <div className="grid2">
        <Field label="Name (for you)"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Masjid name (on screen)"><input className="input" value={f.masjidName} onChange={(e) => set('masjidName', e.target.value)} /></Field>
      </div>

      <div className="grid2">
        <Field label="Latitude" hint="e.g. 40.7128"><input className="input" inputMode="decimal" value={f.latitude} onChange={(e) => set('latitude', e.target.value)} /></Field>
        <Field label="Longitude" hint="e.g. -74.0060"><input className="input" inputMode="decimal" value={f.longitude} onChange={(e) => set('longitude', e.target.value)} /></Field>
      </div>

      <div className="grid2">
        <Field label="Calculation method">
          <select className="select" value={f.method} onChange={(e) => set('method', e.target.value as Form['method'])}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Asr time">
          <select className="select" value={f.asrMadhab} onChange={(e) => set('asrMadhab', e.target.value as Form['asrMadhab'])}>
            <option value="Standard">Standard (Shafi'i/Maliki/Hanbali)</option>
            <option value="Hanafi">Hanafi (later)</option>
          </select>
        </Field>
      </div>

      <div className="grid2">
        <Field label="Time zone" hint="e.g. America/New_York (blank = server zone)"><input className="input" value={f.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
        <Field label="Clock format">
          <select className="select" value={f.timeFormat} onChange={(e) => set('timeFormat', e.target.value as Form['timeFormat'])}>
            <option value="12h">12-hour</option>
            <option value="24h">24-hour</option>
          </select>
        </Field>
      </div>

      <div className="grid2">
        <Field label="Orientation">
          <select className="select" value={f.orientation} onChange={(e) => set('orientation', e.target.value as Form['orientation'])}>
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
          </select>
        </Field>
        <Field label="Picture quality" hint="720p is best for a Raspberry Pi">
          <select className="select" value={f.quality} onChange={(e) => set('quality', e.target.value as Form['quality'])}>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </Field>
      </div>

      <Field label="Theme colour">
        <div className="chips">
          {state.themes.map((th) => (
            <button
              key={th.id}
              className={`chip${f.themeId === th.id && !f.accent ? ' is-active' : ''}`}
              onClick={() => setF((p) => ({ ...p, themeId: th.id, accent: undefined }))}
              title={th.label}
            >
              <span className="chip-dot" style={{ background: th.palette.primary, opacity: 1 }} />
              {th.label}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid2">
        <Field label="Language (dates)">
          <select className="select" value={f.language} onChange={(e) => set('language', e.target.value as Form['language'])}>
            <option value="en">English</option>
            <option value="ar">العربية (Arabic)</option>
            <option value="ur">اردو (Urdu)</option>
          </select>
        </Field>
        <Field label="Footer note (optional)"><input className="input" value={f.footerNote} onChange={(e) => set('footerNote', e.target.value)} placeholder="e.g. Jumu'ah khutbah at 1:15pm" /></Field>
      </div>

      <div className="setting-row row-between" style={{ padding: '0.4rem 0 0.9rem' }}>
        <span className="label" style={{ margin: 0 }}>Show sunrise</span>
        <Toggle checked={f.showSunrise} onChange={(v) => set('showSunrise', v)} label="Show sunrise" />
      </div>

      <h3 className="section-title" style={{ marginTop: '0.5rem' }}>Iqamah times</h3>
      <div className="list">
        {(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const).map((k) => (
          <IqamahRow key={k} name={k} rule={f.iqamah[k]} onChange={(r) => setF((p) => ({ ...p, iqamah: { ...p.iqamah, [k]: r } as IqamahConfig }))} />
        ))}
      </div>

      <h3 className="section-title">Jumu'ah times (Fridays)</h3>
      <JumuahEditor times={f.jumuah} onChange={(j) => set('jumuah', j)} />

      <p className="hint" style={{ marginTop: '0.8rem' }}><IconClock size={13} /> The card preview updates after you save.</p>
    </Modal>
  );
}

const PRAYER_TITLE: Record<string, string> = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };

function IqamahRow({ name, rule, onChange }: { name: string; rule: IqamahRule; onChange: (r: IqamahRule) => void }) {
  return (
    <div className="list-row">
      <div className="list-row__main"><div className="list-row__title">{PRAYER_TITLE[name]}</div></div>
      <select className="select" style={{ width: 'auto' }} value={rule.mode} onChange={(e) => onChange({ mode: e.target.value as IqamahRule['mode'], offset: 10, fixed: '13:30' })}>
        <option value="offset">Minutes after Adhan</option>
        <option value="fixed">Fixed time</option>
        <option value="none">Don't show</option>
      </select>
      {rule.mode === 'offset' && (
        <input className="input" style={{ width: '5rem' }} type="number" min={0} max={240} value={rule.offset ?? 10} onChange={(e) => onChange({ mode: 'offset', offset: Number(e.target.value) })} />
      )}
      {rule.mode === 'fixed' && (
        <input className="input" style={{ width: '8rem' }} type="time" value={rule.fixed ?? '13:30'} onChange={(e) => onChange({ mode: 'fixed', fixed: e.target.value })} />
      )}
    </div>
  );
}

function JumuahEditor({ times, onChange }: { times: string[]; onChange: (t: string[]) => void }) {
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
      {times.map((t, i) => (
        <span key={i} className="row" style={{ gap: '0.3rem' }}>
          <input className="input" style={{ width: '8rem' }} type="time" value={t} onChange={(e) => onChange(times.map((x, j) => (j === i ? e.target.value : x)))} />
          <button className="icon-btn" aria-label="Remove time" onClick={() => onChange(times.filter((_, j) => j !== i))}><IconTrash size={15} /></button>
        </span>
      ))}
      <button className="btn btn--ghost btn--sm" onClick={() => onChange([...times, '13:30'])}><IconPlus size={14} /> Add time</button>
    </div>
  );
}

function PreviewImg({ src, portrait, alt }: { src: string; portrait: boolean; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const cls = `preview${portrait ? ' preview--portrait' : ''}`;
  if (failed) {
    return (
      <div className={cls} style={{ aspectRatio: portrait ? '9 / 16' : '16 / 9', display: 'grid', placeItems: 'center' }}>
        <span className="muted" style={{ fontSize: '0.85rem' }}>Preview will appear shortly…</span>
      </div>
    );
  }
  return <img className={cls} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
