// Three.js setup with a floating origin: the camera never moves from (0, 0, 0);
// everything else is placed relative to the ship each frame.

import * as THREE from 'three';
import { createStarfield } from './starfield.js';

export function createRenderer(canvas, universe) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);

  // Points are additive with no depth test, so a huge near/far range costs nothing.
  const camera = new THREE.PerspectiveCamera(70, 1, 1e-9, 1e12);
  const scene = new THREE.Scene();
  const starfield = createStarfield(scene, universe);

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const pxPerRad = () => renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));

  return {
    starfield,
    draw(state) {
      const q = state.ship.q;
      camera.quaternion.set(q[0], q[1], q[2], q[3]);
      starfield.update(state, pxPerRad());
      renderer.render(scene, camera);
    },
  };
}
