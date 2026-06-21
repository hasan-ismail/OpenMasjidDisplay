import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { AppState, Timetable, TimetableLayout, IqamahRule, IqamahConfig, Hotspot } from '../types';
import { Modal, Field, Toggle, Spinner, IconPlus, IconEdit, IconTrash, IconClock, IconExpand, IconShrink, useToast } from '../ui';

interface Props {
  state: AppState;
  refetch: () => Promise<void>;
}

const METHODS = ['MWL', 'ISNA', 'Egypt', 'Makkah', 'Karachi'] as const;
const LAYOUTS: { id: TimetableLayout; label: string }[] = [
  { id: 'centered', label: 'Centered' },
  { id: 'clockTop', label: 'Clock on top' },
  { id: 'split', label: 'Split' },
];

export function Timetables({ state, refetch }: Props) {
  const toast = useToast();
  const [edit, setEdit] = useState<Timetable | 'new' | null>(null);
  const [confirm, setConfirm] = useState<Timetable | null>(null);
  const [tick, setTick] = useState(0);

  // Refresh the card previews periodically.
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
          <p className="page-sub">Design a prayer display for each look you need. Open one to edit it live.</p>
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
    orientation: 'landscape', quality: state.settings.defaultQuality, layout: 'centered', layoutCarousel: false,
    masjidName: state.timetables[0]?.masjidName ?? 'Our Masjid',
    latitude: '', longitude: '',
    method: 'MWL', asrMadhab: 'Standard', timezone: state.settings.scheduleTimezone ?? '',
    timeFormat: '12h', language: 'en',
    iqamah: { fajr: { mode: 'offset', offset: 20 }, dhuhr: { mode: 'offset', offset: 10 }, asr: { mode: 'offset', offset: 10 }, maghrib: { mode: 'offset', offset: 5 }, isha: { mode: 'offset', offset: 10 } },
    jumuah: ['13:30'], showSunrise: true, showCountdown: true, showDates: true, showLogo: true, showSeconds: false,
    backgroundImage: '', logoImage: '', footerNote: '', createdAt: '',
  };
}

/** Form (with string lat/long) → a timetable body for save/preview. */
function formBody(f: Form): Partial<Timetable> {
  return {
    ...f,
    latitude: f.latitude.trim() === '' ? null : Number(f.latitude),
    longitude: f.longitude.trim() === '' ? null : Number(f.longitude),
  } as Partial<Timetable>;
}

function TimetableModal({ state, tt, onClose, onSaved }: { state: AppState; tt: Timetable | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Form>(() => toForm(tt, state));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const themePrimary = state.themes.find((t) => t.id === f.themeId)?.palette.primary ?? '#22D3EE';

  const save = async () => {
    setBusy(true);
    try {
      const body = formBody(f);
      if (tt) await api.updateTimetable(tt.id, body);
      else await api.createTimetable(body);
      onSaved();
      toast(tt ? 'Timetable saved.' : 'Timetable created.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save.', 'error');
      setBusy(false);
    }
  };

  const pickBackground = (file: File) => {
    if (!tt) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const updated = await api.uploadBackground(tt.id, String(reader.result));
        set('backgroundImage', updated.backgroundImage);
        toast('Background updated.');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not upload the image.', 'error');
      }
    };
    reader.onerror = () => toast('Could not read that image.', 'error');
    reader.readAsDataURL(file);
  };
  const clearBackground = async () => {
    if (!tt) return;
    try {
      await api.removeBackground(tt.id);
      set('backgroundImage', '');
      toast('Background removed.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove the background.', 'error');
    }
  };

  const pickLogo = (file: File) => {
    if (!tt) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const updated = await api.uploadLogo(tt.id, String(reader.result));
        set('logoImage', updated.logoImage);
        toast('Logo updated.');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not upload the logo.', 'error');
      }
    };
    reader.onerror = () => toast('Could not read that image.', 'error');
    reader.readAsDataURL(file);
  };
  const clearLogo = async () => {
    if (!tt) return;
    try {
      await api.removeLogo(tt.id);
      set('logoImage', '');
      toast('Logo removed.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove the logo.', 'error');
    }
  };

  // Click-to-edit in the live preview: rename a prayer, the masjid name or footer.
  const editLabel = (id: string, value: string) => {
    if (id === 'masjidName') set('masjidName', value || 'Our Masjid');
    else if (id === 'footerNote') set('footerNote', value);
    else if (id.startsWith('label.')) {
      const key = id.slice(6);
      setF((p) => {
        const labels = { ...(p.labels ?? {}) };
        const v = value.trim();
        if (v) labels[key] = v;
        else delete labels[key];
        return { ...p, labels: Object.keys(labels).length ? labels : undefined };
      });
    }
  };

  const [csvRows, setCsvRows] = useState<number | null>(tt?.iqamahYear ? Object.keys(tt.iqamahYear).length : null);
  const importCsv = (file: File) => {
    if (!tt) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await api.importIqamahCsv(tt.id, String(reader.result));
        setCsvRows(r.rows);
        toast(`Imported Iqamah times for ${r.rows} day${r.rows === 1 ? '' : 's'}.`);
        if (r.errors.length) toast(`${r.errors.length} line(s) were skipped.`, 'error');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not read that CSV.', 'error');
      }
    };
    reader.onerror = () => toast('Could not read that file.', 'error');
    reader.readAsText(file);
  };
  const clearCsv = async () => {
    if (!tt) return;
    try {
      await api.clearIqamahCsv(tt.id);
      setCsvRows(null);
      toast('Reverted to your Iqamah rules.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not clear the CSV.', 'error');
    }
  };

  return (
    <Modal
      open
      wide
      windowed
      onClose={onClose}
      title={tt ? 'Design timetable' : 'New timetable'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={busy}>{tt ? 'Save' : 'Create'}</button>
        </>
      }
    >
      <div className="studio">
        <div className="studio__preview">
          <LivePreview body={formBody(f)} portrait={f.orientation === 'portrait'} onEditCommit={editLabel} />
          <p className="hint" style={{ textAlign: 'center', marginBlockStart: '0.5rem' }}>
            <IconClock size={12} /> Live preview — click a name, the masjid title or the footer to rename it.
          </p>
        </div>

        <div className="studio__controls">
          <div className="grid2">
            <Field label="Name (for you)"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Masjid name (on screen)"><input className="input" value={f.masjidName} onChange={(e) => set('masjidName', e.target.value)} /></Field>
          </div>

          <Field label="Layout">
            <div className="chips">
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" className={`chip${f.layout === l.id && !f.layoutCarousel ? ' is-active' : ''}`} onClick={() => set('layout', l.id)}>{l.label}</button>
              ))}
            </div>
          </Field>
          <div className="toggle-row row-between" style={{ marginBlockEnd: '0.9rem' }}>
            <span className="label" style={{ margin: 0 }}>
              Rotate layouts over the day <span className="hint">— gently prevents TV burn-in</span>
            </span>
            <Toggle checked={f.layoutCarousel} onChange={(v) => set('layoutCarousel', v)} label="Rotate layouts over the day" />
          </div>

          <div className="grid2">
            <Field label="Latitude" hint="e.g. 40.7128"><input className="input" inputMode="decimal" value={f.latitude} onChange={(e) => set('latitude', e.target.value)} /></Field>
            <Field label="Longitude" hint="e.g. -74.0060"><input className="input" inputMode="decimal" value={f.longitude} onChange={(e) => set('longitude', e.target.value)} /></Field>
          </div>
          <p className="hint" style={{ marginBlockStart: '-0.5rem', marginBlockEnd: '0.6rem' }}>
            Don't know yours?{' '}
            <a href="https://www.latlong.net/convert-address-to-lat-long.html" target="_blank" rel="noopener noreferrer">Look up your address →</a>
          </p>

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
            <Field label="Time zone" hint="e.g. America/New_York (blank = server)"><input className="input" value={f.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
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
                  type="button"
                  className={`chip${f.themeId === th.id && !f.accent ? ' is-active' : ''}`}
                  onClick={() => setF((p) => ({ ...p, themeId: th.id, accent: undefined }))}
                  title={th.label}
                >
                  <span className="chip-dot" style={{ background: th.palette.primary, opacity: 1 }} />
                  {th.label}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: '0.6rem', marginBlockStart: '0.55rem' }}>
              <label className="row" style={{ gap: '0.45rem' }}>
                <input type="color" className="color-input" value={f.accent ?? themePrimary} onChange={(e) => set('accent', e.target.value)} />
                <span className="hint">Custom colour</span>
              </label>
              {f.accent && <button type="button" className="btn btn--ghost btn--sm" onClick={() => set('accent', undefined)}>Use theme colour</button>}
            </div>
          </Field>

          <Field label="Background">
            {tt ? (
              <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: '0.88rem' }}>{f.backgroundImage ? 'Custom image set.' : 'Using the themed scene.'}</span>
                <label className="btn btn--ghost btn--sm" style={{ cursor: 'pointer' }}>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) pickBackground(file); e.target.value = ''; }} />
                  {f.backgroundImage ? 'Replace image' : 'Upload image'}
                </label>
                {f.backgroundImage && <button type="button" className="btn btn--ghost btn--sm" onClick={clearBackground}>Remove</button>}
              </div>
            ) : (
              <span className="hint">Create the timetable first, then you can add a background image.</span>
            )}
          </Field>

          <Field label="Masjid logo" hint="Replaces the built-in dome mark. A transparent PNG or SVG looks best.">
            {tt ? (
              <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: '0.88rem' }}>{f.logoImage ? 'Custom logo set.' : 'Using the built-in mark.'}</span>
                <label className="btn btn--ghost btn--sm" style={{ cursor: 'pointer' }}>
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) pickLogo(file); e.target.value = ''; }} />
                  {f.logoImage ? 'Replace logo' : 'Upload logo'}
                </label>
                {f.logoImage && <button type="button" className="btn btn--ghost btn--sm" onClick={clearLogo}>Remove</button>}
              </div>
            ) : (
              <span className="hint">Create the timetable first, then you can add a logo.</span>
            )}
          </Field>

          <h3 className="section-title">Show on screen</h3>
          <div className="toggle-list">
            <ToggleRow label="Logo & masjid name" checked={f.showLogo} onChange={(v) => set('showLogo', v)} />
            <ToggleRow label="Hijri & Gregorian dates" checked={f.showDates} onChange={(v) => set('showDates', v)} />
            <ToggleRow label="Countdown to next prayer" checked={f.showCountdown} onChange={(v) => set('showCountdown', v)} />
            <ToggleRow label="Seconds on the clock" checked={f.showSeconds} onChange={(v) => set('showSeconds', v)} />
            <ToggleRow label="Sunrise" checked={f.showSunrise} onChange={(v) => set('showSunrise', v)} />
          </div>

          <div style={{ marginBlockStart: '0.9rem' }}>
            <Field label="Language (dates)">
              <select className="select" value={f.language} onChange={(e) => set('language', e.target.value as Form['language'])}>
                <option value="en">English</option>
                <option value="ar">العربية (Arabic)</option>
                <option value="ur">اردو (Urdu)</option>
              </select>
            </Field>
            <Field label="Footer note (optional)"><input className="input" value={f.footerNote} onChange={(e) => set('footerNote', e.target.value)} placeholder="e.g. Jumu'ah khutbah at 1:15pm" /></Field>
          </div>

          <h3 className="section-title">Iqamah times</h3>
          <div className="list">
            {(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const).map((k) => (
              <IqamahRow key={k} name={k} rule={f.iqamah[k]} onChange={(r) => setF((p) => ({ ...p, iqamah: { ...p.iqamah, [k]: r } as IqamahConfig }))} />
            ))}
          </div>

          <h3 className="section-title">Jumu'ah times (Fridays)</h3>
          <JumuahEditor times={f.jumuah} onChange={(j) => set('jumuah', j)} />

          <h3 className="section-title">Iqamah times for the whole year (CSV)</h3>
          {tt ? (
            <div>
              <p className="hint" style={{ marginBlockStart: 0 }}>
                Upload one file with a row per day to set exact Iqamah times for the whole year — they override
                the rules above on matching dates. Download the example to see the format (it comes pre-filled
                from your rules, ready to tweak).
              </p>
              <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginBlockStart: '0.6rem' }}>
                <label className="btn btn--primary btn--sm" style={{ cursor: 'pointer' }}>
                  <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) importCsv(file); e.target.value = ''; }} />
                  Import CSV
                </label>
                <a className="btn btn--ghost btn--sm" href={api.iqamahCsvUrl(tt.id, 'template')}>Download example</a>
                <a className="btn btn--ghost btn--sm" href={api.iqamahCsvUrl(tt.id)}>Export current</a>
                {csvRows != null && <button type="button" className="btn btn--ghost btn--sm" onClick={clearCsv}>Clear ({csvRows} days)</button>}
              </div>
              {csvRows != null && (
                <p className="hint" style={{ marginBlockStart: '0.5rem' }}>
                  {csvRows} day{csvRows === 1 ? '' : 's'} set from CSV. These show on the screens; the live preview
                  here still uses your rules.
                </p>
              )}
            </div>
          ) : (
            <span className="hint">Create the timetable first, then you can upload a yearly CSV.</span>
          )}
        </div>
      </div>
    </Modal>
  );
}

function LivePreview({ body, portrait, onEditCommit }: { body: Partial<Timetable>; portrait: boolean; onEditCommit: (id: string, value: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [spots, setSpots] = useState<Hotspot[]>([]);
  const [active, setActive] = useState<{ id: string; value: string } | null>(null);
  const [full, setFull] = useState(false);
  const urlRef = useRef<string | null>(null);
  const key = JSON.stringify(body);

  // While full-screen, swallow Escape (exit full) before the modal sees it — unless
  // an inline edit is open, in which case let the input cancel itself first.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !active) {
        e.stopPropagation();
        e.preventDefault();
        setFull(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [full, active]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api
        .previewLive(body)
        .then((u) => {
          if (!alive) {
            URL.revokeObjectURL(u);
            return;
          }
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = u;
          setUrl(u);
          setErr(false);
        })
        .catch(() => {
          if (alive) setErr(true);
        });
      api
        .previewMeta(body)
        .then((r) => { if (alive) setSpots(r.hotspots); })
        .catch(() => { if (alive) setSpots([]); });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const commit = () => {
    if (active) onEditCommit(active.id, active.value);
    setActive(null);
  };
  const activeSpot = active ? spots.find((s) => s.id === active.id) : null;

  const canvas = (
    <div className={`studio-canvas${portrait ? ' studio-canvas--portrait' : ''}${full ? ' studio-canvas--full' : ''}`}>
      {url && <img src={url} alt="Live preview of the timetable" className="studio-canvas__img" />}
      {!url && !err && <div className="studio-canvas__overlay"><Spinner /></div>}
      {err && <div className="studio-canvas__overlay"><span className="muted">Preview unavailable.</span></div>}
      {url &&
        spots.map((s) =>
          active && active.id === s.id ? null : (
            <button
              key={s.id}
              type="button"
              className="hot"
              title="Click to rename"
              style={{ left: `${s.xPct}%`, top: `${s.yPct}%`, width: `${s.wPct}%`, height: `${s.hPct}%` }}
              onClick={() => setActive({ id: s.id, value: s.value })}
            />
          ),
        )}
      {active && activeSpot && (
        <input
          autoFocus
          className="hot-input"
          style={{ left: `${activeSpot.xPct}%`, top: `${activeSpot.yPct}%`, width: `${Math.max(activeSpot.wPct, 14)}%`, height: `${activeSpot.hPct}%` }}
          value={active.value}
          onChange={(e) => setActive({ id: active.id, value: e.target.value })}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); setActive(null); }
          }}
        />
      )}
      <button
        type="button"
        className="canvas-expand"
        onClick={() => setFull((v) => !v)}
        title={full ? 'Exit full screen' : 'Full screen'}
        aria-label={full ? 'Exit full screen' : 'Full screen'}
      >
        {full ? <IconShrink size={16} /> : <IconExpand size={16} />}
      </button>
    </div>
  );

  if (full) {
    return (
      <div className="studio-full" onClick={(e) => { if (e.target === e.currentTarget) setFull(false); }}>
        {canvas}
      </div>
    );
  }
  return canvas;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row row-between">
      <span className="label" style={{ margin: 0 }}>{label}</span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
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
