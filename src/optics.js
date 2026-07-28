// optics.js
// Pure physics + math. Nothing in this file touches the DOM or canvas.
//
// Elements supported:
//   lens   (model: 'ideal'      -> thin-lens graphical construction)
//          (model: 'realistic' -> real Snell's law through two spherical surfaces)
//   mirror (surface: 'flat' | 'concave' | 'convex')
//   prism  (real Snell's law through two flat faces, with wavelength dispersion)

// ---------- vector helpers ----------

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function scale(a, s) { return { x: a.x * s, y: a.y * s }; }
function dot(a, b) { return a.x * b.x + a.y * b.y; }
function length(a) { return Math.hypot(a.x, a.y); }

function normalize(a) {
  const len = length(a);
  return len === 0 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

function fromAngle(angle) {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function rotate(v, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

// ---------- shared element geometry ----------
// Ideal lenses and mirrors are drawn/hit as a flat chord perpendicular to
// their local optical axis. `angle` is the direction that axis faces.

function elementEndpoints(el) {
  const axis = fromAngle(el.angle);
  const along = { x: -axis.y, y: axis.x };
  const half = el.height / 2;
  return {
    a: add(el.center, scale(along, -half)),
    b: add(el.center, scale(along, half)),
  };
}

function withinAperture(point, center, tangent, halfHeight) {
  const offset = dot(sub(point, center), tangent);
  return Math.abs(offset) <= halfHeight;
}

// ---------- ray / segment / circle intersection ----------

function intersectSegment(origin, dir, p1, p2) {
  const v1 = sub(origin, p1);
  const v2 = sub(p2, p1);
  const v3 = { x: -dir.y, y: dir.x };

  const denom = dot(v2, v3);
  if (Math.abs(denom) < 1e-9) return null;

  const t1 = (v2.x * v1.y - v2.y * v1.x) / denom;
  const t2 = dot(v1, v3) / denom;

  if (t1 > 1e-6 && t2 >= 0 && t2 <= 1) {
    return { t: t1, point: add(origin, scale(dir, t1)) };
  }
  return null;
}

function intersectCircle(origin, dir, center, radius) {
  const oc = sub(origin, center);
  const b = 2 * dot(dir, oc);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / 2;
  const t2 = (-b + sq) / 2;
  const candidates = [t1, t2].filter((t) => t > 1e-6).sort((a, b2) => a - b2);
  if (candidates.length === 0) return null;
  const t = candidates[0];
  return { t, point: add(origin, scale(dir, t)) };
}

// A lens surface is only physically the *near* hemisphere of its curvature
// sphere -- the half facing the vertex. The sphere's radius is typically
// much larger than the lens thickness (as with any real lens), so its far
// hemisphere extends well past the lens body, often back through the space
// where a point source sits. A plain nearest-t circle intersection (as
// `intersectCircle` does) can't tell the two hemispheres apart and will
// happily report a ray "hitting" that phantom far side as if it were glass.
// This restricts candidates to the hemisphere containing `vertex` before
// picking the nearest one, so only the real surface can ever be hit.
function intersectSphereHemisphere(origin, dir, center, radius, vertex) {
  const oc = sub(origin, center);
  const b = 2 * dot(dir, oc);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const vertexDir = normalize(sub(vertex, center));
  const candidates = [(-b - sq) / 2, (-b + sq) / 2]
    .filter((t) => t > 1e-6)
    .map((t) => ({ t, point: add(origin, scale(dir, t)) }))
    .filter((hit) => dot(sub(hit.point, center), vertexDir) > 0)
    .sort((a, b2) => a.t - b2.t);
  return candidates.length ? candidates[0] : null;
}

function intersectBounds(origin, dir, minX, minY, maxX, maxY) {
  const candidates = [];
  const edges = [
    [{ x: minX, y: minY }, { x: maxX, y: minY }],
    [{ x: maxX, y: minY }, { x: maxX, y: maxY }],
    [{ x: maxX, y: maxY }, { x: minX, y: maxY }],
    [{ x: minX, y: maxY }, { x: minX, y: minY }],
  ];
  for (const [p1, p2] of edges) {
    const hit = intersectSegment(origin, dir, p1, p2);
    if (hit) candidates.push(hit);
  }
  if (candidates.length === 0) return add(origin, scale(dir, Math.max(maxX - minX, maxY - minY)));
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0].point;
}

// ---------- reflection & refraction primitives ----------

function reflect(dir, normal) {
  const d = dot(dir, normal);
  return normalize(sub(dir, scale(normal, 2 * d)));
}

/**
 * Vector form of Snell's law, n1 sin(theta1) = n2 sin(theta2), solved
 * directly as a vector equation rather than a small-angle (paraxial)
 * approximation (Hecht, "Optics", 5th ed., Eq. 4.55-4.57; Glassner (ed.),
 * "An Introduction to Ray Tracing", Sec. 1.2). `normal` need not be
 * pre-oriented against `dir` — this flips it automatically.
 * @param {{x:number,y:number}} dir unit incident direction
 * @param {{x:number,y:number}} normal surface normal (either orientation)
 * @param {number} n1 incident-side refractive index
 * @param {number} n2 transmitted-side refractive index
 * @returns {{x:number,y:number}|null} unit refracted direction, or null on total internal reflection
 */
function refractVector(dir, normal, n1, n2) {
  let nrm = normal;
  let cosI = -dot(nrm, dir);
  if (cosI < 0) { nrm = scale(nrm, -1); cosI = -dot(nrm, dir); }
  const eta = n1 / n2;
  const sin2t = eta * eta * (1 - cosI * cosI);
  if (sin2t > 1) return null; // total internal reflection
  const cosT = Math.sqrt(1 - sin2t);
  return normalize(add(scale(dir, eta), scale(nrm, eta * cosI - cosT)));
}

/**
 * Thin-lens graphical (ray-tracing) construction (Hecht, "Optics", 5th ed.,
 * Sec. 5.2, "principal rays"): the ray through the optical center is
 * undeviated, so every ray parallel to it must bend to cross the same
 * point on the focal plane. Generalized here to a lens at any
 * position/orientation and a ray at any angle, not just rays along one
 * fixed horizontal axis.
 * @param {{x:number,y:number}} point where the ray meets the lens plane
 * @param {{x:number,y:number}} dir unit incident direction
 * @param {{center:{x:number,y:number}, angle:number, focalLength:number}} lensLike
 * @returns {{x:number,y:number}} unit refracted direction
 */
function refractThinLens(point, dir, lensLike) {
  const axis = fromAngle(lensLike.angle);
  const nSigned = dot(axis, dir) >= 0 ? axis : scale(axis, -1);
  const f = lensLike.focalLength;
  const denom = dot(dir, nSigned);
  if (Math.abs(denom) < 1e-9) return dir;

  const t = f / denom;
  const target = add(lensLike.center, scale(dir, t));
  const toTarget = sub(target, point);
  const forward = dot(toTarget, nSigned) > 0 ? toTarget : scale(toTarget, -1);
  return normalize(forward);
}

// ---------- dispersion ----------
// Cauchy's equation (Cauchy, 1836; see Hecht, "Optics", 5th ed., Eq. 3.71):
// n(λ) = A + B/λ² (λ in micrometers). A two-term empirical fit to normal
// dispersion, accurate away from absorption bands for ordinary optical
// glass. Rough presets below; not lab-grade glass data, but the right
// shape and the right idea: blue bends more than red because n(λ) rises
// toward shorter wavelengths.
const GLASS_PRESETS = {
  // Real BK7/flint dispersion is genuinely subtle — under a degree of
  // spread across the whole visible spectrum — which is invisible at
  // canvas scale over a few hundred pixels. These B coefficients are
  // moderately exaggerated from real glass data so the rainbow is actually
  // visible; the wavelength-dependence itself (Cauchy's equation) is real,
  // only the strength of the effect is tuned up for visibility.
  crown: { label: 'Crown glass (BK7-like, exaggerated), n\u2248 1.52', A: 1.5046, B: 0.0180 },
  flint: { label: 'Flint glass (exaggerated), n\u2248 1.62', A: 1.6034, B: 0.0500 },
};

/**
 * Cauchy's equation, n(λ) = A + B/λ².
 * @param {number} A Cauchy A coefficient (dimensionless)
 * @param {number} B Cauchy B coefficient (µm²)
 * @param {number} wavelengthNm wavelength in nanometers
 * @returns {number} refractive index at that wavelength
 */
function cauchyIndex(A, B, wavelengthNm) {
  const lambdaUm = wavelengthNm / 1000;
  return A + B / (lambdaUm * lambdaUm);
}

// Real optical glass catalogs (Schott, Ohara, ...) publish dispersion as a
// three-term Sellmeier equation (Sellmeier, 1871):
//   n(lambda)^2 = 1 + B1*L2/(L2-C1) + B2*L2/(L2-C2) + B3*L2/(L2-C3)
// where L2 = lambda^2 (lambda in micrometers). Coefficients below are the
// standard published Schott catalog values (matched against each glass's
// known n_d to 5 significant figures).
const SELLMEIER_GLASSES = {
  'n-bk7': {
    label: 'N-BK7 (Schott), n_d = 1.517, V_d = 64.2',
    B1: 1.03961212, B2: 0.231792344, B3: 1.01046945,
    C1: 0.00600069867, C2: 0.0200179144, C3: 103.560653,
  },
  'n-bak4': {
    label: 'N-BAK4 (Schott), n_d = 1.569, V_d = 55.9',
    B1: 1.28834642, B2: 0.132817724, B3: 0.945395373,
    C1: 0.00779980626, C2: 0.0315631177, C3: 105.965875,
  },
  'n-sf11': {
    label: 'N-SF11 (Schott), n_d = 1.785, V_d = 25.7',
    B1: 1.73759695, B2: 0.313747346, B3: 1.89878101,
    C1: 0.013188707, C2: 0.0623068142, C3: 155.23629,
  },
  'n-sf6': {
    label: 'N-SF6 (Schott), n_d = 1.805, V_d = 25.4',
    B1: 1.77931763, B2: 0.338149866, B3: 2.08734474,
    C1: 0.0133714182, C2: 0.0617533621, C3: 174.01759,
  },
  'fused-silica': {
    label: 'Fused silica, n_d = 1.458, V_d = 67.8',
    B1: 0.696166300, B2: 0.407942600, B3: 0.897479400,
    C1: 0.00467914826, C2: 0.0135120631, C3: 97.9340025,
  },
};

// The Sellmeier dispersion equation used by real optical glass catalogs.
function sellmeierIndex(glass, wavelengthNm) {
  const lambdaUm = wavelengthNm / 1000;
  const l2 = lambdaUm * lambdaUm;
  const n2 =
    1 +
    (glass.B1 * l2) / (l2 - glass.C1) +
    (glass.B2 * l2) / (l2 - glass.C2) +
    (glass.B3 * l2) / (l2 - glass.C3);
  return Math.sqrt(n2);
}

// Dispatches to the right dispersion model for a glass key: the real
// Sellmeier catalog, the exaggerated Cauchy demo presets, or user-entered
// custom Cauchy coefficients (customA/customB, used only for 'custom').
function glassIndexAt(glassKey, wavelengthNm, customA, customB) {
  if (SELLMEIER_GLASSES[glassKey]) return sellmeierIndex(SELLMEIER_GLASSES[glassKey], wavelengthNm);
  if (glassKey === 'custom') return cauchyIndex(customA, customB, wavelengthNm);
  const preset = GLASS_PRESETS[glassKey] || GLASS_PRESETS.crown;
  return cauchyIndex(preset.A, preset.B, wavelengthNm);
}

// Display label for a glass key, checking both catalogs.
function glassLabel(glassKey) {
  if (SELLMEIER_GLASSES[glassKey]) return SELLMEIER_GLASSES[glassKey].label;
  if (glassKey === 'custom') return 'Custom glass';
  return (GLASS_PRESETS[glassKey] || GLASS_PRESETS.crown).label;
}

// Abbe number (V_d), the standard glass-catalog figure of merit for
// dispersion: V_d = (n_d - 1) / (n_F - n_C), using the Fraunhofer d/F/C
// lines (587.6/486.1/656.3nm). Higher V_d = less dispersive (crown-like);
// lower V_d = more dispersive (flint-like).
function abbeNumber(glassKey, customA, customB) {
  const nd = glassIndexAt(glassKey, 587.6, customA, customB);
  const nF = glassIndexAt(glassKey, 486.1, customA, customB);
  const nC = glassIndexAt(glassKey, 656.3, customA, customB);
  const denom = nF - nC;
  return Math.abs(denom) < 1e-9 ? Infinity : (nd - 1) / denom;
}

// Rough visible-spectrum wavelength -> RGB, for coloring dispersed rays.
function wavelengthToRGB(nm) {
  let r, g, b;
  if (nm < 440) { r = -(nm - 440) / (440 - 380); g = 0; b = 1; }
  else if (nm < 490) { r = 0; g = (nm - 440) / (490 - 440); b = 1; }
  else if (nm < 510) { r = 0; g = 1; b = -(nm - 510) / (510 - 490); }
  else if (nm < 580) { r = (nm - 510) / (580 - 510); g = 1; b = 0; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / (645 - 580); b = 0; }
  else { r = 1; g = 0; b = 0; }
  const gamma = 0.8;
  const scale255 = (v) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v)), gamma));
  return `rgb(${scale255(r)}, ${scale255(g)}, ${scale255(b)})`;
}

// ---------- realistic (Snell's law) lens geometry ----------
// Sign convention (standard lensmaker/Cartesian convention, e.g. Hecht,
// "Optics", 5th ed., Sec. 5.2): a surface radius is positive if its center
// of curvature lies on the outgoing side of that surface. A biconvex lens
// is R1 > 0, R2 < 0.

// A radius of exactly zero isn't a physical surface at all (it degenerates
// the sphere to a single point, which a ray will essentially never hit) --
// the UI's R1/R2 sliders pass straight through 0 at their step size, so
// this is easy to reach by accident. A flat surface is the *infinite*-radius
// limit, not the zero-radius one; clamp away from zero instead of silently
// producing a surface no ray can ever strike.
const MIN_LENS_RADIUS = 1;
function clampLensRadius(r) {
  if (Math.abs(r) >= MIN_LENS_RADIUS) return r;
  return r < 0 ? -MIN_LENS_RADIUS : MIN_LENS_RADIUS;
}

function buildLensSurfaces(lens) {
  const axis = fromAngle(lens.angle);
  const half = lens.thickness / 2;
  const r1 = clampLensRadius(lens.r1);
  const r2 = clampLensRadius(lens.r2);
  const frontVertex = sub(lens.center, scale(axis, half));
  const backVertex = add(lens.center, scale(axis, half));
  return {
    axis,
    frontVertex,
    backVertex,
    frontCenter: add(frontVertex, scale(axis, r1)),
    backCenter: add(backVertex, scale(axis, r2)),
    frontRadius: Math.abs(r1),
    backRadius: Math.abs(r2),
  };
}

function lensIndexAt(lens, wavelengthNm) {
  return glassIndexAt(lens.glass, wavelengthNm, lens.customA, lens.customB);
}

/**
 * Thin-lens-equivalent focal length. For an ideal lens this is just the
 * stored value; for a realistic lens it's the lensmaker's equation,
 * 1/f = (n-1)(1/R1 - 1/R2) (Hecht, "Optics", 5th ed., Eq. 5.14, thin-lens
 * limit), used both to drive the ideal-mode ray tracing and as the
 * paraxial estimate shown in the image-formation readout for
 * realistic-mode lenses (whose traced rays include real aberration beyond
 * this paraxial value).
 * @param {object} lens
 * @param {number} [wavelengthNm] wavelength in nanometers (realistic lenses only; defaults to 550nm)
 * @returns {number} focal length in world units (mm), or Infinity if the lens has no optical power
 */
function effectiveFocalLength(lens, wavelengthNm) {
  if (lens.model === 'ideal') return lens.focalLength;
  const n = lensIndexAt(lens, wavelengthNm || 550);
  const r1 = clampLensRadius(lens.r1);
  const r2 = clampLensRadius(lens.r2);
  const invF = (n - 1) * (1 / r1 - 1 / r2);
  return Math.abs(invF) < 1e-9 ? Infinity : 1 / invF;
}

function findRealisticLensHit(lens, origin, dir) {
  const s = buildLensSurfaces(lens);
  const tangent = { x: -s.axis.y, y: s.axis.x };
  const halfHeight = lens.height / 2;
  const candidates = [];

  const hitFront = intersectSphereHemisphere(origin, dir, s.frontCenter, s.frontRadius, s.frontVertex);
  if (hitFront && withinAperture(hitFront.point, lens.center, tangent, halfHeight)) {
    candidates.push({ t: hitFront.t, point: hitFront.point, surface: 'front' });
  }
  const hitBack = intersectSphereHemisphere(origin, dir, s.backCenter, s.backRadius, s.backVertex);
  if (hitBack && withinAperture(hitBack.point, lens.center, tangent, halfHeight)) {
    candidates.push({ t: hitBack.t, point: hitBack.point, surface: 'back' });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0];
}

function propagateRealisticLens(lens, origin, dir, hit, wavelengthNm) {
  const s = buildLensSurfaces(lens);
  const n = lensIndexAt(lens, wavelengthNm);
  const tangent = { x: -s.axis.y, y: s.axis.x };
  const halfHeight = lens.height / 2;

  const entrySurface = hit.surface;
  const entryCenter = entrySurface === 'front' ? s.frontCenter : s.backCenter;
  const entryNormal = normalize(sub(hit.point, entryCenter));

  const dirInside = refractVector(dir, entryNormal, 1.0, n);
  if (!dirInside) {
    // Shouldn't happen entering a denser medium, but fall back safely.
    return { points: [hit.point], exitPoint: hit.point, exitDir: reflect(dir, entryNormal) };
  }

  const exitSurface = entrySurface === 'front' ? 'back' : 'front';
  const exitCenter = exitSurface === 'front' ? s.frontCenter : s.backCenter;
  const exitRadius = exitSurface === 'front' ? s.frontRadius : s.backRadius;
  const exitVertex = exitSurface === 'front' ? s.frontVertex : s.backVertex;
  const exitHit = intersectSphereHemisphere(hit.point, dirInside, exitCenter, exitRadius, exitVertex);

  if (!exitHit || !withinAperture(exitHit.point, lens.center, tangent, halfHeight)) {
    // Ray misses the far surface within the clear aperture (grazing edge
    // case) — let it continue unbent rather than producing a glitch.
    return { points: [hit.point], exitPoint: hit.point, exitDir: dirInside };
  }

  const exitNormal = normalize(sub(exitHit.point, exitCenter));
  const dirOut = refractVector(dirInside, exitNormal, n, 1.0);
  if (!dirOut) {
    // Total internal reflection at the exit surface.
    return {
      points: [hit.point, exitHit.point],
      exitPoint: exitHit.point,
      exitDir: reflect(dirInside, exitNormal),
    };
  }
  return { points: [hit.point, exitHit.point], exitPoint: exitHit.point, exitDir: dirOut };
}

// ---------- image-quality analysis ----------
// The bench treats one world unit as 1mm (see README "Units"), so a
// wavelength in nanometers and a lens dimension in world units combine into
// a physically meaningful, dimensionally-correct spot size in micrometers.

// Diffraction-limited (Airy disk) spot radius: r = 1.22 * lambda * (working
// f-number), the standard result for the first dark ring of a circular
// aperture's Fraunhofer diffraction pattern (Hecht, "Optics", 5th ed.,
// Sec. 10.2.5; Born & Wolf, "Principles of Optics", 7th ed., Sec. 8.5.2).
// Uses the *working* f-number (actual image/object distance over aperture),
// not the infinite-conjugate f-number, so it stays correct for finite
// conjugates, not just collimated input.
function airyDiskRadius(wavelengthNm, workingDistance, apertureDiameter) {
  if (!(apertureDiameter > 0) || !isFinite(workingDistance)) return null;
  const wavelengthMm = wavelengthNm / 1e6; // nm -> mm (1 world unit)
  const workingFNumber = Math.abs(workingDistance) / apertureDiameter;
  return 1.22 * wavelengthMm * workingFNumber;
}

// Real-ray spot diagram for a realistic (Snell's-law) lens: traces a fan of
// rays spanning the clear aperture through the *actual* spherical surfaces,
// then finds where each one crosses the paraxial image plane. Their spread
// there is genuine transverse spherical aberration -- rays through the edge
// of the aperture focus short of paraxial rays through the center, exactly
// as in a real lens -- and is reported as an RMS spot radius, directly
// comparable to `airyDiskRadius` above to see whether a configuration is
// diffraction-limited or aberration-limited.
//
// The paraxial image plane is found by tracing an actual near-axis ray
// through the *real* thick-lens surfaces, rather than by placing it at the
// thin-lens focal length measured from the lens's geometric center. For a
// lens with non-negligible thickness those two disagree -- the true
// paraxial focus sits at a principal-plane-shifted position, not at
// `lens.center + f`. Using the thin-lens estimate as the reference plane
// would inject a spurious defocus that scales *linearly* with aperture
// height and swamps the much smaller (cubic-in-height) spherical
// aberration this function exists to measure. Self-referencing against a
// traced ray sidesteps needing a separate thick-lens principal-plane
// formula and stays exact for any thickness/curvature combination.
//
// Only valid when the beam travels along the lens's own optical axis (the
// common on-axis case this bench is built around) and forms a real image;
// returns null otherwise rather than reporting a misleading number.
// Axial distance (from `center`, along `axis`) at which a ray through
// `point` heading `dir` crosses the tangential coordinate 0 -- i.e. where
// it crosses the optical axis. Used both to locate the paraxial focus (a
// near-axis ray's own crossing) and, per marginal ray, its longitudinal
// aberration relative to that paraxial focus.
function axialCrossingDistance(point, dir, center, axis, tangent) {
  const slope = dot(dir, tangent);
  if (Math.abs(slope) < 1e-12) return Infinity;
  const tangentialAt = dot(sub(point, center), tangent);
  const s = -tangentialAt / slope;
  return dot(sub(point, center), axis) + s * dot(dir, axis);
}

// Traces a fan of rays across the full clear aperture of a realistic lens
// and returns, for each, its transverse aberration at the paraxial image
// plane (the ray-fan/spot-diagram quantity) and its own longitudinal
// focus shift from the paraxial focus (the LSA quantity) -- the shared
// data behind `computeSpotDiagram`, the ray-fan plot, and the LSA plot.
//
// The paraxial image plane is found by tracing an actual near-axis ray
// through the *real* thick-lens surfaces (see the note on `computeSpotDiagram`
// below), not by assuming the thin-lens focal length applies at the
// lens's geometric center.
//
// Only valid when the beam travels along the lens's own optical axis and
// forms a real image; returns null otherwise.
function traceAberrationFan(lens, source, sampleCount) {
  if (lens.model !== 'realistic') return null;
  sampleCount = sampleCount || 21;

  const axis = fromAngle(lens.angle);
  const tangent = { x: -axis.y, y: axis.x };
  const halfHeight = lens.height / 2;
  const wavelengthNm = source.wavelength || 550;

  const f = effectiveFocalLength(lens, wavelengthNm);
  if (!isFinite(f)) return null;

  let beamDir;
  let approxPlaneDistance; // coarse validity gate only -- not the measurement plane
  if (source.mode === 'parallel') {
    beamDir = fromAngle((source.angle * Math.PI) / 180);
    approxPlaneDistance = f;
  } else {
    beamDir = normalize(sub(lens.center, source.position));
    const doDist = Math.abs(dot(sub(source.position, lens.center), axis));
    if (doDist < 1e-6 || Math.abs(doDist - f) < 0.5) return null;
    approxPlaneDistance = (f * doDist) / (doDist - f);
  }
  if (!isFinite(approxPlaneDistance) || approxPlaneDistance <= 0) return null; // real image only
  if (Math.abs(dot(axis, beamDir)) < 0.98) return null; // beam not aligned with this lens's axis

  // Traces one ray of a given transverse aperture offset through the lens
  // and returns its exit point/direction, or null if it misses/TIRs.
  function traceOffset(offset) {
    const aimPoint = add(lens.center, scale(tangent, offset));
    let origin, dir;
    if (source.mode === 'parallel') {
      dir = beamDir;
      origin = sub(aimPoint, scale(dir, Math.max(1000, lens.thickness * 10)));
    } else {
      origin = source.position;
      dir = normalize(sub(aimPoint, origin));
    }
    const hit = findRealisticLensHit(lens, origin, dir);
    if (!hit) return null;
    return propagateRealisticLens(lens, origin, dir, hit, wavelengthNm);
  }

  const paraxialOffset = Math.min(0.05, halfHeight * 0.01) || 0.05;
  const paraxial = traceOffset(paraxialOffset);
  if (!paraxial) return null;
  const planeDistance = axialCrossingDistance(paraxial.exitPoint, paraxial.exitDir, lens.center, axis, tangent);
  if (!isFinite(planeDistance) || planeDistance <= 0) return null;

  const margin = 0.92; // stay slightly inside the physical aperture edge
  const samples = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = sampleCount === 1 ? 0 : (i / (sampleCount - 1)) * 2 - 1; // -1..1 pupil fraction
    const offset = t * halfHeight * margin;
    const result = traceOffset(offset);
    if (!result) continue;

    const denom = dot(result.exitDir, axis);
    if (Math.abs(denom) < 1e-9) continue;
    const s = (planeDistance - dot(sub(result.exitPoint, lens.center), axis)) / denom;
    if (s < 0) continue;
    const landing = add(result.exitPoint, scale(result.exitDir, s));
    const transverseAberration = dot(sub(landing, lens.center), tangent);
    // A ray with essentially zero transverse slope (the exact on-axis
    // sample) never crosses the axis at a well-defined finite point -- it
    // IS the axis. Its longitudinal aberration is trivially 0 by definition
    // rather than the Infinity - Infinity = NaN a literal crossing solve
    // would produce.
    const rawCrossing = axialCrossingDistance(result.exitPoint, result.exitDir, lens.center, axis, tangent);
    const longitudinalAberration = isFinite(rawCrossing) ? rawCrossing - planeDistance : 0;
    samples.push({ pupilFraction: t, apertureHeight: offset, transverseAberration, longitudinalAberration });
  }

  if (samples.length < 2) return null;
  return { samples, planeDistance };
}

/**
 * Real-ray spot diagram for a realistic (Snell's-law) lens: traces a fan of
 * rays spanning the clear aperture through the *actual* spherical surfaces,
 * then finds where each one crosses the paraxial image plane. Their spread
 * there is genuine transverse spherical aberration -- rays through the edge
 * of the aperture focus short of paraxial rays through the center, exactly
 * as in a real lens -- and is reported as an RMS spot radius, directly
 * comparable to `airyDiskRadius` above to see whether a configuration is
 * diffraction-limited or aberration-limited.
 *
 * The paraxial image plane is found by tracing an actual near-axis ray
 * through the *real* thick-lens surfaces, rather than by placing it at the
 * thin-lens focal length measured from the lens's geometric center. For a
 * lens with non-negligible thickness those two disagree -- the true
 * paraxial focus sits at a principal-plane-shifted position, not at
 * `lens.center + f`. Using the thin-lens estimate as the reference plane
 * would inject a spurious defocus that scales *linearly* with aperture
 * height and swamps the much smaller (cubic-in-height) spherical
 * aberration this function exists to measure.
 *
 * Only valid when the beam travels along the lens's own optical axis (the
 * common on-axis case this bench is built around) and forms a real image;
 * returns null otherwise rather than reporting a misleading number.
 */
function computeSpotDiagram(lens, source, sampleCount) {
  const fan = traceAberrationFan(lens, source, sampleCount);
  if (!fan) return null;
  const heights = fan.samples.map((s) => s.transverseAberration);
  // Deviation from the *paraxial* image point (tangential coordinate 0 at
  // this plane, by construction), not from the sampled rays' own mean --
  // the paraxial ray defines where a perfect image would form.
  const rmsRadius = Math.sqrt(heights.reduce((a, h) => a + h * h, 0) / heights.length);
  const peakRadius = Math.max(...heights.map((h) => Math.abs(h)));
  return { rmsRadius, peakRadius, sampleCount: heights.length };
}

/**
 * Third-order (Seidel) spherical aberration coefficient for a realistic
 * lens under collimated (infinite-conjugate) illumination, via a genuine
 * paraxial marginal-ray trace and the classic Seidel sum (Welford,
 * "Aberrations of Optical Systems", 2nd ed., Ch. 9; Kingslake & Johnson,
 * "Lens Design Fundamentals", 2nd ed., Ch. 5):
 *   S_I = Σ_surfaces A² y Δ(u/n),   A = n(u + yc)
 * with the predicted transverse ray aberration of the marginal ray at the
 * paraxial focus, ε_y' = -S_I / (2 n' u').
 *
 * This is an independent calculation from the exact ray trace used
 * elsewhere in the bench (a true small-angle paraxial trace, not a
 * small-height limit of the exact Snell's-law trace) -- the two agree to
 * a fraction of a percent for a small aperture and diverge at the full
 * aperture exactly where third-order theory is expected to break down,
 * which is itself a meaningful indicator of how far a configuration sits
 * from the paraxial regime.
 *
 * Only defined for collimated input; returns null for a point source,
 * since "the" Seidel coefficient of a lens depends on which conjugate
 * it's evaluated at.
 * @param {object} lens
 * @param {{mode:string, wavelength:number}} source
 * @returns {{SI:number, marginalRayHeight:number, predictedTransverseAberration:number}|null}
 */
function computeSeidelSpherical(lens, source) {
  if (lens.model !== 'realistic' || source.mode !== 'parallel') return null;
  const wavelengthNm = source.wavelength || 550;
  const n = lensIndexAt(lens, wavelengthNm);
  const r1 = clampLensRadius(lens.r1);
  const r2 = clampLensRadius(lens.r2);
  const c1 = 1 / r1, c2 = 1 / r2;
  const y0 = lens.height / 2;
  if (!(y0 > 0)) return null;

  let sumSI = 0;

  // Surface 1: air (n=1) -> glass (n)
  const nBefore1 = 1, uBefore1 = 0, y1 = y0;
  const A1 = nBefore1 * (uBefore1 + y1 * c1);
  const uAfter1 = (nBefore1 * uBefore1 - y1 * c1 * (n - nBefore1)) / n;
  sumSI += A1 * A1 * y1 * (uAfter1 / n - uBefore1 / nBefore1);

  // Transfer across the lens thickness
  const y2 = y1 + lens.thickness * uAfter1;

  // Surface 2: glass (n) -> air (n=1)
  const nBefore2 = n, uBefore2 = uAfter1;
  const A2 = nBefore2 * (uBefore2 + y2 * c2);
  const uAfter2 = (nBefore2 * uBefore2 - y2 * c2 * (1 - nBefore2)) / 1;
  sumSI += A2 * A2 * y2 * (uAfter2 / 1 - uBefore2 / nBefore2);

  const SI = sumSI;
  const finalU = uAfter2;
  if (Math.abs(finalU) < 1e-12) return null;
  const predictedTransverseAberration = -SI / (2 * finalU);
  return { SI, marginalRayHeight: y0, predictedTransverseAberration };
}

// ---------- prism geometry ----------

function buildPrismFaces(prism) {
  const axis = fromAngle(prism.angle);
  const half = ((prism.apexAngle * Math.PI) / 180) / 2;
  const localN1 = { x: -Math.cos(half), y: -Math.sin(half) };
  const localN2 = { x: -Math.cos(half), y: Math.sin(half) };
  const n1 = rotate(localN1, prism.angle);
  const n2 = rotate(localN2, prism.angle);

  let dir1 = rotate(n1, Math.PI / 2);
  if (dot(dir1, axis) > 0) dir1 = scale(dir1, -1);
  let dir2 = rotate(n2, -Math.PI / 2);
  if (dot(dir2, axis) > 0) dir2 = scale(dir2, -1);

  const apex = prism.center;
  const corner1 = add(apex, scale(dir1, prism.height));
  const corner2 = add(apex, scale(dir2, prism.height));

  // The base closes the triangle between the two angled faces. Without it,
  // any ray that doesn't happen to cross to the *other* angled face within
  // its finite length has nowhere physically correct to exit. Its outward
  // normal points away from the apex.
  const baseDir = normalize(sub(corner2, corner1));
  let baseNormal = { x: -baseDir.y, y: baseDir.x };
  if (dot(baseNormal, axis) < 0) baseNormal = scale(baseNormal, -1);

  return {
    apex,
    face1: { a: apex, b: corner1, normal: n1 },
    face2: { a: apex, b: corner2, normal: n2 },
    face3: { a: corner1, b: corner2, normal: baseNormal },
  };
}

function findPrismHit(prism, origin, dir) {
  const { face1, face2, face3 } = buildPrismFaces(prism);
  const faces = [{ f: face1, id: 1 }, { f: face2, id: 2 }, { f: face3, id: 3 }];
  const candidates = [];
  for (const { f, id } of faces) {
    const h = intersectSegment(origin, dir, f.a, f.b);
    if (h) candidates.push({ t: h.t, point: h.point, face: id, normal: f.normal });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0];
}

function prismIndexAt(prism, wavelengthNm) {
  return glassIndexAt(prism.glass, wavelengthNm, prism.customA, prism.customB);
}

function propagatePrism(prism, origin, dir, hit, wavelengthNm) {
  const { face1, face2, face3 } = buildPrismFaces(prism);
  const n = prismIndexAt(prism, wavelengthNm);

  const dirInside = refractVector(dir, hit.normal, 1.0, n);
  if (!dirInside) {
    return { points: [hit.point], exitPoint: hit.point, exitDir: reflect(dir, hit.normal) };
  }

  // The prism is a real closed triangle now, so whichever of the other two
  // faces the internal ray actually reaches is the correct exit — not
  // always "the other angled face." A convex triangle guarantees exactly
  // one of them is hit (barring an exact-vertex degenerate case).
  const faces = [{ f: face1, id: 1 }, { f: face2, id: 2 }, { f: face3, id: 3 }];
  const exitCandidates = [];
  for (const { f, id } of faces) {
    if (id === hit.face) continue;
    const h = intersectSegment(hit.point, dirInside, f.a, f.b);
    if (h) exitCandidates.push({ point: h.point, normal: f.normal, t: h.t });
  }

  if (exitCandidates.length === 0) {
    // Degenerate (e.g. hit exactly on a vertex) — continue unbent rather
    // than vanish.
    return { points: [hit.point], exitPoint: hit.point, exitDir: dirInside };
  }
  exitCandidates.sort((a, b) => a.t - b.t);
  const exitHit = exitCandidates[0];

  const dirOut = refractVector(dirInside, exitHit.normal, n, 1.0);
  if (!dirOut) {
    return {
      points: [hit.point, exitHit.point],
      exitPoint: exitHit.point,
      exitDir: reflect(dirInside, exitHit.normal),
    };
  }
  return { points: [hit.point, exitHit.point], exitPoint: exitHit.point, exitDir: dirOut };
}

// ---------- mirror curvature ----------
/**
 * A curved mirror is modeled as a flat reflection followed by the same
 * thin-element focusing correction used for lenses, with f = R/2 — the
 * standard paraxial mirror equation (Hecht, "Optics", 5th ed., Eq. 5.24,
 * with the sign convention 1/do + 1/di = 2/R = 1/f). Flat mirrors skip the
 * correction entirely.
 * @param {{x:number,y:number}} point where the ray meets the mirror
 * @param {{x:number,y:number}} reflectedDir the already flat-reflected direction
 * @param {{center:object, angle:number, surface:string, radius:number}} mirror
 * @returns {{x:number,y:number}} the final (possibly curvature-corrected) direction
 */
function applyMirrorCurvature(point, reflectedDir, mirror) {
  if (mirror.surface === 'flat') return reflectedDir;
  const sign = mirror.surface === 'concave' ? 1 : -1;
  const f = (sign * mirror.radius) / 2;
  return refractThinLens(point, reflectedDir, { center: mirror.center, angle: mirror.angle, focalLength: f });
}

// ---------- unified element dispatch ----------

function findElementHit(el, origin, dir) {
  if (el.kind === 'lens' && el.model === 'realistic') return findRealisticLensHit(el, origin, dir);
  if (el.kind === 'prism') return findPrismHit(el, origin, dir);
  // lens (ideal) and mirror (flat/curved) all use the flat chord.
  const { a, b } = elementEndpoints(el);
  const hit = intersectSegment(origin, dir, a, b);
  return hit;
}

function propagateElement(el, origin, dir, hit, wavelengthNm) {
  if (el.kind === 'lens' && el.model === 'realistic') {
    return propagateRealisticLens(el, origin, dir, hit, wavelengthNm);
  }
  if (el.kind === 'prism') {
    return propagatePrism(el, origin, dir, hit, wavelengthNm);
  }
  if (el.kind === 'lens') {
    const newDir = refractThinLens(hit.point, dir, el);
    return { points: [hit.point], exitPoint: hit.point, exitDir: newDir };
  }
  // mirror
  const axis = fromAngle(el.angle);
  const flatReflected = reflect(dir, axis);
  const newDir = applyMirrorCurvature(hit.point, flatReflected, el);
  return { points: [hit.point], exitPoint: hit.point, exitDir: newDir };
}

// ---------- full ray trace through a scene ----------

function traceRay(origin, dir, elements, viewport, wavelengthNm = 550, maxBounces = 24) {
  const points = [origin];
  let currentOrigin = origin;
  let currentDir = normalize(dir);

  for (let bounce = 0; bounce < maxBounces; bounce++) {
    let closest = null;
    let closestEl = null;

    for (const el of elements) {
      const hit = findElementHit(el, currentOrigin, currentDir);
      if (hit && (!closest || hit.t < closest.t)) {
        closest = hit;
        closestEl = el;
      }
    }

    if (!closest) {
      points.push(intersectBounds(currentOrigin, currentDir, viewport.minX, viewport.minY, viewport.maxX, viewport.maxY));
      break;
    }

    const result = propagateElement(closestEl, currentOrigin, currentDir, closest, wavelengthNm);
    for (const p of result.points) points.push(p);
    currentDir = result.exitDir;
    currentOrigin = add(result.exitPoint, scale(currentDir, 0.5));
  }

  return points;
}

// ---------- image-formation analysis ----------

/**
 * Classic thin-lens image formation: 1/do + 1/di = 1/f, m = -di/do (Hecht,
 * "Optics", 5th ed., Eqs. 5.15-5.16), evaluated with the lens's paraxial
 * `effectiveFocalLength`. Also reports the diffraction-limited Airy radius
 * for the resulting image (see `airyDiskRadius`).
 * @param {{position:object, mode:string, wavelength:number}} source
 * @param {object} lens
 * @returns {object} `{valid:false, reason}` or a populated image-formation result
 */
function computeImageInfo(source, lens) {
  const axis = fromAngle(lens.angle);
  const f = effectiveFocalLength(lens, source.wavelength);
  if (!isFinite(f)) return { valid: false, reason: 'This lens has (approximately) no optical power at this configuration.' };

  if (source.mode === 'parallel') {
    return {
      valid: true, parallel: true, focalLength: f,
      real: f > 0, virtual: f < 0,
      airyRadius: airyDiskRadius(source.wavelength, f, lens.height),
    };
  }

  const raw = dot(sub(source.position, lens.center), axis);
  const doDist = Math.abs(raw);
  if (doDist < 1e-6) return { valid: false, reason: 'The source is sitting on the lens.' };

  if (Math.abs(doDist - f) < 0.5) {
    return { valid: false, reason: 'Object is at the focal point \u2014 image forms at infinity.' };
  }

  const di = (f * doDist) / (doDist - f);
  const m = -di / doDist;
  return {
    valid: true, parallel: false,
    objectDistance: doDist, imageDistance: di, magnification: m,
    real: di > 0, virtual: di <= 0,
    inverted: m < 0, upright: m >= 0,
    focalLength: f,
    airyRadius: airyDiskRadius(source.wavelength, di, lens.height),
  };
}

// Exported API used by render.js / interaction.js
window.Optics = {
  sub, add, scale, dot, length, normalize, fromAngle, rotate,
  elementEndpoints, withinAperture,
  intersectSegment, intersectCircle, intersectSphereHemisphere, intersectBounds,
  reflect, refractVector, refractThinLens, applyMirrorCurvature,
  GLASS_PRESETS, cauchyIndex, wavelengthToRGB,
  SELLMEIER_GLASSES, sellmeierIndex, glassIndexAt, glassLabel, abbeNumber,
  buildLensSurfaces, lensIndexAt, effectiveFocalLength,
  buildPrismFaces, prismIndexAt,
  findElementHit, propagateElement, traceRay,
  computeImageInfo, airyDiskRadius, computeSpotDiagram, traceAberrationFan, computeSeidelSpherical,
};
