# Architecture

OpenMasjid Display is a **single container** (`ghcr.io/hasan-ismail/openmasjiddisplay`) — one image to
install and update. Inside it run three cooperating parts:

| Part | Role |
|---|---|
| Control plane (Node) | Web UI + JSON API + WebSocket, the timetable renderer, the scheduler, and the orchestrator. |
| MediaMTX | The RTSP server every screen's decoder connects to. Launched and supervised by the control plane (`mediamtxServer.ts`); the binary is copied from the official multi-arch `bluenviron/mediamtx` image at build time, so it's the same build — just bundled. |

Two ports are published to the host: the control panel (`8080` in the container, `7860` by default on the
host) and RTSP (`8554`). MediaMTX's control API (`9997`) binds to loopback only and is never exposed.

## Data model

All state is a single JSON document in the data volume (`/data/db.json`):

- **Timetable** — a full-screen prayer display: theme/colours, orientation, quality, location, calculation
  method, Asr madhab, timezone, per-prayer Iqamah rules, Jumu'ah times.
- **Source** — a camera or HDMI encoder: RTSP URL, and a mode (`direct` relay or `normalize` re-encode).
- **Screen (TV)** — a physical display with a stable id, a default content, and an optional manual override.
- **Schedule rule** — a weekly time window that points target screens at some content, with a priority.
- **Settings** — default picture quality and the schedule timezone. There is no server IP to set: the
  control panel builds each screen's RTSP link from the address it was opened with. Theme and wallpaper are
  per-browser preferences (localStorage), not stored here.

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
(set in the bundled `docker/mediamtx.yml`) for the widest, NAT-friendly decoder compatibility, so only
`8554/tcp` is published.

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

## OpenMasjidOS integration (optional)

When installed through OpenMasjidOS the platform injects `OPENMASJID_BASE_URL` and `OPENMASJID_APP_ID`.
Everything here is additive — with those unset the app behaves exactly as a standalone install. Full
contract in `docs/PLATFORM_INTEGRATION.md`.

- **Appearance inheritance** — on open, the dashboard appends a `#omos=<base64url json>` fragment
  (theme, wallpaper, custom wallpaper image). `prefs.ts` applies + persists it and clears the hash (no
  network needed). While "Match OpenMasjidOS" is on, it also polls `GET <base>/api/public/appearance`
  (~45 s and on focus) so live dashboard theme/wallpaper changes follow.
- **Single sign-on** — the platform's `omos_session` cookie reaches us (same host, different port =
  same-site). The backend validates it **server-to-server** against `GET <base>/api/auth/session`
  (`omos.ts`; positive results cached ~45 s) and, on success, mints a local session — so every other
  endpoint and the WebSocket stay a simple synchronous cookie check. It never trusts a browser-supplied
  identity, and falls back to the app's own password whenever SSO is unset, cookie-less, or the platform
  is unreachable.

## Security & least privilege

- No `privileged`, host networking/pid/ipc, `cap_add`, devices, or Docker socket (passes the OpenMasjidOS
  compose checks).
- Single-admin auth via a signed, HTTP-only session cookie; constant-time password comparison.
- OpenMasjidOS SSO (when present) is verified server-to-server and only ever trusts the cookie actually on
  the request; it augments, never replaces, the local password fallback.
- The platform injects no masjid profile; everything masjid-specific is collected by the app and stored in
  its own volume.
