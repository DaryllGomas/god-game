# Changelog

Notable changes to THE FIRST WORLD (formerly "God Game"), newest first. Dates are when each change landed.

## [Unreleased]

### Added (the confrontation, 2026-10-18: Daryll: "this game's a lot about healing more than beating and dominating")
- **Before his hood falls, Vexahl speaks.** As his spire comes in close he makes his case: "Look at what you made. Every village, every temple. And not one of them fears you." He only wanted it done, the quick way, by fear; he reminds you whether you ever took his ring. Lumi ("He isn't wrong about what you wanted. Only about how.") and Fizz ("For the record, I was the nice one.") answer, he asks you to turn him away again, and Ora says: "Not away. Back." Then the hood falls and the hands meet, as before. There is no fight: the island was the struggle.
- **The last word.** After Ora's "There you are.", Lumi: "Both of you, in one place at last." Fizz: "Wonderful. Now who do I blame for things?"
- Every new line is voiced (Vexahl, Lumi, Fizz); Ora speaks as it always does.

### Added (the last age: the Nexus and Telor, 2026-10-17; Daryll: "you do one last city building where you bring all of the towns together")
- **Whole is no longer the end of story mode.** The ending plays exactly as before (Ready to See, the reveal, the hands meeting), but its card now reads **WHOLE: "Three villages, ready to become one."** When you click past it you are back on the island at night, and one more age begins.
- **The Nexus.** Ora names the goal: where the villages' roads meet, at the heart of the island, the three villages will raise the Nexus, a ring of seven standing stones, one for each mark. A soft light marks the place, and a small chip over it counts the stones. You raise it the way you raised every dream: drop boulders on it, and all three villages carry timber and food there. Every prayer you answer and every gift you give, in any village, flies over to it as light. The stones rise one at a time, each with its mark carved on its inner face (the path, the open circle, the chevron, the river, the orbit, the crescent, the rings). There is no prayer bubble and nothing to kneel to. If you leave it alone a long while, the villages quarry a little stone themselves so it never stalls for good.
- **Telor grows round it.** When the seventh stone stands, the marks light one after another round the ring. Then, instead of a temple, the city builds itself over about three minutes. First the roads from all three villages are paved toward the Nexus. Next a plaza is laid out ring by ring from the stones, with banners, fountains, planters, benches and a market. Seven lanes run out from the seven stones, and two rings of houses and halls fill in, warm stone below, cream and ochre plaster above, terracotta and slate roofs, a few slender towers with gold caps. Houses then line the avenues out to the villages until the villages' own houses meet them, and finally walls of warm stone close the city, with a gate where each road comes in. Lamps light along every street as it is paved, every window glows at dusk, people walk the new streets, and a circle dance turns round the Nexus. Lumi and Fizz have a word at each step.
- **The true end: they understand you now.** When Telor stands, the camera rises over the city at dusk. A column of light opens at the Nexus, three rings of light turn above it, and the people of Telor stop, gather round and look up. Nobody kneels. Ora says its last line, "They understand you now.", and the moment holds. That is the end of THE FIRST WORLD.
- **The end card cuts to the next game.** It shows the mark, THE FIRST WORLD, "Some years later, the Nexus opens." and TELOR, then asks plainly: *Would you like to go on to the next game?* **Beyond the Nexus** opens the RPG's page on the studio site for now. **Stay on this island** takes you back to Telor to keep playing. A controller works too: A goes on and B stays (Enter and Escape on a keyboard). Reaching this end is what unlocks free play now, and the legacy record notes that Telor was built.
- An island saved at any point in the last age loads where it stood, with the same stones and the same city. Islands from before this update load unchanged. Free play's ending is as it was.
- For tests: `game.nexus.debug('nexus' | 'stone' | 'ring' | 'city' | 'built' | 'end')` and `game.nexus.state()`; `scripts/test-nexus-age.mjs`; the playbot plays on through the last age to the true end and stays on the island.

- **Lumi and Fizz speak the new lines aloud** in their own voices (every line of the last age, with each village's name).

### Changed (2026-10-18: Daryll: "until the end it'll lock them all in")
- **No village can lose faith from the good ending to the true end** (Caboose's playtest review: in 4 of 5 runs one slipped away while the ending played). If one had already gone, it rejoins when the last age begins.
- **Lumi no longer speaks of a pyramid or temple before it stands** (Daryll: "they said the pyramid was there before it wasn't even there"). When a village starts dreaming of one she now says "They want a pyramid, right where they pray..." and "Now they dream of a temple of white stone...", voiced.
- **Easier to grab:** a wider margin around things under the hand, a stickier target so it doesn't flicker away as you click, and trees are picked by their crown, the part you see from above.
- **Lumi's and Fizz's words show with an ad blocker on.** Their speech text used class names starting "adv-", which ad blockers hide as adverts, so the card showed only a name and a face. Renamed (talk-).
- **The end cards answer on time on slow machines.** A card ignores clicks for its first 5 seconds; those seconds were counted in capped frame steps, so on the living-room TV the card could ignore the controller for much longer. They are real seconds now.
- **No repeated lines:** Lumi and Fizz never say the same line twice within 90 seconds, and a reaction that has waited more than a minute is dropped.
- **Fizz's walls line** is now "Walls! To keep out... whom, exactly? He's gone. I checked. Twice."
- **In the last age no village can lose faith.** While the three villages raise the Nexus and build the city, a village you neglect only slows down; it never turns away (its faith stays at a quarter or more). After the true end, if you stay on the island, the old rules come back: looking after them is the game.

### Fixed (2026-10-18, the living-room TV: Daryll: moving the hand with the controller "did not work well")
- **The controller follows the pad in your hands.** With two pads connected (the TV has two), the game now listens to whichever pad you last used, and stays with it until another pad does something. It used to pick a pad by how far its stick was pushed, and fell back to the first pad.
- **No more creeping hand.** Both TV pads reported their left stick about halfway up while resting (a stale value the driver keeps until a stick is first moved), so the hand crept up the screen and the game kept choosing the wrong pad. A stick reading that has never moved since the pad appeared now counts as centred.
- **The intro hears every pad**, not only the last one connected.

### Fixed (2026-10-17)
- **On the living-room TV, "Beyond the Nexus" opens the TV's own copy of the RPG** at the Nexus (it pointed at the studio website's page, which the TV doesn't serve).
- **Vexahl's glances always come back** (Daryll: "when he's done ... we should go back"). The camera stays out at sea only if you moved it yourself during the glance (a drag, keys, the wheel, a click that flies somewhere); anything else, and it glides back to where you were.
- **The good ending opened inside a wall.** With the new village scenery (barns, stalls, haystacks), the low camera at the temple could start buried in one, and "Ready to See" showed a brown screen. The ending now checks that nothing drawn stands between the camera and the temple before it picks its spot.

### Changed (Lumi and Fizz have faces, 2026-10-16: Daryll: "get all of the art in")
- **Lumi and Fizz are painted now**, like Vexahl, instead of the little drawn cartoon faces, from sheets Daryll picked on 2026-10-17. Lumi is a little glowing spirit with a halo, big blue eyes and a tiny star friend, over a harbour at dusk: Fizz's counterpart. Fizz is a playful ember-orange trickster with swept-back horns, fin ears, one fang, a scarf and a tail ("there to bug you and annoy you", not evil).
- **Their faces follow the moment.** Lumi rests her chin in her hands when she talks, cheers at good news ("Look at them dance!"), peeks round a wall when something is wrong ("Something stirs out there."), and is hurt, with one tear of light and her star friend worried, when you are cruel ("Oh no. Please be gentler with them."). Fizz smirks with his chin on his hand; cackles and points at his own jokes and at your mischief ("Ha! Splat.", "Your golem just ate a villager."); schemes, hand to chin, when he tempts you ("You know, from up here they look very... throwable."); and peeks round a rock when something is afoot across the sea. Lumi's light breathes softly while she talks; Fizz bobs when he laughs.
- **Fizz's "Echo! Echo! ...Sorry." is gone** (Daryll: "that one's annoying"). When a temple is finished he now says either "They built you a house nicer than any of theirs. Bit awkward, really." or "A temple! Fantastic acoustics. Imagine the screaming. ...Singing. I meant singing.", both voiced.
- **The faces on every speech card are bigger** (76 px, was 58; Vexahl's too), so the paintings read. Phones keep the old size.

### Changed (world look 2, 2026-10-17: storyboard panels 2 and 3)
- **Meadows and woods are deep, warm greens by day**, not lime: the ground, the grass and the tree crowns. Nights keep the brightness they had.
- **Woods have more colour**: dark teal pines, mid greens and olive, and now and then a tree turning gold-orange.
- **The mountains read as grey stone** under the warm light, not lavender.
- Unchanged on purpose: the gold edge of your light and the grey drain when the world falls out of tune.

### Changed (world look, 2026-10-16: storyboard panels 2 and 3)
- **The day is warmer**, nearer golden hour at midday too (this game's own setting; the look kit shared with the RPG is unchanged). Nights are as bright as before.
- **Greens are richer and deeper**: the meadows, the grass tufts and the spring and summer grass colours.
- **Paths are warm brown earth**, not yellow-green lines, and each home and the storehouse stands in a yard of trampled earth. The season's grass colour no longer tints bare ground green.
- **A warm pool of light** hangs over a prayer place of yours, stronger with each age and at night, lighting the stones, the court and the people round it.
- **The walkers on the paths swing their legs and arms** as they go. The people gathered at the prayer place stand still.
- Unchanged on purpose: the gold of your light on the ground and the grey drain when the world falls out of tune.
- A cottage's hidden footing now goes 6 m down, so a home on a steep spot never shows a gap. For tests, `?shot=…&stage=` now takes an age's number (0 to 3) or its name; the number used to be ignored.

### Changed (village art pass, 2026-10-16: Daryll wants the game finished "with all of the art in"; target: storyboard panel 2)
- **Villagers look like little people.** Each has an outfit in the village's colour (a belted tunic, a long dress with an apron, a hooded cloak, or a plain smock with a scarf in the village colour), a face, one of several hair styles or a straw hat, hands and boots. They are a little bigger. Believers wear gold: a sash and a small sun pendant, on everyone in your villages and on the people of a neighbour's home that has come to believe (not on a home ruled by fear). The walkers on the paths come in five looks per village, and there are more of them.
- **Homes are bigger, chunkier and warmer**, in three kinds: timber-framed with a steep shingled roof, fieldstone with a deep thatch, and two storeys with the upper floor jutting out and a dormer. All have a big stone chimney, lit windows with shutters and flower boxes, and some a porch. The storehouse is now a round stone granary with a shingled roof and a little cupola (it was a red cone).
- **The prayer places are grand.** The totem is a third taller, carved with faces, with layered wings, a crest and torches round its floor. The standing stones are half as tall again, in slate grey. The pyramid is steeper and taller, and the temple's columns and floating crown rise with it.
- **Rings of gold light** lie on the ground round a prayer place of yours, one for each age (up to three), with beads of light running round them. They glow brighter at night. The grass stays off them.
- **Villages are busier.** Crops grow in rows of plants inside a fence with a gate (they were flat slabs). Each village has market stalls in its colour round the storehouse, a well, a barn, workshops with a glowing forge, woodsheds, carts, haystacks by the fields and lamp posts. These are scenery: they are not homes and don't count as houses. The people gathered at the prayer place stand outside the stones once the stones stand.
- Under the hood: a cottage's hidden footing goes deeper for the bigger footprint (see the world look entry); the ground check passes, including the slope stress step. `scripts/village-shots.mjs` takes the village close-ups, each age, dusk and the island view on Atlas, with fps and draw calls.

### Added (controller support, 2026-10-16: Daryll: "If you're on the couch, I want it to work with the game controllers also.")
- **The game plays with an Xbox controller, natively** (no mouse and key emulation needed). The left stick moves your hand, with a small ring of light that shows only once a pad is used and goes away when the mouse moves. **A** grabs and sets down (tap, tap; or hold and let go), through the same code the mouse uses, so a tree goes onto a rock. **B** puts back or closes. The right stick pans; **X** goes home (hold it with the right stick to turn the view); **Y** finds the golem, or throws what you hold; stick clicks zoom; the D-pad is Water, Food, Fire and pause. No shoulder buttons or triggers are needed, and the Xbox button is never touched. The full map is in the README.
- The intro (A touches the light, B or Start skips), the title screen, the help screen, the win card, the rival's ring and the end cards all work with A, B and the D-pad. The help screen shows a Controller line once a pad is in use.
- The page sets `window.__nativeGamepad = true` when it sees a pad.

### Changed (Vexahl's faces, and the ring, 2026-10-15: Daryll: "different things use different images of him ... if you ruled with an iron fist and with power ... he could be holding up the ring. And so it's your job to turn it down.")
- **Vexahl has a face now, or rather a hood.** His card shows painted portraits instead of the little drawn face: the hooded shadow with ember eyes when he speaks, the shadow holding out a smoking ring when he tempts you, and the shadow turning away into smoke when you foil him, win a village back, or he goes quiet. His card is darker now, with an ember edge instead of a violet one.
- **The ring.** Two or three times in a story game (twice at most in free play), at a moment of impatience, he comes to you on a larger, darker card holding out his ring: when a village you are winning has stalled for a while, when one of his schemes has been draining a village, or when you have been cruel. You choose **Take the ring** or **Turn it down** (click, or Tab and Enter). The world keeps going while you think. After about 20 seconds the offer passes, and that counts as turning it down. The first time, Ora says: "Every gift from him is a little more of him."
  - **Take it** and you get what you wanted, now: the stalled village kneels and is yours at once, his scheme lifts, or (if nothing can kneel) prayer power floods in. But the village knelt out of fear. Its homes glow a cold violet and ember instead of gold, fewer of its people dance, and their prayer is weaker. If the world stays dark for a while they slip away to him. If it stays in tune long enough the fear lifts and their hearts are truly yours. Taking it also pulls your alignment toward cruel, drops the world's balance, and grows his citadel a step out at sea: the first step toward becoming him. He is pleased ("There. Was that so hard? It suits you. It always did."), and Lumi is not.
  - **Turn it down** and he turns away into smoke ("No? How... noble. It will still be here when you are tired."). Lumi is proud of you ("You said no to him. That was the strong thing, not the easy one."), and the world steadies a little.
  - All his new lines are voiced. The island's chronicle remembers each ring taken or turned down, and the legacy record now counts them (`vexahl.ring`).
- **His citadel is black and ember now**, like his portraits and the franchise banner: black glassy obsidian with ember-red veins and windows, ember shards, a black cloud crown lit red from beneath, and a dark sea around him with a faint red glow. It was violet-grey and read pale lavender from afar. It now reads dark and ominous in daylight too. When he dissolves in the good ending, the whole stone turns to light, not only its veins.
- **He sits where you can see him.** After the rising, his isle used to stand at the far left edge of the full-island view, half behind the Villages panel. He now rises further round, about 400 m out on open sea: upper left in the full-island view, clear of the panel and of the island. He still can't be seen before the rising.
- **The reveal.** In the good ending, after the final battle (still a placeholder) and before the two hands meet, his portrait comes up large: the hooded shadow you have known all game. Then the hood falls, and the face beneath is yours. "You know this face. You have always known it." He glances back over his shoulder one last time, and then the reconciliation plays as before. Atlas's face appears only here, never earlier in the game.

### Changed (Vexahl rises with you, 2026-10-15: Daryll: "when you get the pyramid, that's when it rises ... they're leveling up together")
- **His isle is hidden at first.** It now lies under the sea a little further off Ashford's coast (about 370 m out from the island's centre, was 312 m), with no spire to see until your first pyramid stands.
- **The rising.** When your first pyramid stands (in any village), the camera glides out to sea. The water there darkens, a ring of light runs out over the waves, and his isle surfaces through mist as his spire climbs out of the sea. Violet light runs up the spire and flares at its tip, and its ember windows light up. Ora names it ("Out at the sea's edge, something rises as your people rise. Someone who was always there."), then he says his first line and Fizz answers. The whole beat lasts about 17 seconds, and then the camera comes back. He no longer notices you at Ashford's standing stones, and his moves on the villages you're winning start only after he has risen.
- **He grows with you for the rest of the game.** Every age you raise, in any village, adds a step to his citadel, up to his final form when every temple stands (8 steps on this island). In order: two flanking spires, a battlemented wall with towers, a crown of shards and dark cloud above him, two taller spires behind, claws of rock out of the sea, the main spire's needle and three small spires on the wall, and at the last a violet eye in the cloud. As he grows, more ember windows light, the sea around him gets darker, and the isle gets bigger. Each step brings a far rumble and, if he's in view, a flare and a ring on the water. The camera only goes out to him twice more: at your first temple ("I have a spire. A BIG spire...", plus Ora: "Every age you raise, his rises too. Light and shadow grow together.") and at your last temple, his final form, just before the tune step ("I will be watching. Closely...").
- **His size now follows your progress, not the balance.** Balance still sets his temper: a falling world still stirs him, wakes his storm and makes his schemes bite harder. If the world falls before any pyramid stands, he rises early.
- **Free play** shows the same thing (hidden, then rising at the first pyramid, then growing with you) with no camera glances and no lines.
- **Final battle hook.** The Ascension now asks for the final battle as Whole begins, before the hands meet (`src/endings/FinalBattle.ts`). The battle will be imported from the RPG lab. For now the hook ends at once and the ending plays as before.
- Old saves load where they stand: an island that already has a pyramid has him risen at its current step, with no replay of the beats.

### Changed (screen and words, 2026-10-15: a first-time player's playtest, and Daryll: "it's got to be like 1 of 6, then 2 of 6")
- **Your villages show how high their prayer place has climbed**, not a count that is always full (5/5, 6/6). The village list and the label over the village read the age and step, "Totem · 1/4", "Stones · 2/4", "Pyramid · 3/4", "Temple · 4/4", over four segments, and the next segment fills softly as that age's dream is built. Hover a row for the next age and how far it has come. Villages you are still winning keep families with you ("2/5 ✦"); villages Vexahl holds are as before.
- **The village list rows look clickable**: they light up on hover, a small chevron leans in, and they have a focus ring (Tab, then Enter, flies there too). Clicking one still flies to the village and shows what it needs.
- **Ora's goal lines stay longer**: at least 7.5 seconds and up to 12 for long ones, always in real seconds, so 2× and 4× no longer rush them.
- **A small Ora rests at the top centre in story mode.** Hover or click it and Ora says the current goal again. It glows softly for a while after the goal changes, then sits quietly. No checklist, no text of its own.
- **The first goal says what to do.** Ora's first line names the first prayer and how to answer it ("Listen. Ashford is asking for timber. Lift a tree and set it down on their storehouse.") instead of a riddle, and that prayer isn't explained a second time. If no prayer has risen yet, Ora waits for it a few seconds before speaking. A returning player hears "Where were we?" and the same instruction.
- **The intro shows a way out**: a faint "skip ›" settles into the bottom-right corner two seconds into the film. Click it to skip (Escape still works, and a click anywhere still brightens it first).
- **The welcome screen is just a name and Begin.** The controls and the goal paragraph wait behind a small "controls" link (they are always open in the ? screen). "Play without a name" is gone: the name is optional, so Begin with the field empty does the same. Enter in the name field begins. "Lost your code?" moved inside "Have an island code?".
- **Storehouses are labelled**: with the hand over one (or carrying something to it), a small "Storehouse · drop gifts here" tag appears above it.

### Fixed (2026-10-15)
- Lumi's name no longer lingers on the page after the speech bubble fades. The hidden bubble kept "LUMI" and the last line, so it read as if Ora's words were Lumi's. The faded bubble is now emptied, and it and Vexahl's card are hidden properly once faded, so neither catches clicks at the top centre.
### Fixed (first-time player playtest, 2026-10-15, world side)
- **Choosing a miracle with something in your hand just works.** Holding a rock (or a tree, or a villager) and picking Water, Food or Fire sets the held thing down gently right where your hand is if that is inside your light, otherwise puts it back where you picked it up (or at the nearest spot inside your light), then gives you the miracle. The camera stays put.
- **Refusals show by the hand**, not only in the log: "Only inside your light. Throw it!", "Not enough prayer power for Water".
- **The camera no longer lurches on its own.** Double-click-to-fly only happens on bare land with an empty hand, and not when either click just grabbed, set down or picked something. One wheel notch can't zoom the view far in or out any more. Vexahl's glance out to his isle waits while you hold something or drag, and if you move the camera during the glance it stays where you put it.
- **Home button** next to the speed buttons (a small house, "Home (Space)"): same as Space, flies back to your home village. Space no longer re-presses a HUD button you clicked a moment before (it used to cancel or re-pick a miracle).
- **Nights stay readable.** The moon rises as the sun sets (no black gap at dusk), the night sky fill and the exposure lift a little, the light stays cool and blue. Villagers, lost children, buildings and the hand read at the darkest hour. Daytime is unchanged.
- **The golem eating a villager is always remarked on the first time** (Fizz: "Your golem just ate a villager. Chef's kiss." / Lumi: "That was somebody's grandad."), even if they were busy talking. Its "Eating villagers" row lights up for a few real seconds, so a slap still counts at 4x speed, and the bar moves: it got a taste for it until you teach it otherwise.
### Changed (publishing, 2026-10-15)
- **The game has a front door.** https://studio.bigpicsolutions.com/the-first-world/ is now THE FIRST WORLD's landing page (the intro film, screenshots, what's new, what we're building, and a form to report a bug, ask for a feature or leave feedback). The game itself moved to `/the-first-world/play/`; `npm run deploy` publishes there and never touches the landing page. Old links that carry game settings (`?from=thepath&initials=`, `?unlock=`, `?shot=`) are forwarded to `play/` with the same query. Saves and island codes are unaffected (same site).

### Changed (progression, 2026-10-14: Daryll: "by the time I got to the next town there was already a temple built ... we would want to be able to expand as we go into each one")
- **Villages join house by house.** A neighbour's belief fills family by family: each home whose family comes to believe gets a soft gold ring on the ground, gold windows and a small light over its roof, and a few of its people dance for you at the totem (their prayer reaches you at half strength). The village is yours once most homes believe (70%: 3 of 4, 4 of 5, 7 of 10), with the usual fanfare. Families can let go again if belief fades. The village list and the label over each village show families with you ("2/5 ✦") as a bar with one segment per home.
- **Smaller lumps.** An answered prayer gives a neighbour 10 belief (was 28), a finished dream you helped 15 (was 40), material on its dream 0.12 per unit (was 0.25), and storehouse gifts count at 40%. One miracle answers one prayer: Water answers the rain prayer, else the call for a sign; Food on a storehouse feeds the hunger, else counts as a sign.
- **Your light grows as you tend, and leans toward the next village.** No more one-time 270 m jump. Each village of yours has a reach that grows with every answered prayer (4 m), gift (1.5 m), stone given (0.15 m per unit) and finished dream (8 m), flowing out at 3 m/s, up to a cap set by its prayer place: 130 / 200 / 260 / 320 m for totem / stones / pyramid / temple. Growth earned past the cap is banked (up to 20 m) and flows out when the next age rises. A village whose light can't usefully grow passes its growth to the village of yours nearest to touching the next village. The light is an egg: the round part grows only 30% as much as the tip, which reaches along the road toward the nearest village not yet yours. A village is in reach once your light comes within 1.8 times its radius of its centre. Ashford needs its stones to reach Brambleholt; Brambleholt's stones carry the light on to Stonemere. The hand works only inside the gold, which the terrain shader draws from the same shapes (src/reach/Light.ts).
- **A reached neighbour's own glow grows with its belief**, from 1.35 to 3 times its radius, and joins your ring about half-won. Food or wood set down anywhere inside it (not only on the storehouse) counts once, at half a gift. Deeds don't impress a village your light doesn't reach yet.
- **Neighbours wait for you.** A village beyond your light dreams of nothing; once your light reaches it, it announces its first dream 60 to 90 s later. A village that isn't yours never quarries its own stone and doesn't finish a dream without your hand, so it rises past the totem only with your help. It stops building at 5 houses until it believes. Your own villages quarry only after a dream has waited 150 s for your stone, so the stones are something you raise. The golem hauls only to your own villages' dreams.
- **Story mode follows the new road.** After the stones, Ora's "carry" goal shows the gold leaning toward the next village and says every prayer, gift and dream carries it further (or, at the cap, that the next age will). The "win" lines speak of families. Old saves still load: villages of yours keep the full reach of their stage, and saved dreams quarry and count as reached as before.

### Changed (playbot)
- The playbot takes the profile as an argument (`atlas-run dist scripts/playbot/playbot.mjs <out> homebody`), logs families joining, takes the light-leaning, half-joined and glow-joins shots (milestone shots in daylight, light shots at dusk, without the hand), and the newcomer starts carrying stone after Ora has said twice that dreams want it. Run 2 is in the NAS Playthroughs folder.

### Added
- Vexahl enters the story (story mode). His spire-isle now sits, small and hazy, at the top-left sea edge of the view the game starts on (it used to be 1,450 m out, where the top-down camera never looked). When Ashford raises its standing stones, the camera glances out to his isle once, he says his first line, Fizz answers, and Ora notices: "Out at the sea's edge, someone is watching. Someone who was always there." From then on each neighbour your light reaches draws one small move from him, shown on his card and chip: whispers that slow its belief (answer its prayers, give gifts, work a miracle there, or bring the golem), then a blight on a later village's fields (a water miracle washes it away). Neither can turn a village you haven't won yet. When every temple stands he says his last word and stops. Free play keeps the balance-only rules; low balance still wakes him and makes him bite harder in both modes.
- The tune step is real: the Ascension now waits one game day after the LAST temple stands, counted only while the island stays in tune (a dip pauses it, a fallen temple restarts it). Ora's "Every temple stands" line now plays, and you get a calm closing stretch. In free play the ascension light rises on the same rule.

### Fixed
- Vexahl's card and Lumi's and Fizz's no longer show on top of each other at the top centre: each waits for the other's to finish.
- Ora's goal line for the tune step clears stale goal lines still waiting, and Vexahl's first-notice line jumps the queue, so neither arrives minutes late.
- Sea stacks no longer stand where his isle is.

### Added
- Voiced Lumi and Fizz's 14 new story-mode lines (Qwen3 Sohee and Kokoro fable, same settings and loudness as the rest), so they no longer fall back to synth babble. Ora stays text-only.
- Vexahl speaks aloud: 56 recorded lines (Kokoro bm_daniel pitched down), played on his card, which stays up for the clip plus 0.6s; the synth motif remains the fallback. Voice candidates in docs/voice-candidates/.
- Story mode, the default on a first island: Ora names one goal at a time on the road to the Ascension, re-nudges gently if you're stuck, and a soft light marks the goal. Beating the story unlocks free play: a new island then offers Story or Free play (no guidance, you ascend when you choose).

### Fixed
- The road no longer dead-ends after your home village: once a village of yours raises its standing stones, your light reaches the next village, so your hand works there and its people pray to you. Far villages no longer send prayers you can't reach, and the prayer list never flies you somewhere you can't act. The pace marks glow a little softer.

### Added
- Lumi and Fizz speak aloud and float beside your hand, arguing over tempting mischief. Their speech stays readable when the hand leaves the screen.
- Give villagers lasting jobs by setting them down at forests, fields, building sites, the shore or their prayer place. Builders fetch stone from nearby rocks; set them on open ground to release them.

### Added
- Cloud shadows drift slowly across the island, over the ground, the woods and the villages alike.

### Changed
- The hills and mountains are grey-blue slate under the green instead of straw.
- The land is lived in: worn dirt paths link each village's houses, fields and totem, roads run between the villages, and the ground has darker, warmer and mossy patches, trampled earth around buildings and darker ground under trees. Dense mixed woods, shrubs, flower clumps, boulders and a stony shore fill the island; the villages' own groves are thicker.


### Changed
- Crop fields now follow the ground: soil and rows lie on slopes instead of sinking into hills or floating.
- Houses are storyboard cottages: stone footing, timber frame, steep shingled roof, stone chimney, shutters. Lived-in homes glow warm at dusk and send up wind-bent chimney smoke.

### Added
- Barrels, crates, fences and lantern posts around houses.
- Stumps stay where trees fell or were taken, and give way when a tree regrows.
- Gulls circle over the island.

### Added
- **The intro lands in the game.** The film no longer ends on black: its last painting of the island dissolves into the live game, and the camera then glides down to your village before the title screen appears.
- **The intro now plays with sound.** A first visit opens on black with one small, slowly breathing point of light; a click or any key touches it, the light fades and the film begins with its soundtrack. The game's own sound waits until the film ends, and a muted game keeps the film muted.
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
  - **Ready to See, then Whole.** When every temple stands and the world has stayed in tune for a full day, the villages become a city of light at dusk: every window lit, lamps and roads of light between the villages, a pillar of light over each temple, sky lanterns rising, and the people stop and look up. Then the camera rises over the lit city, his spire comes close one last time, calm, and your gold hand and his violet hand reach for each other and become one warm light; his spire dissolves into light and Ora says "There you are." The screen goes black and an end card shows the TEND mark, THE FIRST WORLD and one line: "The Nexus is forming." Click to go back to your island (the city keeps its lights every night; Vexahl is gone for good).
- **The legacy record.** As the good ending begins the game writes the record the RPG reads (`save.legacy`, the AGREED v1 shape in HANDOFF TO THE RPG.md: your villages and the ages they reached, the balance at the end and its lowest, your golem, the people the chronicle remembers, your worst and kindest acts, Vexahl reintegrated) and saves at once, so it goes up with your island code. A small download icon on the end card saves it as a `.json` file too.
- **Lives have a length.** Villagers age. After a long life (34 to 50 game days) the island's eldest pass away peacefully in the morning, one at a time and never a village's last few people. It doesn't touch the world's balance.

### Changed
- **The good ending now plays Ready to See, then Whole, then the end card**, matching the RPG's approved storyboard (it was Whole, then Ready to See). The villages become a city of light at dusk and the people stop and look up; then, with no cut, the camera glides up from them to the sky above the lit city, his spire comes close, the violet hand and the gold hand meet and become one light, the spire dissolves, and Ora says "There you are." Same trigger (every temple standing, balance in tune for a day). The legacy record is still written once, as the sequence begins, and still says Vexahl reintegrated. After the card nothing changes: Vexahl gone, the city lit every night. `game.endings.debug('ready')` plays the whole sequence; `debug('whole')` starts at Whole over the lit city.
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
