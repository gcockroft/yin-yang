import * as THREE from 'three';

// ── Scene ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 3.5;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);
});

// ── Inner sphere ────────────────────────────────────────────────────────────
const innerSphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.97, 64, 64),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);

const group = new THREE.Group();
group.add(innerSphere);
scene.add(group);

// ── Yin-yang classification ────────────────────────────────────────────────
function isYin(px, py) {
  if (px * px + py * py > 1.0) return false;
  const seedR2 = 0.0324;
  if (px * px + (py - 0.5) * (py - 0.5) < seedR2) return true;
  if (px * px + (py + 0.5) * (py + 0.5) < seedR2) return false;
  if (py >= 0) {
    if (px * px + (py - 0.5) * (py - 0.5) < 0.25) return false;
    return px > 0;
  } else {
    if (px * px + (py + 0.5) * (py + 0.5) < 0.25) return true;
    return px > 0;
  }
}

// ── Fibonacci sphere sampling ──────────────────────────────────────────────
function generateParticles(numCandidates) {
  const arr = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < numCandidates; i++) {
    const y = 1 - (i / (numCandidates - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    if (isYin(x, y)) arr.push(x, y, z);
  }
  return new Float32Array(arr);
}

function generateYangParticles(numCandidates) {
  const arr = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < numCandidates; i++) {
    const y = 1 - (i / (numCandidates - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    if (!isYin(x, y)) arr.push(x, y, z);
  }
  return new Float32Array(arr);
}

function nearestYinDist(px, py, maxDist) {
  let best = maxDist + 1;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    if (!isYin(px + dx * maxDist, py + dy * maxDist)) continue;
    let lo = 0, hi = maxDist;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      if (isYin(px + dx * mid, py + dy * mid)) hi = mid; else lo = mid;
    }
    best = Math.min(best, (lo + hi) / 2);
  }
  return best;
}

function generateShadowParticles(numCandidates, bandWidth) {
  const arr = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < numCandidates; i++) {
    const y = 1 - (i / (numCandidates - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    if (isYin(x, y)) continue;
    const d = nearestYinDist(x, y, bandWidth);
    if (d > bandWidth) continue;
    const t = 1 - d / bandWidth;
    if (Math.random() < t * t * t * t) arr.push(x, y, z);
  }
  return new Float32Array(arr);
}

// ── Generate home positions (fixed in yin-yang frame) ─────────────────────
const yinHome    = generateParticles(120000);
const yangHome   = generateYangParticles(1800);
const shadowHome = generateShadowParticles(80000, 0.2);

// Live positions start equal to homes; velocities start at zero
const yinPos    = new Float32Array(yinHome);
const yangPos   = new Float32Array(yangHome);
const shadowPos = new Float32Array(shadowHome);
const yinVel    = new Float32Array(yinHome.length);
const yangVel   = new Float32Array(yangHome.length);
const shadowVel = new Float32Array(shadowHome.length);

// ── Sprite texture ─────────────────────────────────────────────────────────
function makeCircleTexture(r, g, b) {
  const sz = 64;
  const c = document.createElement('canvas');
  c.width = sz; c.height = sz;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  grad.addColorStop(0,   `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.5, `rgba(${r},${g},${b},0.9)`);
  grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sz, sz);
  return new THREE.CanvasTexture(c);
}

// ── BufferGeometry for each system ─────────────────────────────────────────
const yinGeo = new THREE.BufferGeometry();
yinGeo.setAttribute('position', new THREE.BufferAttribute(yinPos, 3));

const yangGeo = new THREE.BufferGeometry();
yangGeo.setAttribute('position', new THREE.BufferAttribute(yangPos, 3));

const shadowGeo = new THREE.BufferGeometry();
shadowGeo.setAttribute('position', new THREE.BufferAttribute(shadowPos, 3));

// ── Materials ──────────────────────────────────────────────────────────────
const yinMat = new THREE.PointsMaterial({
  size: 1.0 * window.devicePixelRatio, sizeAttenuation: false,
  map: makeCircleTexture(0, 0, 0), color: 0x000000,
  transparent: true, depthWrite: false, alphaTest: 0.01,
});
const yangMat = new THREE.PointsMaterial({
  size: 1.2 * window.devicePixelRatio, sizeAttenuation: false,
  map: makeCircleTexture(160, 160, 160), color: 0xa0a0a0,
  transparent: true, depthWrite: false, alphaTest: 0.01,
});
const shadowMat = new THREE.PointsMaterial({
  size: 1.0 * window.devicePixelRatio, sizeAttenuation: false,
  map: makeCircleTexture(0, 0, 0), color: 0x000000,
  transparent: true, depthWrite: false, alphaTest: 0.01,
});

// ── Add to group ───────────────────────────────────────────────────────────
group.add(new THREE.Points(yangGeo,   yangMat));
group.add(new THREE.Points(shadowGeo, shadowMat));
group.add(new THREE.Points(yinGeo,    yinMat));

// ── Systems array (used by physics loop) ──────────────────────────────────
const systems = [
  { pos: yinPos,    home: yinHome,    vel: yinVel,    geo: yinGeo    },
  { pos: yangPos,   home: yangHome,   vel: yangVel,   geo: yangGeo   },
  { pos: shadowPos, home: shadowHome, vel: shadowVel, geo: shadowGeo },
];

// ── Physics constants ──────────────────────────────────────────────────────
const K_SPRING   = 0.012;
const DAMPING    = 0.88;
const SPIN_SPEED = 0.004;

// ── Physics step ───────────────────────────────────────────────────────────
function physicsStep(sys, theta) {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  for (const { pos, home, vel, geo } of sys) {
    const N = pos.length / 3;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      // Rotate home around Z by theta
      const hx = home[i3]     * cosT - home[i3 + 1] * sinT;
      const hy = home[i3]     * sinT + home[i3 + 1] * cosT;
      const hz = home[i3 + 2];
      // Spring toward rotated home
      vel[i3]     += K_SPRING * (hx - pos[i3]);
      vel[i3 + 1] += K_SPRING * (hy - pos[i3 + 1]);
      vel[i3 + 2] += K_SPRING * (hz - pos[i3 + 2]);
      // Tangent project: remove radial component from vel
      const radial = vel[i3] * pos[i3] + vel[i3 + 1] * pos[i3 + 1] + vel[i3 + 2] * pos[i3 + 2];
      vel[i3]     -= radial * pos[i3];
      vel[i3 + 1] -= radial * pos[i3 + 1];
      vel[i3 + 2] -= radial * pos[i3 + 2];
      // Integrate
      pos[i3]     += vel[i3];
      pos[i3 + 1] += vel[i3 + 1];
      pos[i3 + 2] += vel[i3 + 2];
      // Surface project (normalize; guard against zero-length)
      const len = Math.sqrt(pos[i3] * pos[i3] + pos[i3 + 1] * pos[i3 + 1] + pos[i3 + 2] * pos[i3 + 2]);
      if (len < 1e-6) continue;
      pos[i3]     /= len;
      pos[i3 + 1] /= len;
      pos[i3 + 2] /= len;
      // Damping
      vel[i3]     *= DAMPING;
      vel[i3 + 1] *= DAMPING;
      vel[i3 + 2] *= DAMPING;
    }
    geo.attributes.position.needsUpdate = true;
  }
}

// ── Animation loop (Task 4 replaces theta accumulation with hover logic) ───
let theta = 0;

function animate() {
  requestAnimationFrame(animate);
  theta += SPIN_SPEED;
  physicsStep(systems, theta);
  renderer.render(scene, camera);
}

animate();
