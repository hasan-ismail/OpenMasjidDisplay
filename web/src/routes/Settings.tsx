import { useState } from 'react';
import { api } from '../api';
import type { AppState, Settings } from '../types';
import { Field, IconCheck, useToast } from '../ui';
import { usePrefs, prefsStore, WALLPAPERS, fetchOmosAppearance } from '../prefs';

interface Props {
  state: AppState;
  refetch: () => Promise<void>;
}

export function SettingsPage({ state, refetch }: Props) {
  const toast = useToast();
  const prefs = usePrefs();
  const [quality, setQuality] = useState<Settings['defaultQuality']>(state.settings.defaultQuality);
  const [tz, setTz] = useState(state.settings.scheduleTimezone);
  const [busy, setBusy] = useState(false);

  // Only "follow" when we actually run under OpenMasjidOS (there's a base URL).
  const canFollow = !!state.omosBase;
  const following = canFollow && prefs.followOmos;

  const save = async () => {
    setBusy(true);
    try {
      await api.saveSettings({ defaultQuality: quality, scheduleTimezone: tz.trim() });
      await refetch();
      toast('Settings saved.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Defaults and appearance for this control panel.</p>
      </div>

      <div className="panel glass">
        <h3 className="section-title" style={{ marginTop: 0 }}>Defaults</h3>
        <div className="grid2">
          <Field label="Default picture quality" hint="Used for new timetables. 720p is best for a Raspberry Pi.">
            <select className="select" value={quality} onChange={(e) => setQuality(e.target.value as Settings['defaultQuality'])}>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </Field>
          <Field label="Schedule time zone" hint="Used to run schedule rules. e.g. America/New_York (blank = server zone).">
            <input className="input" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="America/New_York" />
          </Field>
        </div>
      </div>

      <div className="panel glass">
        <h3 className="section-title" style={{ marginTop: 0 }}>Appearance</h3>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          {canFollow
            ? 'Saved on this device. It can follow your OpenMasjidOS light/dark theme and wallpaper automatically.'
            : "Saved on this device. The theme can follow your device's light/dark setting."}
        </p>

        {canFollow && (
          <Field label="Appearance source">
            <div className="chips">
              <button
                type="button"
                className={`chip${following ? ' is-active' : ''}`}
                onClick={() => {
                  prefsStore.patch({ followOmos: true });
                  void fetchOmosAppearance(state.omosBase);
                }}
              >
                Match OpenMasjidOS
              </button>
              <button
                type="button"
                className={`chip${!following ? ' is-active' : ''}`}
                onClick={() => prefsStore.patch({ followOmos: false })}
              >
                Choose my own
              </button>
            </div>
          </Field>
        )}

        {following ? (
          <p className="hint">
            Following your OpenMasjidOS theme and wallpaper. Choose “Choose my own” to set them here instead.
          </p>
        ) : (
          <>
            <Field label="Theme">
              <div className="chips">
                {(['system', 'light', 'dark'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`chip${prefs.theme === t ? ' is-active' : ''}`}
                    onClick={() => prefsStore.patch({ theme: t, followOmos: false })}
                  >
                    {t === 'system' ? 'Match device' : t === 'light' ? 'Light' : 'Dark'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Wallpaper" hint="Pick the same one you use in OpenMasjidOS.">
              <div className="wallpaper-row">
                {Object.entries(WALLPAPERS).map(([id, w]) => (
                  <button
                    key={id}
                    type="button"
                    title={w.label}
                    className={`wallpaper${prefs.wallpaper === id && !prefs.wallpaperImage ? ' is-active' : ''}`}
                    style={{ background: w.preview }}
                    onClick={() => prefsStore.patch({ wallpaper: id, wallpaperImage: '', followOmos: false })}
                  />
                ))}
              </div>
            </Field>
            <Field label="Custom wallpaper image URL (optional)" hint="Paste the same image URL you use in OpenMasjidOS; leave blank to use a preset.">
              <input
                className="input"
                value={prefs.wallpaperImage}
                onChange={(e) => prefsStore.patch({ wallpaperImage: e.target.value, followOmos: false })}
                placeholder="https://…/wallpaper.jpg"
              />
            </Field>
          </>
        )}
      </div>

      <div className="panel glass">
        <h3 className="section-title" style={{ marginTop: 0 }}>Connecting a screen</h3>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Each screen's link uses the address you opened this panel with — there's nothing to configure.
        </p>
        <ol className="muted" style={{ paddingInlineStart: '1.2rem', lineHeight: 1.7, margin: 0 }}>
          <li>On the <b>Screens</b> page, add a screen and copy its link.</li>
          <li>In your TV's RTSP decoder, paste the link and set the transport to <b>TCP</b>.</li>
          <li>Pick what the screen shows — a timetable, a camera, or an HDMI source.</li>
        </ol>
      </div>

      <button className="btn btn--primary" onClick={save} disabled={busy}><IconCheck size={16} /> Save settings</button>
    </div>
  );
}
