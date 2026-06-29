<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# CLAUDE.md — OpenMasjidDisplay

> Single source of truth for the **OpenMasjidDisplay** app. Read it before writing any code.
> When in doubt, follow this document and the existing code over your own assumptions; if
> something is ambiguous, ask before guessing.

---

## 1. What we are building (one paragraph)

**OpenMasjidDisplay** is an app for
[OpenMasjidOS](https://github.com/OpenMasjid-Solutions/OpenMasjidOS) that drives the screens in a
masjid: prayer timetables, camera feeds, and HDMI output over **RTSP**. It runs as **one Docker
container** (a `server/` + `web/` split), is configured via the platform, looks and feels like the
rest of the OpenMasjid family, and is the **reference implementation** that other OpenMasjid apps
(e.g. OpenMasjidDonations) copy their structure from.

---

## 2. Licensing & headers — non-negotiable (read first)

This repository is **AGPL-3.0-only** and **every contribution is bound by the Contributor License
Agreement** ([`CLA.md`](CLA.md), enforced by [`.github/workflows/cla.yml`](.github/workflows/cla.yml)).
**This is a hard rule for all future work** — *every line written here is AGPL-3.0 and CLA-covered:*

- **Every new source file MUST begin with the SPDX header**, in the right comment syntax for its type,
  followed by `Copyright (C) 2026 OpenMasjid-Solutions`:
  - `.ts` / `.tsx` / `.js` / `.cjs` / `.mjs` / `.css`: `// SPDX-License-Identifier: AGPL-3.0-only`
  - `.yml` / `.yaml` / `.sh` / `Dockerfile`: `# SPDX-License-Identifier: AGPL-3.0-only`
  - `.md` / `.html`: `<!-- SPDX-License-Identifier: AGPL-3.0-only -->`
- **Never** remove or alter an existing SPDX header.
- **Never** add code, assets, or dependencies under a license incompatible with AGPL-3.0. In
  particular, **never copy from umbrelOS / `umbrel-apps`** (PolyForm-Noncommercial) — reimplement
  from behaviour.
- The CLA keeps the **public tree AGPL-3.0** while letting **OpenMasjid-Solutions** also offer
  commercial/dual licenses; contributors keep their copyright. Contributors sign once, automatically,
  on their first PR (the CLA bot → reply *"I have read the CLA Document and I hereby sign the CLA"*).
- The `manifest.yaml` `license:` field is **AGPL-3.0-only** for this app.
- Include a visible **"Source code"** link to this repo in the admin UI (AGPL §13 network clause).

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contribution + signing flow.

---

## 3. Structure & conventions

- **`server/`** — the backend (Node + TypeScript): platform single-sign-on + theme/wallpaper
  matching done **server-to-server** (never trusting the browser, with a local-password fallback),
  RTSP/stream handling with a scheme allowlist, least-privilege posture.
- **`web/`** — React + Vite + TypeScript, styled with the OpenMasjidOS design tokens (dark default,
  WCAG AA, RTL-ready, honors `prefers-reduced-motion`).
- One-container `Dockerfile`; `docker-compose.yml`, `manifest.yaml`, `icon.png`, and `screenshots/`
  follow the OpenMasjidAPPS catalog contract (see
  [`OpenMasjidAPPS/docs/BUILDING_AN_APP.md`](https://github.com/OpenMasjid-Solutions/OpenMasjidAPPS)).
- Don't weaken the security invariants noted in the code (stream-scheme allowlist, audience-bound
  tokens, scrypt + constant-time compare, array-form `spawn`, Fabric private-range SSRF guard).
- It must build (`cd server && npm run build`, `cd web && npm run build`) and pass `npm test` in
  `server/` before a PR.

When this file and the actual code disagree on a mechanism, **read the code and follow it**, then fix
this file.
