// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Public, embeddable web widget — a compact VERTICAL list of just the prayer times
 * + Jumu'ah for one timetable (not the full TV scene). A masjid turns it on per
 * timetable and embeds it on their own website via an <iframe>. Served
 * unauthenticated (only for timetables whose `widget.enabled` is true), and
 * self-contained (inline CSS/JS) so it drops into any page. It refetches its own
 * JSON every 30s so the highlighted "next" prayer stays current without a reload.
 */
import type { WidgetData } from './render/svg';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** The self-contained HTML page for the widget. `data` seeds the first paint;
 *  `jsonPath` is the (relative) URL the page polls for fresh times. */
export function renderWidgetHtml(data: WidgetData, jsonPath: string): string {
  return `<!doctype html>
<html lang="${esc(data.language)}"${data.rtl ? ' dir="rtl"' : ''}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(data.masjidName)} — Prayer times</title>
<style>
  :root {
    --bg:#0e1814; --surface:rgba(255,255,255,.05); --surface-next:rgba(31,163,122,.16);
    --ink:#eaf3ee; --dim:#9fb3a8; --line:rgba(255,255,255,.10);
    --primary:#2bbf90; --gold:#e6c768;
    --font: -apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Naskh Arabic",Arial,sans-serif;
  }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; }
  body { font-family:var(--font); background:transparent; color:var(--ink); }
  .omw { max-width: 420px; margin: 0 auto; padding: 14px; background:var(--bg);
         border-radius: 16px; border:1px solid var(--line); }
  .omw-h { text-align:center; margin-bottom: 10px; }
  .omw-name { font-size: 1.1rem; font-weight: 700; letter-spacing:.2px; }
  .omw-date { font-size: .76rem; color: var(--dim); margin-top: 2px; }
  .omw-row { display:flex; align-items:center; justify-content:space-between; gap:10px;
             padding:10px 12px; border-radius:12px; margin-top:6px; background:var(--surface); }
  .omw-row.next { background:var(--surface-next); box-shadow: inset 0 0 0 1px var(--primary); }
  .omw-label { font-weight:600; font-size:1rem; }
  .omw-row.next .omw-label { color:var(--primary); }
  .omw-times { text-align:end; line-height:1.25; white-space:nowrap; }
  .omw-iq { font-weight:700; font-size:1.05rem; font-variant-numeric:tabular-nums; }
  .omw-adhan { font-size:.74rem; color:var(--dim); font-variant-numeric:tabular-nums; }
  .omw-one { font-weight:700; font-size:1.05rem; font-variant-numeric:tabular-nums; }
  .omw-foot { text-align:center; font-size:.66rem; color:var(--dim); margin-top:10px; opacity:.7; }
  .omw-foot a { color:inherit; text-decoration:none; }
</style>
</head>
<body>
<div class="omw" id="omw" aria-live="polite"></div>
<script>
  var JSON_URL = ${JSON.stringify(jsonPath)};
  var INITIAL = ${JSON.stringify(data)};
  function el(t, c, txt){ var e=document.createElement(t); if(c)e.className=c; if(txt!=null)e.textContent=txt; return e; }
  function render(d){
    var root = document.getElementById('omw');
    if(!root) return;
    document.documentElement.setAttribute('dir', d.rtl ? 'rtl' : 'ltr');
    root.innerHTML='';
    var h = el('div','omw-h');
    h.appendChild(el('div','omw-name', d.masjidName));
    var dt = (d.gregorian||'') + (d.hijri ? '  ·  ' + d.hijri : '');
    if(dt.trim()) h.appendChild(el('div','omw-date', dt));
    root.appendChild(h);
    (d.rows||[]).forEach(function(r){
      var row = el('div','omw-row' + (r.next?' next':''));
      row.appendChild(el('div','omw-label', r.label));
      var times = el('div','omw-times');
      if(r.iqamah && r.adhan){
        times.appendChild(el('div','omw-iq', r.iqamah));
        times.appendChild(el('div','omw-adhan', 'Adhan ' + r.adhan));
      } else {
        times.appendChild(el('div','omw-one', r.iqamah || r.adhan || '—'));
      }
      row.appendChild(times);
      root.appendChild(row);
    });
    var f = el('div','omw-foot'); var a=el('a',null,'OpenMasjid Display'); a.href='https://github.com/OpenMasjid-Solutions'; a.target='_blank'; a.rel='noopener';
    f.appendChild(a); root.appendChild(f);
  }
  render(INITIAL);
  setInterval(function(){
    fetch(JSON_URL, { cache:'no-store' }).then(function(r){ return r.json(); }).then(render).catch(function(){});
  }, 30000);
</script>
</body>
</html>`;
}
