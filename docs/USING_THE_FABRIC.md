<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# How to use the OpenMasjidOS Fabric (Display)

The **Fabric** is the platform↔app integration layer. Everything is **optional + backwards-
compatible**: without the platform, Display runs fully standalone (own login + appearance). The
canonical spec is OpenMasjidAPPS `docs/BUILDING_AN_APP.md` §7.

**Wire identifiers (never rename):** env `OPENMASJID_BASE_URL`, `OPENMASJID_APP_ID`,
`OPENMASJID_APP_SECRET`; header `X-OpenMasjid-App-Secret`; cookie `omos_session`.
**Golden rule:** read those env vars **every process start**; never persist them (or anything fetched
from the Fabric) to the data volume — the platform changes them across restarts/migrations.

## What Display uses today

```yaml
# manifest.yaml
sso: true            # sign in with the dashboard login
notifications: true  # alert the masjid when a screen goes offline/online
```

### 1. Single sign-on (implemented — keep it)

Forward the request's `omos_session` cookie to `${OPENMASJID_BASE_URL}/api/auth/session` with the app
secret; a `true` mints a local admin session (`server/src/fabric.ts`). **Required resilience fix** —
never brick when the platform is unreachable: see `docs/RESTORE_SSO_FIX.md`. That is the one change
Display must make.

### 2. Appearance (implemented — keep it)

Match the dashboard's theme/wallpaper via the `#omos=` hash + `GET /api/public/appearance`
(`web/src/prefs.ts`).

### 3. Notifications (implemented — keep it)

Relay screen offline/online alerts: `POST ${OPENMASJID_BASE_URL}/api/fabric/notify` with the app
secret + `{ text, title?, level? }`. Fails soft.

## What Display does NOT need (yet) — but exists

- **Stripe (`stripe: true`) — skip.** Display takes no payments. Do not set it.
- **Public URL / remote access (`domain: true`) — optional, not needed now.** Display's screens use
  RTSP on the LAN and the panel builds links from the address it was opened with, so it has no need
  for an internet-reachable URL. **Only** add `domain: true` if a future feature needs an absolute
  public link (e.g. a "view this timetable" page reachable off-site). If so:

  ```
  GET ${OPENMASJID_BASE_URL}/api/fabric/site
    X-OpenMasjid-App-Secret: <OPENMASJID_APP_SECRET>
  → { "enabled": true, "domain": "omos.example.org",
      "publicUrl": "https://omos.example.org/display", "basePath": "/display" }
  ```

  Note the platform serves apps **path-based under one subdomain `omos`**, so a `domain` app must be
  **base-path aware** (mount routes/assets under `basePath`; Cloudflare does not strip the prefix).
  Until you need that, leave it off — least privilege (the platform only issues the per-app secret to
  apps that opt into a capability).

See also `docs/RESTORE_SSO_FIX.md` — the one required fix for Display.
