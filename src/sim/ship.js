// Heading from pitch/yaw, logistic throttle, speed = throttle * regional cap.

import { translate } from './coords.js';
import { qMul, qAxisAngle, qNormalize, qRotate } from './vec.js';

const T0 = 0.02; // throttle the instant the button goes down
const ACCEL = 1.3; // logistic growth rate (1/s): slow start, fast middle, levels off at the cap
const DECAY = 1.2; // how fast throttle bleeds off after release (1/s)
const CAP_RISE = 1.5; // how fast the cap may grow when leaving a region (1/s, in log space)

export function createShip(pos, q = [0, 0, 0, 1]) {
  return { pos, q, throttle: 0, cap: 0, speed: 0 };
}

export function forward(ship) {
  return qRotate(ship.q, [0, 0, -1]);
}

// controls: { pitch, yaw } are angle changes this frame in radians; button is held state.
export function updateShip(ship, dt, controls, regionCap) {
  if (controls.yaw) ship.q = qMul(ship.q, qAxisAngle(0, 1, 0, -controls.yaw));
  if (controls.pitch) ship.q = qMul(ship.q, qAxisAngle(1, 0, 0, controls.pitch));
  ship.q = qNormalize(ship.q);

  if (controls.button) {
    if (ship.throttle < T0) ship.throttle = T0;
    ship.throttle += ACCEL * ship.throttle * (1 - ship.throttle) * dt;
  } else {
    ship.throttle *= Math.exp(-DECAY * dt);
    if (ship.throttle < 1e-4) ship.throttle = 0;
  }

  // Braking into a smaller region is immediate; speeding up on the way out is eased.
  if (!ship.cap || regionCap < ship.cap) ship.cap = regionCap;
  else ship.cap = Math.exp(Math.log(ship.cap) + (Math.log(regionCap) - Math.log(ship.cap)) * (1 - Math.exp(-CAP_RISE * dt)));

  ship.speed = ship.throttle * ship.cap;
  const f = forward(ship);
  const step = ship.speed * dt;
  translate(ship.pos, f[0] * step, f[1] * step, f[2] * step);
}
