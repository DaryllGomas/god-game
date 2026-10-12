# FABLE-REVIEW: a fresh-eyes pass on THE FIRST WORLD v0.6 (2026-10-11)

Rendered `?shot=default|close|mid|far` on Atlas and held them against the approved storyboard
(`Boards/ChatGPT 2026-10-10 v0.6 storyboard/…v1.png`) and Daryll's reactions to passes 1 to 4.
Ranked by impact per hour. Items 1 and 2 are done in this worktree (commits `08fd5d2`, `dcecfd2`).

## Where it stands, candidly

The grade, the long shadows, the paths, the cottages, the heart column and the sea are all on the
Tiny Glade bar now; nobody would call the close view "last year" any more. What still gives the
game away, in order:

1. **The island is one green dome.** Every storyboard panel with a horizon (1, 2, 3, 8) is built
   from *plateaus*: flat tops, steep faces, water in the gaps. Ours is a smooth bell with a brown
   lump on it. Everything else below is polish on top of that one shape problem.
2. **Nothing moves across the land.** Villagers and gulls move, but light doesn't. A diorama only
   feels alive when big soft shadows slide over it. (Done, item 1.)
3. **Rock was straw-coloured** so the mountains read as dry grass. (Done, item 2.)
4. **Trees are mono-value.** Each tree is one flat green in sun, a slightly darker green in shade;
   the storyboard's woods are dark blue-green at the base and warm yellow-green at the crown, and
   the whole wood is darker than the meadow around it.
5. **The sea stacks float.** Straight-sided striped cylinders with a bright cyan halo and no
   waterline contact read as stacked coins hovering on the sea.
6. **The far sky is empty.** Panel 3's horizon is layers of hazy islands and cloud; ours is a flat
   peach-to-blue gradient.

## Ranked improvements (look)

### 1. Cloud shadows drifting over the island. DONE. (~30 min, big)
`src/plugins/cloud-shadows.ts`: one invisible plane at 110 m carrying a tiling value-noise cloud
mask (`alphaTest`, `colorWrite = false`) casts into the existing sun shadow map, so ground, trees,
houses and people all darken together for one draw call; it drifts at 2.2 m/s. Registered in the
post-processing AO ignore list so the AO pre-pass (override material, no alphaTest) doesn't see it
as a ceiling. Knobs at the top of the file: `COVERAGE`, `TILE_M`, `SPEED`, `HEIGHT`.
Next step on this: when the camera is above ~180 m, also draw the puffs themselves (same mask, a
soft white `MeshBasicMaterial` on a second, lower plane) so the far shot gets panel 3's cloud layer.

### 2. Rock is cool slate, not straw. DONE. (5 min, medium)
`Terrain.ts` baked rock `0x7c8290` / dark `0x4a505e` (was `0x857c70` / `0x5e5750`). The mountains
now read as rock under green instead of dry grass, and the slate is what makes the gold sun read
as gold. The sea-cliff strata in `groundLook.ts` / `cliffMaterial.ts` are still warm tan; pull
`sA/sB` toward the same slate so cliffs and hills are one stone.

### 3. Break the dome into terraces. (half a day, the biggest remaining win)
Not a new heightmap: a post-pass on `Terrain.heights` that quantises height above ~8 m into 3 or 4
steps with a noise-warped threshold, blended by slope so the bell becomes plateaus with cliff
faces; the existing cliff colouring (`cliffK` in `LAND_LOOK_GLSL`) already paints steep faces as
strata, so the faces come for free. Let the land mask repaint paths and re-run `groundCheck()`.
Keep the village sites flat (mask out village radius + 20 m before quantising). Then cut one or
two sea inlets so the coast has a channel like panel 3. This is the single change that would move
"much better" to "that's the picture".

### 4. Darker woods, lit crowns. (1 hour, medium-big)
`Forest.ts` already has a top/bottom gradient but it's drowned by `TREE_TINTS` and the flat sun.
Two moves: (a) widen the gradient (`vec3(0.42,0.52,0.66)` at the base, `vec3(1.1,1.02,0.84)` on
top, with `position.y / height`, not `/ 7.0`, since pines are 10 m); (b) in the land mask, paint
the forest-floor channel under *every* decorative tree too, so the ground under a wood goes dark
and the wood reads as a mass. A one-line `emissive` of 0 and `roughness` 1 on leaves stops the
plastic sheen in the close shot.

### 5. Sea stacks that stand in the water. (1 hour, medium)
`cliffStackGeometry`: flare the bottom third (radius 0.5 → 0.7 below y 0.3) and give the strata
a per-layer thickness (`floor(yy * (0.7 + 0.6 * rnd))`) so they stop looking machined; place them
with `y: -6` and `sy + 6` so the flare is underwater. In `Water.ts` the shallows tint comes from
terrain depth, so the stacks sit in "deep" water with no shelf: add a small raised bump to
`Terrain.heights` under each stack (+4 m over 2× its width) so the sea goes turquoise and foams
around it. Drop the pale-green grass cap on the thin ones; only the islets should be green.

### 6. Horizon layers for the far view. (2 hours, medium)
Panel 3's distance is three or four hazy island silhouettes. Cheapest: 6 to 8 flat, fog-coloured
cards (`MeshBasicMaterial`, no lighting, `fog: true`) at 900 to 1800 m, each a low ragged
polyline extruded 20 to 60 m, placed round the horizon away from Vexahl's spire. They only have to
read as shapes in haze.

### 7. Smaller polish seen in the renders
- Gulls are white chevrons the size of a cottage from the default view; halve them and give them a
  grey upper wing so they stop reading as UI markers.
- The heart's gold rings are too regular from above: a 0.6 × noise on ring radius and a dropped
  segment or two would make it look drawn by hand, not plotted.
- The hex-ish lime rocks (pink-brown boulders in the close shot) are brighter than the ground;
  multiply their colour by 0.75 and the same slate hue.

## Ranked improvements (play)

1. **Make the loop visible in the first 90 seconds.** The pace question is the only prompt; after
   it, a new player sees a village and a pillar of light and nothing asking for anything. Fire
   the first prayer within 20 s of the pace choice (`prayerSystem.spawnNow` on a wood or food need
   the home village can satisfy with one gift), so the first act is "see need → carry → thanks".
2. **The golem's good side needs a reward you can see at once.** `Deeds.ts` raises a hidden
   curiosity; the player sees nothing until the golem repeats the deed much later. When the golem
   *watches* the hand do a deed, play the teal rune glow on it and a short "aha" chime right then,
   so the learning is felt the moment it happens (panel 5).
3. **Reach waves should carry meaning, not just grow.** The ring wave on a shrine stage is lovely,
   but the player can't tell what a bigger ring buys. Have the drop marker turn gold the moment
   the ring passes a neighbour's edge, and have Ora say its one line there ("Now they can see
   you.") instead of at a milestone timer.
4. **Marks: one mark should be teachable by the world itself.** The TEND mark is the signature;
   draw it once in light above the shrine the first time the player holds the hand still for 3 s
   (no text), the way panel 8 shows it. The recogniser (`recognise.ts`) is good; discovery is
   the gap.
5. **Disciples and quests (brief items 4 and 5) aren't in the build.** They're the "named
   villager with a tiny story" that the vision calls the stickiness; I'd put the first quest in
   before any more look work.

## What I'd do next, in order
Terraces (3) → sea stacks (5) → woods (4) → the first-prayer hook (play 1) → visible golem
learning (play 2). Then re-shoot all four poses and make the pass-5 side-by-side.
