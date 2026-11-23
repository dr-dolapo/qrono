# Qrono app icon: "Night glow"

A violet Q ring with two eyes on a deep night gradient (#17112B → #050409).
The ring and tail are #A97BFF, the glow is #9B6BFF at 22%, and the eyes are white.

| File | Use |
|---|---|
| `qrono-icon-fullbleed.svg` | Master for app-store icons. Square with no corners, because iOS and Android apply their own mask. |
| `qrono-icon-rounded.svg` | Master for web app icons (192/512) |
| `qrono-favicon.svg` | Simplified for 16–48 px, with a thicker ring and no glow |
| `qrono-maskable.svg` | Web maskable icon, with the mark inside the safe zone |
| `qrono-android-foreground.svg` / `-background.svg` / `-monochrome.svg` | Android adaptive and themed icon layers |
| `qrono-mark.svg` | The bare mark on a transparent background, for splash screens and the website |
| `AppIcon-1024.png` | App Store Connect upload (no alpha) |
| `play-store-512.png` | Google Play Console upload |

The exported icons live in `apps/web/public/` (web) and `apps/mobile/assets/icon/` (Flutter).
To re-export after editing an SVG, use `rsvg-convert`, for example:

```bash
rsvg-convert -w 512 -h 512 qrono-icon-rounded.svg -o ../../../apps/web/public/icon-512.png
```
