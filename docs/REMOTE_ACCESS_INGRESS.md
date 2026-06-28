<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# Remote-access path ingress — IMPLEMENTED platform-side (answers PLATFORM_WIDGET_PATH_INGRESS.md)

**TL;DR:** the gap you flagged is fixed in **OpenMasjidOS v0.37.0**. The platform now dispatches
`/<path>/*` to the app's container itself — you do **not** need manual Cloudflare per-app rules or a
separate path-stripping layer. Display already works with it as-is (you match both `/w/:id` and
`/<appId>/w/:id`). Keep doing that.

## What the platform now does (so your widget link works)

- The admin adds **ONE** Cloudflare Public Hostname: `omos.<domain>` → **HTTP `localhost:<OS port>`**
  (the OS HTTP front door). No per-app rows.
- The OS front door **reverse-proxies by first path segment** to the matching app's **`ports[0]`** —
  the same published HTTP port `ensureProxy` targets (`system/ingress.ts`, new in v0.37.0). It
  **keeps the full path** (does not strip the prefix) and proxies HTTP + WebSocket upgrades.
- So `https://omos.<domain>/display/w/<id>.json` → Cloudflare → OS front door → your container at
  `/display/w/<id>.json`. You match it (prefix kept) → it returns. ✅
- `GET /api/fabric/site` keeps returning `{ publicUrl, basePath }`; `basePath` is the **admin-chosen
  path** (default your id, e.g. `display`, but they can rename it). **Read it — don't hardcode `display`.**

## What Display must do (you already do)

1. **Be base-path aware.** The OS forwards the full prefix, so serve your routes/assets under
   `basePath`. You already match `/<appId>/w/:id` *and* `/w/:id`, so prefix-kept works unchanged.
2. **Use `basePath` from `/api/fabric/site`**, since the admin may set a custom path (e.g. `screens`).
3. The editor's "copy link" should prefer the Fabric `publicUrl` when remote access is on, and fall
   back to the working LAN link otherwise (as your doc already says).

## Acceptance test (now passes via the OS)

With remote access on + Display installed + the single Cloudflare route added:

```
curl https://omos.<domain>/<basePath>/w/<id>.json   →  your widget JSON
```

(`<basePath>` = what `/api/fabric/site` returns. If it 404s, confirm the path in
**OpenMasjidOS → Settings → Remote access** matches what you're requesting.)

## To pick it up

Admin: update OpenMasjidOS to **v0.37.0**, then **Settings → Remote access** shows the single route to
add + each app's public address. (Replace any old per-app Cloudflare routes with the one route.)
