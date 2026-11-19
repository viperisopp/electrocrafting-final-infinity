// A batch of glowing points anchored at one universe position.
//
// Each point has a physical radius (ly) and a surface brightness. The shader works out its angular
// size: resolved objects keep a constant brightness, unresolved ones fade as 1/d², so stars,
// galaxies and clusters all behave consistently at every scale.
//
// Precision: the camera sits at the origin. Non-cpu layers store float32 offsets from their anchor and
// move the whole Points object by delta(ship, anchor). The star layer (cpu: true) instead recomputes
// every point relative to the ship in float64 each frame, so stars stay rock steady at AU scales.

import * as THREE from 'three';
import { delta, clone } from '../sim/coords.js';

const vertexShader = /* glsl */ `
  attribute vec3 acolor;
  attribute float psize;
  attribute float sb;
  uniform float uPxPerRad, uGain, uMinPx, uMaxPx, uNearA, uNearB, uFarA, uFarB, uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(length(mv.xyz), 1e-20);
    float px = 2.0 * psize / d * uPxPerRad;
    float I = uGain * sb * min(1.0, (px * px) / (uMinPx * uMinPx));
    float size = clamp(px, uMinPx, uMaxPx);
    if (px < uMinPx && I > 1.0) size = min(size * (1.0 + 0.45 * log(I)), uMaxPx);
    float a = 1.0 - exp(-I);
    if (uNearB > 0.0) a *= smoothstep(uNearA * psize, uNearB * psize, d);
    if (uFarB > 0.0) a *= 1.0 - smoothstep(uFarA, uFarB, d);
    a *= uOpacity;
    vColor = acolor;
    vAlpha = a;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = a < 0.003 ? 0.0 : size;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float f = exp(-r2 * 4.0);
    gl_FragColor = vec4(vColor * vAlpha * f, 1.0);
  }
`;

export class PointLayer {
  constructor(scene, opts) {
    const cap = opts.capacity;
    this.capacity = cap;
    this.cpu = !!opts.cpu;
    this.count = 0;
    this.anchor = null;
    this.positions = new Float32Array(cap * 3);
    this.colors = new Float32Array(cap * 3);
    this.sizes = new Float32Array(cap);
    this.sbs = new Float32Array(cap);
    this.local = this.cpu ? new Float64Array(cap * 3) : null;

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage);
    this.sbAttr = new THREE.BufferAttribute(this.sbs, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('acolor', this.colAttr);
    geo.setAttribute('psize', this.sizeAttr);
    geo.setAttribute('sb', this.sbAttr);
    geo.setDrawRange(0, 0);
    this.geometry = geo;

    const u = (v) => ({ value: v });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPxPerRad: u(1000),
        uGain: u(opts.gain ?? 1),
        uMinPx: u(opts.minPx ?? 1.5),
        uMaxPx: u(opts.maxPx ?? 256),
        uNearA: u(opts.nearA ?? 0),
        uNearB: u(opts.nearB ?? 0),
        uFarA: u(opts.farA ?? 0),
        uFarB: u(opts.farB ?? 0),
        uOpacity: u(opts.opacity ?? 1),
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  get opacity() {
    return this.material.uniforms.uOpacity.value;
  }
  set opacity(v) {
    this.material.uniforms.uOpacity.value = v;
  }
  setUniform(name, v) {
    this.material.uniforms[name].value = v;
  }

  begin(anchor) {
    this.anchor = clone(anchor);
    this.count = 0;
  }

  // x, y, z: light years from the anchor
  push(x, y, z, r, g, b, size, sb) {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    const buf = this.cpu ? this.local : this.positions;
    buf[i * 3] = x;
    buf[i * 3 + 1] = y;
    buf[i * 3 + 2] = z;
    this.colors[i * 3] = r;
    this.colors[i * 3 + 1] = g;
    this.colors[i * 3 + 2] = b;
    this.sizes[i] = size;
    this.sbs[i] = sb;
    return true;
  }

  end() {
    this.geometry.setDrawRange(0, this.count);
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.sbAttr.needsUpdate = true;
    this.posAttr.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  update(shipPos, pxPerRad) {
    this.material.uniforms.uPxPerRad.value = pxPerRad;
    this.points.visible = this.count > 0 && this.opacity > 0.001 && !!this.anchor;
    if (!this.points.visible) return;
    const d = delta(shipPos, this.anchor);
    if (this.cpu) {
      const L = this.local;
      const P = this.positions;
      for (let i = 0, n = this.count * 3; i < n; i += 3) {
        P[i] = L[i] + d.x;
        P[i + 1] = L[i + 1] + d.y;
        P[i + 2] = L[i + 2] + d.z;
      }
      this.posAttr.needsUpdate = true;
      this.points.position.set(0, 0, 0);
    } else {
      this.points.position.set(d.x, d.y, d.z);
    }
  }
}
