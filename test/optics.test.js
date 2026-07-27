// optics.test.js
//
// Validates src/optics.js against known analytic results from geometric
// optics — not just internal consistency with itself. Every expected value
// below is derived independently, by hand, from a textbook formula (Hecht,
// "Optics", 5th ed.; Born & Wolf, "Principles of Optics", 7th ed.) so a
// failing test means the *physics* is wrong, not just that behavior changed.
//
// Run with: node --test test/
// (Node's built-in test runner, no dependencies required.)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// optics.js is a plain browser <script> that assigns `window.Optics = {...}`.
// Load it into a fresh vm context (its own real global object, including
// Math) rather than modifying the source file to support `require()`.
const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'optics.js'), 'utf8');
vm.runInContext(source, sandbox, { filename: 'optics.js' });
const Optics = sandbox.Optics;

const EPS = 1e-3;
function approx(actual, expected, eps = EPS, msg) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    msg || `expected ${actual} to be within ${eps} of ${expected}`
  );
}
function approxVec(actual, expected, eps = EPS) {
  approx(actual.x, expected.x, eps, `x: expected ${actual.x} ≈ ${expected.x}`);
  approx(actual.y, expected.y, eps, `y: expected ${actual.y} ≈ ${expected.y}`);
}

// ---------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------

test('vector helpers: fromAngle/rotate/normalize/dot/length are self-consistent', () => {
  approxVec(Optics.fromAngle(0), { x: 1, y: 0 });
  approxVec(Optics.fromAngle(Math.PI / 2), { x: 0, y: 1 });

  approxVec(Optics.rotate({ x: 1, y: 0 }, Math.PI / 2), { x: 0, y: 1 });

  approxVec(Optics.normalize({ x: 3, y: 4 }), { x: 0.6, y: 0.8 });

  const v = { x: 5, y: -12 };
  approx(Optics.length(v), Math.sqrt(Optics.dot(v, v)));
  approx(Optics.length(v), 13);
});

// ---------------------------------------------------------------------
// Snell's law (vector form): n1 sin(theta1) = n2 sin(theta2)
// ---------------------------------------------------------------------

test("refractVector: air -> glass at 30 deg matches Snell's law (n1 sin theta1 = n2 sin theta2)", () => {
  // Incidence angle measured from the normal (0, -1); incident ray travels
  // in +y with a sideways +x component, per cosI = -dot(normal, dir).
  const theta1 = (30 * Math.PI) / 180;
  const dir = { x: Math.sin(theta1), y: Math.cos(theta1) };
  const normal = { x: 0, y: -1 };
  const n1 = 1.0, n2 = 1.5;

  const out = Optics.refractVector(dir, normal, n1, n2);
  assert.ok(out, 'expected a transmitted ray (no TIR entering a denser medium)');

  // Independently derived expected value:
  // sin(theta2) = (n1/n2) sin(theta1) = (1/1.5) * 0.5 = 0.333333...
  const sinTheta2 = (n1 / n2) * Math.sin(theta1);
  const theta2 = Math.asin(sinTheta2);
  approxVec(out, { x: Math.sin(theta2), y: Math.cos(theta2) });

  // Bending toward the normal when entering a denser medium.
  assert.ok(theta2 < theta1);
});

test('refractVector: total internal reflection beyond the critical angle returns null', () => {
  // Critical angle glass(n=1.5) -> air: theta_c = asin(1/1.5) = 41.81 deg.
  const thetaC = Math.asin(1.0 / 1.5);
  const theta1 = thetaC + (10 * Math.PI) / 180; // comfortably past critical
  const dir = { x: Math.sin(theta1), y: Math.cos(theta1) };
  const normal = { x: 0, y: -1 };

  const out = Optics.refractVector(dir, normal, 1.5, 1.0);
  assert.equal(out, null);
});

test('refractVector: glass -> air below the critical angle still transmits and bends away from the normal', () => {
  const thetaC = Math.asin(1.0 / 1.5);
  const theta1 = thetaC - (10 * Math.PI) / 180; // below critical
  const dir = { x: Math.sin(theta1), y: Math.cos(theta1) };
  const normal = { x: 0, y: -1 };

  const out = Optics.refractVector(dir, normal, 1.5, 1.0);
  assert.ok(out);
  const theta2 = Math.atan2(out.x, out.y);
  assert.ok(theta2 > theta1, 'leaving a denser medium should bend away from the normal');
});

test('refractVector: normal incidence passes straight through regardless of the index ratio', () => {
  // sin(0) = 0 for any n1/n2, so theta_t = 0 -- direction must be unchanged.
  const dir = { x: 0, y: 1 };
  const normal = { x: 0, y: -1 };
  approxVec(Optics.refractVector(dir, normal, 1.0, 2.4), dir, 1e-9);
});

// ---------------------------------------------------------------------
// Reflection: angle of incidence = angle of reflection
// ---------------------------------------------------------------------

test('reflect: angle of incidence equals angle of reflection', () => {
  const dir = Optics.normalize({ x: 0.6, y: 0.8 });
  const normal = { x: 0, y: -1 };
  const out = Optics.reflect(dir, normal);

  const cosIncidence = -Optics.dot(normal, dir);
  const cosReflection = Optics.dot(normal, out);
  approx(cosReflection, cosIncidence);
});

// ---------------------------------------------------------------------
// Thin-lens graphical construction
// ---------------------------------------------------------------------

function axisCrossingX(point, dir) {
  // Where does the ray from `point` along `dir` cross y = 0?
  const s = -point.y / dir.y;
  return point.x + dir.x * s;
}

test('refractThinLens: parallel rays converge to the same real focal point regardless of height (converging lens)', () => {
  const lens = { center: { x: 0, y: 0 }, angle: 0, focalLength: 100 };
  for (const y of [30, -15, 55]) {
    const point = { x: 0, y };
    const dir = { x: 1, y: 0 }; // parallel to the optical axis
    const out = Optics.refractThinLens(point, dir, lens);
    approx(axisCrossingX(point, out), 100, 1e-2, `ray at y=${y} should cross the axis at f=100`);
  }
});

test('refractThinLens: parallel rays through a diverging lens appear to come from the virtual focal point', () => {
  const lens = { center: { x: 0, y: 0 }, angle: 0, focalLength: -100 };
  const point = { x: 0, y: 30 };
  const dir = { x: 1, y: 0 };
  const out = Optics.refractThinLens(point, dir, lens);

  // Extend the outgoing ray *backward* -- it should trace back to (f, 0).
  approx(axisCrossingX(point, Optics.scale(out, -1)), -100, 1e-2);
});

// ---------------------------------------------------------------------
// Lensmaker's equation (thin-lens approximation for a realistic lens)
// ---------------------------------------------------------------------

test("effectiveFocalLength: realistic biconvex lens matches the lensmaker's equation 1/f = (n-1)(1/R1 - 1/R2)", () => {
  const lens = { model: 'realistic', r1: 150, r2: -150, glass: 'crown', customA: null, customB: null };
  const n = Optics.lensIndexAt(lens, 550);
  const expectedInvF = (n - 1) * (1 / lens.r1 - 1 / lens.r2);
  const expectedF = 1 / expectedInvF;

  approx(Optics.effectiveFocalLength(lens, 550), expectedF, 1e-6);
  assert.ok(expectedF > 0, 'a symmetric biconvex lens (R1>0, R2<0) must be converging');
});

test('effectiveFocalLength: ideal lens returns its stored focal length unchanged', () => {
  const lens = { model: 'ideal', focalLength: 87 };
  approx(Optics.effectiveFocalLength(lens, 550), 87, 1e-9);
});

// ---------------------------------------------------------------------
// Mirror curvature: f = R/2 (paraxial spherical mirror equivalence)
// ---------------------------------------------------------------------

test('applyMirrorCurvature: concave mirror focuses parallel rays at f = R/2', () => {
  const mirror = { center: { x: 0, y: 0 }, angle: 0, surface: 'concave', radius: 200 };
  const point = { x: 0, y: 30 };
  const dir = { x: 1, y: 0 }; // already-reflected ray, traveling parallel to axis
  const out = Optics.applyMirrorCurvature(point, dir, mirror);
  approx(axisCrossingX(point, out), 100, 1e-2, 'R=200 concave mirror should focus at f=R/2=100');
});

test('applyMirrorCurvature: convex mirror diverges as if from a virtual focus at f = -R/2', () => {
  const mirror = { center: { x: 0, y: 0 }, angle: 0, surface: 'convex', radius: 200 };
  const point = { x: 0, y: 30 };
  const dir = { x: 1, y: 0 };
  const out = Optics.applyMirrorCurvature(point, dir, mirror);
  approx(axisCrossingX(point, Optics.scale(out, -1)), -100, 1e-2);
});

test('applyMirrorCurvature: flat mirror leaves the reflected ray direction untouched', () => {
  const mirror = { center: { x: 0, y: 0 }, angle: 0, surface: 'flat', radius: 200 };
  const dir = { x: 0.6, y: 0.8 };
  approxVec(Optics.applyMirrorCurvature({ x: 0, y: 30 }, dir, mirror), dir, 1e-12);
});

// ---------------------------------------------------------------------
// Edge case: a lens radius of exactly 0 (reachable via the R1/R2 sliders,
// which step straight through it) is not a physical surface -- it must be
// clamped rather than silently producing NaN/Infinity or a zero-radius
// "point" surface no ray can ever hit.
// ---------------------------------------------------------------------

test('effectiveFocalLength/buildLensSurfaces: a lens radius of exactly 0 is clamped, not left degenerate', () => {
  const lens = {
    model: 'realistic', r1: 0, r2: -150, glass: 'crown', customA: null, customB: null,
    center: { x: 0, y: 0 }, angle: 0, thickness: 30, height: 150,
  };
  const f = Optics.effectiveFocalLength(lens, 550);
  assert.ok(Number.isFinite(f) && f > 0, 'a zero radius must not produce NaN/Infinity');

  const surfaces = Optics.buildLensSurfaces(lens);
  assert.ok(surfaces.frontRadius >= 1, 'the front surface radius must be clamped away from 0');
});

// ---------------------------------------------------------------------
// Cauchy dispersion: n(lambda) = A + B/lambda^2
// ---------------------------------------------------------------------

test('cauchyIndex: shorter (blue) wavelengths refract more than longer (red) ones for both glasses', () => {
  const crown = Optics.GLASS_PRESETS.crown;
  const flint = Optics.GLASS_PRESETS.flint;

  const nCrownBlue = Optics.cauchyIndex(crown.A, crown.B, 400);
  const nCrownRed = Optics.cauchyIndex(crown.A, crown.B, 700);
  const nFlintBlue = Optics.cauchyIndex(flint.A, flint.B, 400);
  const nFlintRed = Optics.cauchyIndex(flint.A, flint.B, 700);

  assert.ok(nCrownBlue > nCrownRed, 'crown glass must be more refractive at 400nm than 700nm');
  assert.ok(nFlintBlue > nFlintRed, 'flint glass must be more refractive at 400nm than 700nm');

  const crownSpread = nCrownBlue - nCrownRed;
  const flintSpread = nFlintBlue - nFlintRed;
  assert.ok(flintSpread > crownSpread, 'flint glass is presented as more dispersive than crown glass');
});

// ---------------------------------------------------------------------
// Image formation: the thin-lens equation, 1/do + 1/di = 1/f, m = -di/do
// ---------------------------------------------------------------------

test('computeImageInfo: object at 2f produces a real, inverted, same-size image at 2f (canonical case)', () => {
  const lens = { model: 'ideal', center: { x: 0, y: 0 }, angle: 0, focalLength: 100 };
  const source = { position: { x: -200, y: 0 }, mode: 'point', wavelength: 550 };
  const info = Optics.computeImageInfo(source, lens);

  assert.ok(info.valid);
  approx(info.objectDistance, 200);
  approx(info.imageDistance, 200);
  approx(info.magnification, -1);
  assert.equal(info.real, true);
  assert.equal(info.inverted, true);
});

test('computeImageInfo: object inside the focal length produces a virtual, upright, magnified image (magnifying glass)', () => {
  const lens = { model: 'ideal', center: { x: 0, y: 0 }, angle: 0, focalLength: 100 };
  const source = { position: { x: -50, y: 0 }, mode: 'point', wavelength: 550 };
  const info = Optics.computeImageInfo(source, lens);

  assert.ok(info.valid);
  approx(info.imageDistance, -100);
  approx(info.magnification, 2);
  assert.equal(info.virtual, true);
  assert.equal(info.upright, true);
});

test('computeImageInfo: object at the focal point is reported invalid (image at infinity)', () => {
  const lens = { model: 'ideal', center: { x: 0, y: 0 }, angle: 0, focalLength: 100 };
  const source = { position: { x: -100, y: 0 }, mode: 'point', wavelength: 550 };
  const info = Optics.computeImageInfo(source, lens);
  assert.equal(info.valid, false);
});

test('computeImageInfo: collimated (parallel) input reports the focal plane directly', () => {
  const lens = { model: 'ideal', center: { x: 0, y: 0 }, angle: 0, focalLength: 100 };
  const source = { position: { x: -500, y: 0 }, mode: 'parallel', wavelength: 550 };
  const info = Optics.computeImageInfo(source, lens);
  assert.ok(info.valid);
  assert.ok(info.parallel);
  approx(info.focalLength, 100);
  assert.equal(info.real, true);
});

// ---------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------

test('intersectSegment: a ray along the x-axis crosses a perpendicular segment at the expected point and distance', () => {
  const hit = Optics.intersectSegment({ x: -10, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -5 }, { x: 0, y: 5 });
  assert.ok(hit);
  approxVec(hit.point, { x: 0, y: 0 });
  approx(hit.t, 10);
});

test('intersectCircle: a ray hits the near side of a circle first', () => {
  const hit = Optics.intersectCircle({ x: -10, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 5);
  assert.ok(hit);
  approxVec(hit.point, { x: -5, y: 0 });
  approx(hit.t, 5);
});

// ---------------------------------------------------------------------
// Regression: a lens surface is only the *near* hemisphere of its
// curvature sphere. A naive nearest-t circle intersection can strike the
// far hemisphere instead -- which for a point source sits in empty space
// well before the real glass -- and, being geometrically closer, would
// incorrectly win. This reproduces the exact default-parameter scenario
// (a point source aimed at a stock realistic biconvex lens) that exposed
// the bug: the ray must hit the real front vertex (~x=365), not the
// back surface's phantom far side (~x=95).
// ---------------------------------------------------------------------

test('findElementHit: a point-source ray hits the real front surface of a realistic lens, not the far hemisphere of the back surface', () => {
  const lens = {
    kind: 'lens', model: 'realistic',
    center: { x: 380, y: 0 }, angle: 0, height: 150,
    glass: 'crown', customA: 1.5, customB: 0.0042,
    r1: 150, r2: -150, thickness: 30,
  };
  const origin = { x: 90, y: 5 };
  const dir = Optics.normalize({ x: 1, y: 0.02 });
  const hit = Optics.findElementHit(lens, origin, dir);

  assert.ok(hit);
  assert.equal(hit.surface, 'front');
  approx(hit.point.x, 365, 5, 'expected the front vertex region, not the phantom back-surface hemisphere near x=95');
});

test('traceRay: the same realistic-lens scenario resolves end-to-end without hitting the phantom surface', () => {
  const lens = {
    kind: 'lens', model: 'realistic', center: { x: 380, y: 0 }, angle: 0, height: 150,
    glass: 'crown', customA: 1.5, customB: 0.0042, r1: 150, r2: -150, thickness: 30,
  };
  const viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
  const points = Optics.traceRay({ x: 90, y: 5 }, Optics.normalize({ x: 1, y: 0.02 }), [lens], viewport, 550);
  approx(points[1].x, 365, 5);
});

// ---------------------------------------------------------------------
// Diffraction-limited (Airy disk) and real-ray (spherical aberration) spot
// sizes
// ---------------------------------------------------------------------

test('airyDiskRadius: matches 1.22 * lambda * (working f-number)', () => {
  // f/10 system at 550nm: 1.22 * 0.00055mm * 10 = 0.00671mm.
  approx(Optics.airyDiskRadius(550, 200, 20), 0.00671, 1e-5);
  assert.equal(Optics.airyDiskRadius(550, 200, 0), null);
  assert.equal(Optics.airyDiskRadius(550, Infinity, 20), null);
});

test('computeImageInfo: reports a diffraction-limited Airy radius alongside the geometric image', () => {
  const lens = { model: 'ideal', center: { x: 0, y: 0 }, angle: 0, focalLength: 100, height: 20 };
  const info = Optics.computeImageInfo({ position: { x: -500, y: 0 }, mode: 'parallel', wavelength: 550 }, lens);
  approx(info.airyRadius, Optics.airyDiskRadius(550, 100, 20), 1e-9);
});

test('computeSpotDiagram: an ideal lens (no surface geometry) has no spot diagram', () => {
  assert.equal(Optics.computeSpotDiagram({ model: 'ideal', focalLength: 100 }, { mode: 'parallel', angle: 0, wavelength: 550 }), null);
});

test('computeSpotDiagram: a more strongly curved realistic lens shows more spherical aberration than a weaker one of the same aperture', () => {
  const weakLens = {
    model: 'realistic', center: { x: 0, y: 0 }, angle: 0, height: 100,
    glass: 'crown', customA: null, customB: null, r1: 800, r2: -800, thickness: 20,
  };
  const strongLens = {
    model: 'realistic', center: { x: 0, y: 0 }, angle: 0, height: 100,
    glass: 'crown', customA: null, customB: null, r1: 120, r2: -120, thickness: 20,
  };
  const parallelSource = { mode: 'parallel', angle: 0, wavelength: 550 };

  const weakSpot = Optics.computeSpotDiagram(weakLens, parallelSource, 41);
  const strongSpot = Optics.computeSpotDiagram(strongLens, parallelSource, 41);

  assert.ok(weakSpot && strongSpot);
  assert.ok(strongSpot.rmsRadius > weakSpot.rmsRadius, 'a small-radius (strongly curved) lens should show more spherical aberration');
});

// ---------------------------------------------------------------------
// Regression: the paraxial image plane for a *thick* lens is not simply
// "f from the geometric center" -- that's a thin-lens-only shortcut. Using
// it as the spot-diagram reference plane injects a spurious defocus that
// scales linearly with aperture height, swamping the much smaller
// (roughly cubic-in-height) real spherical aberration signal. Halving the
// aperture should roughly halve the *cube* of the RMS spot radius (an
// 8x drop), not leave it nearly unchanged.
// ---------------------------------------------------------------------

test('computeSpotDiagram: RMS spot radius shrinks roughly with the cube of the aperture height (near the paraxial regime)', () => {
  const makeLens = (height) => ({
    model: 'realistic', center: { x: 0, y: 0 }, angle: 0, height,
    glass: 'crown', customA: null, customB: null, r1: 150, r2: -150, thickness: 30,
  });
  const parallelSource = { mode: 'parallel', angle: 0, wavelength: 550 };

  const spot40 = Optics.computeSpotDiagram(makeLens(40), parallelSource, 41);
  const spot20 = Optics.computeSpotDiagram(makeLens(20), parallelSource, 41);
  assert.ok(spot40 && spot20);

  const ratio = spot40.rmsRadius / spot20.rmsRadius;
  // Ideal cubic scaling for a halved aperture is exactly 8x; allow a wide
  // band (5x-13x) since real (non-paraxial) aberration isn't perfectly
  // cubic, but a defocus-contaminated measurement would show close to 2x.
  assert.ok(ratio > 5 && ratio < 13, `expected ~cubic scaling (ratio near 8), got ${ratio}`);
});

test('computeSpotDiagram: a finite-conjugate (point-source) spot is the same order of magnitude as the collimated-input spot for the same lens', () => {
  const lens = {
    model: 'realistic', center: { x: 0, y: 0 }, angle: 0, height: 100,
    glass: 'crown', customA: null, customB: null, r1: 800, r2: -800, thickness: 20,
  };
  const f = Optics.effectiveFocalLength(lens, 550);
  const parallelSpot = Optics.computeSpotDiagram(lens, { mode: 'parallel', angle: 0, wavelength: 550 }, 41);
  const pointSpot = Optics.computeSpotDiagram(lens, { mode: 'point', position: { x: -2.5 * f, y: 0 }, wavelength: 550 }, 41);

  assert.ok(parallelSpot && pointSpot);
  const ratio = pointSpot.rmsRadius / parallelSpot.rmsRadius;
  assert.ok(ratio > 0.2 && ratio < 5, `expected the same order of magnitude, got ratio ${ratio}`);
});

test('traceRay: a ray through an ideal lens bends toward the focal point and terminates within the viewport', () => {
  const lens = {
    kind: 'lens', model: 'ideal',
    center: { x: 100, y: 0 }, angle: 0, height: 200, focalLength: 50,
  };
  const viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
  const points = Optics.traceRay({ x: 0, y: 20 }, { x: 1, y: 0 }, [lens], viewport, 550);

  assert.ok(points.length >= 3, 'expect origin, lens hit, and a terminating viewport point');
  for (const p of points) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'no NaN/Infinity in a traced ray');
  }
  // The bent ray should be heading down-and-right toward the focal point at
  // x = 150 (lens at x=100 + f=50), so it must cross the axis before x=1000.
  const crossed = points.some((p, i) => i > 0 && points[i - 1].y > 0 && p.y <= 0);
  assert.ok(crossed, 'a ray refracted by a converging lens should cross the optical axis');
});
