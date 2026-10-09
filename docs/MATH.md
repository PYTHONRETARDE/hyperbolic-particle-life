# How it works

This page derives everything the simulation does, from the model of space up to the renderer. You need linear algebra and a little calculus. Every formula here has a matching test in [`test/`](../test).

## 1. The hyperboloid model

The hyperbolic plane **H²** is the surface of constant curvature −1. We represent it as the upper sheet of a two-sheeted hyperboloid in Minkowski space ℝ²˒¹:

```
H² = { p = (t, x, y) : ⟨p, p⟩ = −1, t > 0 },   ⟨a, b⟩ = −a_t b_t + a_x b_x + a_y b_y
```

This model makes everything linear:

| Concept | Formula |
|---|---|
| Distance | `cosh d(p, q) = −⟨p, q⟩` |
| Tangent vectors at p | `{ v : ⟨p, v⟩ = 0 }` (always spacelike, so `|v| = √⟨v, v⟩`) |
| Unit direction from p to q | `(q − cosh(d)·p) / sinh(d)` |
| Geodesic from p with velocity v | `exp_p(v) = cosh(|v|)·p + sinh(|v|)·v/|v|` |
| Parallel transport p → q | `PT(w) = w + ⟨q, w⟩ / (1 − ⟨p, q⟩) · (p + q)` |
| Isometries | 3×3 matrices with `MᵀJM = J`, `J = diag(−1, 1, 1)`, so `M⁻¹ = J Mᵀ J` |

Because isometries are matrices, moving the camera, gluing the surface and drawing the tiling all come down to matrix multiplications.

**Drift control.** After each step a particle is snapped back with `t = √(1 + x² + y²)` and its velocity is re-projected onto the tangent plane with `v ← v + ⟨p, v⟩p`. Long products of camera matrices are repaired with Minkowski Gram–Schmidt (`renormalize`).

### Useful isometries

- Rotation by θ about the origin: the usual 2×2 rotation acting on (x, y).
- Translation by d along the x-axis (a *Lorentz boost*): `[[cosh d, sinh d, 0], [sinh d, cosh d, 0], [0, 0, 1]]`.
- Half-turn about p: `σ_p(x) = −x − 2⟨p, x⟩p`.
- The translation that slides a to b along their geodesic is a product of two half-turns, about a and then about the midpoint m = (a + b)/‖a + b‖. This is what dragging the view uses.

## 2. Building a closed surface

Take a regular hyperbolic polygon with **n = 4g** sides and interior angles **2π/n**. In flat space those angles would be far too small to close up a polygon. In hyperbolic space a polygon's angles shrink as it grows, so such a polygon exists. For a regular n-gon with interior angle α:

```
cosh(inradius)      = cos(π/n) / sin(α/2)   = cot(π/n)          (α = 2π/n)
cosh(circumradius)  = cot(π/n) · cot(α/2)   = cot²(π/n)
```

For g = 2 (an octagon with 45° corners), `cosh(inradius) = 1 + √2`.

**Gluing.** Side k has its midpoint in direction θ_k = 2πk/n. The map

```
g_k = translation(θ_k, 2·inradius)
```

slides the opposite side (k + n/2) exactly onto side k. These n maps (n/2 of them and their inverses) generate a group Γ. Poincaré's polygon theorem says the copies γ·P for γ ∈ Γ tile the plane without overlaps, which holds here because the n corners all get identified to **one** point whose angles sum to n · 2π/n = 2π.

Euler characteristic: χ = V − E + F = 1 − n/2 + 1 = 2 − 2g, so the surface has genus g. Gauss–Bonnet confirms its area is −2πχ = **4π(g − 1)**.

For g = 2 this is the **Bolza surface**, the genus-2 surface with the most symmetry and the longest shortest closed geodesic (systole = 2·arccosh(1 + √2) ≈ 3.057).

**Point location.** Side k lies on the geodesic `{p : ⟨n_k, p⟩ = 0}` with unit normal `n_k = (sinh r, cosh r cos θ_k, cosh r sin θ_k)` (r = inradius), and `⟨n_k, p⟩ = sinh(signed distance)`. A point is inside P when every `⟨n_k, p⟩ ≤ 0`. If side k is violated, apply `g_k⁻¹ = g_{k+n/2}` and repeat (`Surface.reduce`).

## 3. Particle Life on the surface

Each particle has a species s, a position p ∈ P and a tangent velocity v. The force that particle j exerts on particle i is

```
F_ij = K(d_ij / r_max, A[s_i][s_j]) · û_ij
K(x, a) = x/β − 1                          if x < β        (always repel up close)
        = a · (1 − |2x − 1 − β| / (1 − β))  if β ≤ x < 1   (follow the rule)
        = 0                                otherwise
```

Here û_ij is the unit tangent at p_i pointing along the geodesic to p_j. This is the standard Particle Life kernel; only the notions of distance and direction have changed.

**Integration** (semi-implicit Euler on a manifold):

```
v ← v · 0.5^(dt / t_half) + dt · r_max · force · Σ_j F_ij
p' = exp_p(dt · v)
v ← PT_{p→p'}(v)
if p' ∉ P: apply the gluing map to both p' and v
```

Parallel transport is the step people tend to forget. Without it, a particle coasting in a straight line would slowly turn, because the tangent planes at p and p' are different planes in ℝ²˒¹.

### Ghosts

A particle near side k must feel neighbours that sit just across that side, which on the surface means just inside the opposite side. Each step we copy every particle that lies within r_max of ∂P through the group elements whose tiles touch P. For the octagon those are the 8 edge-neighbours plus 40 corner-neighbours: **48 tiles**. A cheap test `(γp)_t ≤ cosh(R + r_max)` discards copies that can't reach P.

As long as r_max is less than the injectivity radius (≈ 1.53 for Bolza), each pair interacts through exactly one copy.

## 4. A spatial index for hyperbolic space

A uniform grid in the Poincaré disk is useless: area grows exponentially toward the rim, so outer cells would hold thousands of times more space than central ones. Instead we use the **binary tiling** of the upper half-plane.

1. Map to the half-plane: `Y = 1 / (t − x)`, `X = −y · Y`. The metric becomes `ds = |dw| / Y`.
2. Row k holds `Y ∈ [e^{kL}, e^{(k+1)L})`, and each cell in row k is `W·e^{kL}` wide. Every cell has (roughly) the same hyperbolic size W × L.
3. **Exact queries:** the hyperbolic circle of radius r around (X₀, Y₀) is a Euclidean circle with centre (X₀, Y₀ cosh r) and radius Y₀ sinh r. Its bounding box is `X ∈ X₀ ± Y₀ sinh r`, `Y ∈ [Y₀e^{−r}, Y₀e^{r}]`, so we visit exactly the cells that box covers.

Points are sorted by cell key once per step (a typed-array sort), giving contiguous runs per cell. `test/spatial.test.js` checks the results against brute force.

## 5. Rendering

Particle positions (t, x, y, species) go to the GPU once per frame. For each visible tile γ the same buffer is drawn again with the uniform `M = camera · γ`, and the vertex shader projects to the Poincaré disk:

```
z = (q_x, q_y) / (1 + q_t),   q = M p
```

The Poincaré metric is `ds = 2|dz| / (1 − |z|²)`, so a particle of hyperbolic radius s is drawn with a pixel diameter of `s · (1 − |z|²) · R_disk`. That conformal factor is the whole "shrinking toward the rim" effect. Sub-pixel particles fade by area instead of disappearing, so far regions keep their colour texture.

Tile edges are geodesic arcs sampled with `geodesicLerp` and transformed by the same matrices. Each tile draws only sides 0…n/2−1, so every shared edge is drawn once.

**Level of detail.** A tile at distance δ from the camera is about e^{−δ} as large on screen. Beyond δ = 3.5 we draw only a random prefix of the particle buffer, shrinking exponentially.

**Klein model.** `z = (q_x, q_y)/q_t` maps geodesics to straight lines, at the cost of angles. Toggle it with **K**.

## 6. The camera

The camera is a Lorentz matrix C from world to view coordinates. Dragging from view point a to view point b applies the transvection T(a→b): `C ← T·C`. The world is invariant under Γ, so `C` and `C·γ` show the same picture. After every move we pick γ so that the camera position `C⁻¹·o` lies in P. You can fly in one direction forever and the matrix entries stay bounded.

## Further reading

- J. W. Cannon, W. J. Floyd, R. Kenyon, W. R. Parry, *Hyperbolic Geometry* (1997), a great tour of all the models.
- W. Thurston, *Three-Dimensional Geometry and Topology*, Vol. 1, for gluing polygons into surfaces.
- [Bolza surface](https://en.wikipedia.org/wiki/Bolza_surface) on Wikipedia.
