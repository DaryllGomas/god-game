# OPUS review: THE FIRST WORLD v0.6 (fresh-eyes pass, 2026-10-11)

Branch `v06-opus` (from v0.6 at d0cb5b1). Compared: the v0.6 storyboard (8 panels), the pass 1-4 side-by-sides, the
Tiny Glade research note, and fresh Atlas renders of `?shot=default|close|mid|far` at d0cb5b1.

## Diagnosis: what separates "nice prototype" from "real game"

The Sonnet passes added *things* (trees, crowds, shrines, water, decor). The frame is now full; it still reads as a
prototype because of fundamentals that more things can't fix. In order of impact:

1. **Foliage is faceted, flat-shaded low-poly.** Trees cover 30-50% of every frame and are drawn with
   `flatShading: true` (MAT.base, cloned by `seasonalMaterial`), so each canopy is a cluster of hard facets, and the
   sun-facing facets go lime. That is the 2016 asset-store look. The storyboard and Tiny Glade canopies are soft
   volumes: one rounded light gradient across the whole crown (warm lit top, cool dark belly), clumps defined by AO,
   leaves glowing at the edges when backlit, a slight sway. This is the biggest single tell, and it is shader and
   normal work, not new assets: canopy normals pointing out from the crown centre (the "Ghibli tree" trick),
   backlit translucency on the rim, and wind.
2. **The lens is a wide-angle game camera, not a miniature.** FOV 50 at 70-130 m makes trees at the bottom of the frame
   3x the size of the ones at the top (see `close`). The storyboard is near-telephoto: object sizes barely change
   across the frame, which (with the tilt-shift DoF already in) is what makes a diorama read as a toy. Narrower FOV
   (~30-32) with the camera pulled back to keep the framing. NOT done here: `godCam.distance` is read in ~15 places
   (fog, DoF, hand scale, grass radius, Cine, sound, storm), so it needs a "framing distance vs physical distance"
   split and a play-test, not a drive-by.
3. **Scale and silhouette.** Houses are small next to trees (canopy as wide as a cottage), villagers are ~3 px blue
   capsules at the default view. In the storyboard cottages are chunky, roof-dominant and the people are chibi-sized
   and readable. Village props at 1.3-1.5x and villagers ~1.5x (gameplay radii unchanged) would close more of the gap
   than any further density pass.
4. **Grade pushes greens to lime.** `LOOK.tintHigh` (1.22, 1.04, 0.76) multiplies highlights by 1.22 red / 0.76 blue:
   every sunlit green turns yellow-lime. The storyboard keeps sunlit greens green-gold and puts the gold in light
   sources (rings, windows, the shaft). Pull `tintHigh` toward (1.10, 1.02, 0.90) and let the emissive glows carry
   the gold. (lookKit is shared with the RPG: change both, per its header.)
5. **The land's shape is smooth and soft.** 3.1 m terrain cells, two smoothing passes: rolling slopes and brown
   mud mountains, no terraces, ledges or rock faces. The storyboard islands are stepped: plateaus, cliff bands, rock
   strata. The coast lane is doing sea cliffs as decoration; inland, the mountains need terraced height shaping and a
   stylised rock material (they currently read as brown felt).

Not on the list because they are fine: shadows (long, soft enough, PCF radius 3 is honoured in r186), GTAO, the
tilt-shift pass, water colour, the warm/cool split itself.

## Code and design smells that will bite later

- `Forest.sync()` rewrites every tree matrix and colour and re-uploads all 16 instance buffers every frame, even when
  nothing moved. Fine at ~400 trees; it scales badly. Mark dirty on add/remove/fell/grow instead.
- `godCam.distance` doubles as "zoom level" in ~15 systems and as a physical distance in `Cine.ts:184`. Any lens or
  camera change has to untangle that first.
- The look is a stack of shader string-patches (`onBeforeCompile` replace on `#include` chunks) across Terrain,
  groundLook, Forest, Grass, Water, plus lane additions. Every three.js upgrade risks a silent no-op patch (the
  replace target string changes, the code silently stops applying). Worth a startup check that each patch found
  its anchor.
- `Sky.ts`, `lookKit.ts` and `groundLook.ts` are being edited by several lanes at once (coast lane edits all three).
  Expect merge friction there; keep new look work in new files where possible.
- The fog colour is the horizon colour (warm peach), so distance fades to warm haze instead of cool blue, which
  flattens depth (warm near, cool far is the classic cue). Left to the COAST + HORIZON lane, which owns Sky.ts now.

## What I changed (item 1: foliage)

Commits on `v06-opus`: `58f4492` (this review), the foliage WIP commit, and `c0fe421`.
- `src/art/softCanopy.ts` (new): at load, each tree geometry gets soft crown normals (an ellipsoid fitted to the leaf
  vertices, 22% of the facet normal kept for broadleaf and 40% for pines) and rebuilt leaf colours: the crown's mean green ×
  a smooth volumetric AO (dark belly and core, bright crown) + 25% of the welded original. The baked per-facet
  jitter and the hard black AO were what made crowns read as shards.
- `src/entities/Forest.ts` `seasonalMaterial`: `flatShading = false`; leaves get backlit translucency (rim glow when you
  look toward the sun) and a wrapped terminator; a small crown sway (~0.15 m at the top of a full tree, its own phase per tree). The leaf test
  is now a ratio (`g >= r*1.08`), so dark leaves are recoloured too. Every new term is NaN-guarded.
- `src/entities/Nature.ts`: applies `softenCanopy` to the Blender set and the procedural fallback.
- `src/plugins/foliage.ts` (new): advances the wind clock.
- Covers every tree on the island (Forest, Flora decor trees, VillageDecor clumps and rim): they all share
  `treeVariant(...).geo` and `seasonalMaterial`. Shrubs and flowers share the material but keep their own (faceted) geometry.
- Cost: no extra draw calls; a few ALU ops per leaf fragment; one CPU pass over ~20k vertices at load.
- Side-by-side: `Boards/2026-10-11 v0.6 build side-by-sides/OPUS pass - storyboard vs now vs opus.jpg`
  (storyboard panel 2 | v0.6 now | OPUS, close and default shots).
- `npm run build` passes (tsc + vite). The repo has no other test script (`scripts/ground-test.mjs` was not run).
  Atlas renders: no console errors.

**Not done (out of time):** an FPS measurement on Atlas (the change adds no draw calls, so I expect no measurable cost),
a check of autumn, winter and the blossom trees, and a check in Daryll's own Chrome.

## Next, in order

1. **Lens (diagnosis 2).** Add `LOOK.fov` (~30) and split `godCam.distance` into framing distance (what the 15
   consumers read) and physical distance (`distance * tan(25deg)/tan(fov/2)`, used only in `GodCamera.apply` and for the
   fog/shadow extents). Fix `Cine.ts:184` to convert back. Play-test the feel of the zoom and the hand's size. Likely the next biggest
   jump toward "miniature".
2. **Grade (4).** `tintHigh` → about (1.10, 1.02, 0.90); re-check against panel 2; mirror to the RPG kit.
3. **Scale (3).** Cottages/store/shrines ×1.3–1.5 and villagers ×1.5 visually (keep gameplay radii); bigger lit windows.
4. **Foliage, part 2.** Soften the shrub and hedge geometries the same way (index them, then `softenCanopy`-style normals);
   break up crown silhouettes (alpha-tested leaf-card fringe or a noise-displaced shell) so the edge isn't a polygon; give the
   shadow and AO passes the sway (customDepthMaterial) if it ever gets bigger.
5. **Land (5).** Terraced inland heights (quantise and re-smooth the hills into 2–3 m ledges), a stylised rock material
   for the range (strata bands + a top lip of grass), after the coast lane lands so they match.
6. Smells: dirty-flag `Forest.sync()`; a startup assert that every `onBeforeCompile` replace found its anchor.

## For bigpic-30 before merging

- Files touched: `src/entities/Forest.ts`, `src/entities/Nature.ts`, plus two new files. No overlap with the coast lane
  (Sky.ts, lookKit.ts, groundLook.ts, coast/), so it should merge cleanly in either order.
- The leaf test in `seasonalMaterial` changed from absolute to ratio. Seasonal recolouring (autumn, winter, blossom)
  now reaches more of each crown, so autumn will look more complete; give autumn and winter one look before publishing.
- The sway uses `FOLIAGE_WIND.uWindT` (real seconds, slower while paused). Shot mode renders stay repeatable within ~0.1 m.
- Revert: `git revert c0fe421` and the foliage WIP commit (or drop the `softenCanopy` calls and set `mat.flatShading` back).
