<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# New Fabric endpoints: Stripe vault + public URL (informational — not needed yet)

**For OpenMasjid Display, no change is required right now.** This note just records that the platform
gained two new Fabric capabilities so you know they exist when/if Display ever needs them.

## What's new on the platform

- **Stripe vault (OpenMasjidOS v0.29.0):** the admin stores named Stripe accounts once in
  Settings → Payments; apps fetch them via `GET /api/fabric/stripe?account=<name>` (manifest
  `stripe: true`). **Display doesn't take card payments, so do *not* set `stripe: true`** — skip it.
- **Remote access / public URL (v0.30.0):** the admin can run a Cloudflare Tunnel (Settings → Remote
  access). Apps can learn their public URL via `GET /api/fabric/site` (manifest `domain: true`).

## Does Display need `domain: true`?

**Not today.** Display's screens connect over RTSP on the LAN, and the control panel builds its links
from the address the browser opened it with — so it has no need for an externally-resolvable URL yet.

Consider `domain: true` **only if** a future feature needs an absolute, internet-reachable URL — e.g.
a public "view this screen / timetable" link or a QR code that works off-site. If that happens:

```
GET ${OPENMASJID_BASE_URL}/api/fabric/site
  X-OpenMasjid-App-Secret: <OPENMASJID_APP_SECRET>
→ { "enabled": true, "domain": "omos.example.org", "publicUrl": "https://omos.example.org/display" }
```

Until then, leave it off — least privilege (the platform only issues the per-app secret to apps that
opt into a Fabric capability).

## What you SHOULD act on

The unrelated, **required** fix is in `docs/RESTORE_SSO_FIX.md` (this repo): the sign-in lockout after
a backup restore. That one matters for Display; this Stripe/domain note does not.

See OpenMasjidAPPS `docs/BUILDING_AN_APP.md` §7 for the full Fabric capability contract.
