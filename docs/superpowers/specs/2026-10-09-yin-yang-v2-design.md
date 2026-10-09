# Yin-Yang Particle Sphere v2 — Design Spec

**Date:** 2026-10-09

## What It Is

A rework of the v1 yin-yang particle sphere. Instead of the whole geometry
rotating as a rigid body, the yin-yang classification field rotates while the
sphere stays still. Particles have home positions fixed in the rotating frame;
spring physics pulls them toward their (rotating) homes each frame. The result:
as the fish heads sweep forward, particles are absorbed into the dense yin
region; as the tails pass, particles drift back out into the sparse yang field.
The symbol is always readable — the density gradient, not color changes or
geometry rotation, is what makes yin look dark and yang look light.

## Files

- `v2.html` — entry point (same shell as `index.html`, importmap + module script)
- `src/v2.js` — all v2 code
- `index.html` / `src/main.js` — v1, untouched

## Visual Baseline

Identical to v1: white background, three particle layers (yin black 1px, yang
light gray 1.2px, shadow black 1px fading band), white inner sphere
`SphereGeometry(0.97)`. Dot sizes, textures, materials, and colors are
unchanged. The visual difference is entirely in motion.

## Particle Initialisation

Home positions are generated exactly as in v1 using the same three functions:

- `generateParticles(120000)` → ~55k yin homes (black, dense)
- `generateYangParticles(1800)` → ~900 yang homes (light gray, sparse)
- `generateShadowParticles(80000, 0.2)` → shadow homes (black, fading band)

Two Float32Arrays per particle system:
- `posArray` — live positions (initialised = homes, updated every frame)
- `homeArray` — fixed home positions (never written after init)
- `velArray` — velocities (initialised to zero)

`BufferAttribute` for positions is set `needsUpdate = true` each frame.

## Frame Rotation

A scalar `θ` accumulates each frame: `θ -= SPIN_SPEED` (same direction as v1).
On each frame, each particle's home is the original home position rotated around
the Z axis by `θ`:

```
hx = home_x * cos(θ) - home_y * sin(θ)
hy = home_x * sin(θ) + home_y * cos(θ)
hz = home_z
```

## Physics (per particle, per frame)

1. **Spring** — `vel += -k * (pos - rotatedHome)`, k = 0.012
2. **Tangent project** — `vel -= dot(vel, pos) * pos` (keeps vel on sphere surface)
3. **Integrate** — `pos += vel`
4. **Surface project** — `pos = pos / |pos|`
5. **Damping** — `vel *= 0.88`

O(N) per frame. No spatial grid, no neighbour forces.

Spring constant k = 0.012 gives visible lag (dramatic absorption/release) while
keeping the symbol readable. Damping 0.88 prevents oscillation.

## Hover Interaction

Identical to v1: `θ` accumulation uses the same smootherstep 3-second ease-in-out
pause on sphere hover (raycaster against inner sphere mesh). Hover → θ eases to
stop. Mouse-off → θ re-accelerates to SPIN_SPEED via lerp.

## Drag Rotation

X/Y drag rotation on the `THREE.Group` (tilts viewing angle) is kept from v1.
Independent of θ — tilting the view does not affect the physics frame.

## Performance

~56k total particles × O(1) physics ops = O(N) per frame. No allocations in the
render loop (all arrays pre-allocated at init). Should sustain 60fps on modern
hardware. Shadow generation (80k candidates, 8-direction binary search) runs once
at startup — acceptable load time.

## Constants

| Name | Value | Purpose |
|------|-------|---------|
| `SPIN_SPEED` | 0.004 rad/frame | base rotation rate |
| `k` | 0.012 | spring constant |
| `DAMPING` | 0.88 | velocity damping per frame |
| `HOVER_DURATION` | 3.0s | smootherstep pause duration |
