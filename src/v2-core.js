// Pure yin-yang logic shared by v2.js and tests/v2-unit.html — no DOM or
// Three.js, so it can be tested on its own.

// ── Yin-yang classification ────────────────────────────────────────────────
export function isYin(px, py) {
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
export function isYinSphere(px, py, pz) {
  return isYin(px, pz < 0 ? -py : py);
}

// ── Full-sphere Fibonacci grid ─────────────────────────────────────────────
export function makeFibGrid(count) {
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

// Sparse assignment. Each particle's sparse home is the sparse point
// nearest a random spot near its dense home, so the hop between homes has
// a typical length of reachDeg. Sparse homes within about that
// distance of the yin boundary are partly populated, so the two sides melt
// into each other there; deeper inside the yin they are empty at rest.
// Seeded, so the layout is the same on every load.
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function assignSparseHomes(denseGrid, sparseGrid, reachDeg) {
  const N = denseGrid.length / 3, M = sparseGrid.length / 3;
  const sparseAssign = new Float32Array(N * 3);
  const rand = mulberry32(1);
  // Uniform scatter over a spherical cap: median offset = radius / √2.
  const capRadius = reachDeg * Math.SQRT2 * Math.PI / 180;
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
  return sparseAssign;
}
