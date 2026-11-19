# Get Back to Earth: Simulation Build Plan

This file is the source of truth for the project. Keep it updated as decisions change.

**Status (Nov 19, 2026):** M0–M2 built. Next up: M3 (HUD). See "Running it" below.

## What this is and why

Get Back to Earth is an interactive art installation, built with code and hardware, about how vast the universe is, and how even that vastness is nothing next to infinity.

**What the visitor does.** Each visitor is dropped at a random point in the observable universe and steers a ship with two hidden knobs and a button, trying to find Earth. Cosmic events along the way return fragments of their memory as images or video. A visit lasts about 15 to 25 minutes, and almost no one will ever get home.

**Where it comes from.**

- *A Short Stay in Hell* by Steven L. Peck: Hell is a library that is finite, yet so large that its one way out is effectively impossible. This piece applies the same idea to the real universe. The numbers are real and nothing is exaggerated, yet the odds of starting inside our own supercluster are still about 1 in 5.7 million.
- *Project Hail Mary* by Andy Weir: an amnesiac's returning memories turn out to hold exactly what he needs. Here, memories hold clues about where home is.
- The video [How To Find Earth If You Get Lost In Space](https://www.youtube.com/watch?v=zZ0yxOQyKF0): a route home that narrows from superclusters down to the Orion Arm, which supplies the nested landmarks.

**What success looks like.** Winning is not the goal. The piece works if visitors leave having felt the scale of the universe, and realize that something this unimaginably large is still finite. Their visit ends after a few minutes, which is a kindness compared with eternity. The closing exchange for the rare visitor who finds Earth says this out loud.

**Design principles** (use these to settle new questions):

- Real scale, honest odds: the start is uniformly random, never weighted.
- Kind wherever the visit's length demands it: accurate memory clues, no cosmic expansion, events concentrated in galaxies.
- Never show the distance to Earth.
- The hardware disappears: sensors hidden under a seamless surface, knobs that feel like they float and coast.

## Goal and constraints

Build a Three.js space simulation, driven by two hidden AS5600 knobs and a button, that drops each visitor at a random point in the observable universe, users have 15 to 25 minutes to explore the piece.

Decisions already made:

- **Rendering:** Three.js. **Simulation:** plain JavaScript modules that never import Three.js, so the renderer can change without touching the sim.
- **Input:** Raspberry Pi Pico + two AS5600 magnetic encoders (one per I2C bus, since every AS5600 has the fixed address 0x36) plus one button, streaming over USB serial and read in Chrome with the Web Serial API. A keyboard fallback for development.
- **Session length:** open-ended, with no time limit; visits are expected to last 15 to 25 minutes.
- **Physics simplifications:** no cosmic expansion, no light-travel-time effects. Memory clues describe the real universe correctly; none are deliberately wrong or faded.
- **Memories:** unlocked by space events (supernova, pulsar, hidden black hole, colliding galaxies, quasar, rogue planet, Laniakea flow), earned as players explore through galaxies, spawned by a director system near the player's path.
- **Ending:** No ending, unless the player actually manages to find earth. Have one short line like "That was too cruel right?" "No, eternity is much harsher" if that happens
- **Odds:** a random start lands inside Laniakea about 1 in 5.7 million times. Nigh unbeatable, game is satisfactory enough if users comprehend scale of universe and how that is not even anywhere close to infinity.

## Architecture

The simulation core owns all state and runs without Three.js; input feeds it, and the renderer only reads from it once per frame.

Data flow:

```
Keyboard (dev fallback) ──┐                                         ┌─> Three.js renderer (floating origin)
                          ├─ controls ─> Simulation core ─ sim.state ─┤
Pico + 2x AS5600 (Web Serial)┘          (ship: heading, speed tiers;     └─> UI overlay (HUD, memory media)
                                         universe: seeded cells + regionAt;
                                         director and space events;
                                         memories and session state)
```

Each frame: input adapters produce one `controls` object → `sim.update(dt, controls)` advances the ship, the director and the session state → the renderer draws `sim.state` relative to the camera → the UI layer shows any memory the sim just unlocked.

Suggested folder structure (Vite + vanilla ES modules):

```
src/
  main.js              wires everything, runs the frame loop
  sim/
    coords.js          cell + offset positions, distance math
    rng.js             seeded PRNG + hash(cellX, cellY, cellZ, seed)
    vec.js             vector/quaternion math, so the sim never needs Three.js
    universe.js        supercells (cosmic web, groups, clusters) + galaxies per cell + regionAt(pos)
    galaxy.js          galaxy shape, star density, star chunks, glow cloud for close views
    sim.js             createSim: owns sim.state, random start, dev jumps
    ship.js            pitch/yaw heading, logistic speed, speed tiers
    director.js        decides when and where the next event spawns
    events/            one file per phenomenon (supernova.js, pulsar.js, blackhole.js ...)
    memories.js        loads memories.json, tracks what is unlocked
    session.js         intro / explore / found-Earth states, idle reset
  input/
    keyboard.js        dev fallback
    serial.js          Web Serial reader for the Pico
  render/
    scene.js           Three.js setup, floating origin
    pointLayer.js      one batch of glowing points (angular size + brightness in the shader)
    starfield.js       level-of-detail layers: clusters, galaxies, galaxy clouds, stars
    effects/           lensing shader, supernova flash, bloom
  ui/
    hud.js             elapsed time, current region (never distance to Earth)
    debug.js           dev readout (region, speed, cap); hidden with the backquote key
    memoryOverlay.js   image/video playback + memory log
data/
  memories.json
  localUniverse.json   real nearby galaxies (later)
```

Rule of thumb: nothing in `sim/` imports from `render/`, `input/` or `ui/`. If you ever need to, the data belongs in `sim.state` instead.

## Coordinates and universe generation

Store every position as an integer grid cell plus a precise local offset, and generate each cell's contents from a seed only when the player is near it.

**Units.** Use light years. One cell = 1 million light years (about ten Milky Way widths; the Local Group is roughly 10 million light years across). The observable universe is about 46.5 billion light years in radius, so cell indices only go up to about ±46,500: plain JS numbers handle that exactly, no BigInt needed.

```js
// sim/coords.js
export const CELL = 1e6; // light years per cell
// position = { cx, cy, cz, x, y, z }  where 0 <= x,y,z < CELL

export function normalize(p) {
  for (const a of ['x', 'y', 'z']) {
    const c = 'c' + a;
    const shift = Math.floor(p[a] / CELL);
    p[c] += shift;
    p[a] -= shift * CELL;
  }
  return p;
}

// vector from a to b in light years (safe as long as they are within a few thousand cells)
export function delta(a, b) {
  return {
    x: (b.cx - a.cx) * CELL + (b.x - a.x),
    y: (b.cy - a.cy) * CELL + (b.y - a.y),
    z: (b.cz - a.cz) * CELL + (b.z - a.z),
  };
}
```

**Floating origin.** The camera is always at (0, 0, 0) in Three.js. Every object is placed at `delta(ship, object)` scaled into scene units, so the GPU never sees a huge number.

**Random start, uniform in volume.** Picking a random radius directly would cluster starts near the center. Use the cube root:

```js
const R = 46.5e9; // light years
const r = R * Math.cbrt(rng());
const theta = 2 * Math.PI * rng();
const phi = Math.acos(2 * rng() - 1);
// x = r sin(phi) cos(theta), y = r sin(phi) sin(theta), z = r cos(phi), then normalize()
```

**Seeded generation.** `hash(cx, cy, cz, worldSeed)` seeds a small PRNG (mulberry32 is enough). The same cell always produces the same galaxies, so nothing has to be stored. Most cells should be empty or nearly empty; that emptiness is the point. The world seed is fixed (the same universe for every visitor); only the start point is random.

**Large-scale structure (supercells).** Hashing each cell on its own can't produce superclusters, filaments or voids, which span hundreds of cells. A coarser grid of supercells (100 cells = 100 million ly per edge) sits on top. A smooth "cosmic web" noise field (0 = void, 1 = supercluster) decides where groups (3–40 galaxies, 0.4–1.4 Mly) and rich clusters (100–1,000 galaxies, 2–5 Mly) are placed; each one raises the galaxy density of the cells around it. As built: about 0.0016 galaxies per cell on average, 99.8% of cells empty, and about 22% of random starts land in supercluster regions (may need tuning down).

**Level of detail by scale.** As built, four layers crossfade by distance: groups and clusters as soft glows out to ~200 million ly; one sprite per galaxy within ~12 million ly; a glow cloud of ~24,000 blobs showing arms and bulge for up to 3 galaxies within 20 radii; and individual stars in 20 ly chunks around the ship while inside a galaxy (faded out above ~900 ly/s). Star positions are recomputed relative to the ship in float64 every frame, so they stay steady at AU scale.

**Earth.** Earth sits at a fixed position (the origin of the universe coordinates). Near it, swap procedural content for real data: the Local Group, Andromeda, the Magellanic Clouds and the Virgo Cluster.

## Milestones

Nine milestones, each ending in something you can run and judge by feel; the hardware joins at M4 so the sim is never blocked on parts.

1. **M0: Skeleton.** Vite project, Three.js scene, black screen with a few test points, frame loop calling an empty `sim.update`. Done when it runs full screen in Chrome.
2. **M1: Ship and controls.** Keyboard: arrows = pitch and yaw, space = the button. Holding the button accelerates along a logistic curve (slow start, fast middle, leveling off at a cap). The cap depends on where you are: solar system, star clump, galaxy, galaxy cluster, supercluster (and the void between). Entering a smaller region lowers the cap smoothly, so arriving somewhere feels like braking. Starting caps to tune: about 1 AU/s, 10 ly/s, 1,000 ly/s, 100,000 ly/s and 10 million ly/s. Done when flying feels smooth.
3. **M2: Coordinates and the universe.** Cell + offset positions, floating origin, seeded cell generation, uniform random start. Galaxies appear as you fly. Done when you can fly in one direction for a minute and the universe stays consistent if you turn around.
4. **M3: HUD.** Elapsed time, distance traveled, current scale ("you are looking at 10 million light years"). Distance to Earth is never shown.
5. **M4: Hardware.** `input/serial.js` reads the Pico's lines and outputs the same `controls` object as the keyboard. Two AS5600 knobs and a button to move forward/press dialogue lines. Each knob's change in angle maps directly to pitch or yaw. There is no separate momentum setting: the knob's own physical coasting carries the turn. Wire one AS5600 to I2C0 (GP4/GP5) and the other to I2C1 (GP2/GP3). Button timing (proposed, settle here): hold longer than 250 ms = accelerate; a short tap = close a memory or dialogue; a double tap = open the memory log. After a memory closes, ignore the button until it is released, so a press-then-hold can't close a memory and start thrust in one motion. Done when the knob feels better than the keyboard.
6. **M5: Director and first two events.** An event interface: `spawn(shipPos, heading)`, `update(dt)`, `isTriggered()`, `memoryId`. Start with the supernova (flash + camera shake) and the pulsar (sweeping beam + ticking). The director places events in and around the galaxies the player explores, so memories are earned by exploring, not handed out on a timer.
7. **M6: Memories.** `memories.json` with id, title and an image or video file. A full-screen overlay plays the memory and pauses the ship; a button press ends it. Each memory unlocks once. After all are found, events keep happening but memories stop. Unlocked memories go into a memory log the player can reopen. Then add the black hole with a lensing shader, colliding galaxies, the quasar and the rogue planet.
8. **M7: Session flow.** Intro screen with the rules and no time limit or forced ending. Detect a collision with Earth (the player still has to cross the solar system to hit it) using a swept test: check the segment the ship traveled this frame against Earth's sphere in the local km frame, because at 1 AU/s the ship moves about 2.5 million km per frame and a per-frame position check would skip right past. Then show the short closing exchange ("That was too cruel, right?" / "No, eternity is much harsher."). Add an idle reset so the next visitor starts fresh.
9. **M8: Polish.** Sound, bloom, tuning event density with real playtesters so a 15 to 25 minute visit feels full, the Laniakea route and real nearby galaxies, and the thermal printer receipt if you still want it.

## First week

Aim to finish M0 through M2: by the end of the week you should be flying through a seeded universe with the keyboard.

- [x] `npm create vite@latest` (vanilla JS), then `npm install three`
- [x] Create the folder structure above with empty modules that export stubs
- [x] Frame loop in `main.js` using `requestAnimationFrame`, passing `dt` in seconds
- [x] `input/keyboard.js` producing `{ pitch, yaw, button }`
- [x] `sim/ship.js`: heading from pitch and yaw, logistic speed with tier caps, position update
- [x] `sim/rng.js`: mulberry32 + a cell hash function
- [x] `sim/coords.js` from the snippet above, with a quick test that `normalize` and `delta` round-trip
- [x] `sim/universe.js`: `getCell(cx, cy, cz)` returning a cached list of galaxies, mostly empty, plus a stub regionAt(pos) returning void / supercluster / cluster / galaxy / star clump / solar system, which ship.js uses to pick its speed cap
- [x] `render/starfield.js`: one `THREE.Points` buffer rebuilt when the set of visible cells changes
- [x] Random start using the cube-root formula, logged to the console so you can see how far from Earth you land

Keep the Pico on the side and test the AS5600 firmware alone; it plugs in at M4.

Still to tune by feel (M1/M2 leftovers): speed caps and acceleration (constants at the top of `sim/ship.js` and `CAPS` in `sim/universe.js`); brightness (galaxy cores still saturate to white from inside); supercluster share of the volume. Earth is not special yet: the origin is still procedural until real local data arrives (M7/M8).

## Running it

- `npm install` once, then `npm run dev` and open the printed URL (http://localhost:5173 by default) in Chrome. `npm test` runs the sim tests (Node, no browser).
- Keys: arrows = pitch/yaw (Shift = fine), Space = the button (hold to accelerate). Dev keys: G = jump to a nearby galaxy, I = jump inside one, C = jump to a rich cluster, N = new random start, F = fullscreen, backquote = hide the debug readout.
- URL options: `?start=<n>` repeats a start, `?seed=<n>` picks a different universe, `?jump=galaxy|inside|cluster` opens at a test viewpoint, `?debug=0` hides the readout.
- The distance from Earth of each start is logged to the browser console only; nothing on screen shows it.

## Open decisions

None of these block the first week, but each should be settled by the milestone noted.

- **Who is the player?** A named character whose memories build one life, or a vague "you" visitors fill in themselves. Needed before writing `memories.json` in M6. Answer: no named player.
- **What the knob controls.** One knob for heading plus a button for scale, or two knobs (heading and zoom). Needed by M4. Answer: Two knobs for pitch and yaw, a button for going forward and pressing when interaction is needed (end dialogue)
- **Is distance to Earth ever shown?** Showing it makes the scale legible; hiding it keeps the dread. Needed by M3. Answer: No distance to earth is ever shown.
- **Event density.** Visits are open-ended, so how many events per galaxy make 15 to 25 minutes of exploring feel full? Tune with playtesters in M8. Answer: A galaxy can have all the events.
- **How is the memory log opened?** With only two knobs and one button, it needs a gesture that can't be confused with accelerating, proposed: a double tap (see M4). Settle by M4 together with the other button timings.
- **Memory media.** Each memory becomes an image or video instead of text. Plan the look, length and how they're made later. Needed by M6.
- **What do memory clues say?** Memories are fixed images/video but every start is random, so a clue can describe Earth's surroundings but can't point the way unless it is generated live (or an event like the Laniakea flow shows an in-sim direction). Needed by M6.
- **Should a lucky visitor be able to make it home?** At the 10 million ly/s cap an average start is about an hour from Earth even flying straight there; only starts within ~15 billion ly (~3%) could make it in 25 minutes. Raise the void cap or accept it. Needed by M7.
- **What makes Earth recognizable?** If procedural stars also get planets, visitors can be fooled; if not, the solar system is obvious once found. Needed by M7.
- **Installation setup.** Display (monitor or projector, resolution), idle reset timeout, and Chrome kiosk mode with Web Serial auto-reconnect (`navigator.serial.getPorts()` after a one-time permission). Needed by M7.
- **Thermal printer receipt.** Mentioned in M8 but not described: what would it print? Needed by M8.
- **Precision near Earth.** Cell offsets are only accurate to about 2,000 km, which is too coarse for a collision with Earth (about 12,700 km across). Inside Earth's cell, switch to a local solar-system frame in kilometers and use the swept collision test from M7. Needed by M7.
