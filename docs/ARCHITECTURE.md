# Architecture

OpenMasjid Display is two containers that run side by side (one Docker Compose project):

| Service | Image | Role |
|---|---|---|
| `app` | `ghcr.io/hasan-ismail/openmasjiddisplay` | Control panel (web UI + JSON API + WebSocket), the timetable renderer, the scheduler, and the orchestrator. |
| `mediamtx` | `bluenviron/mediamtx` | The RTSP server every screen's decoder connects to. |

They share the private Compose network. Only the control-panel port (`8080`, published as `8099` by
default) and the RTSP port (`8554`) are exposed to the host. MediaMTX's control API (`9997`) stays internal.

## Data model

All state is a single JSON document in the data volume (`/data/db.json`):

- **Timetable** — a full-screen prayer display: theme/colours, orientation, quality, location, calculation
  method, Asr madhab, timezone, per-prayer Iqamah rules, Jumu'ah times.
- **Source** — a camera or HDMI encoder: RTSP URL, and a mode (`direct` relay or `normalize` re-encode).
- **Screen (TV)** — a physical display with a stable id, a default content, and an optional manual override.
- **Schedule rule** — a weekly time window that points target screens at some content, with a priority.
- **Settings** — the server's public RTSP host/port, default quality, schedule timezone, panel theme.

## What each screen shows (content resolution)

Every reconcile, each screen's *effective content* is resolved with this precedence:

1. **Manual override** — a volunteer's choice from the Screens page (sticky until they pick again / resume).
2. **Schedule** — the highest-priority enabled rule whose weekly window is currently open (windows may wrap
   past midnight).
3. **Default** — the screen's normal content.

## MediaMTX path scheme

The orchestrator programs MediaMTX entirely through its control API (the file watcher is unreliable in
Docker), reconciling desired vs. actual paths:

- A timetable publishes to a runtime path named by its id (`tt_xxxx`) via ffmpeg.
- A **direct** source becomes a proxy path (`src_xxxx`, `sourceOnDemand: true`) — pulled only while watched.
- A **normalize** source is transcoded by us and published to `src_xxxx`.
- Each screen path (`tv_xxxx`) **self-relays** from `rtsp://127.0.0.1:8554/<contentPath>`. Switching a screen
  is one `PATCH` of that path's `source`; the decoder keeps the same URL (and sees a brief reconnect).

Paths the app no longer needs (`tv_*`, `src_*`) are deleted on reconcile. RTSP is forced to **TCP**
(`MTX_RTSPTRANSPORTS=tcp`) for the widest, NAT-friendly decoder compatibility, so only `8554/tcp` is
published.

## Timetable render pipeline

Per active timetable, one pipeline runs:

1. Once per second, the current state is built into an **SVG** (`render/svg.ts`).
2. resvg (`@resvg/resvg-js`, bundled native binary, fonts baked into the image) rasterises it to raw RGBA.
3. The RGBA frame is piped to **ffmpeg**, which upsamples to a steady ~15 fps and encodes H.264:
   `libx264 -preset ultrafast -tune zerolatency -profile baseline`, a fixed 2-second GOP, in-band SPS/PPS
   (`repeat-headers=1`), `yuv420p`, no audio — then publishes to MediaMTX over RTSP/TCP.

Because the frame is mostly static, encoding is cheap (duplicated frames cost almost nothing), which is what
keeps it viable on a Raspberry Pi. Pipelines self-heal: if ffmpeg exits, it is respawned with backoff.

## Reconcile loop

`store.update()` (any data change) and a 15-second timer both trigger `orchestrator.reconcile()`, which:

1. resolves effective content for every screen,
2. starts/stops timetable + transcode pipelines to match what's referenced,
3. adds/patches/deletes MediaMTX paths to match,
4. samples each screen path's live state and pushes a status update over WebSocket.

Reconciles are coalesced so overlapping triggers collapse into one trailing run.

## Security & least privilege

- No `privileged`, host networking/pid/ipc, `cap_add`, devices, or Docker socket (passes the OpenMasjidOS
  compose checks).
- Single-admin auth via a signed, HTTP-only session cookie; constant-time password comparison.
- The platform injects no masjid profile; everything masjid-specific is collected by the app and stored in
  its own volume.
