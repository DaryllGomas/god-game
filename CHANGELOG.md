# Changelog

Notable changes to THE FIRST WORLD (formerly "God Game"), newest first. Dates are when each change landed.

## [Unreleased]

### Added
- **The balance of the world.** The island now keeps a balance between tending and ruin, separate from good and evil: standing forests, fed villages, faith, people kept alive, prayers answered and fires put out lift it; stumps and burnt land, starvation, deaths, cruelty (hurling villagers, burning homes) and suffering left unanswered pull it down. Nothing on screen names it. The island shows it instead:
  - **In tune:** full colour, more birdsong, a soundscape whose chord always comes home, and two thin rings of gold light hanging in the sky.
  - **Falling out of tune:** the land drains to grey-olive, the sky greys, the rings fade away, the open sea darkens on Vexahl's side, and the music slowly sags out of tune and stops resolving.
- **Vexahl is there from the first day.** A small dark spire stands far out at sea from the start. As the world tips it drifts closer and grows taller, and its violet storm wakes; as the world recovers it recedes. Once the balance falls far enough he stirs and starts scheming before the Wonder, small at first and bolder the lower it goes; when the world is back in tune he goes quiet again. His schemes echo what you did: burn things and he blights, hurl villagers and he snatches them. Still always announced, always counterable, and he never kills.
- **The intro.** On your first visit the intro film plays full screen before the title: it starts on black, ends on black, and the island fades up from black into the title screen. Click or press a key and a small "skip" appears; a second click or key skips (Esc skips at once). Returning players (anyone with a saved island or an island code) never see it again, and "▶ Watch the intro" on the `?` screen plays it any time. The web copy is `public/intro/intro.mp4` (H.264, 1280×720, 5.6 MB, silent for now).
- **Ora, the voice of balance.** A third voice beside Lumi and Fizz, and a rare one: a perfectly round sphere of light and one soft line of italic text, no box, at a few big moments only (your first answered prayer, the first sign of the world falling out of balance, a turn toward either extreme, very kind or very cruel, and a long quiet stretch of good tending). It never tells you what to do; it asks, warns once, or notices. At most five lines a sitting, never over Lumi or Fizz.
- **Arriving from THE PATH.** A link from THE PATH's ending (`?from=thepath&initials=AVR`) fills the title screen's god-name box with your initials (one to three letters). It's only a suggestion: change it, clear it, or play without a name. Ignored once an island code is linked.
- **The prayer place grows through the ages.** Each village's totem becomes a ring of standing stones when its well is finished, then a pyramid, then a temple, all built where its people dance. The work is the same as before: builders carry timber and food, and you drop boulders on the site for stone. The pyramid keeps the old temple's gift (more prayer power, steadier faith) and the temple opens with the harvest festival's night of dancing round it. Each age arrives as a moment: the stones rise out of the earth, gold carvings glow into the pyramid's faces, and the temple's capstone lifts off to float, turning, over a small sun with two gold orbit rings. The dance carries on at whatever stands.
- **Signs in the sky.** Once a village has raised its stones, answering its prayers sometimes sends a soft streak of light across its sky: a white star with a long gold tail, the visitor its people remember. The pyramid's faces carry their murals of it (the light crossing the sky over people with raised arms, the TEND sprout in its cradle, the four ages, a constellation round an orb) and the temple's frieze repeats them. Nothing to read, only carving and light.
- **Villagers have names**, made from who they are, so the same villager always has the same name (Tada, Nalika, Lawosh, Kethol...). They never appear as labels on screen. A lost child's prayer now carries the real child's name, and the names live in the chronicle and the legacy record.
- **The chronicle.** The island quietly remembers what happens and to whom: a lost child carried home, someone saved from a fire, villagers fed in a famine, carried, thrown, killed, eaten by the golem, born, or passing away old; and for the island, each age raised, villages won and lost to Vexahl, schemes foiled, and the worst thing you did. It keeps the 200 most memorable moments, is saved with the island, and is what the endings and the legacy record read (`game.chronicle.people(5)`: "Tada, who wandered into the woods as a child and was carried home by the hand").
- **Two endings** (no "game over" screen, no words but Ora's):
  - **Collapse.** If the world stays badly out of tune for a day and a half, or none of your people are left, the island goes quiet and grey under a bruised violet sky, his spire comes to stand over it, and your own hand rises into view and slowly turns violet: it was always you. Ora says one line, and the screen goes black. Then **the world begins again, remembering**: a new island fades up on a ruin standing where the worst thing you did happened (moss and wildflowers in its cracks), Ora speaks once more, and you play on. The count of fallen worlds and their ruins are kept in the save. A collapse never writes a legacy.
  - **Whole, then Ready to See.** When every temple stands and the world has stayed in tune for a full day, his spire comes close one last time, calm. Your gold hand and his violet hand rise over the island, reach for each other and become one warm light; his spire dissolves into light. The light comes down into your home temple, and the villages become a city of light at dusk: every window lit, lamps and roads of light between the villages, a pillar of light over each temple, sky lanterns rising, and the people stop and look up. The camera rises, the screen goes black, and an end card shows the TEND mark, THE FIRST WORLD and one line: "The Nexus is forming." Click to go back to your island (the city keeps its lights every night; Vexahl is gone for good).
- **The legacy record.** At Ready to See the game writes the record the RPG reads (`save.legacy`, the AGREED v1 shape in HANDOFF TO THE RPG.md: your villages and the ages they reached, the balance at the end and its lowest, your golem, the people the chronicle remembers, your worst and kindest acts, Vexahl reintegrated) and saves at once, so it goes up with your island code. A small download icon on the end card saves it as a `.json` file too.
- **Lives have a length.** Villagers age. After a long life (34 to 50 game days) the island's eldest pass away peacefully in the morning, one at a time and never a village's last few people. It doesn't touch the world's balance.

### Changed
- **Your influence reaches further:** good deeds now count up to 150 m from a village (was 120), so a gift set down at the edge of your ring reaches the next village.
- **The Wonder's "The Island Is Yours" card is gone**; the endings above replace it.
- **Vexahl's banner** over a village he has turned now stands behind its prayer place, clear of the pyramid.
- **The Wonder is retired.** The island's goal is now every village's temple standing, with every village worshipping you (`game.allTemplesStand()`); the endings build on it. A Wonder already finished in an old save still stands.
- **The Temple project is now the pyramid and the Harvest Festival is now the temple**, both raised at the prayer place. Saves from v0.4 and early v0.5 load with their finished projects shown as the ages they reached; a temple or festival still being built moves to the prayer place with everything delivered so far.
- Houses, fields and the well keep a little further from the prayer place, which now grows to about 12 m across, and villagers and the golem walk round its solid middle.
- **Belief you can see.** Around the totem of every village that doesn't worship you yet, a thin gold ring lies on the ground and fills clockwise as its people come to believe in you, and a soft light rises on the totem as it grows (you can read it from your own village). When a gift, a miracle or a feat lands, the ring pulses, the new arc glows and a ripple runs outward. When it closes, the village is yours: the ring flares and fades. It replaces the floating "+N belief" text. See `src/village/BeliefRing.ts`.
- **Rain grows forests.** The Water miracle on open land sprouts a small grove of saplings where it lands, and young trees nearby shoot up. Rain on fields still waters the crops.
- **Forests heal.** Where a tree is chopped down or carried off, a sapling takes root again within a minute or two if other trees stand nearby, so a grove you take from keeps coming back. A clear-cut or burnt land only creeps back from its edges. While the world is in tune, villagers who fell a tree often plant a sapling in the stump. See `src/forest/ForestCare.ts`.
- **Belief lasts.** A neighbouring village's belief no longer slips away between your gifts: it holds for a minute after anything you do for it, then fades four times slower than before. A god who keeps carrying trees to a neighbour's store now wins it over in about ten minutes; before, it never got past a tenth of the way.
- **His Grasping Hand is your hand**, darkened to midnight violet: the same hand, moving the way yours does, with a violet warning ring under it.
- After the Wonder he plays by the old rules (foil four schemes and keep him villageless for a season to drive him off), whether he arrived then or was already here.
- **His portrait** loses its orange horns and ember eyes: midnight and violet, not a fantasy villain.
- **His storm-eye** is soft, painterly cloud lit violet from inside, instead of lumpy grey shapes.

- **No more words to read while you play.** The game teaches through play:
  - The hover tooltips are gone ("Boulder: Heavy. Throw it for a spectacle…"). The gold ring under whatever you point at is the cue; it now also shows under buildings and the golem, and turns reddish when the thing is outside your influence.
  - Prayers are pictures: logs for timber, a loaf for food, a rain cloud, a lost child with a question mark, a flame, a sparkle for a sign, and stone-and-log for a project, each in a medallion with a ring (filling as you deliver wood or food, otherwise the time left) and the village's colour. The Prayers list is a grid of these tiles, and a lost child is marked with a bobbing "!".
  - An answered prayer thanks you with sparkles, bells and the power it brought, not a sentence.
  - Lumi and Fizz stay (the kind spirit and the cheeky imp) but no longer explain the controls. They react, praise, grumble and tempt ("You know, from up here they look very... throwable."), and they speak less often.
  - The `?` screen keeps the full controls list.

## [0.4.0] - 2026-10-10: THE FIRST WORLD

### Changed
- **The game is THE FIRST WORLD**, "An Atlas Veyr Worldmaker Game" (the name and its TEND mark were chosen on 2026-10-01). It lives at https://studio.bigpicsolutions.com/the-first-world/, and the old github.io address redirects there.

### Fixed
- **The golem no longer gets stuck walking into houses.** It steers around buildings on the side nearer its target, walks to the nearest edge when the target sits inside a footprint, and gives up on a target (and picks something else) if it still can't get there.

### Added
- **Island codes (cloud saves).** On the title screen you can leave a god name and get a code like `AMBER-OTTER-4821`. Your island is saved to BigPic's own server about once a minute, and the code brings it back on any device or after clearing your browser ("Have an island code?"). The name alone opens nothing; only the code does. Your code is shown again on the title and `?` screen. "Play without a name" keeps today's behaviour: saved on this device only. If the server can't be reached, the game plays on as normal.
- **Prayers list.** A new prayer still rises over its village as a bubble, then flies into a Prayers panel on the right (under the time bar, above the golem). Each card has the village colour, the request, a progress bar, time left and a help hint; click one to fly there. The panel collapses, scrolls past five, and only a small praying marker with a count stays over each village. Off-screen villages show an edge pill until their bubble flies in.
- **Easier grabbing and a clear drop marker.** The Hand's pick is forgiving: it reaches a few pixels past a target (scaled by size and camera distance), prefers villagers > food > rocks > trees, and sticks to the current hover. The hovered thing gets a soft gold ring. While carrying, a glowing gold TEND sigil (cradle, orb, sprout, slowly turning orbit arcs) lies on the ground where it will land, with the star axis as a beam of light from the held object; it goes dim red with no beam when the spot is blocked or outside your influence. See `src/hand/DropMarker.ts`.

## [0.3.0] - 2026-10-01: The living island

This release builds the plan in `docs/vision.md`. Most of it was made by parallel Sonnet agents following `docs/agents.md`.

### Added
- **Prayers and advisors.**
  - Villages pray for things: timber, food, rain, a sign, a lost child brought home, a fire put out, or help with a project. Prayers show as speech bubbles over the village.
  - Answering a prayer earns prayer power, and faith in your own villages or belief in neutral ones. Ignored prayers fade with no penalty.
  - Two advisors, **Lumi** (a kind spirit) and **Fizz** (a cheeky imp), introduce the game and point things out. The 💬 button mutes them.
- **Village projects and the Wonder.**
  - Each village builds a **Well** (crops grow faster and fires go out sooner), then a **Temple** (more prayer power and steadier faith), then a **Harvest Festival**.
  - Builders haul wood, food and stone, and quarry the stone from boulders. You can help by dropping materials on a site.
  - Once all three villages worship you, they raise the **Wonder** together. Finishing it ends the first island, with a hint that something stirs across the sea.
- **Seasons and nature events.**
  - A year has four seasons of 2.5 game days each, blending smoothly into one another:
    - Spring: blossom and petals.
    - Summer: golden light.
    - Autumn: trees turning red, orange and gold, falling leaves and a bigger harvest.
    - Winter: snow on the ground, trees and roofs, with gentle snowfall.
  - Seasons change crop growth, tree growth and hunger.
  - Each season has one announced event:
    - A spring **bloom**.
    - A summer **dry spell**: villages pray for rain.
    - An autumn **storm**: it rolls in from the sea, and its lightning can start fires.
    - A winter **cold snap**: villages pray for food.
  - A season chip sits by the clock.
- **Vexahl, the rival god.**
  - He arrives after the Wonder: a dark spire-isle rises out at sea, and he introduces himself.
  - **Schemes**, one at a time. Each is announced with a countdown and can be countered:
    - **Whispers** drain a village's faith.
    - **Blight** withers its fields; a rain miracle cleanses them.
    - **The Grasping Hand** tries to snatch a villager; snatch them first or slap the hand.
    - **A violet storm.**
  - A village drained to zero faith turns to him, and you win it back by impressing it. Your home village never turns, and he never kills anyone.
  - Foil four schemes and keep him villageless for a season, and he retreats.
  - He has a panel with a difficulty setting: Gentle, Steady or Cunning.
- **Save and load.**
  - The island autosaves every minute, and whenever you hide or close the tab, to `localStorage` (`godgame.save.v1`, about 19 KB).
  - The title screen offers **Continue** or **New island**, with a summary such as "Day 7 · Autumn · 2 of 3 villages".
  - A corrupt save is set aside, and a fresh island starts.
- **Looks pass.**
  - Blender-built trees: 16 variants of oak, pine, birch and blossom.
  - A painted landscape shader with biome colours, plus wind-blown grass and wildflowers.
  - Better water and post-processing: ambient occlusion, bloom and colour grading. `K` toggles the effects, and `Shift+K` cycles the quality.
- **A new hand, built in Blender:** skinned, with 17 bones, a "claws" shape for an evil god, a stroking pose, and a glow and mist that follow your alignment.
- **A plugin system** (`src/plugins/`), a typed event bus (`game.events`), and world modifiers (`game.modifiers`), so features can be added without editing each other's files.

### Changed
- **The hand's resting angle** matches *Black & White*: it reaches in from the lower right, a little side-on, instead of showing its whole back, so it covers far less of the view.
- **Dropping a tree near a village store** turns it into wood for that village.
- **Starting a new island** also replays the advisors' introduction.

### Fixed
- **Neutral villages no longer convert themselves.** Projects a village built without you were being credited as your help. A village now only thanks you for projects you contributed to.
- **The end-of-dry-spell shower** is nature's rain, so it no longer counts as your miracle.
- **Golem training:** petting the golem while it was only walking toward a rock or a snack taught it "Throwing rocks" or "Eating". Now only the deed itself, or one it did in the last 10 seconds, takes the lesson. Otherwise a pet is just affection.

## [0.2.0] - 2026-09-29 to 2026-10-01: The golem and the soundscape

### Added
- **The Creature: a stone golem pet.** The concept came from ChatGPT and was chosen by the owner.
  - It has hunger, energy and play needs, and chooses its own activities: eating food piles, crops, rocks or villagers, throwing boulders, wandering and sleeping.
  - **Training:**
    - Stroke (left-click and rub) to reward it.
    - Pat (a quick click) for a small reward.
    - Slap (right-click) to punish it.
    - It learns opinions of its habits, shown in the creature panel.
  - It grows from 1.5× to 2.6× size, and its looks follow its own good or evil nature (moss and flowers, or spikes and lava).
  - `C` finds it and `L` calls it to your hand.
- **The Blender golem** (`blender/build_golem.py`, which generates it from a script): faceted boulders with baked shading, runes, lava veins and moss, with a rig the game animates directly. The code-built golem remains as a fallback.
- **A synthesised soundscape**, with no audio files:
  - Music in D major pentatonic over a slow chord cycle and a 60 BPM beat clock.
  - Every sound effect (chimes, miracles, throws, splashes, golem footsteps, purrs, snores) follows the same key and beat, so everything harmonises.
  - Reverb, ducking and ambient layers that follow day, night and the sea.
  - `M` mutes everything and `N` toggles the music.

## [0.1.0] - 2026-09-29: Core loop

### Added
- **An island** with terrain, sea, a day-night sky, and a god camera that can rotate, tilt, pan, zoom and fly to a spot.
- **The Hand:** grab, carry, place and throw villagers, trees, rocks and food, with physics (flight, bounce, roll, collisions).
- **Villages:**
  - Villagers with hunger and homes, who farm, chop, haul, build houses, have children and sleep.
  - Each village has a worship site, and a slider sets how many people dance there to make prayer power.
- **Belief and conversion:** neutral villages gain belief from impressive deeds nearby and convert at 100%, extending your ring of influence.
  - Faith in your own villages drops if they starve or are hurt.
  - Alignment drifts toward Benevolent or Malevolent depending on what you do.
- **Miracles:** Water (`1`), Food (`2`) and Fire (`3`). A miracle appears in your hand, ready to throw or set down.
  - Fire spreads, and rain puts it out.
- **HUD:** prayer power, alignment, village list and details, a message feed, game speed and help.
