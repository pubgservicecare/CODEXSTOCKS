# Image generation prompts (optional upgrade)

**Status:** no image-generation tool was available in the environment used for the redesign, so the
shipped artwork is original procedural vector illustration made by `scripts/art/generate-art.mjs`
(see [DESIGN.md §4](DESIGN.md#4-artwork)). It is complete and in use. These prompts let you replace it
with painterly/photoreal AI artwork later **without touching code**.

## How to replace

1. Generate with any image model you are licensed to use commercially.
2. Export WebP (quality ≈ 75–80) at the exact sizes below and overwrite the files in
   `packages/ui/assets/art/` with the **same names**.
3. Keep every file under ~400 KB (`packages/ui/test/design.test.tsx` checks this).
4. Run `npm test`, `npm run web:build`, and rebuild the desktop installer.

## Rules for every image

- Original scene only: no PUBG/Krafton logos, UI, weapon skins, characters or recognisable map
  landmarks; no text, no watermarks; no real people.
- Never depict a specific account, inventory screen or rank badge — these images are decorative and the
  UI labels them as illustrations.
- Leave quiet negative space where noted (headline area).

Shared style suffix (append to every prompt):
> cinematic battle-royale atmosphere, original concept art, volumetric fog, atmospheric perspective,
> dramatic natural light, rich but restrained colour grade, high dynamic range, ultra-detailed, no text,
> no logos, no UI, no characters' faces

| File | Size | Prompt |
|---|---|---|
| `hero-dusk-2560.webp` (+ `-1440`, `-portrait` 900×1200 crops) | 2560×1440 | Wide golden-hour valley of layered misty hills, low sun on the right third, a twin-engine transport plane crossing high in the sky with a faint contrail, five parachutes drifting down, a hilltop with small houses, a water tower and a radio mast with a red light, red supply-drop smoke rising from a ridge, lone soldier silhouette with helmet and rifle looking at the horizon. **Left 45% of the frame darker and calm for a headline.** |
| `scene-dawn.webp` | 1600×900 | Misty dawn over a calm bay, long suspension bridge silhouette, pine-covered hills in layers, pale blue-peach sky, two distant parachutes. |
| `scene-desert.webp` | 1600×900 | Late-afternoon desert of flat-topped mesas in orange haze, a dusty road winding into the distance, a small off-road vehicle kicking up dust, one parachute crate in the sky. |
| `scene-snow.webp` | 1600×900 | Snowy mountain range under a starry night sky with soft green aurora and a bright moon, two lit cabins in a pine valley, light snowfall. |
| `scene-storm.webp` | 1600×900 | Stormy overcast valley with a towering translucent blue energy wall curving across the landscape, glowing edge on the ground, a village with a water tower, a lone figure silhouette in the foreground, distant lightning. **Left half calm and dark for text.** |
| `card-*.webp` (dusk, dawn, desert, snow, storm) | 800×500 | 16:10 crops of the five scenes above, centred on the most interesting element. |
| `login-dusk.webp`, `login-snow.webp` | 1400×1600 | Portrait crops of the dusk and snow scenes; **bottom third dark** for overlaid text. |
