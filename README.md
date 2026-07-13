# Optical Bench

A draggable, interactive thin-lens and mirror ray tracer that runs entirely
in the browser — no build step, no dependencies.

**[Live demo →](#)** *(add your GitHub Pages link here once deployed)*

![screenshot placeholder](docs/screenshot.png)

## What it does

Drag a light source, one or more lenses, and flat mirrors around a canvas
"optical table," and watch the ray paths update in real time. Switch the
source between a diverging point source and a collimated (parallel) beam to
see classic behaviors like a beam converging to a lens's focal point, or a
point source forming a real/virtual image.

This isn't a canned animation — every bend you see is computed from actual
optics equations each time you drag something.

## The physics

**Lenses** use the standard thin-lens *graphical ray-tracing construction*
that gets taught by hand on paper:

> A ray that passes through a lens's optical center is never deviated. Every
> other ray that enters *parallel* to it must therefore bend so that,
> extended forward, it crosses the same point on the focal plane that the
> center-ray does.

`src/optics.js` implements exactly this rule, generalized to rays at any
angle and lenses placed anywhere on the canvas at any orientation — not
just rays along a single fixed optical axis. Positive focal length gives a
converging (convex) lens; negative gives a diverging (concave) one, and the
same formula naturally produces the correct virtual-focus behavior for it.

**Mirrors** use plain specular reflection, angle of incidence equal to angle
of reflection: `d' = d - 2(d·n)n`.

**Ray tracing** repeatedly finds the nearest element a ray intersects,
applies the appropriate rule, and continues the ray from that point — up to
a bounce limit — so light can pass through multiple lenses or bounce off
several mirrors in sequence.

## Project structure

```
optical-bench/
├── index.html          # page shell + control panel markup
├── style.css            # optical-table visual theme
├── src/
│   ├── optics.js         # pure physics/math — no DOM code
│   ├── render.js         # canvas drawing — no physics code
│   └── interaction.js    # scene state, dragging, panel wiring
└── README.md
```

The split between `optics.js` (math), `render.js` (drawing), and
`interaction.js` (state/UI) is deliberate: you can read the ray-tracing
logic in `optics.js` without any canvas or event-handling code in the way.

## Running it locally

No build tools, no npm install. Just open `index.html` in a browser, or
serve the folder locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under "Build and deployment," set **Source** to `Deploy from a branch`,
   branch `main`, folder `/ (root)`.
4. Save — GitHub will publish it at `https://<username>.github.io/<repo>/`
   within a minute or two.

## Ideas for extending it

- Curved mirrors (concave/convex) via proper surface-normal reflection
- A second refraction mode using real Snell's law at each lens surface
  (rather than the idealized thin-lens approximation)
- An image-formation readout: real/virtual, upright/inverted, magnification
- Wavelength-dependent dispersion through a prism element

## License

MIT — see [LICENSE](LICENSE).
