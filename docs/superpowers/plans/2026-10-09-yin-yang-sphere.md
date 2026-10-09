# Yin-Yang Particle Sphere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single `index.html` browser visualization of a yin-yang particle sphere with physics and mouse interaction.

**Architecture:** One file, four additive tasks — each leaves a visually testable state. Physics and rendering share a Float32Array for positions (zero copy). The rotation group wraps all scene objects so a single transform drives everything.

**Tech Stack:** Three.js r0.167.0 via CDN importmap, vanilla ES modules, no build step.

**Spec:** `docs/superpowers/specs/2026-10-09-yin-yang-sphere-design.md`

## Global Constraints

- Single file: `index.html` at project root
- Three.js: `https://cdn.jsdelivr.net/npm/three@0.167.0/build/three.module.js`
- No npm, no bundler, no external assets
- Must open directly with `open index.html` (file:// protocol, no local server needed)
- Background color: `#06060f`
- Inner sphere radius: `0.97`, white `0xffffff`
- Particle color: `0x0a0a12`, size 3px, `sizeAttenuation: false`

## Review Focus

- **Particle size on retina displays**: `devicePixelRatio > 1` makes 3px dots appear tiny — renderer should call `setPixelRatio(window.devicePixelRatio)` so CSS pixels match physical pixels
- **isYin boundary at py=0**: the equator (py exactly 0) should route to the top-half test; ensure `py >= 0` covers this
- **Physics blow-up on first frame**: if spring constant is too large relative to initial zero velocities this is fine, but if home positions ever drift (e.g. NaN from a zero-length normalize), the whole system explodes — add `if (len > 0)` guard before dividing
- **Mouse delta accumulation between frames**: if mouse events fire multiple times per frame, raw deltas should be summed not replaced, then cleared after applying each frame
- **Click-pause restoring wrong velocity**: storing `angVelY` before zeroing it must capture the value including auto-spin contribution at that moment, not just the extra — test that releasing restores perceptible rotation, not zero

---

### Task 1: HTML scaffold + Three.js scene

**Files:**
- Create: `index.html`

**Interfaces:**
- Produces: `renderer`, `scene`, `camera`, `group` (THREE.Group) — used by all later tasks

- [ ] **Step 1: Create `index.html` with scene, camera, renderer, and animation loop**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Yin Yang</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #06060f; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
<body>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.167.0/build/three.module.js"
  }
}
</script>
<script type="module">
import * as THREE from 'three';

// ── Scene ──────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06060f);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 3.5;

const group = new THREE.Group();
scene.add(group);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Animation loop (populated by later tasks) ──────────────
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>
```

- [ ] **Step 2: Open in browser and verify**

  Open `index.html` directly. Expected: solid near-black (`#06060f`) full-screen canvas, no errors in console.

---

### Task 2: Inner sphere + yin-yang particle generation

**Files:**
- Modify: `index.html` — add inner sphere mesh and particle Points to `group` before the animation loop

**Interfaces:**
- Consumes: `group` (THREE.Group from Task 1)
- Produces: `posArray` (Float32Array, N×3 positions), `homePositions` (Vector3[]), `particleGeo` (BufferGeometry with `position` attribute) — used by Tasks 3 and 4

- [ ] **Step 1: Add inner white sphere**

  Insert after `scene.add(group);`:

```javascript
// ── Inner sphere ───────────────────────────────────────────
const innerSphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.97, 64, 64),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
group.add(innerSphere);
```

- [ ] **Step 2: Add yin-yang classification function**

  Insert after inner sphere code:

```javascript
// ── Yin-yang geometry ──────────────────────────────────────
function isYin(px, py) {
  if (px * px + py * py > 1.0) return false;

  // Small dark dot at (0, +0.5) — yin seed in yang territory
  if (px * px + (py - 0.5) * (py - 0.5) < 0.0144) return true;
  // Small light dot at (0, -0.5) — yang seed in yin territory
  if (px * px + (py + 0.5) * (py + 0.5) < 0.0144) return false;

  if (py >= 0) {
    // Top half: yin = outside inner circle centred at (0, 0.5) r=0.5
    return px * px + (py - 0.5) * (py - 0.5) > 0.25;
  } else {
    // Bottom half: yin = inside inner circle centred at (0, -0.5) r=0.5
    return px * px + (py + 0.5) * (py + 0.5) < 0.25;
  }
}
```

  Note: `0.0144 = 0.12²` — dot radius 0.12 in unit-circle space.

- [ ] **Step 3: Generate home positions via Fibonacci sphere sampling**

  Insert after `isYin`:

```javascript
function generateParticles(numCandidates) {
  const homes = [];
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle ≈ 2.399963 rad
  for (let i = 0; i < numCandidates; i++) {
    const y  = 1 - (i / (numCandidates - 1)) * 2; // y in [-1, 1]
    const r  = Math.sqrt(1 - y * y);
    const th = phi * i;
    const x  = Math.cos(th) * r;
    const z  = Math.sin(th) * r;
    if (isYin(x, y)) homes.push(new THREE.Vector3(x, y, z));
  }
  return homes;
}

const homePositions = generateParticles(12000);
const N = homePositions.length;

// Flat Float32Array — 3 floats per particle, shared with BufferGeometry
const posArray = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  posArray[i * 3]     = homePositions[i].x;
  posArray[i * 3 + 1] = homePositions[i].y;
  posArray[i * 3 + 2] = homePositions[i].z;
}
```

- [ ] **Step 4: Create circular point sprite texture**

```javascript
function makeCircleTexture() {
  const sz = 64;
  const c  = document.createElement('canvas');
  c.width  = sz; c.height = sz;
  const ctx = c.getContext('2d');
  const g   = ctx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  g.addColorStop(0,   'rgba(10,10,18,1)');
  g.addColorStop(0.45,'rgba(10,10,18,0.85)');
  g.addColorStop(1,   'rgba(10,10,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sz, sz);
  return new THREE.CanvasTexture(c);
}
```

- [ ] **Step 5: Add Points to scene**

```javascript
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

const particleMat = new THREE.PointsMaterial({
  size: 3,
  sizeAttenuation: false,
  map: makeCircleTexture(),
  color: 0x0a0a12,
  transparent: true,
  depthWrite: false,
  alphaTest: 0.01,
});

const points = new THREE.Points(particleGeo, particleMat);
group.add(points);
```

- [ ] **Step 6: Open in browser and verify**

  Reload `index.html`. Expected:
  - White sphere visible in centre
  - Black dot particles forming the yin-yang dark half — right side at top, left side at bottom
  - Small dark dot visible in the yang (white/top-left) region
  - Small light gap visible in the yin (dark) region
  - Console: no errors; `N` should log ~3200–3600 particles (log it temporarily if unsure)

---

### Task 3: Particle physics — spring + neighbour gravity

**Files:**
- Modify: `index.html` — add velocity array, spatial grid, `physicsStep()`, call it from animate loop

**Interfaces:**
- Consumes: `posArray`, `homePositions`, `N`, `particleGeo` (from Task 2)
- Produces: `physicsStep()` — called each frame in animate loop

- [ ] **Step 1: Add velocity array and physics constants**

  Insert after the `posArray` initialisation block:

```javascript
const velArray = new Float32Array(N * 3); // zero-initialised

const SPRING_K  = 0.025;
const GRAV_G    = 6e-5;
const CUTOFF    = 0.28;
const CUTOFF2   = CUTOFF * CUTOFF;
const DAMPING   = 0.93;
const SOFTENING = 0.002;
```

- [ ] **Step 2: Add spatial grid helpers**

```javascript
// ── Spatial grid ───────────────────────────────────────────
const GRID_N  = 8;                       // 8×8×8 = 512 cells
const GRID_N2 = GRID_N * GRID_N;
const cells   = Array.from({ length: GRID_N ** 3 }, () => []);

function cellOf(x, y, z) {
  const gx = Math.min(GRID_N - 1, Math.max(0, ((x + 1) * GRID_N / 2) | 0));
  const gy = Math.min(GRID_N - 1, Math.max(0, ((y + 1) * GRID_N / 2) | 0));
  const gz = Math.min(GRID_N - 1, Math.max(0, ((z + 1) * GRID_N / 2) | 0));
  return gx + gy * GRID_N + gz * GRID_N2;
}

function buildGrid() {
  for (let c = 0; c < cells.length; c++) cells[c].length = 0;
  for (let i = 0; i < N; i++) {
    cells[cellOf(posArray[i*3], posArray[i*3+1], posArray[i*3+2])].push(i);
  }
}

// Returns all particle indices in the 3×3×3 neighbourhood of a cell index
function neighboursOf(ci) {
  const gz =  (ci / GRID_N2) | 0;
  const gy = ((ci % GRID_N2) / GRID_N) | 0;
  const gx =   ci % GRID_N;
  const out = [];
  for (let dz = -1; dz <= 1; dz++) {
    const nz = gz + dz; if (nz < 0 || nz >= GRID_N) continue;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = gy + dy; if (ny < 0 || ny >= GRID_N) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = gx + dx; if (nx < 0 || nx >= GRID_N) continue;
        const nc = nx + ny * GRID_N + nz * GRID_N2;
        const cs = cells[nc];
        for (let k = 0; k < cs.length; k++) out.push(cs[k]);
      }
    }
  }
  return out;
}
```

- [ ] **Step 3: Add `physicsStep()` function**

```javascript
// ── Physics ────────────────────────────────────────────────
function physicsStep() {
  buildGrid();

  // 1. Spring force toward home
  for (let i = 0; i < N; i++) {
    const b = i * 3;
    velArray[b]   += -SPRING_K * (posArray[b]   - homePositions[i].x);
    velArray[b+1] += -SPRING_K * (posArray[b+1] - homePositions[i].y);
    velArray[b+2] += -SPRING_K * (posArray[b+2] - homePositions[i].z);
  }

  // 2. Neighbour gravity via grid
  for (let i = 0; i < N; i++) {
    const bi  = i * 3;
    const px  = posArray[bi], py = posArray[bi+1], pz = posArray[bi+2];
    const ci  = cellOf(px, py, pz);
    const nbr = neighboursOf(ci);
    for (let k = 0; k < nbr.length; k++) {
      const j = nbr[k];
      if (j <= i) continue;               // process each pair once
      const bj  = j * 3;
      const dx  = posArray[bj]   - px;
      const dy  = posArray[bj+1] - py;
      const dz  = posArray[bj+2] - pz;
      const d2  = dx*dx + dy*dy + dz*dz;
      if (d2 >= CUTOFF2 || d2 < 0.0001) continue;
      const d   = Math.sqrt(d2);
      const f   = GRAV_G / (d2 + SOFTENING);
      const fx  = f * dx / d, fy = f * dy / d, fz = f * dz / d;
      velArray[bi]   += fx; velArray[bi+1] += fy; velArray[bi+2] += fz;
      velArray[bj]   -= fx; velArray[bj+1] -= fy; velArray[bj+2] -= fz;
    }
  }

  // 3. Integrate → project → tangent constraint → damp
  for (let i = 0; i < N; i++) {
    const b = i * 3;
    posArray[b]   += velArray[b];
    posArray[b+1] += velArray[b+1];
    posArray[b+2] += velArray[b+2];

    // Project onto unit sphere
    const len = Math.sqrt(posArray[b]**2 + posArray[b+1]**2 + posArray[b+2]**2);
    if (len > 0) { posArray[b] /= len; posArray[b+1] /= len; posArray[b+2] /= len; }

    // Strip radial velocity component (keep tangential only)
    const rad = velArray[b]*posArray[b] + velArray[b+1]*posArray[b+1] + velArray[b+2]*posArray[b+2];
    velArray[b]   -= rad * posArray[b];
    velArray[b+1] -= rad * posArray[b+1];
    velArray[b+2] -= rad * posArray[b+2];

    // Damp
    velArray[b]   *= DAMPING;
    velArray[b+1] *= DAMPING;
    velArray[b+2] *= DAMPING;
  }

  particleGeo.attributes.position.needsUpdate = true;
}
```

- [ ] **Step 4: Call `physicsStep()` from animate loop**

  Replace the animate function body:

```javascript
function animate() {
  requestAnimationFrame(animate);
  physicsStep();
  renderer.render(scene, camera);
}
```

- [ ] **Step 5: Open in browser and verify**

  Reload. Expected:
  - Yin-yang pattern still clearly visible (spring force keeps shape)
  - Particles visibly jiggling/breathing — gentle motion, not chaotic
  - Shape does not dissolve over time
  - No console errors, smooth 60fps (check performance tab if unsure)

---

### Task 4: Rotation, mouse gravity, and click-pause

**Files:**
- Modify: `index.html` — add rotation state, event listeners, update animate loop

**Interfaces:**
- Consumes: `group` (Task 1), existing `animate` loop (Task 3)
- Produces: complete interactive visualization

- [ ] **Step 1: Add rotation state and constants**

  Insert after physics constants:

```javascript
// ── Rotation state ─────────────────────────────────────────
const AUTO_SPIN       = 0.003;   // base yaw per frame (rad)
const MOUSE_INFLUENCE = 0.035;   // mouse delta → angular velocity scale
const VEL_DECAY       = 0.97;    // extra angular velocity decay per frame

let angVelX = 0;                 // pitch rate (extra, decays)
let angVelY = 0;                 // yaw rate (extra, decays; auto-spin added separately)
let isPaused = false;
let savedAngVelX = 0, savedAngVelY = 0;

// Mouse delta — summed between frames, cleared after each physics step
let mouseDX = 0, mouseDY = 0;
let lastMX = 0, lastMY = 0;
```

- [ ] **Step 2: Add event listeners**

  Insert before `animate()`:

```javascript
// ── Event listeners ────────────────────────────────────────
window.addEventListener('mousemove', (e) => {
  const mx = (e.clientX / window.innerWidth)  *  2 - 1;
  const my = (e.clientY / window.innerHeight) * -2 + 1;
  mouseDX += mx - lastMX;   // accumulate; cleared each frame
  mouseDY += my - lastMY;
  lastMX = mx;
  lastMY = my;
});

window.addEventListener('mousedown', () => {
  if (isPaused) return;
  isPaused     = true;
  savedAngVelX = angVelX;
  savedAngVelY = angVelY;
  angVelX      = 0;
  angVelY      = 0;
});

window.addEventListener('mouseup', () => {
  if (!isPaused) return;
  isPaused = false;
  angVelX  = savedAngVelX * 0.6;
  angVelY  = savedAngVelY * 0.6;
});
```

- [ ] **Step 3: Update animate loop with rotation**

  Replace the entire `animate` function:

```javascript
function animate() {
  requestAnimationFrame(animate);
  physicsStep();

  if (!isPaused) {
    // Apply accumulated mouse delta as angular impulse
    angVelX += mouseDY * MOUSE_INFLUENCE;
    angVelY += mouseDX * MOUSE_INFLUENCE;

    // Decay extra velocity
    angVelX *= VEL_DECAY;
    angVelY *= VEL_DECAY;

    // Apply rotation (auto-spin always added to Y)
    group.rotation.x += angVelX;
    group.rotation.y += angVelY + AUTO_SPIN;
  }

  // Clear accumulated mouse deltas after use
  mouseDX = 0;
  mouseDY = 0;

  renderer.render(scene, camera);
}
```

- [ ] **Step 4: Open in browser and verify**

  Reload. Expected:
  - Sphere auto-rotates smoothly around Y axis
  - Moving mouse over the canvas nudges the rotation — moving left/right affects yaw, up/down affects pitch
  - After moving mouse, rotation settles back toward base auto-spin
  - Click and hold: sphere freezes
  - Release: sphere resumes with slight inertia
  - Particle breathing continues while sphere is paused
  - From the front: clear yin-yang pattern
  - Rotating 90°: sphere face is predominantly dark (yin particles) or light (white sphere, no particles)
