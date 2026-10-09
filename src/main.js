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

// ── Inner sphere (provides white yang half) ────────────────────────────────
const innerSphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.97, 64, 64),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
scene.add(innerSphere);

// ── Yin-yang classification ────────────────────────────────────────────────
//
// Geometry (unit circle, vertical S-curve, yin = dark):
//
//   Top half (py >= 0):
//     • Inside  inner circle at (0, +0.5) r=0.5  → YANG (white fish head)
//     • Outside inner circle AND px > 0           → YIN  (dark right sliver)
//     • Outside inner circle AND px <= 0          → YANG (white left wing)
//
//   Bottom half (py < 0):
//     • Inside  inner circle at (0, -0.5) r=0.5  → YIN  (dark fish head)
//     • Outside inner circle AND px > 0           → YIN  (dark right wing)
//     • Outside inner circle AND px <= 0          → YANG (white left sliver)
//
//   Seed dots (override before region test):
//     • Small circle at (0, +0.5) r=0.18  → YIN  (dark seed in white head)
//     • Small circle at (0, -0.5) r=0.18  → YANG (light seed in dark head)

function isYin(px, py) {
  if (px * px + py * py > 1.0) return false;

  const seedR2 = 0.0324; // 0.18²

  if (px * px + (py - 0.5) * (py - 0.5) < seedR2) return true;  // dark seed
  if (px * px + (py + 0.5) * (py + 0.5) < seedR2) return false; // light seed

  if (py >= 0) {
    if (px * px + (py - 0.5) * (py - 0.5) < 0.25) return false; // inside top head = yang
    return px > 0; // right outer wing = yin
  } else {
    if (px * px + (py + 0.5) * (py + 0.5) < 0.25) return true;  // inside bot head = yin
    return px > 0; // right outer wing = yin
  }
}

// ── Fibonacci sphere sampling ──────────────────────────────────────────────
// Uniform distribution on unit sphere surface; filter to yin points only.
function generateParticles(numCandidates) {
  const homes = [];
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle ≈ 2.3999 rad
  for (let i = 0; i < numCandidates; i++) {
    const y  = 1 - (i / (numCandidates - 1)) * 2;
    const r  = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    const x  = Math.cos(th) * r;
    const z  = Math.sin(th) * r;
    if (isYin(x, y)) homes.push(x, y, z);
  }
  return new Float32Array(homes);
}

const posArray = generateParticles(120000);

// ── Yang texture dots (sparse, small, light gray on white surface) ─────────
function generateYangParticles(numCandidates) {
  const pts = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < numCandidates; i++) {
    const y  = 1 - (i / (numCandidates - 1)) * 2;
    const r  = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    const x  = Math.cos(th) * r;
    const z  = Math.sin(th) * r;
    if (!isYin(x, y)) pts.push(x, y, z);
  }
  return new Float32Array(pts);
}

const yangArray = generateYangParticles(1800);

// ── Shadow particles (fading density band just outside yin boundary) ───────
// For each yang candidate, binary-search toward yin in 8 directions to find
// the nearest yin boundary. Density falls off quadratically with distance.
function nearestYinDist(px, py, maxDist) {
  let best = maxDist + 1;
  const dirs = 8;
  for (let i = 0; i < dirs; i++) {
    const angle = (i / dirs) * Math.PI * 2;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    if (!isYin(px + dx * maxDist, py + dy * maxDist)) continue;
    let lo = 0, hi = maxDist;
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) / 2;
      if (isYin(px + dx * mid, py + dy * mid)) hi = mid;
      else lo = mid;
    }
    best = Math.min(best, (lo + hi) / 2);
  }
  return best;
}

function generateShadowParticles(numCandidates, bandWidth) {
  const pts = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < numCandidates; i++) {
    const y  = 1 - (i / (numCandidates - 1)) * 2;
    const r  = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    const x  = Math.cos(th) * r;
    const z  = Math.sin(th) * r;
    if (isYin(x, y)) continue;
    const d = nearestYinDist(x, y, bandWidth);
    if (d > bandWidth) continue;
    const t = 1 - d / bandWidth; // 1 at boundary edge, 0 at bandWidth
    if (Math.random() < t * t * t * t) pts.push(x, y, z);
  }
  return new Float32Array(pts);
}

const shadowArray = generateShadowParticles(80000, 0.2);

// ── Circular sprite texture ────────────────────────────────────────────────
function makeCircleTexture(r, g, b) {
  const sz  = 64;
  const c   = document.createElement('canvas');
  c.width   = sz; c.height = sz;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  grad.addColorStop(0,   `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.5, `rgba(${r},${g},${b},0.9)`);
  grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sz, sz);
  return new THREE.CanvasTexture(c);
}

// ── Yin particle system (black, 1.0px) ────────────────────────────────────
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

const mat = new THREE.PointsMaterial({
  size:            1.0 * window.devicePixelRatio,
  sizeAttenuation: false,
  map:             makeCircleTexture(0, 0, 0),
  color:           0x000000,
  transparent:     true,
  depthWrite:      false,
  alphaTest:       0.01,
});

// ── Yang texture particle system (light gray, 1.2px) ─────────────────────
const yangGeo = new THREE.BufferGeometry();
yangGeo.setAttribute('position', new THREE.BufferAttribute(yangArray, 3));

const yangMat = new THREE.PointsMaterial({
  size:            1.2 * window.devicePixelRatio,
  sizeAttenuation: false,
  map:             makeCircleTexture(160, 160, 160),
  color:           0xa0a0a0,
  transparent:     true,
  depthWrite:      false,
  alphaTest:       0.01,
});

// ── Shadow particle system (black, 1.0px, fading band at yin edge) ────────
const shadowGeo = new THREE.BufferGeometry();
shadowGeo.setAttribute('position', new THREE.BufferAttribute(shadowArray, 3));

const shadowMat = new THREE.PointsMaterial({
  size:            1.0 * window.devicePixelRatio,
  sizeAttenuation: false,
  map:             makeCircleTexture(0, 0, 0),
  color:           0x000000,
  transparent:     true,
  depthWrite:      false,
  alphaTest:       0.01,
});

const points = new THREE.Points(geo, mat);
const yangPoints = new THREE.Points(yangGeo, yangMat);
const shadowPoints = new THREE.Points(shadowGeo, shadowMat);
const group = new THREE.Group();
group.add(innerSphere);
group.add(yangPoints);
group.add(shadowPoints);
group.add(points);
scene.add(group);

// ── Drag-to-rotate ─────────────────────────────────────────────────────────
let dragging = false, lastX = null, lastY = null;

renderer.domElement.addEventListener('mousedown', e => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener('mouseup', () => { dragging = false; });

// ── Auto-spin with hover-to-pause (raycast against sphere geometry) ────────
const SPIN_SPEED = 0.004;
let rotSpeed = SPIN_SPEED;
let hovering = false;

// Smootherstep: zero-derivative at both ends — gentle start, gentle finish
function smootherstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('mousemove', e => {
  // Update hover state via raycast against the inner sphere
  mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  hovering = raycaster.intersectObject(innerSphere).length > 0;

  // Drag rotation
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  group.rotation.y += dx * 0.01;
  group.rotation.x += dy * 0.01;
});

const clock = new THREE.Clock();
let hoverTime = 0;
let speedAtHoverStart = SPIN_SPEED;
let wasHovering = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (hovering) {
    if (!wasHovering) {
      speedAtHoverStart = rotSpeed;  // capture speed at the moment of hover
      hoverTime = 0;
    }
    hoverTime += dt;
    const t = Math.min(hoverTime / 3.0, 1.0);
    rotSpeed = speedAtHoverStart * (1 - smootherstep(t));
  } else {
    hoverTime = 0;
    rotSpeed += (SPIN_SPEED - rotSpeed) * 0.025;  // ease back up to full speed
  }

  wasHovering = hovering;
  group.rotation.z -= rotSpeed;
  renderer.render(scene, camera);
}

animate();
