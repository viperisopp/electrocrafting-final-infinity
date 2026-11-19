// Wires everything together and runs the frame loop:
// input -> controls -> sim.update(dt, controls) -> renderer reads sim.state -> UI.
//
// URL options: ?seed=<world seed>  ?start=<start seed>  ?debug=0  ?jump=galaxy|inside|cluster

import './style.css';
import { createSim, distanceFromEarthLy } from './sim/sim.js';
import { createKeyboard } from './input/keyboard.js';
import { createRenderer } from './render/scene.js';
import { createDebug } from './ui/debug.js';

const params = new URLSearchParams(location.search);
const worldSeed = Number(params.get('seed')) || 20261119; // the universe is the same for every visitor
const startSeed = Number(params.get('start')) || (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0);

const sim = createSim({ worldSeed, startSeed });
const keyboard = createKeyboard(window);
const view = createRenderer(document.getElementById('view'), sim.universe);
const debug = createDebug();
if (params.get('debug') === '0') debug.toggle();

function logStart(label) {
  const d = distanceFromEarthLy(sim.state.ship.pos);
  console.log(`[start] ${label}: ${(d / 1e9).toFixed(3)} billion ly from Earth (start seed ${startSeed}, world seed ${worldSeed})`);
}
logStart('random start');

function handleDev(action) {
  if (action === 'toggleDebug') return debug.toggle();
  if (action === 'fullscreen') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
    return;
  }
  let result;
  if (action === 'newStart') {
    sim.newRandomStart();
    logStart('new random start');
  } else if (action === 'jumpGalaxy' || action === 'jumpInside') {
    result = sim.devJumpToGalaxy(action === 'jumpInside');
    console.log('[dev] jump to galaxy', result ? `${result.type}, radius ${Math.round(result.R)} ly` : '(none nearby)');
  } else if (action === 'jumpCluster') {
    result = sim.devJumpToCluster();
    console.log('[dev] jump to cluster', result ? `${result.N} galaxies, radius ${(result.R / 1e6).toFixed(1)} Mly` : '(none nearby)');
  }
  view.starfield.reset();
}

// ?jump=galaxy|inside|cluster starts at a test viewpoint (development only).
const jump = { galaxy: 'jumpGalaxy', inside: 'jumpInside', cluster: 'jumpCluster' }[params.get('jump')];
if (jump) handleDev(jump);

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const controls = keyboard.read(dt);
  for (const a of controls.dev) handleDev(a);
  sim.update(dt, controls);
  view.draw(sim.state);
  debug.update(sim.state, view.starfield.stats, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy from the console while tuning.
window.sim = sim;
