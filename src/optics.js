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

// Vector form of Snell's law. Returns the refracted direction, or null on
// total internal reflection. `normal` need not be pre-oriented against `dir`
// — this flips it automatically.
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

// Thin-lens graphical construction (see README for the reasoning): the ray
// through the optical center is undeviated, so every ray parallel to it must
// bend to cross the same point on the focal plane.
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
// Cauchy's equation: n(λ) = A + B / λ² (λ in micrometers). Rough presets;
// not lab-grade glass data, but the right shape and the right idea: blue
// bends more than red because n(λ) rises toward shorter wavelengths.
const GLASS_PRESETS = {
  // Real BK7/flint dispersion is genuinely subtle — under a degree of
  // spread across the whole visible spectrum — which is invisible at
  // canvas scale over a few hundred pixels. These B coefficients are
  // moderately exaggerated from real glass data so the rainbow is actually
  // visible; the wavelength-dependence itself (Cauchy's equation) is real,
  // only the strength of the effect is tuned up for visibility.
  crown: { label: 'Crown glass (BK7-like), n\u2248 1.52', A: 1.5046, B: 0.0180 },
  flint: { label: 'Flint glass, n\u2248 1.62', A: 1.6034, B: 0.0500 },
};

function cauchyIndex(A, B, wavelengthNm) {
  const lambdaUm = wavelengthNm / 1000;
  return A + B / (lambdaUm * lambdaUm);
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
// Sign convention (standard lensmaker convention): a surface radius is
// positive if its center of curvature lies on the outgoing side of that
// surface. A biconvex lens is R1 > 0, R2 < 0.

function buildLensSurfaces(lens) {
  const axis = fromAngle(lens.angle);
  const half = lens.thickness / 2;
  const frontVertex = sub(lens.center, scale(axis, half));
  const backVertex = add(lens.center, scale(axis, half));
  return {
    axis,
    frontVertex,
    backVertex,
    frontCenter: add(frontVertex, scale(axis, lens.r1)),
    backCenter: add(backVertex, scale(axis, lens.r2)),
    frontRadius: Math.abs(lens.r1),
    backRadius: Math.abs(lens.r2),
  };
}

function lensIndexAt(lens, wavelengthNm) {
  const preset = GLASS_PRESETS[lens.glass] || GLASS_PRESETS.crown;
  const A = lens.customA != null ? lens.customA : preset.A;
  const B = lens.customB != null ? lens.customB : preset.B;
  return cauchyIndex(A, B, wavelengthNm);
}

// Thin-lens-equivalent focal length, used for the ideal-mode ray tracing AND
// as the paraxial estimate shown in the image-formation readout for
// realistic-mode lenses (lensmaker's equation, thin-lens approximation).
function effectiveFocalLength(lens, wavelengthNm) {
  if (lens.model === 'ideal') return lens.focalLength;
  const n = lensIndexAt(lens, wavelengthNm || 550);
  const invF = (n - 1) * (1 / lens.r1 - 1 / lens.r2);
  return Math.abs(invF) < 1e-9 ? Infinity : 1 / invF;
}

function findRealisticLensHit(lens, origin, dir) {
  const s = buildLensSurfaces(lens);
  const tangent = { x: -s.axis.y, y: s.axis.x };
  const halfHeight = lens.height / 2;
  const candidates = [];

  const hitFront = intersectCircle(origin, dir, s.frontCenter, s.frontRadius);
  if (hitFront && withinAperture(hitFront.point, lens.center, tangent, halfHeight)) {
    candidates.push({ t: hitFront.t, point: hitFront.point, surface: 'front' });
  }
  const hitBack = intersectCircle(origin, dir, s.backCenter, s.backRadius);
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
  const exitHit = intersectCircle(hit.point, dirInside, exitCenter, exitRadius);

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
  const preset = GLASS_PRESETS[prism.glass] || GLASS_PRESETS.crown;
  const A = prism.customA != null ? prism.customA : preset.A;
  const B = prism.customB != null ? prism.customB : preset.B;
  return cauchyIndex(A, B, wavelengthNm);
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
// A curved mirror is modeled as a flat reflection followed by the same
// thin-element focusing correction used for lenses, with f = R/2 — a
// standard equivalence for paraxial spherical mirrors. Flat mirrors skip
// the correction entirely.
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

function computeImageInfo(source, lens) {
  const axis = fromAngle(lens.angle);
  const f = effectiveFocalLength(lens, source.wavelength);
  if (!isFinite(f)) return { valid: false, reason: 'This lens has (approximately) no optical power at this configuration.' };

  if (source.mode === 'parallel') {
    return {
      valid: true, parallel: true, focalLength: f,
      real: f > 0, virtual: f < 0,
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
  };
}

// Exported API used by render.js / interaction.js
window.Optics = {
  sub, add, scale, dot, length, normalize, fromAngle, rotate,
  elementEndpoints, withinAperture,
  intersectSegment, intersectCircle, intersectBounds,
  reflect, refractVector, refractThinLens, applyMirrorCurvature,
  GLASS_PRESETS, cauchyIndex, wavelengthToRGB,
  buildLensSurfaces, lensIndexAt, effectiveFocalLength,
  buildPrismFaces, prismIndexAt,
  findElementHit, propagateElement, traceRay,
  computeImageInfo,
};
