# Changelog

Notable changes to God Game, newest first. Dates are when each change landed.

## [Unreleased]

### Added
- **The game is online** at https://daryllgomas.github.io/god-game/. The source is in the public repo `DaryllGomas/god-game`, and `npm run deploy` publishes a new version.

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
