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
// White core that hides the far side of the dot shell (radius 1). Its size
// is set as a fraction of the shell in applySizes().
const innerSphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 64, 64),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
// Invisible shell-sized target for hover-to-pause, so hover still covers
// the whole sphere when the inner sphere is shrunk.
const hoverTarget = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 32),
  new THREE.MeshBasicMaterial({ visible: false })
);
const group = new THREE.Group();
group.add(innerSphere, hoverTarget);
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
// Sparse grid — far fewer points (~N/M per sparse home), wide spacing.
//
// Each particle has both a dense home and a sparse home a short hop away
// (see sparse assignment below), so switching states is a local move.
//
// The YIN/YANG FIELD rotates (orientation `field`).  Each frame, the particle's
// fixed dense home is de-rotated into the body frame and classified.
// Inside the fish → spring toward dense home (cluster together → dark).
// Outside the fish → spring toward sparse home (spread apart → light).
// Absorption/release appears at the boundary as particles physically
// flow between the two states.
//
// All of these are tunable live from the Tune panel; the starting values
// can also come from the URL, e.g. v2.html?dense=80000&sparse=1500&reach=10
const params = new URLSearchParams(location.search);
const num = (key, fallback) => (params.has(key) && params.get(key) !== '' && !isNaN(Number(params.get(key))))
  ? Number(params.get(key)) : fallback;
const DEFAULTS = {
  dense:   70000,  // total particles = size of dense grid
  sparse:  1800,   // size of sparse grid (~dense/sparse particles per sparse home)
  reach:   5,      // typical hop between homes, degrees
  spring:  0.008,  // spring constant toward the current home
  damping: 0.88,   // velocity kept each frame
  spin:    0.004,  // primary spin about the field's own axis, radians per frame
  spin2:   0,      // secondary spin about the tilted world axis, radians per frame
  tilt:    90,     // secondary axis, degrees from Z toward Y
  size:    1,      // overall scale of the sphere
  inner:   97,     // inner white sphere radius, % of the dot shell
};
const settings = Object.fromEntries(
  Object.entries(DEFAULTS).map(([key, value]) => [key, num(key, value)]));

let N, M, denseGrid, sparseGrid, sparseAssign, pos, vel;

// Sparse assignment. Each particle's sparse home is the sparse point
// nearest a random spot near its dense home, so the hop between homes has
// a typical length of settings.reach. Sparse homes within about that
// distance of the yin boundary are partly populated, so the two sides melt
// into each other there; deeper inside the yin they are empty at rest.
// Seeded, so the layout is the same on every load.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assignSparseHomes() {
  sparseAssign = new Float32Array(N * 3);
  const rand = mulberry32(1);
  // Uniform scatter over a spherical cap: median offset = radius / √2.
  const capRadius = settings.reach * Math.SQRT2 * Math.PI / 180;
  // On a Fibonacci grid y falls linearly with index, and the nearest sparse
  // point is within a couple of grid spacings, so only sparse indices in a
  // narrow latitude band need checking.
  const band = 3 * Math.sqrt(4 * Math.PI / M);
  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const px = denseGrid[i3], py = denseGrid[i3 + 1], pz = denseGrid[i3 + 2];

    // Tangent basis at p (avoid the pole when crossing with +Y)
    let ux = -pz, uy = 0, uz = px;                       // p × (0,1,0) up to sign
    let ul = Math.hypot(ux, uz);
    if (ul < 1e-6) { ux = 0; uy = pz; uz = -py; ul = Math.hypot(uy, uz); }  // p × (1,0,0)
    ux /= ul; uy /= ul; uz /= ul;
    const vx = py * uz - pz * uy, vy = pz * ux - px * uz, vz = px * uy - py * ux;

    // Random point on the cap around p
    const d = capRadius * Math.sqrt(rand());
    const a = 2 * Math.PI * rand();
    const ca = Math.cos(a), sa = Math.sin(a), sd = Math.sin(d), cd = Math.cos(d);
    const x = px * cd + (ux * ca + vx * sa) * sd;
    const y = py * cd + (uy * ca + vy * sa) * sd;
    const z = pz * cd + (uz * ca + vz * sa) * sd;

    const jLo = Math.max(0,     Math.floor((1 - (y + band)) / 2 * (M - 1)));
    const jHi = Math.min(M - 1, Math.ceil ((1 - (y - band)) / 2 * (M - 1)));
    let best = -1, bestDot = -2;
    for (let j = jLo; j <= jHi; j++) {
      const j3 = j * 3;
      const dot = x * sparseGrid[j3] + y * sparseGrid[j3 + 1] + z * sparseGrid[j3 + 2];
      if (dot > bestDot) { bestDot = dot; best = j3; }
    }
    sparseAssign[i3]     = sparseGrid[best];
    sparseAssign[i3 + 1] = sparseGrid[best + 1];
    sparseAssign[i3 + 2] = sparseGrid[best + 2];
  }
}

// ── Field orientation ─────────────────────────────────────────────────────
// The yin-yang field's orientation is a quaternion, advanced each frame by
//   primary   — spin about the field's own polar axis (body Z), and
//   secondary — spin about a fixed world axis tilted settings.tilt
//               degrees from Z toward Y (0° = same as Z, 90° = vertical Y).
// Two incommensurate spins make the fish wander over the whole sphere.
const field  = new THREE.Quaternion();
const fieldM = new THREE.Matrix4();
const qStep  = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const secondaryAxis = new THREE.Vector3();

function advanceField(primaryAngle, secondaryAngle) {
  // Leave the field exactly as it is when nothing turns: renormalizing a
  // still quaternion nudges it by rounding error each frame, which flips
  // dense homes that sit exactly on a boundary (e.g. the poles) back and forth.
  if (primaryAngle === 0 && secondaryAngle === 0) return;
  qStep.setFromAxisAngle(Z_AXIS, -primaryAngle);
  field.multiply(qStep);                       // about body Z
  const tilt = settings.tilt * Math.PI / 180;
  secondaryAxis.set(0, Math.sin(tilt), Math.cos(tilt));
  qStep.setFromAxisAngle(secondaryAxis, -secondaryAngle);
  field.premultiply(qStep);                    // about the world axis
  field.normalize();
}

// Body-frame axes of the field in world coordinates (rows of R^T):
// body = R^T · world, so body.x = col0 · p, etc.
function fieldAxes() {
  fieldM.makeRotationFromQuaternion(field);
  return fieldM.elements;  // column-major: col0 = e[0..2], col1 = e[4..6], col2 = e[8..10]
}

// Put every particle at its correct home for the current field, at rest.
function placeParticlesAtHome() {
  const e = fieldAxes();
  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const dx = denseGrid[i3], dy = denseGrid[i3 + 1], dz = denseGrid[i3 + 2];
    const inYin = isYinSphere(
      e[0] * dx + e[1] * dy + e[2]  * dz,
      e[4] * dx + e[5] * dy + e[6]  * dz,
      e[8] * dx + e[9] * dy + e[10] * dz);
    const src = inYin ? denseGrid : sparseAssign;
    pos[i3]     = src[i3];
    pos[i3 + 1] = src[i3 + 1];
    pos[i3 + 2] = src[i3 + 2];
  }
  vel.fill(0);
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
const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
  size: 1.0 * window.devicePixelRatio,
  sizeAttenuation: false,
  map: makeCircleTexture(0, 0, 0),
  color: 0x000000,
  transparent: true,
  depthWrite: false,
  alphaTest: 0.01,
}));
points.frustumCulled = false;  // always on the unit sphere; skip bounds upkeep
group.add(points);

// (Re)build grids, homes and particles from settings, keeping the field orientation.
function rebuild() {
  N = Math.round(settings.dense);
  M = Math.round(settings.sparse);
  denseGrid  = makeFibGrid(N);
  sparseGrid = makeFibGrid(M);
  assignSparseHomes();
  pos = new Float32Array(N * 3);
  vel = new Float32Array(N * 3);
  placeParticlesAtHome();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  points.geometry.dispose();
  points.geometry = geo;
}

rebuild();

// ── Physics step ──────────────────────────────────────────────────────────
function physicsStep() {
  const e = fieldAxes();
  const K_SPRING = settings.spring;
  const DAMPING  = settings.damping;

  for (let i = 0; i < N; i++) {
    const i3 = i * 3;

    // Classify the particle's fixed dense home, not its current position.
    // Classifying the moving position is a feedback loop: a particle near
    // the boundary springs toward its home, crosses the boundary, flips
    // home, and turns back — jittering forever even when the field is still.
    // Rotate into the field's body frame: body = R^T * world
    const dx = denseGrid[i3], dy = denseGrid[i3 + 1], dz = denseGrid[i3 + 2];
    const inYin = isYinSphere(
      e[0] * dx + e[1] * dy + e[2]  * dz,
      e[4] * dx + e[5] * dy + e[6]  * dz,
      e[8] * dx + e[9] * dy + e[10] * dz);

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

  points.geometry.attributes.position.needsUpdate = true;
}

// ── Hover-to-pause (smootherstep ease-in-out, 3 s) ────────────────────────
function smootherstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

const HOVER_DURATION  = 3.0;
let motion            = 1;  // 0 = stopped, 1 = full speed (both spins)
let hovering          = false;
let wasHovering       = false;
let hoverTime         = 0;
let motionAtHoverStart = 1;

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
  const overControls = e.target instanceof Element && e.target.closest('#controls');
  hovering = !overControls && raycaster.intersectObject(hoverTarget).length > 0;

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

// ── Controls: start/stop spin, reset rotation ─────────────────────────────
let spinning = true;
const spinBtn  = document.getElementById('spin-toggle');
const resetBtn = document.getElementById('rotation-reset');

spinBtn.addEventListener('click', () => {
  spinning = !spinning;
  spinBtn.textContent = spinning ? 'Stop' : 'Start';
  spinBtn.setAttribute('aria-pressed', String(!spinning));
});

// Back to the initial state: field orientation, default view, particles at home.
resetBtn.addEventListener('click', () => {
  field.identity();
  group.rotation.set(0, 0, 0);
  placeParticlesAtHome();
  points.geometry.attributes.position.needsUpdate = true;
});

// ── Sizes ──────────────────────────────────────────────────────────────────
function applySizes() {
  group.scale.setScalar(settings.size);
  innerSphere.scale.setScalar(settings.inner / 100);
  innerSphere.visible = settings.inner > 0;
}
applySizes();

// ── Axis guides ────────────────────────────────────────────────────────────
// Shown (and the spin paused) while the axis tilt is being changed, so the
// effect of the change is visible: gold = secondary axis (fixed in the
// world), green = primary axis (the field's own pole, which the secondary
// spin carries around).
function makeAxisRod(color) {
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 2.8, 12),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
  rod.renderOrder = 10;  // draw over the particles and through the sphere
  rod.visible = false;
  group.add(rod);
  return rod;
}
const secondaryRod = makeAxisRod(0xd4a531);
const primaryRod   = makeAxisRod(0x1f9d74);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const axisDir = new THREE.Vector3();

function updateAxisRods() {
  const tilt = settings.tilt * Math.PI / 180;
  axisDir.set(0, Math.sin(tilt), Math.cos(tilt));
  secondaryRod.quaternion.setFromUnitVectors(Y_AXIS, axisDir);
  axisDir.set(0, 0, 1).applyQuaternion(field);
  primaryRod.quaternion.setFromUnitVectors(Y_AXIS, axisDir);
}

let axisEditing = false;
let axisEditTimer = null;
function beginAxisEdit() {
  clearTimeout(axisEditTimer);
  axisEditing = true;
  secondaryRod.visible = primaryRod.visible = true;
}
function endAxisEditSoon() {
  clearTimeout(axisEditTimer);
  axisEditTimer = setTimeout(() => {
    axisEditing = false;
    secondaryRod.visible = primaryRod.visible = false;
  }, 1500);
}

// ── Tune panel ─────────────────────────────────────────────────────────────
// Spring, damping, spins and axis tilt apply instantly. Dense, sparse and
// reach rebuild the particles (on release), keeping the field orientation.
const TUNERS = [
  { key: 'dense',   label: 'Yin dots',   min: 10000, max: 150000, step: 5000,   rebuild: true, fmt: v => v.toLocaleString() },
  { key: 'sparse',  label: 'Yang dots', min: 200,   max: 6000,   step: 100,    rebuild: true, fmt: v => v.toLocaleString() },
  { key: 'reach',   label: 'Reach (how far dots travel)', min: 0, max: 20, step: 0.5, rebuild: true, fmt: v => `${v.toFixed(1)}°` },
  { key: 'spring',  label: 'Spring (pull toward home)',       min: 0.001, max: 0.05,   step: 0.001,  fmt: v => v.toFixed(3) },
  { key: 'damping', label: 'Damping (higher = glides longer)',      min: 0.5,   max: 0.99,   step: 0.01,   fmt: v => v.toFixed(2) },
  { key: 'spin',    label: 'Primary spin (own axis)', min: -0.02, max: 0.02, step: 0.0005, fmt: v => v.toFixed(4) },
  { key: 'spin2',   label: 'Secondary spin',          min: -0.02, max: 0.02, step: 0.0005, fmt: v => v.toFixed(4) },
  { key: 'tilt',    label: 'Secondary axis tilt (°)', min: 0,    max: 180,  step: 1,      fmt: v => v.toFixed(0), axis: true },
  { key: 'size',    label: 'Overall size',            min: 0.3,  max: 2,    step: 0.05,   fmt: v => `${v.toFixed(2)}×`, sizes: true },
  { key: 'inner',   label: 'Inner sphere (% of dot shell)', min: 0, max: 100, step: 1,   fmt: v => `${v.toFixed(0)}%`, sizes: true },
];

const tunePanel   = document.getElementById('tune-panel');
const tuneToggle  = document.getElementById('tune-toggle');
const tuneSummary = document.getElementById('tune-summary');
const tuneRows    = document.getElementById('tune-rows');
const resetAllBtn = document.getElementById('tune-reset-all');

function refreshSummary() {
  tuneSummary.textContent = TUNERS.map(t => `${t.key}=${Number(settings[t.key].toFixed(4))}`).join('&');
}

const sliderUI = {};  // key → { input, value }

// Apply a value from code (reset buttons): update the slider and the scene.
function applySetting(t, v) {
  const changed = settings[t.key] !== v;
  settings[t.key] = v;
  sliderUI[t.key].input.value = v;
  sliderUI[t.key].value.textContent = t.fmt(v);
  return changed;
}

for (const t of TUNERS) {
  const row = document.createElement('div');
  row.className = 'tune-row';
  const input = document.createElement('input');
  Object.assign(input, { id: `tune-${t.key}`, type: 'range', min: t.min, max: t.max, step: t.step, value: settings[t.key] });
  const name = document.createElement('label');
  name.htmlFor = input.id;
  name.textContent = t.label;
  const value = document.createElement('output');
  value.htmlFor = input.id;
  value.textContent = t.fmt(settings[t.key]);
  const reset = document.createElement('button');
  Object.assign(reset, { type: 'button', className: 'tune-reset', textContent: '↺', title: `Reset to ${t.fmt(DEFAULTS[t.key])}` });
  reset.setAttribute('aria-label', `Reset ${t.label} to ${t.fmt(DEFAULTS[t.key])}`);
  sliderUI[t.key] = { input, value };

  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = t.fmt(v);
    if (t.axis) beginAxisEdit();
    if (!t.rebuild) { settings[t.key] = v; refreshSummary(); }
    if (t.sizes) applySizes();
  });
  input.addEventListener('change', () => {
    if (t.axis) endAxisEditSoon();
    if (t.rebuild) {
      settings[t.key] = Number(input.value);
      rebuild();
      refreshSummary();
    }
  });
  if (t.axis) {
    input.addEventListener('pointerdown', beginAxisEdit);
    input.addEventListener('pointerup', endAxisEditSoon);
  }
  reset.addEventListener('click', () => {
    if (t.axis) { beginAxisEdit(); endAxisEditSoon(); }
    if (applySetting(t, DEFAULTS[t.key]) && t.rebuild) rebuild();
    if (t.sizes) applySizes();
    refreshSummary();
  });

  row.append(name, value, reset, input);
  tuneRows.append(row);
}
refreshSummary();

resetAllBtn.addEventListener('click', () => {
  let needsRebuild = false;
  for (const t of TUNERS) {
    if (applySetting(t, DEFAULTS[t.key]) && t.rebuild) needsRebuild = true;
  }
  if (needsRebuild) rebuild();
  applySizes();
  refreshSummary();
});

tuneToggle.addEventListener('click', () => {
  const open = tunePanel.hidden;
  tunePanel.hidden = !open;
  tuneToggle.setAttribute('aria-expanded', String(open));
});

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (!spinning || axisEditing) {
    motion += (0 - motion) * 0.15;  // quick ease to a stop
    if (motion < 1e-4) motion = 0;
  } else if (hovering) {
    if (!wasHovering) {
      motionAtHoverStart = motion;
      hoverTime = 0;
    }
    hoverTime += dt;
    const t = Math.min(hoverTime / HOVER_DURATION, 1.0);
    motion = motionAtHoverStart * (1 - smootherstep(t));
  } else {
    hoverTime = 0;
    motion += (1 - motion) * 0.025;
  }
  wasHovering = hovering;

  advanceField(settings.spin * motion, settings.spin2 * motion);
  physicsStep();
  if (primaryRod.visible) updateAxisRods();
  renderer.render(scene, camera);
}

animate();
