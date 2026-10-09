# Tower Rush

A Kingdom Rush-inspired tower defense game. Plain HTML5 canvas and vanilla
JavaScript — no dependencies, no build step.

## How to play

**Easiest:** double-click `play.html` — a self-contained build that runs
straight from disk, no server or install needed.

Or serve the folder with any static file server and open `index.html`:

```sh
npm start          # serves on http://localhost:8080
# or: python3 -m http.server 8080
```

(`index.html` uses ES modules, which browsers refuse to load over
`file://`, so it only works through a server. `play.html` is regenerated
from the sources with `npm run build`.)

- Pick a level. Beating a level unlocks the next; progress is saved in
  your browser.
- Click a **round build spot** next to the path, then pick a tower.
- Click a built tower to **upgrade** it (four tiers) or **sell** it for
  half of what you've invested.
- Click **Start Wave** to send the next wave. **Speed** (or `F`, `1`/`2`/`3`)
  fast-forwards the action up to 3×. Every enemy that reaches the
  castle costs 1 life, heavy brutes (orcs, yetis, trolls, golems) cost 2,
  and the **boss** on the final wave costs 5.

### Sound

Everything you hear is synthesized live with the Web Audio API, so there
are no audio files: each tower has its own shot and impact sounds (the
flamethrower roars while it fires, the laser hums higher as it ramps),
heroes, bosses and the castle have their own cues, and every level has a
generative soundtrack that shifts from calm build music to wave music
with drums and a darker, faster boss mode. **M** or the Sound button
mutes; browsers only start audio after your first click.

### Heroes

Pick a hero on the level screen. Click the hero, then click the map to send
it there; it fights on its own, and **Q** (or the ability button) fires its
special. Heroes level up from their own kills, and fall back to the castle
gate to return after a short wait if they die.

| Hero                | Style                                                        | Ability                                              |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| **Ember Drake**     | Flying; fire breath that splashes and burns                   | **Firestorm**: rains fire on everything around it    |
| **Sir Aldric**      | Armoured knight; blocks three enemies and cleaves two         | **Whirlwind**: hits and stuns everything around him  |
| **Ilyria**          | Archmage; arcane bolts from range                             | **Frost Nova**: slows every nearby enemy to a crawl  |
| **Mordrek**         | Skeleton paladin; blocks two enemies, heals as he hits        | **Consecration**: scorches and stuns, mends his bones |

Melee heroes hold the enemies that reach them (bosses shove straight
through); enemies fight back, so pull a hurt hero out of the line.

### Towers

Eleven towers, each with **four upgrade tiers**. Physical damage is reduced
by an enemy's **armor**; magic damage by its **magic resistance**.

| Tower          | Base cost | Damage   | Mechanic                                             |
| -------------- | --------- | -------- | ---------------------------------------------------- |
| Archer Tower   | 70g       | physical | Fast, cheap arrows                                   |
| Mage Tower     | 100g      | magic    | Slow bolts that ignore armor                         |
| Cannon Tower   | 125g      | physical | Splash damage                                        |
| Mortar         | 180g      | physical | Huge long-range blast, but a minimum range           |
| Sniper Nest    | 150g      | physical | Enormous single shots, pierce armor, target the toughest |
| Frost Spire    | 80g       | magic    | Ice shards slow enemies                              |
| Tesla Coil     | 140g      | magic    | Chain lightning arcs between enemies                 |
| Flamethrower   | 110g      | physical | Short range; leaves enemies burning                  |
| Venom Spitter  | 120g      | magic    | Poison that stacks with every hit                    |
| Laser Lance    | 160g      | magic    | Beam that ramps up the longer it holds a target      |
| War Beacon     | 130g      | —        | Boosts the damage of every tower in its aura         |

Armored golems and trolls want magic or armor-piercing fire; spectral
sprites, wisps and witches want physical damage. Chill, poison, lightning
and a well-placed beacon turn a good defense into a great one.

### Enemy traits and elements

Enemies carry traits that reward reading the roster and building counters:

| Trait          | What it does                                                                 | Answer                                  |
| -------------- | ---------------------------------------------------------------------------- | --------------------------------------- |
| **Armored**    | Reduces physical damage                                                      | Magic, sniper rounds, lightning         |
| **Spell-warded** | Reduces magic damage                                                       | Arrows, cannon, flame, sniper           |
| **Regenerates** | Heals every second while left alone                                         | Burn or poison stops regeneration       |
| **Shielded**   | An energy shield absorbs hits before health (magic ×1.5, physical ×0.75), blocks burn and poison, and recharges after 4 s untouched | Lightning and arcane bolts; keep hitting it |
| **Element**    | Fire, ice, poison or storm; immune to its own status (fire ignores burn, ice ignores chill, poison ignores poison) | Hit the opposing element |
| **Weak to X**  | Towers of element X deal 1.75× and ignore armor and wards                    | Frost vs fire, flame vs ice, venom vs storm, tesla vs golems |

Tower elements: Frost Spire is **ice**, Flamethrower is **fire**, Venom
Spitter is **poison**, Tesla Coil is **storm**, Mage Tower and Laser Lance
are **arcane**.

**Thermal shock:** fire on a chilled enemy, or frost on a burning one,
shatters both effects for a burst of true damage (8% of max health).

### Bosses

Every boss is tougher than before and fights in phases:

- At **half health** it calls reinforcements from its own army.
- Below **a third** most bosses **enrage**: 50% faster and harder to hurt.
- The Frost Giant and Hydra **regenerate**, the Ember Dragon carries a
  **fire ward** shield, and each has an elemental weakness to exploit.

### Levels

1. **Greenfields** — goblins, wolves, orcs. Boss: Orc Warlord
2. **Frostpeak Pass** — snow wolves, ice sprites, yetis, frost trolls. Boss: Frost Giant
3. **Sunscorch Desert** — scorpions, bandits, dune wasps, sand golems. Boss: Sand Wyrm
4. **Murkwater Swamp** — bog frogs, will-o-wisps, swamp witches, bog trolls. Boss: Hydra
5. **Ember Caldera** — fire imps, lava hounds, ash wraiths, obsidian golems. Boss: Ember Dragon

## Project layout

```
index.html       Page, HUD, level select, and styles
play.html        Generated single-file build (npm run build)
src/config.js    Tower tiers and the full enemy roster (stats + sprite look)
src/levels.js    The five levels: paths, spots, water, themes, waves
src/path.js      Polyline path addressed by distance
src/game.js      Core simulation incl. heroes (no DOM — runs in Node for tests)
src/effects.js   Particles, floating text, banners (no DOM)
src/render.js    Canvas drawing: terrain, animated water/trees/clouds, sprites
src/audio.js     Procedural sound effects and generative music (Web Audio)
src/main.js      Browser wiring: input, HUD, level flow, saved progress
test/            node:test suites, zero deps
test/strategy.js Headless AI player used for balance tests
```

The simulation runs fully headless. The balance tests play every level
to completion with scripted strategies: a classic Kingdom Rush mix must
clear the opening levels, an element-aware build must beat every level,
and no single tower type can carry the whole campaign.

## Tests

```sh
npm test
```
