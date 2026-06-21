# OpenMasjidOS ⇄ App integration — proposal for the platform

> **Status (2026-06-21): implemented on both sides.** The platform ships this in **v0.18.0+**
> (A1 open-fragment, A2 `GET /api/public/appearance`, B0 env injection, B1 `GET /api/auth/session`).
> OpenMasjid Display consumes all of it as of **v0.4.0** — appearance in `web/src/prefs.ts`, SSO in
> `server/src/omos.ts` — and still runs fully standalone when the platform is absent. The sections below
> are the original contract, kept as the spec of record.

> Audience: the **OpenMasjidOS** core developer. This describes small, optional,
> backwards-compatible platform features so apps (e.g. **OpenMasjid Display**) can
> (A) **inherit appearance** — dark/light + wallpaper — and (B) optionally share a
> **single login** with the dashboard. Nothing here moves masjid data into the
> platform: the platform still holds **no** masjid profile. These are presentation
> + auth conveniences only.
>
> Grounded in the current code: sessions in `packages/core/src/auth/sessions.ts`
> (cookie `omos_session`, HttpOnly, **SameSite=Strict**, opaque in-memory token),
> `auth.me` in `packages/core/src/trpc/routers/auth.ts`, the "Open" URL in
> `packages/ui/src/lib/apps.ts`, install env in `packages/core/src/apps/manager.ts`.

## Design principles

1. **Optional & graceful.** An app must work perfectly standalone. If these hooks
   are absent, the app uses its own appearance prefs and its own login. Integration
   only *enhances*.
2. **Presentation only.** The platform shares theme/wallpaper/locale — **never**
   masjid/prayer data. That stays in each app.
3. **Same-host assumption.** Cookie sharing works because the dashboard and the app
   are the same host on different ports (same-site). If an app is on another host,
   SSO simply doesn't engage and the app falls back to its own login.

---

## Part A — Appearance & preference inheritance (recommended; low effort)

Share the viewer's presentation prefs: `theme` (`system|dark|light`), `wallpaper`
(preset id), `wallpaperImage` (optional URL), `accent` (optional), `lang`.

### A1. Hand-off on the "Open" link (instant, no network, cross-origin-safe)

When the dashboard opens an app, append the prefs as a **URL fragment** (the part
after `#` is never sent to any server or written to logs):

In `packages/ui/src/lib/apps.ts`, change the open URL builder to append:

```
#omos=<base64url(JSON.stringify({ v:1, theme, wallpaper, wallpaperImage, accent, lang }))>
```

Example:
```
http://192.168.4.50:7860/#omos=eyJ2IjoxLCJ0aGVtZSI6InN5c3RlbSIsIndhbGxwYXBlciI6Im9jZWFuIn0
```

The app reads `location.hash` on load, applies + persists the values, then clears
the hash. (OpenMasjid Display is ready to consume this.) Payload is **presentation
only**; the `v` field is a version for forward-compat.

### A2. Live read endpoint (optional — for live theme changes without reopening)

Add a tiny **public** read of the current presentation prefs:

```
GET /api/public/appearance
→ 200 { "v":1, "theme":"system", "wallpaper":"ocean", "wallpaperImage":"", "accent":"cyan", "lang":"en" }
```

- No masjid data, low sensitivity → may be served without auth.
- For an app's **browser** to read it cross-origin, send
  `Access-Control-Allow-Origin: *` (or echo the app origin) on this route only.
- Apps poll this occasionally (or on focus) to follow live theme/wallpaper changes.
- The platform already persists these in its prefs store (`packages/ui/src/lib/prefs.ts`);
  this endpoint just exposes the presentation subset.

> A1 alone already covers "looks right when I open it." A2 adds live sync.

---

## Part B — Single sign-on (optional; medium effort) — **feasible**

**Verdict:** yes, an app can share the dashboard login, because the `omos_session`
cookie (set for the host) is delivered by the browser to the app's port too
(same-site). The app cannot validate the opaque token itself, so the platform must
expose a way to **introspect** it. Two implementation options:

### Option B1 — Cookie introspection (lighter; keeps direct-port apps)

1. **Tell apps where the platform is.** On install, inject into the app's env
   (in `packages/core/src/apps/manager.ts`, alongside the existing env):
   ```
   OPENMASJID_BASE_URL=http://<lan-ip-or-host>:8723
   OPENMASJID_APP_ID=display
   ```
2. **Expose a stable introspection route** (a plain-REST mirror of the existing
   `auth.me`, so apps don't depend on the tRPC envelope):
   ```
   GET /api/auth/session        (reads the omos_session cookie)
   → 200 { "authenticated": true, "username": "admin" }   // or { "authenticated": false }
   ```
3. **App flow (server-to-server, never trust the browser):** the app's *backend*
   takes the incoming `omos_session` cookie from the request and forwards it to
   `${OPENMASJID_BASE_URL}/api/auth/session`. If `authenticated` is true, the app
   treats the request as signed-in (SSO). Cache the positive result briefly
   (~30–60 s) per token to avoid a round-trip on every call.
4. **Fallback:** if `OPENMASJID_BASE_URL` is unset, the platform is unreachable, or
   no `omos_session` is present, the app uses its **own** password login (today's
   behavior). So SSO is purely additive.

**Security requirements (must-haves):**
- Only ever trust a session the platform *confirms* for the cookie actually
  presented on that request. Never trust a browser-supplied header/username.
- The introspection call is **server→server** over the LAN; do not rely on CORS for it.
- Keep the app's own CSRF posture (its API is same-origin to its own UI).
- The cookie is `SameSite=Strict` + HttpOnly today — fine for same-site, same-host;
  no change needed. If the platform ever needs apps on other hosts, that's out of
  scope for cookie-SSO (use B2).

### Option B2 — Forward-auth reverse proxy (the "Umbrel-style" ideal; larger change)

The platform proxies each app's **web UI** under its own origin, e.g.
`http://<host>:8723/apps/display/`, runs its auth middleware there, and injects a
trusted `X-OpenMasjid-User` header to the upstream app (which trusts that header
only from the proxy). This gives true SSO, one origin (also removes the cross-port
cookie nuance), and a tidy URL — at the cost of a proxy layer.

Caveat for this app specifically: **RTSP (port 8554) cannot be HTTP-proxied** — only
the control panel would sit behind the proxy; the RTSP video links stay direct. So
B2 helps the panel SSO but doesn't change how TVs connect.

**Recommendation:** start with **A1 + B1** (small, safe, direct-port-friendly).
Consider B2 later if the platform wants a unified origin for all app UIs.

---

## Minimal platform change checklist

- [ ] A1: append `#omos=<base64url json>` to the app open URL (`apps.ts`).
- [ ] A2 (optional): `GET /api/public/appearance` (+ CORS) exposing presentation prefs.
- [ ] B0: inject `OPENMASJID_BASE_URL` (+ `OPENMASJID_APP_ID`) into app env on install.
- [ ] B1: `GET /api/auth/session` REST route returning `{authenticated, username}` from the cookie.
- [ ] Keep everything optional — apps must still work with none of it.

On the app side, OpenMasjid Display will: read the A1 fragment on load; (if A2) poll
appearance; (if B0+B1) accept the platform session with its own password as fallback.
