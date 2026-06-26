// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Printable monthly prayer-time sheet.
 *
 * Returns a self-contained, print-styled HTML page of computed Adhan + Iqamah
 * times for a whole month. The browser's own "Save as PDF" turns it into a PDF,
 * so we add no PDF library — staying lightweight (see CLAUDE.md §5).
 */
import {
  prayerTimes,
  timezoneOffsetHours,
  iqamahHours,
  parseHHMM,
  type MethodDef,
} from './prayer/engine';
import type { Timetable } from './types';

const pad2 = (n: number) => String(n).padStart(2, '0');

function fmt(hours: number | null, timeFormat: string): string {
  if (hours == null) return '—';
  let h = Math.floor(hours) % 24;
  let m = Math.round((hours - Math.floor(hours)) * 60);
  if (m === 60) { m = 0; h = (h + 1) % 24; }
  if (timeFormat === '24h') return `${pad2(h)}:${pad2(m)}`;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${period}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

/** Build a printable month sheet. `month` is 1-12, `year` is the full year. */
export function renderMonthPrintHtml(tt: Timetable, year: number, month: number): string {
  const tz = tt.timezone || undefined;
  const method: CalcMethodOrDef =
    tt.method === 'Custom'
      ? { label: 'Custom', fajr: tt.fajrAngle ?? 18, isha: tt.ishaAngle ?? 17 }
      : tt.method;
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const rows: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const instant = new Date(Date.UTC(year, month - 1, day, 12));
    const off = timezoneOffsetHours(instant, tz);
    const t = prayerTimes({ year, month, day }, tt.latitude!, tt.longitude!, off, method, tt.asrMadhab);
    const dow = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
      .format(Date.UTC(year, month - 1, day));
    const isFri = dow === 'Fri';

    // CSV per-day override wins over the configured Iqamah rule (mirrors svg.ts).
    const dayKey = `${pad2(month)}-${pad2(day)}`;
    const yearRow = tt.iqamahYear?.[dayKey];
    const iqOf = (k: (typeof PRAYERS)[number], adhan: number): number | null => {
      const csv = yearRow?.[k];
      const csvH = csv ? parseHHMM(csv) : null;
      if (csvH != null) return csvH;
      return iqamahHours(adhan, tt.iqamah[k]);
    };

    const cell = (adhan: number, iq: number | null) =>
      `<td><div class="adhan">${fmt(adhan, tt.timeFormat)}</div>${iq != null ? `<div class="iq">${fmt(iq, tt.timeFormat)}</div>` : ''}</td>`;

    rows.push(
      `<tr${isFri ? ' class="fri"' : ''}>` +
        `<td class="date"><b>${day}</b> <span>${dow}</span></td>` +
        cell(t.fajr, iqOf('fajr', t.fajr)) +
        `<td class="minor">${fmt(t.sunrise, tt.timeFormat)}</td>` +
        cell(t.dhuhr, iqOf('dhuhr', t.dhuhr)) +
        cell(t.asr, iqOf('asr', t.asr)) +
        cell(t.maghrib, iqOf('maghrib', t.maghrib)) +
        cell(t.isha, iqOf('isha', t.isha)) +
        '</tr>',
    );
  }

  const masjid = esc(tt.masjidName || 'Our Masjid');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${masjid} — ${esc(monthName)} prayer times</title>
<style>
  :root { --ink:#16241e; --dim:#5b6b63; --line:#d7e0da; --accent:#1fa37a; --gold:#a8801f; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: var(--ink); margin: 0; padding: 28px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 2px solid var(--accent); padding-bottom: 10px; margin-bottom: 14px; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 15px; margin: 0; color: var(--dim); font-weight: 500; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead th { text-align: center; padding: 7px 4px; border-bottom: 1.5px solid var(--line); color: var(--accent); text-transform: uppercase; letter-spacing: .04em; font-size: 11px; }
  thead th .sub { display:block; color: var(--dim); font-weight: 400; letter-spacing: 0; text-transform: none; font-size: 9px; }
  tbody td { text-align: center; padding: 5px 4px; border-bottom: 1px solid var(--line); }
  td.date { text-align: left; white-space: nowrap; }
  td.date span { color: var(--dim); font-size: 11px; }
  td.minor { color: var(--dim); }
  .adhan { font-weight: 600; }
  .iq { color: var(--gold); font-size: 11px; }
  tr.fri { background: #f3f8f5; }
  footer { margin-top: 14px; color: var(--dim); font-size: 11px; text-align: center; }
  .print-btn { display:inline-block; margin-left: 12px; padding: 6px 14px; border:1px solid var(--accent); border-radius: 8px; background: var(--accent); color:#fff; font-size: 12px; cursor:pointer; }
  @media print { .print-btn { display:none; } body { padding: 0; } }
</style>
</head>
<body>
<header>
  <div><h1>${masjid}</h1><h2>${esc(monthName)} — prayer times</h2></div>
  <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
</header>
<table>
  <thead>
    <tr>
      <th>Date</th>
      <th>Fajr<span class="sub">Adhan / Iqamah</span></th>
      <th>Sunrise</th>
      <th>Dhuhr<span class="sub">Adhan / Iqamah</span></th>
      <th>Asr<span class="sub">Adhan / Iqamah</span></th>
      <th>Maghrib<span class="sub">Adhan / Iqamah</span></th>
      <th>Isha<span class="sub">Adhan / Iqamah</span></th>
    </tr>
  </thead>
  <tbody>
    ${rows.join('\n    ')}
  </tbody>
</table>
<footer>Times in bold are the Adhan; the gold time below is the Iqamah. Friday rows are shaded — confirm the Jumu'ah time separately.</footer>
</body>
</html>`;
}

type CalcMethodOrDef = Timetable['method'] | MethodDef;
