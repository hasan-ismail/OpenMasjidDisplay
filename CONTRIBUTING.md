<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Copyright (C) 2026 OpenMasjid-Solutions -->

# Contributing to OpenMasjid Display

Thanks for helping! A few ground rules.

## Licensing

This project is licensed **AGPL-3.0-only** (see [`LICENSE`](LICENSE)). By submitting a
contribution you agree that it is licensed under **AGPL-3.0-only**, and you certify the
[Developer Certificate of Origin](https://developercertificate.org/) — i.e. the work is
yours to contribute. Sign your commits off:

```
git commit -s -m "..."
```

> **Contributor License Agreement.** OpenMasjid-Solutions may ask contributors to accept the
> organization's CLA so the project can be relicensed or dual-licensed in future. If a CLA is in
> effect for the org, it applies to contributions here; see the OpenMasjid-Solutions org for the
> current text.

## Code

- Keep it **AGPL-3.0-only** — every source file carries an SPDX header
  (`// SPDX-License-Identifier: AGPL-3.0-only`); add one to new files.
- It must build (`cd server && npm run build`, `cd web && npm run build`) and pass
  `npm test` in `server/`.
- Match the surrounding style; UI follows the OpenMasjidOS design language
  (dark default, WCAG AA, RTL-ready, honors `prefers-reduced-motion`).
- Don't weaken the security invariants noted in the code (stream-scheme allowlist,
  audience-bound tokens, scrypt + constant-time compare, array-form `spawn`, Fabric
  private-range SSRF guard).
