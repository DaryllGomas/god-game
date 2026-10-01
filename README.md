# God Game

A browser god game in the spirit of Lionhead's *Black & White*, built with Three.js and TypeScript.

You're a god whose hand hangs over an island. Villagers who dance at your totem generate prayer power. Spend it on miracles, and win over the island's other villages by impressing them, kindly or cruelly.

**Version 0.3.0.** See [CHANGELOG.md](CHANGELOG.md) for what's new. Design docs:
- [docs/vision.md](docs/vision.md): the design north star.
- [docs/creature.md](docs/creature.md): the golem.
- [docs/agents.md](docs/agents.md): how features are added.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
```

## Controls

| Action | Input |
| --- | --- |
| Grab a villager, tree, rock or food | Left-click it |
| Drag the land | Left-drag the ground (works while holding things) |
| Set the held thing down | Left-click the ground |
| Throw | Hold the right button, flick the mouse, release (a still click just drops it) |
| Rotate / tilt | Right- or middle-drag with an empty hand, `Q`/`E`, `T`/`G` |
| Pan / zoom | `WASD` / arrows, mouse wheel (zooms to the cursor), `R`/`F` |
| Fly somewhere | Double-click the ground |
| Miracles | `1` Water · `2` Food · `3` Fire. The miracle appears in your hand; throw it or set it down. `Esc` refunds it |
| Village details and worship slider | Click one of its buildings, or its row in the Villages list |
| Your golem | `C` finds it, `L` calls it to your hand. Left-click and rub to **stroke** (reward), right-click to **slap** (punish) |
| Home / pause / speed / help | `Space` / `P` / `[` `]` / `H` |
| Sound / music | `M` mutes everything, `N` toggles the music (also the 🔊 and ♪ buttons) |
| Visual effects | `K` toggles post-processing (ambient occlusion, bloom, grade); `Shift+K` cycles its quality |
| Advisors | The 💬 button mutes Lumi and Fizz |

Your hand only works inside the golden ring of influence around villages that worship you. You can still **throw** things beyond it, and that's how you reach unconverted villages.

## How the game works

- **Villagers** have hunger and homes. They farm, chop wood, haul goods to the village store, build houses, have children, sleep at night, and panic when on fire.
- **Worship.** Each village sends a share of its people (the slider) to dance at its totem. In your villages this produces prayer power. More worshippers means fewer farmers.
- **Belief.** Neutral villages gain belief from impressive deeds nearby: food, rain, long throws, gifts dropped on their store, or fire and destruction. At 100% they convert, extending your influence. Belief slowly fades if you ignore them.
- **Alignment.** Kind acts push you toward *Benevolent*, cruelty toward *Malevolent*. Your hand changes to match.
- **Faith.** Your own villages lose faith if they starve or you hurt them. A converted village whose faith hits zero leaves you.
- **Your golem** eats, sleeps, plays and grows. It chooses what to do by itself, and your strokes and slaps teach it which habits you approve of. Its looks follow its own good or evil nature.
- **Prayers.** Villages ask for things: timber, food, rain, a sign, a lost child brought home, a fire put out, help with a project. Answering one gives power and faith (or belief, for neutral villages); ignored prayers just fade. Two advisors, Lumi (kind) and Fizz (cheeky), point things out. The 💬 button mutes them.
- **Projects.** Each village works through a Well, then a Temple, then a Harvest Festival, with its builders hauling wood, stone and food. Drop materials on a site to help. A neutral village is only won over by projects **you** helped with.
- **The Wonder.** Once all three villages worship you, they raise the Wonder together. Finishing it ends the first island.
- **Seasons.** A year is four seasons of 2.5 days each, and each changes the look, the crops and hunger. Each season brings one announced nature event: a spring bloom, a summer dry spell, an autumn storm with lightning, or a winter cold snap.
- **Vexahl, the rival god**, arrives across the sea after the Wonder. His schemes are always announced with a countdown, and each can be countered:
  - **Whispers** drain a village's faith.
  - **Blight** withers its fields.
  - **A grasping hand** tries to snatch a villager.
  - **A violet storm.**

  A village drained to zero faith turns to him, and you win it back by impressing it. Your home village never turns, and he never kills anyone. Foil four schemes and keep him villageless for a season, and he retreats. His panel has a difficulty setting: Gentle, Steady or Cunning.
- **Saving.** The island autosaves every minute and whenever you leave the tab. The title screen offers **Continue** or **New island**.

## Code map

```
src/
  Game.ts               world setup, entity registry, game-event rules (impress, deaths, conversion), main loop
  config.ts             all tuning numbers (villages, rates, costs)
  world/                Terrain (heightfield, ray-march picking, biome + influence-ring shader), Water, Sky (day/night,
                        weather), Grass, PostFX (AO, bloom, grade)
  entities/             Entity base; Villager (needs + task AI); Tree/Rock/Pile; House/Store/WorshipSite/Field; Forest (instanced tree rendering)
  village/Village.ts    layout, roles, births, construction, belief/faith
  hand/                 Hand (grab/throw/place); HandModel picks the Blender SkinnedHand or the ProceduralHand fallback
                        and sets the resting angle (POSE)
  input/                raw Input and the Controls mapping
  miracles/             Orb (a miracle in hand/flight), effects, RainCloud
  creature/             Golem pet: rigid-rock rig model + poses (GolemModel), needs/decisions/learning (Golem)
  systems/              Physics (flight, bounce, roll, collisions), Fire (burn + spread), Player (power, alignment)
  fx/Particles.ts       pooled GPU particles and effect helpers
  ui/                   DOM HUD and styles
  plugins/              features loaded automatically (each exports install(game)); see docs/agents.md
  prayers/              prayer system, prayer bubbles, the advisors Lumi and Fizz
  projects/             Well/Temple/Festival chain, building sites, the Wonder
  seasons/              calendar, seasonal looks, nature events, the storm, falling leaves/snow/petals
  rival/                Vexahl: arrival, schemes, visuals, panel
  systems/Save.ts       versioned save in localStorage (godgame.save.v1), autosave, Continue/New island
  systems/Events.ts     typed event bus (game.events)
  assets.ts             loads public/models/*.glb before the game starts
  audio/Audio.ts        the soundscape, synthesised live (no audio files). One key, chord cycle and beat clock
                        drive the music, and every chime, miracle, drum and golem hum follows them, so sounds harmonise
blender/build_*.py      generate the golem, trees and hand in Blender and export them to public/models/
docs/                   vision.md (design north star), agents.md (how to add features), creature.md, concept art
```

`window.game` is exposed for debugging. `game.advance(seconds)` fast-forwards the simulation. Feature handles:

- `game.seasons.jumpTo('winter')` and `game.seasons.trigger('storm')`
- `game.rival.arriveNow()`, `game.rival.trigger('whispers')` and `game.rival.state()`
- `game.projectSystem.startNow(village)`
- `game.prayerSystem.spawnNow(village, 'food')`
- `game.saves.save()`

## Not built yet

- **The golem** has needs, habits and stroke/slap learning (see `docs/creature.md`), but it doesn't learn miracles or use leashes yet.
- **Also missing:**
  - gesture-drawn miracles
  - more miracle types
  - terrain sculpting
  - more islands and pets
