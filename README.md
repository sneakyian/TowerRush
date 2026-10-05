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
- Click a built tower to **upgrade** it (three tiers) or **sell** it for
  half of what you've invested.
- Click **Start Wave** to send the next wave. Every enemy that reaches the
  castle costs 1 life, heavy brutes (orcs, yetis, trolls, golems) cost 2,
  and the **boss** on the final wave costs 5.

### Towers and damage types

| Tower  | Cost (tiers) | Damage   | Notes                                   |
| ------ | ------------ | -------- | --------------------------------------- |
| Archer | 70/110/160   | physical | Fast, cheap; the backbone of a defense  |
| Mage   | 100/160/240  | magic    | Slow but ignores armor; long range      |
| Cannon | 125/220/320  | physical | Splash damage for packed groups         |

Physical damage is reduced by an enemy's **armor**; magic damage by its
**magic resistance**. Armored golems and trolls want mages; spectral
sprites, wisps and witches want archers and cannons.

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
src/game.js      Core simulation (no DOM — runs in Node for tests)
src/effects.js   Particles, floating text, banners (no DOM)
src/render.js    Canvas drawing: terrain, animated water/trees/clouds, sprites
src/main.js      Browser wiring: input, HUD, level flow, saved progress
test/            node:test suites, zero deps
test/strategy.js Headless AI player used for balance tests
```

The simulation runs fully headless. The balance tests play every level
to completion with a mixed-tower strategy and assert it wins, and that no
single tower type can carry the whole campaign.

## Tests

```sh
npm test
```
