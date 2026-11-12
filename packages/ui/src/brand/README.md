# Brand assets

Generated from the vectorised logo by the design tooling (`design/tools/brand.py`, not in this repository).
The mark geometry is never modified for the app icons; only its size, position and the plate behind it change.

## Desktop app icon

The mark (vermilion `#DF500C`) sits on an ink (`#100E0C`) plate. There is one source per platform, because the
platforms treat icon shape differently, plus one variant for small renders.

| Source                                                        | Use it for                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app-icon.svg`, `app-icon-1024.png`                           | macOS (`.icns`). 824 px plate centred on a 1024 px canvas (100 px transparent margin), continuous-curvature corners (radius 185.4), baked drop shadow. |
| `app-icon-windows.svg`, `app-icon-windows-1024.png`           | Windows (`.ico`). 976 px plate, small rounded corners (1/24 of the plate, the 2 px exterior radius on Microsoft's 48 px grid), no shadow.              |
| `app-icon-linux.svg`, `app-icon-linux-1024.png`               | Linux (PNG set, e.g. `hicolor/<size>/apps`). 928 px plate with the same continuous-curvature corners as macOS, no shadow (the shell adds its own).     |
| `app-icon-small.svg`, `app-icon-small-{1024,48,32,24,16}.png` | **Any platform when the rendered size is 48 px or smaller.** 944 px plate, mark at 72% of the plate height (66% in the large icons), no shadow.        |
| `app-icon-square.svg`, `app-icon-square-1024.png`             | Legacy full-bleed square, kept for tools that only accept a square image. Not used by the platform builds above.                                       |

### What the desktop build should do

- Render every size from the SVG (or use the PNGs above) instead of downscaling the 1024 px PNG: for sizes up to 48 px
  (`.ico` 16/24/32/48, `.icns` 16 and 32, `hicolor` 16/24/32/48) use `app-icon-small`, for everything larger use the
  platform source.
- `app-icon.svg` uses an SVG `feDropShadow` filter. If the rasteriser you use does not support it, use `app-icon-1024.png`
  (rendered with Chrome) as the macOS input instead.
- The macOS and Linux corners are an approximation of Apple's continuous-curvature shape (a cubic-Bezier / arc / cubic-Bezier
  corner with 60% smoothing), not a path supplied by Apple.

### Platform rules this follows

- **macOS:** native apps provide the rounded shape themselves (the system only masks Catalyst apps). The community-documented
  template is a 1024 px canvas, an 824 px plate with 100 px margin, a continuous corner of about 185 px and a shadow
  (blur 28, offset 12, 50% black). Icons that do not conform get boxed on macOS 26. Not verified against Apple's own
  template file.
- **Windows:** Microsoft recommends a silhouette that stays legible at small sizes, rounded exterior corners of 2 px on a
  48 px grid, and no text in the icon. For packaged apps, Windows adds a backplate unless unplated assets are supplied, and
  looks for an exact size match first (unplated sizes listed run from 16 up to 256 px, e.g. 16, 20, 24, 30, 32, 36, 40, 48, 60,
  64, 72, 80, 96, 256), so supplying more exact sizes avoids rescaling.
- **Linux:** GNOME draws app icons inside a 128 px area without filling it, and judges them at 64 px and down to 32 px.
  Most Linux desktops do not mask app icons, so the icon carries its own rounded shape and margin.
