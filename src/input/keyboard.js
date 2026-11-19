// Development fallback for the knobs: arrows = pitch and yaw, space = the button.
// Produces the same controls object the Pico will: { pitch, yaw, button } plus dev actions.

const DEV_KEYS = {
  KeyG: 'jumpGalaxy',
  KeyI: 'jumpInside',
  KeyC: 'jumpCluster',
  KeyN: 'newStart',
  KeyF: 'fullscreen',
  Backquote: 'toggleDebug',
};

export function createKeyboard(target = window, { turnRate = 0.8 } = {}) {
  const down = new Set();
  const dev = [];
  target.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    down.add(e.code);
    if (!e.repeat && DEV_KEYS[e.code]) dev.push(DEV_KEYS[e.code]);
  });
  target.addEventListener('keyup', (e) => down.delete(e.code));
  target.addEventListener('blur', () => down.clear());

  return {
    read(dt) {
      const rate = turnRate * (down.has('ShiftLeft') || down.has('ShiftRight') ? 0.25 : 1) * dt;
      return {
        pitch: ((down.has('ArrowUp') ? 1 : 0) - (down.has('ArrowDown') ? 1 : 0)) * rate,
        yaw: ((down.has('ArrowRight') ? 1 : 0) - (down.has('ArrowLeft') ? 1 : 0)) * rate,
        button: down.has('Space'),
        dev: dev.splice(0),
      };
    },
  };
}
