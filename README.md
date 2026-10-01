# Tower Rush

A simple Kingdom Rush-inspired tower defense game. Plain HTML5 canvas and
vanilla JavaScript — no dependencies, no build step.

## How to play

Serve the folder with any static file server and open it in a browser:

```sh
npm start          # serves on http://localhost:8080
# or: python3 -m http.server 8080
```

- Click a **round build spot** next to the path, then pick a tower.
- Click **Start Wave** to send the next wave. Survive all 5 waves to win.
- Each enemy that reaches the exit costs 1 life; killing one earns gold.
- Click a built tower to **sell** it for half its cost.

| Tower  | Cost | Notes                          |
| ------ | ---- | ------------------------------ |
| Archer | 70g  | Fast, cheap single-target      |
| Mage   | 100g | Long range, solid damage       |
| Cannon | 120g | Slow, splash damage for groups |

## Project layout

```
index.html       Page, HUD, and styles
src/config.js    All game data: level, towers, enemies, waves
src/path.js      Polyline path addressed by distance
src/game.js      Core simulation (no DOM — runs in Node for tests)
src/render.js    Canvas drawing
src/main.js      Browser wiring: input, HUD, game loop
test/            Unit + end-to-end tests (node:test, zero deps)
```

The game logic is fully separated from rendering, so the entire simulation
runs headless. One test even plays level 1 start-to-finish with a greedy
strategy and asserts the level is winnable.

## Tests

```sh
npm test
```

## Adding more levels later

Add another level object in `src/config.js` (path waypoints, build spots,
waves) and construct `new Game(LEVEL_2)` — nothing else needs to change.
