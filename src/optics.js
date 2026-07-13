// optics.js
// Pure physics + math. Nothing in this file touches the DOM or canvas —
// that separation is what makes the ray-tracing logic easy to test and reason about.

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

// Unit vector from an angle in radians, matching canvas coordinates (y down).
function fromAngle(angle) {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

// ---------- optical elements ----------
// A lens or mirror is stored as { center, angle, height, kind, focalLength? }
// `angle` is the direction of the element's *local optical axis* (the
// direction it "faces"), not the direction of the physical glass/mirror
// surface. The physical surface is drawn perpendicular to that axis.

function elementEndpoints(el) {
  const axis = fromAngle(el.angle);
  const along = { x: -axis.y, y: axis.x }; // perpendicular to the axis
  const half = el.height / 2;
  return {
    a: add(el.center, scale(along, -half)),
    b: add(el.center, scale(along, half)),
  };
}

// ---------- ray / segment intersection ----------
// Returns the smallest positive t (distance along the ray) where the ray
// crosses segment p1-p2, or null if there is no forward intersection.
function intersectSegment(origin, dir, p1, p2) {
  const v1 = sub(origin, p1);
  const v2 = sub(p2, p1);
  const v3 = { x: -dir.y, y: dir.x };

  const denom = dot(v2, v3);
  if (Math.abs(denom) < 1e-9) return null; // parallel

  const t1 = (v2.x * v1.y - v2.y * v1.x) / denom; // distance along ray
  const t2 = dot(v1, v3) / denom; // position along segment, 0..1

  if (t1 > 1e-6 && t2 >= 0 && t2 <= 1) {
    return { t: t1, point: add(origin, scale(dir, t1)) };
  }
  return null;
}

// Finds where a ray exits the canvas rectangle. Used as the fallback
// "end of the line" when a ray doesn't hit any element.
function intersectBounds(origin, dir, width, height) {
  const candidates = [];
  const edges = [
    [{ x: 0, y: 0 }, { x: width, y: 0 }],
    [{ x: width, y: 0 }, { x: width, y: height }],
    [{ x: width, y: height }, { x: 0, y: height }],
    [{ x: 0, y: height }, { x: 0, y: 0 }],
  ];
  for (const [p1, p2] of edges) {
    const hit = intersectSegment(origin, dir, p1, p2);
    if (hit) candidates.push(hit);
  }
  if (candidates.length === 0) return add(origin, scale(dir, Math.max(width, height)));
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0].point;
}

// ---------- refraction & reflection ----------

// Flat-mirror reflection: d' = d - 2(d.n)n
function reflect(dir, normal) {
  const d = dot(dir, normal);
  return normalize(sub(dir, scale(normal, 2 * d)));
}

// Thin-lens refraction using the classic graphical construction, generalized
// to rays that aren't on the optical axis and lenses at any position/angle:
//
//   A ray that passes through the lens's optical CENTER is never bent.
//   Every ray that enters PARALLEL to it therefore bends so that, extended,
//   it crosses the same point on the focal plane as that center ray does.
//
// So: draw the helper ray (same direction, through the center), find where
// it crosses the focal plane, and aim the real ray at that point. This is
// exactly what students draw by hand on paper for thin-lens ray diagrams —
// we're just letting the computer do it for arbitrary rays.
function refractThinLens(point, dir, lens) {
  const axis = fromAngle(lens.angle);
  // Orient the axis so it points roughly the same way the light is travelling.
  const nSigned = dot(axis, dir) >= 0 ? axis : scale(axis, -1);

  const f = lens.focalLength;
  const denom = dot(dir, nSigned);
  if (Math.abs(denom) < 1e-9) return dir; // ray travelling along the lens plane, ignore

  // Where the center-ray crosses the focal plane (signed distance f from center).
  const t = f / denom;
  const focalPoint = add(lens.center, add(scale(dir, t), { x: 0, y: 0 }));
  // (equivalent to: point on the line through `center` with direction `dir`,
  //  at the parameter that lands it on the plane center + f*nSigned)
  const target = add(lens.center, scale(dir, t));

  const toTarget = sub(target, point);
  // If the focal point lies ahead of us (converging case), aim straight at it.
  // If it lies behind us (diverging case, virtual focal point), aim away from
  // it instead — the ray keeps travelling forward but *appears* to diverge
  // from that point if you trace it backwards.
  const forward = dot(toTarget, nSigned) > 0 ? toTarget : scale(toTarget, -1);
  return normalize(forward);
}

// ---------- full ray trace through a scene ----------

// Traces one ray through all elements, bouncing/refracting until it leaves
// the canvas or hits a bounce limit. Returns an array of points describing
// the polyline to draw.
function traceRay(origin, dir, elements, width, height, maxBounces = 12) {
  const points = [origin];
  let currentOrigin = origin;
  let currentDir = normalize(dir);

  for (let bounce = 0; bounce < maxBounces; bounce++) {
    let closest = null;
    let closestEl = null;

    for (const el of elements) {
      const { a, b } = elementEndpoints(el);
      const hit = intersectSegment(currentOrigin, currentDir, a, b);
      if (hit && (!closest || hit.t < closest.t)) {
        closest = hit;
        closestEl = el;
      }
    }

    if (!closest) {
      points.push(intersectBounds(currentOrigin, currentDir, width, height));
      break;
    }

    points.push(closest.point);

    if (closestEl.kind === 'mirror') {
      const axis = fromAngle(closestEl.angle);
      currentDir = reflect(currentDir, axis);
    } else if (closestEl.kind === 'lens') {
      currentDir = refractThinLens(closest.point, currentDir, closestEl);
    }

    // Nudge forward slightly so we don't immediately re-intersect the same element.
    currentOrigin = add(closest.point, scale(currentDir, 0.5));
  }

  return points;
}

// Exported API used by render.js / interaction.js
window.Optics = {
  sub, add, scale, dot, length, normalize, fromAngle,
  elementEndpoints, intersectSegment, intersectBounds,
  reflect, refractThinLens, traceRay,
};

