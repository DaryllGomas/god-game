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

## What I changed

(in progress, see commits on v06-opus)

## Next, in order

(to be filled in)
