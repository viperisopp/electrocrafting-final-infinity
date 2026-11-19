// Development readout (toggle with the backquote key). Not the visitor HUD, which comes in M3.
// Like the HUD, it never shows the distance to Earth; that goes to the console only.

import { LY_PER_AU } from '../sim/coords.js';

export function formatSpeed(lyps) {
  if (lyps === 0) return '0';
  if (lyps < 0.01) return (lyps / LY_PER_AU).toPrecision(3) + ' AU/s';
  if (lyps < 1e3) return lyps.toPrecision(3) + ' ly/s';
  if (lyps < 1e6) return (lyps / 1e3).toPrecision(3) + ' thousand ly/s';
  return (lyps / 1e6).toPrecision(3) + ' million ly/s';
}

export function createDebug(parent = document.body) {
  const el = document.createElement('pre');
  el.id = 'debug';
  parent.appendChild(el);
  let visible = true;
  let fps = 60;
  return {
    toggle() {
      visible = !visible;
      el.style.display = visible ? '' : 'none';
    },
    update(state, stats, dt) {
      fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
      if (!visible) return;
      const s = state.ship;
      const r = state.region;
      el.textContent = [
        `region    ${r.name}`,
        `speed     ${formatSpeed(s.speed)}`,
        `cap       ${formatSpeed(s.cap)}`,
        `throttle  ${(s.throttle * 100).toFixed(0)}%`,
        `web       ${r.web.toFixed(2)}`,
        `cell      ${s.pos.cx}, ${s.pos.cy}, ${s.pos.cz}`,
        `drawn     ${stats.clusters} groups, ${stats.galaxies} galaxies, ${stats.clouds} close, ${stats.stars} stars`,
        `fps       ${fps.toFixed(0)}`,
        ``,
        `arrows turn (shift = fine)   space accelerate`,
        `G galaxy   I inside   C cluster   N new start   F fullscreen   \` hide`,
      ].join('\n');
    },
  };
}
