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

// Back hemisphere (z < 0) is the front pattern flipped top-to-bottom, i.e.
// the front turned 180° about the X axis. Seen from behind it is a proper
// (non-mirrored) yin-yang, and because the outer rim of the 2D symbol is
// symmetric top-to-bottom, the two halves meet seamlessly at z = 0: each
// fish's tail runs over the rim and becomes its head on the back.
function isYinSphere(px, py, pz) {
  return isYin(px, pz < 0 ? -py : py);
}

// ── Full-sphere Fibonacci grid ─────────────────────────────────────────────
function makeFibGrid(count) {
  const arr = new Float32Array(count * 3);
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y  = 1 - (i / (count - 1)) * 2;
    const r  = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    arr[i * 3]     = Math.cos(th) * r;
    arr[i * 3 + 1] = y;
    arr[i * 3 + 2] = Math.sin(th) * r;
  }
  return arr;
}

// ── Two grids covering the whole sphere ───────────────────────────────────
//
// Dense grid  — one home per particle, tight spacing.
// Sparse grid — ~28× fewer points, wide spacing.
//
// Each particle has both a dense home and a sparse home.
// The sparse home is assigned by index correspondence (same spiral,
// different density), so the two homes are geographically close —
// the particle never has to cross the sphere when switching states.
//
// The YIN/YANG FIELD rotates (theta).  Each frame, the particle's
// world position is de-rotated into the body frame and classified.
// Inside the fish → spring toward dense home (cluster together → dark).
// Outside the fish → spring toward sparse home (spread apart → light).
// Absorption/release appears at the boundary as particles physically
// flow between the two states.
//
const N = 50000;   // total particles = size of dense grid
const M = 1800;    // size of sparse grid  (~28 particles per sparse home)

const denseGrid  = makeFibGrid(N);
const sparseGrid = makeFibGrid(M);

// Index-based sparse assignment: particle i → sparseGrid[round(i * M/N)]
const sparseAssign = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  const j = Math.min(Math.round(i * M / N), M - 1) * 3;
  sparseAssign[i * 3]     = sparseGrid[j];
  sparseAssign[i * 3 + 1] = sparseGrid[j + 1];
  sparseAssign[i * 3 + 2] = sparseGrid[j + 2];
}

// ── Initial positions: correct home for theta = 0 ─────────────────────────
const pos = new Float32Array(N * 3);
const vel = new Float32Array(N * 3);  // zero-initialised

for (let i = 0; i < N; i++) {
  const i3 = i * 3;
  if (isYinSphere(denseGrid[i3], denseGrid[i3 + 1], denseGrid[i3 + 2])) {
    pos[i3]     = denseGrid[i3];
    pos[i3 + 1] = denseGrid[i3 + 1];
    pos[i3 + 2] = denseGrid[i3 + 2];
  } else {
    pos[i3]     = sparseAssign[i3];
    pos[i3 + 1] = sparseAssign[i3 + 1];
    pos[i3 + 2] = sparseAssign[i3 + 2];
  }
}

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

// ── Geometry + material ────────────────────────────────────────────────────
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

group.add(new THREE.Points(geo, new THREE.PointsMaterial({
  size: 1.0 * window.devicePixelRatio,
  sizeAttenuation: false,
  map: makeCircleTexture(0, 0, 0),
  color: 0x000000,
  transparent: true,
  depthWrite: false,
  alphaTest: 0.01,
})));

// ── Physics constants ──────────────────────────────────────────────────────
const K_SPRING   = 0.008;  // transition band ~10° wide at SPIN_SPEED
const DAMPING    = 0.88;
const SPIN_SPEED = 0.004;

// ── Physics step ──────────────────────────────────────────────────────────
function physicsStep(theta) {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  for (let i = 0; i < N; i++) {
    const i3 = i * 3;

    // De-rotate world position into body frame: body = R(-theta) * world
    const bx =  pos[i3]     * cosT + pos[i3 + 1] * sinT;
    const by = -pos[i3]     * sinT + pos[i3 + 1] * cosT;

    // Classify in the rotating yin-yang field
    const inYin = isYinSphere(bx, by, pos[i3 + 2]);

    // Choose fixed world-frame home
    const hx = inYin ? denseGrid[i3]       : sparseAssign[i3];
    const hy = inYin ? denseGrid[i3 + 1]   : sparseAssign[i3 + 1];
    const hz = inYin ? denseGrid[i3 + 2]   : sparseAssign[i3 + 2];

    // Spring toward home
    vel[i3]     += K_SPRING * (hx - pos[i3]);
    vel[i3 + 1] += K_SPRING * (hy - pos[i3 + 1]);
    vel[i3 + 2] += K_SPRING * (hz - pos[i3 + 2]);

    // Tangent project: remove radial component from velocity
    const rad = vel[i3] * pos[i3] + vel[i3 + 1] * pos[i3 + 1] + vel[i3 + 2] * pos[i3 + 2];
    vel[i3]     -= rad * pos[i3];
    vel[i3 + 1] -= rad * pos[i3 + 1];
    vel[i3 + 2] -= rad * pos[i3 + 2];

    // Integrate
    pos[i3]     += vel[i3];
    pos[i3 + 1] += vel[i3 + 1];
    pos[i3 + 2] += vel[i3 + 2];

    // Surface project
    const len = Math.sqrt(pos[i3]*pos[i3] + pos[i3+1]*pos[i3+1] + pos[i3+2]*pos[i3+2]);
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

// ── Hover-to-pause (smootherstep ease-in-out, 3 s) ────────────────────────
function smootherstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const HOVER_DURATION  = 3.0;
let rotSpeed          = SPIN_SPEED;
let hovering          = false;
let wasHovering       = false;
let hoverTime         = 0;
let speedAtHoverStart = SPIN_SPEED;

const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();
const clock     = new THREE.Clock();

// ── Drag rotation ──────────────────────────────────────────────────────────
let dragging = false, lastX = null, lastY = null;

renderer.domElement.addEventListener('mousedown', e => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener('mouseup', () => { dragging = false; });

window.addEventListener('mousemove', e => {
  mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  hovering = raycaster.intersectObject(innerSphere).length > 0;

  if (!dragging) return;
  if (lastX === null) { lastX = e.clientX; lastY = e.clientY; return; }
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  group.rotation.y += dx * 0.01;
  group.rotation.x += dy * 0.01;
});

// ── Animation loop ─────────────────────────────────────────────────────────
let theta = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (hovering) {
    if (!wasHovering) {
      speedAtHoverStart = rotSpeed;
      hoverTime = 0;
    }
    hoverTime += dt;
    const t = Math.min(hoverTime / HOVER_DURATION, 1.0);
    rotSpeed = speedAtHoverStart * (1 - smootherstep(t));
  } else {
    hoverTime = 0;
    rotSpeed += (SPIN_SPEED - rotSpeed) * 0.025;
  }
  wasHovering = hovering;

  theta -= rotSpeed;
  physicsStep(theta);
  renderer.render(scene, camera);
}

animate();
