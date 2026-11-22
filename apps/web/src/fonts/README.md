# Self-hosted fonts

Loaded with `next/font/local` in `src/app/[locale]/layout.tsx`. They are
self-hosted because `next/font/google` fetched and parsed Google's CSS at build
time, and that failed `next build` intermittently (Nov 2026). All are SIL Open
Font License 1.1, which allows bundling and redistribution.

| File | Face | Source (downloaded 2026-11-22) |
|---|---|---|
| inter-latin-wght.woff2 | Inter, variable wght, Latin | fontsource `inter:vf` |
| jetbrains-mono-latin-wght.woff2 | JetBrains Mono, variable wght, Latin | fontsource `jetbrains-mono:vf` |
| bricolage-grotesque-latin-opsz-wght.woff2 | Bricolage Grotesque, variable opsz + wght (+ wdth), Latin | fontsource `bricolage-grotesque:vf` (standard axes) |
| ibm-plex-sans-latin-{400,500,600}.woff2 | IBM Plex Sans, Latin | fontsource `ibm-plex-sans` |
| ibm-plex-mono-latin-{400,500}.woff2 | IBM Plex Mono, Latin | fontsource `ibm-plex-mono` |
| vazirmatn-wght.woff2 | Vazirmatn, variable wght, Arabic + Latin in one file | npm `vazirmatn@33.0.3` (rastikerdar/vazirmatn) |
| ibm-plex-sans-hebrew-{400,500,600,700}.woff2 | IBM Plex Sans Hebrew, Hebrew + Latin (complete) | npm `@ibm/plex-sans-hebrew@1.1.0` |

The Latin-only files cover what the Latin faces render. Persian and Hebrew
use the complete files because `next/font/local` cannot give one family
several files split by `unicode-range`.
