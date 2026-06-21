import { useState } from 'react';
import { api } from '../api';
import type { AppState, Settings } from '../types';
import { Field, IconCheck, useToast } from '../ui';

interface Props {
  state: AppState;
  refetch: () => Promise<void>;
}

export function SettingsPage({ state, refetch }: Props) {
  const toast = useToast();
  const [host, setHost] = useState(state.settings.rtspPublicHost);
  const [port, setPort] = useState(String(state.settings.rtspPublicPort));
  const [quality, setQuality] = useState<Settings['defaultQuality']>(state.settings.defaultQuality);
  const [tz, setTz] = useState(state.settings.scheduleTimezone);
  const [busy, setBusy] = useState(false);

  const base = host.trim() ? `rtsp://${host.trim()}:${port.trim() || '8554'}` : null;

  const save = async () => {
    setBusy(true);
    try {
      await api.saveSettings({
        rtspPublicHost: host.trim(),
        rtspPublicPort: Number(port) || 8554,
        defaultQuality: quality,
        scheduleTimezone: tz.trim(),
      });
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
        <p className="page-sub">A few details so your screens can find this server.</p>
      </div>

      <div className="panel glass">
        <h3 className="section-title" style={{ marginTop: 0 }}>This server's network address</h3>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          The address your screens' decoders connect to. Use this computer's IP on your local network.
        </p>
        <div className="grid2">
          <Field label="Address (IP or hostname)" hint="e.g. 192.168.1.50"><input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" /></Field>
          <Field label="Video port" hint="Default 8554"><input className="input" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} /></Field>
        </div>
        {base && <div className="rtsp-url" style={{ marginBottom: '0.5rem' }}>{base}/&lt;screen&gt;</div>}
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
        <h3 className="section-title" style={{ marginTop: 0 }}>Connecting a screen</h3>
        <ol className="muted" style={{ paddingInlineStart: '1.2rem', lineHeight: 1.7, margin: 0 }}>
          <li>Set the address above and Save.</li>
          <li>On the <b>Screens</b> page, add a screen and copy its link.</li>
          <li>In your TV's RTSP decoder, paste the link and set the transport to <b>TCP</b>.</li>
          <li>Pick what the screen shows — a timetable, a camera, or an HDMI source.</li>
        </ol>
      </div>

      <button className="btn btn--primary" onClick={save} disabled={busy}><IconCheck size={16} /> Save settings</button>
    </div>
  );
}
