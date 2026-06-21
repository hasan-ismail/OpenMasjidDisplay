import { useState } from 'react';
import { api } from '../api';
import type { AppState, Source } from '../types';
import { Modal, Field, Toggle, IconPlus, IconEdit, IconTrash, IconCamera, useToast } from '../ui';

interface Props {
  state: AppState;
  refetch: () => Promise<void>;
}

export function Sources({ state, refetch }: Props) {
  const toast = useToast();
  const [edit, setEdit] = useState<Source | 'new' | null>(null);
  const [confirm, setConfirm] = useState<Source | null>(null);

  const toggleEnabled = async (s: Source) => {
    try {
      await api.updateSource(s.id, { enabled: !s.enabled });
      await refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the source.', 'error');
    }
  };
  const remove = async (s: Source) => {
    try {
      await api.deleteSource(s.id);
      setConfirm(null);
      await refetch();
      toast('Source removed.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove the source.', 'error');
    }
  };

  return (
    <div>
      <div className="page-head row-between">
        <div>
          <h1 className="page-title">Sources</h1>
          <p className="page-sub">Cameras and HDMI encoders you can send to any screen. Use the link from your device, e.g. an imam camera or an overflow feed.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setEdit('new')}><IconPlus size={16} /> Add source</button>
      </div>

      {state.sources.length === 0 ? (
        <div className="empty-state glass" style={{ borderRadius: 'var(--radius-card)' }}>
          <div className="empty-art"><IconCamera size={56} /></div>
          <h3>No sources yet</h3>
          <p>Add a security/imam camera or an HDMI encoder by its RTSP link.</p>
          <button className="btn btn--primary" style={{ marginTop: '1rem' }} onClick={() => setEdit('new')}><IconPlus size={16} /> Add a source</button>
        </div>
      ) : (
        <div className="panel glass">
          <div className="list">
            {state.sources.map((s) => (
              <div key={s.id} className="list-row">
                <span className={`tag ${s.type === 'hdmi' ? 'tag--hdmi' : 'tag--cam'}`}>{s.type === 'hdmi' ? 'HDMI' : 'Camera'}</span>
                <div className="list-row__main">
                  <div className="list-row__title">{s.name}</div>
                  <div className="list-row__sub">{maskUrl(s.url)} · {s.mode === 'normalize' ? 'Most compatible' : 'Direct'}</div>
                </div>
                <Toggle checked={s.enabled} onChange={() => toggleEnabled(s)} label={`Enable ${s.name}`} />
                <button className="icon-btn" aria-label="Edit" onClick={() => setEdit(s)}><IconEdit size={16} /></button>
                <button className="icon-btn" aria-label="Delete" onClick={() => setConfirm(s)}><IconTrash size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {edit && (
        <SourceModal
          src={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={async () => {
            setEdit(null);
            await refetch();
          }}
        />
      )}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={`Remove ${confirm?.name ?? 'source'}?`}
        footer={
          <>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn btn--danger" onClick={() => confirm && remove(confirm)}>Remove</button>
          </>
        }
      >
        <p className="muted">Any screen showing this source will switch to nothing until you pick another.</p>
      </Modal>
    </div>
  );
}

function maskUrl(url: string): string {
  // Hide any embedded credentials in the displayed URL.
  return url.replace(/\/\/[^@/]*@/, '//•••@');
}

function SourceModal({ src, onClose, onSaved }: { src: Source | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(src?.name ?? '');
  const [type, setType] = useState<Source['type']>(src?.type ?? 'camera');
  const [url, setUrl] = useState(src?.url ?? '');
  const [mode, setMode] = useState<Source['mode']>(src?.mode ?? 'direct');
  const [quality, setQuality] = useState<Source['quality']>(src?.quality ?? '720p');
  const [enabled, setEnabled] = useState(src?.enabled ?? true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!/^rtsps?:\/\//i.test(url.trim()) && !/^rtmps?:\/\//i.test(url.trim())) {
      toast('Enter an RTSP link, e.g. rtsp://192.168.1.50:554/stream1', 'error');
      return;
    }
    setBusy(true);
    try {
      const body = { name: name.trim() || 'Source', type, url: url.trim(), mode, quality, enabled };
      if (src) await api.updateSource(src.id, body);
      else await api.createSource(body);
      onSaved();
      toast(src ? 'Source saved.' : 'Source added.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save.', 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      windowed
      onClose={onClose}
      title={src ? 'Edit source' : 'Add a source'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={busy}>{src ? 'Save' : 'Add source'}</button>
        </>
      }
    >
      <div className="grid2">
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Imam camera" /></Field>
        <Field label="Type">
          <select className="select" value={type} onChange={(e) => setType(e.target.value as Source['type'])}>
            <option value="camera">Camera</option>
            <option value="hdmi">HDMI encoder</option>
          </select>
        </Field>
      </div>
      <Field label="RTSP link" hint="From your camera/encoder. Credentials in the link are kept private.">
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="rtsp://user:pass@192.168.1.50:554/stream1" />
      </Field>
      <div className="grid2">
        <Field label="Compatibility" hint="'Most compatible' re-encodes so it plays on more screens (more processor — best on a mini-PC).">
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as Source['mode'])}>
            <option value="direct">Direct (lightest)</option>
            <option value="normalize">Most compatible (re-encode)</option>
          </select>
        </Field>
        <Field label="Picture quality" hint="Used when re-encoding. 720p is best for a Raspberry Pi.">
          <select className="select" value={quality} onChange={(e) => setQuality(e.target.value as Source['quality'])}>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </Field>
      </div>
      <div className="row-between" style={{ padding: '0.3rem 0' }}>
        <span className="label" style={{ margin: 0 }}>Available to screens</span>
        <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
      </div>
    </Modal>
  );
}
