# Optical Bench

[![Physics tests](https://github.com/br24563/Optics-Bench/actions/workflows/test.yml/badge.svg)](https://github.com/br24563/Optics-Bench/actions/workflows/test.yml)

A draggable, interactive optics playground that runs entirely in the
browser — no build step, no dependencies. Drag a light source, lenses,
mirrors, and a dispersive prism around an optical-table canvas and watch
real physics compute every ray bend live, validated against the same
textbook formulas you'd find in Hecht or Born & Wolf. Alongside the
interactive bench sits a small set of real lens-design analysis tools —
a ray-fan plot, longitudinal spherical aberration curve, Seidel
coefficient, Lens Data Editor-style prescription table, and a real
Sellmeier glass catalog — a lightweight, browser-native taste of what a
tool like Zemax OpticStudio shows for a single-element system.

**[Live demo →](#)** *(add your GitHub Pages link here once deployed)*

![Ray fan from a point source, focused by a realistic biconvex lens (visible spherical aberration), folded 90° by a mirror](docs/screenshot.png)

## What it does

- **A pannable, zoomable bench.** Drag empty space to move around the
  canvas, and scroll (or the +/− buttons, or the +/− keys) to zoom in and
  out, centered on the cursor — handy once you've got several elements
  spread out further than the window, or want to see fine ray-bending
  detail up close. "Reset view" snaps back to the origin at 100% zoom if
  you get lost.
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
  the Sellmeier or Cauchy dispersion equation, depending on the glass), so
  switch on "white light" and watch a single beam split by wavelength — or
  dial the source wavelength by hand and watch the bend angle shift in
  real time.
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
- **A real glass catalog.** Choose from real Schott glasses (N-BK7,
  N-BAK4, N-SF11, N-SF6, fused silica) via the actual 3-term Sellmeier
  dispersion equation the catalogs publish, alongside the original
  exaggerated "demo" glasses (kept for a clearly-visible dispersion demo)
  and fully custom Cauchy coefficients. Every glass reports its Abbe
  number (V_d) next to its index.
- **Lens-design analysis tools**, for a realistic lens: a **ray-fan plot**
  (transverse aberration vs. pupil coordinate), a **longitudinal spherical
  aberration (LSA) plot**, a **3rd-order Seidel spherical aberration
  coefficient** (an independent paraxial calculation, shown alongside the
  exact ray-traced result), and a **prescription (Lens Data Editor-style)
  table** of the surface-by-surface radius/thickness/glass/index data —
  see [Lens-design analysis tools](#lens-design-analysis-tools) below.

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
vector Snell's law as the realistic lens. A glass's index of refraction
depends on wavelength — shorter (bluer) wavelengths bend more than longer
(redder) ones, the actual reason a prism splits white light into a
spectrum, not a hand-wavy color gradient. Two dispersion models are
available: the real **3-term Sellmeier equation** (Sellmeier, 1871),
`n(λ)² = 1 + Σ Bᵢλ²/(λ²-Cᵢ)`, using the actual published Schott catalog
coefficients for N-BK7, N-BAK4, N-SF11, N-SF6, and fused silica (each
matched against its known d-line index to 5 significant figures); and a
simpler 2-term **Cauchy equation**, `n(λ) = A + B/λ²` (Hecht §3.7.1), used
for the "demo" glasses and custom coefficients. Real BK7/flint dispersion
across the visible spectrum is under a degree — genuinely subtle at
canvas scale — so the demo glasses' `B` coefficients are moderately
exaggerated to make the effect easier to see; the real-glass presets use
unmodified catalog data.

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

## Lens-design analysis tools

Select a realistic lens and two more panels appear alongside the
image-formation readout — the same kind of analysis a real lens-design
tool (Zemax OpticStudio, Code V, ...) shows for a single element:

- **Ray-fan plot** — transverse ray aberration (ΔY, µm) at the paraxial
  image plane vs. normalized pupil coordinate (Pᵧ, −1 to 1). A perfect,
  unaberrated lens plots as a flat line at zero; the S-shaped bow you'll
  actually see is real, ray-traced spherical aberration.
- **Longitudinal spherical aberration (LSA) plot** — each ray's own focus
  shift from the paraxial focus (mm) vs. the pupil height it passed
  through. Marginal rays bowing toward negative LSA is the classic
  signature of undercorrected spherical aberration in a simple converging
  lens.
- **3rd-order (Seidel) spherical aberration** — a genuinely independent
  calculation from the exact ray trace: a true paraxial marginal-ray trace
  through both surfaces, combined into the classic Seidel sum
  (Welford, *Aberrations of Optical Systems*, 2nd ed., Ch. 9; Kingslake &
  Johnson, *Lens Design Fundamentals*, 2nd ed., Ch. 5),
  `S_I = Σ_surfaces A²yΔ(u/n)`, predicting the marginal ray's transverse
  aberration as `−S_I / (2n'u')`. This number is shown next to the exact
  ray-traced peak so you can see 3rd-order theory agree to a fraction of a
  percent at a small aperture, and increasingly diverge as the aperture
  grows and higher-order aberrations start to dominate — a direct,
  visible demonstration of *why* lens designers need more than 3rd-order
  theory for fast optics.
- **Prescription data** — a compact, Lens Data Editor-style table of the
  lens's two surfaces (radius, thickness, glass, index at the current
  wavelength) plus its semi-aperture and Abbe number.

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
- The Sellmeier equation against each real glass's published index and
  Abbe number
- The 3rd-order Seidel spherical aberration prediction against the exact
  ray trace, confirming agreement to within 1% at a small (near-paraxial)
  aperture and increasing disagreement at a larger one — the two
  calculations share no code, so their convergence is a genuine check on
  both
- A geometric regression: a lens surface is only the *near* hemisphere of
  its curvature sphere — a naive nearest-intersection test can strike the
  sphere's far side (which, for a point source, sits in empty space well
  before the real glass) and incorrectly "win" because it's closer. This
  was an actual bug caught by writing this test suite, now covered by a
  permanent regression test.
- A methodology regression: the paraxial reference plane for the spot
  diagram/ray-fan must come from tracing an actual near-axis ray through
  the *real* (thick) surfaces, not from the thin-lens focal length
  measured at the lens's geometric center — the latter injects a spurious
  defocus that swamps the real (much smaller, cubic-in-aperture)
  aberration signal. Also caught by this test suite; also now a permanent
  regression test.

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
- With a realistic lens selected and collimated (**Parallel**) input,
  watch the **ray-fan** and **LSA** plots update live as you drag the
  R1/R2 sliders toward smaller radii (a faster, more strongly-curved
  lens) — and watch the 3rd-order Seidel prediction increasingly diverge
  from the exact ray-traced peak as the aberration grows.
- Switch a lens's glass from a **demo** preset to a **real** one (e.g.
  N-BK7) and back, and watch the effective focal length and the spot size
  shift slightly — real glass dispersion is genuinely different from the
  exaggerated demo presets, even though both use the same underlying
  Snell's-law ray trace.

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
