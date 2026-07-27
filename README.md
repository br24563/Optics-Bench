# Optical Bench

[![Physics tests](https://github.com/br24563/Optics-Bench/actions/workflows/test.yml/badge.svg)](https://github.com/br24563/Optics-Bench/actions/workflows/test.yml)

A draggable, interactive optics playground that runs entirely in the
browser — no build step, no dependencies. Drag a light source, lenses,
mirrors, and a dispersive prism around an optical-table canvas and watch
real physics compute every ray bend live, validated against the same
textbook formulas you'd find in Hecht or Born & Wolf.

**[Live demo →](#)** *(add your GitHub Pages link here once deployed)*

![Ray fan from a point source, focused by a realistic biconvex lens (visible spherical aberration), folded 90° by a mirror](docs/screenshot.png)

## What it does

- **A pannable bench.** Drag empty space to move around the canvas — handy
  once you've got several elements spread out further than the window.
  "Reset view" snaps back to the origin if you get lost.
- **An optical axis you can build on.** A horizontal reference line runs
  across the bench. Drag any element near it and it snaps into alignment —
  drag it away and it's free again. Drag the axis itself to reposition your
  whole reference line.
- **Two lens models.** Toggle a lens between an *ideal thin lens* (the
  graphical construction taught on paper) and a *realistic lens* that traces
  actual Snell's law through two spherical glass surfaces you define by
  radius of curvature, thickness, and glass type — real spherical
  aberration and all. Aperture height is adjustable on either model, and
  the two glass surfaces are geometrically guaranteed never to cross each
  other even at extreme radius/thickness combinations.
- **Flat, concave, and convex mirrors**, each reflecting correctly with the
  focusing behavior of a real spherical mirror.
- **A dispersive prism.** Its refractive index depends on wavelength (via
  Cauchy's equation), so switch on "white light" and watch a single beam
  split by wavelength — or dial the source wavelength by hand and watch the
  bend angle shift in real time.
- **A live image-formation readout.** Select a lens and see the actual
  object distance, image distance, magnification, and whether the image is
  real/virtual and upright/inverted — computed from the thin-lens equation
  as you drag things around.
- **Diffraction- vs. aberration-limited analysis.** The same readout also
  reports the diffraction-limited Airy disk radius for the current aperture
  and wavelength, and — for a realistic lens — the actual RMS spot radius
  from real ray tracing, so you can see directly whether a configuration is
  limited by diffraction or by spherical aberration (often by three or more
  orders of magnitude).
- **Quantitative controls everywhere.** Every slider has a paired number
  field for exact values — position, angle, focal length, radii, apex
  angle, wavelength — so you can dial in a precise configuration, not just
  eyeball it.
- **Keyboard accessible.** Tab to the canvas, click (or arrow-key-cycle) to
  select the source, an element, or the axis, then use the arrow keys to
  nudge it — hold Shift to move faster. Delete/Backspace removes the
  selected element; Escape deselects.
- **Save and load scenes.** "Save scene…" downloads the current source and
  every element as plain JSON; "Load scene…" restores it exactly, so a
  configuration can be shared or reproduced precisely.

## The physics

**Ideal lenses** use the classic thin-lens *graphical ray-tracing
construction* (Hecht, *Optics*, 5th ed., §5.2): a ray through a lens's
optical center is never deviated, so every ray parallel to it must bend to
cross the same point on the focal plane. `refractThinLens` in
`src/optics.js` implements exactly this rule, generalized to rays at any
angle and lenses at any position/orientation — not just rays along one
fixed optical axis.

**Realistic lenses** trace real vector Snell's law
(`n₁ sinθ₁ = n₂ sinθ₂`, solved as a vector equation, not a paraxial
approximation) through two spherical surfaces, using the standard
lensmaker sign convention (a surface radius is positive if its center of
curvature sits on the outgoing side). A biconvex lens is `R1 > 0, R2 < 0`.
Because this traces the *actual* geometry rather than an idealized
approximation, rays far from the axis focus slightly differently than
paraxial rays — genuine spherical aberration falls out of the math for
free, no separate aberration formula required.

**Mirrors** reflect with angle of incidence equal to angle of reflection.
Curved mirrors add a focusing correction equivalent to a thin lens of focal
length `f = R/2` — the standard paraxial mirror equation — applied *after*
the flat reflection, so the same `refractThinLens` helper does double duty
here.

**The prism** refracts through two real flat glass faces using the same
vector Snell's law as the realistic lens. Its index of refraction follows
Cauchy's equation, `n(λ) = A + B/λ²`, so shorter (bluer) wavelengths bend
more than longer (redder) ones — the actual reason a prism splits white
light into a spectrum, not a hand-wavy color gradient. (Real BK7/flint
dispersion across the visible spectrum is under a degree — genuinely subtle
at canvas scale — so the `B` coefficients here are moderately exaggerated
from real glass data to make it easier to see; the wavelength-dependence
itself is the real Cauchy relation.)

**Total internal reflection** is handled as a real physical case, not an
edge-case crash: if light hits a glass-to-air boundary steeper than the
critical angle, it reflects back into the material instead of vanishing.

**Diffraction and aberration.** The diffraction-limited spot size uses the
standard Airy-disk result, `r = 1.22 λ (working f-number)` (Hecht §10.2.5;
Born & Wolf, *Principles of Optics*, 7th ed., §8.5.2). The real-ray spot
diagram for a realistic lens traces a fan of rays across the full aperture
and measures their spread at the *paraxial* image plane — found by tracing
an actual near-axis ray through the real surfaces rather than assuming the
thin-lens focal length applies at the lens's geometric center (which is
only exactly true for a lens of negligible thickness; a real, thick lens's
paraxial focus sits at a principal-plane-shifted position).

## Units

The bench treats **one canvas unit as 1mm**. This isn't just cosmetic: it's
what makes a wavelength in nanometers and a lens dimension in world units
combine into a physically meaningful, dimensionally-correct diffraction
spot size in micrometers, rather than an arbitrary "pixels" quantity with
no real-world scale.

## Validation

The physics in `src/optics.js` is checked against known analytic results
from geometric optics — not just internal consistency, but independently
hand-derived textbook values — in `test/optics.test.js`:

- Snell's law (vector form) against a hand-computed refraction angle, plus
  total-internal-reflection and normal-incidence edge cases
- The thin-lens graphical construction (parallel rays converging to/from
  the correct focal point, both converging and diverging)
- The lensmaker's equation for a realistic biconvex lens
- The paraxial mirror equation, `f = R/2`, for concave/convex/flat mirrors
- Cauchy dispersion ordering (blue bends more than red) and that flint
  glass is more dispersive than crown
- The thin-lens image-formation equation against two canonical textbook
  cases: an object at `2f` (real, inverted, unit magnification) and an
  object inside `f` (virtual, upright, magnified — the magnifying-glass
  case)
- The Airy-disk diffraction formula and that RMS spot radius scales
  correctly (roughly with the cube of aperture height, as expected for
  spherical aberration near the paraxial regime)
- A geometric regression: a lens surface is only the *near* hemisphere of
  its curvature sphere — a naive nearest-intersection test can strike the
  sphere's far side (which, for a point source, sits in empty space well
  before the real glass) and incorrectly "win" because it's closer. This
  was an actual bug caught by writing this test suite, now covered by a
  permanent regression test.

Run the suite (Node's built-in test runner, no dependencies) with:

```bash
npm test
# or directly: node --test test/
```

Requires Node 18+. A GitHub Actions workflow (`.github/workflows/test.yml`)
runs it on every push and pull request.

## Project structure

```
optical-bench/
├── index.html              # page shell + full control panel markup
├── style.css                # optical-table visual theme
├── package.json              # `npm test` script; no runtime dependencies
├── src/
│   ├── optics.js               # pure physics/math — no DOM code
│   ├── render.js               # canvas drawing — no physics code
│   └── interaction.js          # scene state, dragging, panel wiring
├── test/
│   └── optics.test.js          # physics validated against textbook formulas
├── docs/
│   └── screenshot.png
├── .github/workflows/
│   └── test.yml                 # CI: runs the test suite on push/PR
└── README.md
```

The split between `optics.js` (math), `render.js` (drawing), and
`interaction.js` (state/UI) is deliberate: you can read the ray-tracing
logic in `optics.js` without any canvas or event-handling code in the way.
Every element type (lens, mirror, prism) implements the same two-function
interface — `findElementHit` and `propagateElement` — so `traceRay` stays a
short, generic loop regardless of how complex an individual element's
internal physics is.

## Running it locally

No build tools, no npm install required to *run* it. Just open `index.html`
in a browser, or serve the folder locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

(`npm install` is only needed if you want to run the test suite, and even
then it has no dependencies to install — `npm test` works standalone.)

## Deploying to GitHub Pages

1. Push this repo to GitHub (as a **public** repo — Pages needs that on the
   free plan).
2. Go to **Settings → Pages**.
3. Under "Build and deployment," set **Source** to `Deploy from a branch`,
   branch `main`, folder `/ (root)`.
4. Save — GitHub will publish it at `https://<username>.github.io/<repo>/`
   within a minute or two.

## Try this

- Add a lens, switch it to **Realistic**, and drag the source close — watch
  the outer rays focus short of the paraxial focal tick marks, and check
  the **RMS spot radius** in the image-formation panel against the
  **Airy radius** right above it. That's real spherical aberration, easily
  three to four orders of magnitude bigger than the diffraction limit for
  a fast lens — not a bug.
- Add a prism and check **Simulate white light** — the exit rays separate
  by wavelength (switch the prism's glass to *flint* for a stronger
  spread), though real dispersion across the visible spectrum is subtle
  enough that you may want to widen the browser window or zoom in on the
  exit face to see the separation clearly.
- Put a lens on the axis, drag the source further than the focal length
  away, and watch the **Image formation** panel report a real, inverted
  image — then drag the source inside the focal length and watch it flip
  to virtual and upright.
- Select an element and nudge it with the arrow keys instead of the mouse
  (Shift for a bigger step) — then hit **Save scene…** to download the
  configuration as JSON, and **Load scene…** to bring it back exactly.

## Ideas for extending it further

- A second prism or lens after the first, to recombine a dispersed
  spectrum back into white light (Newton's classic experiment)
- Polarization and a simple Malus's-law polarizer element
- An anti-reflection coating toggle showing partial reflection at each
  glass surface, not just transmission
- An exact thick-lens principal-plane formula for the analytic
  image-formation readout on realistic lenses (currently a thin-lens
  paraxial estimate; the ray-traced spot diagram already accounts for the
  real geometry, but the numeric object/image distances shown do not)

## License

MIT — see [LICENSE](LICENSE).
