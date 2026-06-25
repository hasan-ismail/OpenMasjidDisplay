// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
import { useState } from 'react';
import { api } from '../api';
import type { AppState, ScheduleRule, ContentRef } from '../types';
import { contentOptions, ContentPicker, contentLabel, DAYS } from '../content';
import { Modal, Field, Toggle, IconPlus, IconEdit, IconTrash, IconCalendar, useToast } from '../ui';

interface Props {
  state: AppState;
  refetch: () => Promise<void>;
}

export function Schedules({ state, refetch }: Props) {
  const toast = useToast();
  const [edit, setEdit] = useState<ScheduleRule | 'new' | null>(null);
  const [confirm, setConfirm] = useState<ScheduleRule | null>(null);

  const toggle = async (r: ScheduleRule) => {
    try {
      await api.updateSchedule(r.id, { enabled: !r.enabled });
      await refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the rule.', 'error');
    }
  };
  const remove = async (r: ScheduleRule) => {
    try {
      await api.deleteSchedule(r.id);
      setConfirm(null);
      await refetch();
      toast('Schedule removed.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove the rule.', 'error');
    }
  };

  const daySummary = (days: number[]) => {
    if (days.length === 7) return 'Every day';
    if (days.length === 0) return 'No days';
    return [...days].sort((a, b) => a - b).map((d) => DAYS[d]).join(', ');
  };
  const targetSummary = (t: string[]) =>
    t.includes('*') ? 'All screens' : t.map((id) => state.tvs.find((tv) => tv.id === id)?.name ?? '?').join(', ');

  return (
    <div>
      <div className="page-head row-between">
        <div>
          <h1 className="page-title">Schedule</h1>
          <p className="page-sub">Switch screens automatically — e.g. show the imam camera during Jumu'ah, then back to the timetable.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setEdit('new')}><IconPlus size={16} /> New rule</button>
      </div>

      {state.schedules.length === 0 ? (
        <div className="empty-state glass" style={{ borderRadius: 'var(--radius-card)' }}>
          <div className="empty-art"><IconCalendar size={56} /></div>
          <h3>No schedule rules</h3>
          <p>Rules let a screen change on its own at set times each week. A volunteer can always override from the Screens page.</p>
          <button className="btn btn--primary" style={{ marginTop: '1rem' }} onClick={() => setEdit('new')}><IconPlus size={16} /> Create a rule</button>
        </div>
      ) : (
        <div className="panel glass">
          <div className="list">
            {state.schedules.map((r) => (
              <div key={r.id} className="list-row">
                <div className="list-row__main">
                  <div className="list-row__title">{r.name}</div>
                  <div className="list-row__sub">
                    {daySummary(r.days)} · {r.start}–{r.end} · {contentLabel(r.content, state)} → {targetSummary(r.targets)}
                  </div>
                </div>
                <Toggle checked={r.enabled} onChange={() => toggle(r)} label={`Enable ${r.name}`} />
                <button className="icon-btn" aria-label="Edit" onClick={() => setEdit(r)}><IconEdit size={16} /></button>
                <button className="icon-btn" aria-label="Delete" onClick={() => setConfirm(r)}><IconTrash size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {edit && (
        <ScheduleModal
          state={state}
          rule={edit === 'new' ? null : edit}
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
        title={`Delete ${confirm?.name ?? 'rule'}?`}
        footer={
          <>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn btn--danger" onClick={() => confirm && remove(confirm)}>Delete</button>
          </>
        }
      >
        <p className="muted">Screens will go back to their normal content at the next check.</p>
      </Modal>
    </div>
  );
}

function ScheduleModal({ state, rule, onClose, onSaved }: { state: AppState; rule: ScheduleRule | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const options = contentOptions(state);
  const [name, setName] = useState(rule?.name ?? 'Jumu\'ah camera');
  const [content, setContent] = useState<ContentRef>(rule?.content ?? { kind: 'off' });
  const [targets, setTargets] = useState<string[]>(rule?.targets ?? ['*']);
  const [days, setDays] = useState<number[]>(rule?.days ?? [5]);
  const [start, setStart] = useState(rule?.start ?? '13:00');
  const [end, setEnd] = useState(rule?.end ?? '14:00');
  const [priority, setPriority] = useState(rule?.priority ?? 0);
  const [busy, setBusy] = useState(false);

  const allScreens = targets.includes('*');
  const toggleDay = (d: number) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  const toggleTarget = (id: string) => setTargets((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.filter((x) => x !== '*'), id]));

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: name.trim() || 'Schedule', content, targets: targets.length ? targets : ['*'], days, start, end, priority };
      if (rule) await api.updateSchedule(rule.id, body);
      else await api.createSchedule(body);
      onSaved();
      toast(rule ? 'Rule saved.' : 'Rule created.');
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
      title={rule ? 'Edit rule' : 'New schedule rule'}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={busy}>{rule ? 'Save' : 'Create'}</button>
        </>
      }
    >
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>

      <Field label="Show"><ContentPicker options={options} value={content} onChange={setContent} /></Field>

      <Field label="On which screens">
        <div className="chips">
          <button className={`chip${allScreens ? ' is-active' : ''}`} onClick={() => setTargets(['*'])}>All screens</button>
          {state.tvs.map((tv) => (
            <button key={tv.id} className={`chip${!allScreens && targets.includes(tv.id) ? ' is-active' : ''}`} onClick={() => toggleTarget(tv.id)}>{tv.name}</button>
          ))}
        </div>
      </Field>

      <Field label="On these days">
        <div className="daygrid">
          {DAYS.map((d, i) => (
            <button key={i} className={days.includes(i) ? 'is-on' : ''} onClick={() => toggleDay(i)}>{d}</button>
          ))}
        </div>
      </Field>

      <div className="grid2">
        <Field label="From"><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Until" hint="If 'until' is earlier than 'from', the window runs past midnight."><input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>

      <Field label="Priority" hint="If two rules overlap, the higher number wins.">
        <input className="input" type="number" min={0} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} style={{ width: '7rem' }} />
      </Field>
    </Modal>
  );
}
