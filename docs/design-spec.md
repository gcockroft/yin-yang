# Yin-Yang Particle Sphere — Design Spec

**Date:** 2026-10-09

## What It Is

A single `index.html` browser visualization: an animated 3D sphere made entirely of particles that form a yin-yang symbol. The sphere auto-rotates; a white inner sphere provides the yang (light) half; black dot particles form the yin (dark) half plus the small dark dot in the light region. The small light circle in the dark region is just the white sphere showing through (no particles placed there).

## Delivery

Single self-contained `index.html`. Three.js loaded via CDN importmap (ES modules). No build step, no dependencies to install.

## Scene

- Background: `#06060f` (near-black with faint blue)
- Inner sphere: `SphereGeometry(0.97)` + `MeshBasicMaterial({ color: 0xffffff })`
- Particles: `THREE.Points` with `BufferGeometry` + `PointsMaterial`
  - Color: near-black (`0x0a0a12`), soft circular sprite texture (canvas-generated radial gradient)
  - Size: 3px (screen pixels, `sizeAttenuation: false`)
  - Depth write off, transparent: true
- Camera: `PerspectiveCamera(45°)`, `z = 3.5`

## Yin-Yang Geometry

Particles have fixed **home positions** on the unit sphere surface, classified as "yin" using `isYin(px, py)` — a 2D test on `(x, y)` coordinates of the sphere point, ignoring `z`. This gives a perfect yin-yang from the front view; as the sphere rotates, yin-heavy vs yang-heavy faces emerge naturally.

```
isYin(px, py):
  if px²+py² > 1: return false
  topDot = px²+(py-0.5)² < 0.12²   → true  (dark seed in yang half)
  botDot = px²+(py+0.5)² < 0.12²   → false (light seed in yin half)
  if py >= 0: return px²+(py-0.5)² > 0.25   (outside top inner circle)
  else:       return px²+(py+0.5)² < 0.25   (inside bottom inner circle)
```

Home positions generated via **Fibonacci sphere sampling** (~12,000 candidates), filtered to ~3,000–4,000 yin points.

## Particle Physics (Approach A)

Per-particle state: `pos` (Float32Array, 3 per particle), `vel` (Float32Array), `homePos` (Vector3 array).

Each frame:
1. **Spring** — `vel += -k*(pos - home)`, k = 0.025
2. **Neighbor gravity** — spatial grid (8×8×8); for pairs within distance 0.28: `vel += G/dist² * direction`, G = 6e-5, softened
3. **Integrate** — `pos += vel`
4. **Surface project** — `pos.normalize()`
5. **Tangent constraint** — strip radial component from vel
6. **Damping** — `vel *= 0.93`

## Rotation & Interaction

- `THREE.Group` wraps both inner sphere and particles
- **Auto-spin**: constant +0.003 rad/frame on Y each frame
- **Mouse gravity**: `mousemove` delta → add scaled fraction (×0.035) to `angVelX/Y`; extra velocity decays at 0.97/frame
- **Click-pause**: `mousedown` zeroes angular velocity and freezes; `mouseup` restores at 60% with inertia
- Resize handler updates camera aspect + renderer size
