<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# Platform request: route each app's public path through the Cloudflare tunnel

**Audience:** maintainers/agents of the **OpenMasjidOS** repo (and anyone wiring the
Cloudflare tunnel). **This is NOT a change to OpenMasjidOS that the Display app made —
it's a request.** Nothing in the platform repo was edited; this doc describes the gap
and the fix.

---

## Symptom

OpenMasjid Display added a public, embeddable prayer-times **widget**. The app asks the
Fabric for its public address (`GET /api/fabric/site`) and builds the embed URL from the
returned `publicUrl` + `/w/<timetableId>`, e.g.:

```
https://omos.openmasjidos.org/display/w/tt_6e46aea7
```

Opening that URL **loads a different app (OpenMasjid Donations), not the Display widget.**
So `publicUrl`/`basePath` are *advertised* but the tunnel doesn't actually route
`/<appId>/*` to that app's container — the hostname resolves to a single app and every
path falls through to it.

## Root cause (in the OpenMasjidOS repo)

- `packages/core/src/api/fabric.ts` → `GET /api/fabric/site` returns
  `publicUrl = https://<domain>/<appPath>` and `basePath = /<appPath>` and tells the app
  to "mount its routes/assets under this base path so links resolve behind the tunnel."
- `packages/core/src/system/cloudflared.ts` → `appBasePath()` / `appPublicUrl()` compute
  `/<getAppPath(appId)>`, **but** the file's own header says:
  > "Routing (which hostname/path → which app) is configured in the Cloudflare dashboard
  > … **path-based ingress is a planned enhancement (see docs).**"

So the **contract promises a per-app public path that nothing enforces.** Today the tunnel
points the whole hostname at one origin (the dashboard or whichever app owns the
hostname), and `/<appId>/...` is not dispatched to `<appId>`'s container.

## What's needed in OpenMasjidOS

Implement the planned **path-based ingress** so a request to
`https://<domain>/<appId>/*` reaches that app's **first published (control-panel) port** —
the same target the per-app HTTPS proxy already uses
(`ensureProxy(app.id, httpsPort, installed.ports[0])` in
`packages/core/src/apps/manager.ts`, via `system/app-proxy.ts`).

Any of these is acceptable; pick what fits the tunnel design:

1. **cloudflared ingress rules** — generate one ingress rule per installed app mapping
   `hostname=<domain>, path=/<appId>/*` → `http://127.0.0.1:<app ports[0]>` (or the app's
   HTTPS proxy port), with a final catch-all to the dashboard. Regenerate when apps are
   installed/removed (the same lifecycle hooks that call `ensureProxy`).
2. **A reverse proxy in front of the tunnel** (the existing `app-proxy`) that strips
   `/<appId>` and forwards to that app, with the tunnel pointing at the proxy.
3. Document the **manual** Cloudflare "Public hostname → Path" rule an admin must add per
   app, and have the dashboard surface the exact rule to paste.

### Path prefix: strip or keep — both are fine

The Display app accepts the widget at **both** `/w/<id>` and `/<appId>/w/<id>` (its route
matcher allows an optional leading path segment), and the widget page fetches its JSON
relative to its own URL. So whether the ingress **strips** `/<appId>` or **passes it
through**, the app serves correctly. Other apps should follow the same rule (mount under
`basePath`, use relative asset/fetch URLs).

### Until it's implemented

OpenMasjid Display now **verifies** a candidate public URL before showing it: its
`/api/timetables/:id/widget-info` fetches `<publicUrl>/w/<id>.json` and only advertises the
public link if the response carries the app marker `{"app":"openmasjid-display"}`.
Otherwise it shows the **LAN** link and tells the admin that per-app path routing isn't
available yet. So Display will **light up the public link automatically** the moment the
platform routes the path — no further app change needed.

**Suggested platform-side acceptance test:** with remote access on, `curl -s
https://<domain>/<appId>/w/<id>.json` must return that app's JSON (here, containing
`"app":"openmasjid-display"`), not another app's HTML.
