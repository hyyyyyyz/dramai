# Bundled subtitle font

`NotoSansSC-Regular-Subset.otf` is **Noto Sans SC Regular** (Noto Sans CJK, Simplified Chinese build) subset to the
characters subtitles actually need. The burn-in step (`composeEpisode(..., { subtitles: 'burn' })`) points libass at
the parent folder (`data/fonts`, `fontsdir`) and asks for the family `Noto Sans SC`, so burned subtitles look the same everywhere and never
depend on which fonts the machine happens to have (a Linux runner, a container or a Mac without a usable CJK font
renders Chinese subtitles as blank boxes or nothing at all).

- **Source:** https://github.com/googlefonts/noto-cjk — `Sans/SubsetOTF/SC/NotoSansSC-Regular.otf` (Google Noto fonts, by Adobe / Google).
- **License:** SIL Open Font License 1.1 (`about/OFL.txt`, copied from the upstream `Sans/LICENSE`).
  The copyright line in the font is "© 2014-2021 Adobe"; it declares **no Reserved Font Name**, so a subset may keep the
  family name "Noto Sans SC" (this is also how Google Fonts distributes its subsets). The OFL allows redistribution and
  embedding together with an application as long as the license text and copyright notice travel with the font — keep
  `about/OFL.txt` next to the font file, and do not sell the font by itself.
- **What was changed:** only subsetting (glyphs removed, nothing redrawn), done with `fonttools`:

  ```bash
  pyftsubset NotoSansSC-Regular.otf --unicodes-file=unicodes.txt \
    --layout-features='kern,vert,vrt2,locl,ccmp,mark,mkmk,liga,calt' \
    --name-IDs='*' --name-languages='*' --notdef-outline \
    --output-file=NotoSansSC-Regular-Subset.otf
  ```

- **Coverage (10 134 code points):** ASCII, Latin-1, general / CJK / fullwidth punctuation, kana, arrows and a few symbols,
  every character of GB2312 (symbols + the 6 763 Simplified hanzi), and Big5 (symbols + the 5 401 most frequent
  Traditional hanzi). Characters outside this set fall back to whatever fonts the system has (libass does that itself),
  so they may render blank on a machine without a CJK font.
- **Traditional Chinese** uses the same font: it has the Traditional characters, drawn in the Simplified-Chinese regional
  glyph style (a handful of characters differ slightly from the Taiwan standard shapes).
- **Layout:** `data/fonts/` holds _only_ font files (libass tries to load every file in it, so the license and this note live in `about/`).
- **Size:** about 2.6 MB. Desktop builds must unpack this folder from any archive (e.g. Electron `asarUnpack`) because
  ffmpeg reads it as a plain file, outside the application process.
