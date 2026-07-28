// render.js
// Everything that touches the canvas 2D context lives here. optics.js knows
// nothing about pixels; this file knows nothing about ray-tracing rules
// beyond the points/values it's handed.

const COLORS = {
  bg: '#0b0f14',
  grid: '#1b2733',
  gridDot: '#26364a',
  ray: '#ff3b4e',
  rayGlow: 'rgba(255, 59, 78, 0.35)',
  lens: '#8ecbff',
  lensFill: 'rgba(142, 203, 255, 0.06)',
  mirror: '#e7ecf2',
  mirrorBack: '#0b0f14',
  prism: '#c9a6ff',
  prismFill: 'rgba(201, 166, 255, 0.08)',
  source: '#ffd23f',
  selected: '#39ff88',
  axis: 'rgba(142, 203, 255, 0.22)',
  opticalAxis: 'rgba(255, 210, 63, 0.35)',
  imageReal: '#39ff88',
  imageVirtual: 'rgba(57, 255, 136, 0.5)',
};

const GRID_SPACING = 28;

function drawBreadboard(ctx, width, height, panX = 0, panY = 0) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  // The grid is drawn in screen space (cheap, always fills the canvas) but
  // offset by the pan so it reads as a fixed world-space pattern scrolling
  // underneath a moving viewport, rather than a static screen overlay.
  const offsetX = ((panX % GRID_SPACING) + GRID_SPACING) % GRID_SPACING;
  const offsetY = ((panY % GRID_SPACING) + GRID_SPACING) % GRID_SPACING;

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = offsetX; x < width; x += GRID_SPACING) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = offsetY; y < height; y += GRID_SPACING) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.fillStyle = COLORS.gridDot;
  for (let x = offsetX; x < width; x += GRID_SPACING) {
    for (let y = offsetY; y < height; y += GRID_SPACING) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// minWorldX/maxWorldX describe the visible world-space range (which shifts
// as the camera pans) so the axis and its ruler ticks always span exactly
// what's on screen, with tick labels reading true world coordinates.
function drawOpticalAxis(ctx, minWorldX, maxWorldX, axisY, isSnapping) {
  ctx.strokeStyle = isSnapping ? COLORS.selected : COLORS.opticalAxis;
  ctx.lineWidth = isSnapping ? 2 : 1.5;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(minWorldX, axisY);
  ctx.lineTo(maxWorldX, axisY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ruler ticks every 50mm (the bench treats 1 world unit as 1mm — see
  // README "Units" section) so drag distances have a physical reference.
  ctx.strokeStyle = 'rgba(255, 210, 63, 0.25)';
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(255, 210, 63, 0.45)';
  const start = Math.floor(minWorldX / 50) * 50;
  for (let x = start; x < maxWorldX; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, axisY - 4);
    ctx.lineTo(x, axisY + 4);
    ctx.stroke();
    if (Math.round(x) % 100 === 0) ctx.fillText(`${Math.round(x)}mm`, x + 3, axisY - 7);
  }

  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(255, 210, 63, 0.55)';
  ctx.fillText('optical axis — drag to reposition (1 unit = 1mm)', minWorldX + 10, axisY - 12);
}

function drawRayPath(ctx, points, color) {
  if (points.length < 2) return;
  const rayColor = color || COLORS.ray;

  ctx.strokeStyle = rayColor;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = rayColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function drawAxisLine(ctx, el) {
  const axis = Optics.fromAngle(el.angle);
  const p1 = Optics.add(el.center, Optics.scale(axis, -40));
  const p2 = Optics.add(el.center, Optics.scale(axis, 40));
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawLabel(ctx, center, axis, text, dy) {
  const offset = { x: -axis.y, y: axis.x };
  const p = Optics.add(center, Optics.scale(offset, dy || 26));
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(230, 238, 246, 0.7)';
  ctx.textAlign = 'center';
  ctx.fillText(text, p.x, p.y);
}

// ---------- lens ----------

function drawLens(ctx, lens, isSelected) {
  if (lens.model === 'realistic') drawRealisticLens(ctx, lens, isSelected);
  else drawIdealLens(ctx, lens, isSelected);

  drawAxisLine(ctx, lens);
  const modelLabel = lens.model === 'realistic' ? 'Snell\u2019s law' : 'ideal thin lens';
  drawLabel(ctx, lens.center, Optics.fromAngle(lens.angle), modelLabel, 26);
}

// Standard textbook lens symbol: a straight line with arrowheads at each
// end. Converging (f > 0) lenses flare their arrowheads outward; diverging
// (f < 0) lenses point them inward — the same convention used in optics
// textbooks, so the symbol itself tells you the lens type at a glance.
function drawIdealLens(ctx, lens, isSelected) {
  const axis = Optics.fromAngle(lens.angle);
  const tangent = { x: -axis.y, y: axis.x };
  const halfHeight = lens.height / 2;
  const converging = lens.focalLength > 0;
  const color = isSelected ? COLORS.selected : COLORS.lens;

  const top = Optics.add(lens.center, Optics.scale(tangent, halfHeight));
  const bottom = Optics.add(lens.center, Optics.scale(tangent, -halfHeight));

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.stroke();

  const topDir = converging ? tangent : Optics.scale(tangent, -1);
  const bottomDir = converging ? Optics.scale(tangent, -1) : tangent;
  drawLensArrow(ctx, top, topDir, color);
  drawLensArrow(ctx, bottom, bottomDir, color);

  drawFocalTicks(ctx, lens.center, axis, Math.abs(lens.focalLength));
  drawLabel(ctx, lens.center, axis, `f = ${lens.focalLength > 0 ? '+' : ''}${Math.round(lens.focalLength)}mm`, -18);
}

function drawLensArrow(ctx, from, dir, color) {
  const stemLen = 10;
  const headLen = 9;
  const headWidth = 8;
  const stemEnd = Optics.add(from, Optics.scale(dir, stemLen));
  const tip = Optics.add(stemEnd, Optics.scale(dir, headLen));
  const perp = { x: -dir.y, y: dir.x };
  const left = Optics.add(stemEnd, Optics.scale(perp, headWidth / 2));
  const right = Optics.add(stemEnd, Optics.scale(perp, -headWidth / 2));

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(stemEnd.x, stemEnd.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// Realistic lens: each surface is drawn as a true circular arc, parametrized
// by its own angle (not by projecting toward a point that might not even be
// reachable on that circle — the bug that caused runaway shapes for small
// radii). The arc is capped at a sane fraction of its radius; beyond that,
// a flat rim closes the gap out to the full aperture height, so a small
// radius on a tall lens gets a believable "edge" instead of an absurd bulge.
// Both surfaces share one safe aperture height, found by sampling the gap
// between them, so a strongly-curved pair can never cross into each other.
function drawRealisticLens(ctx, lens, isSelected) {
  const s = Optics.buildLensSurfaces(lens);
  const tangent = { x: -s.axis.y, y: s.axis.x };
  const halfHeight = lens.height / 2;
  const safeHeight = computeSafeAperture(lens, s, halfHeight);

  const front = buildSurfaceOutline(s.frontCenter, lens.r1, s.frontVertex, lens.center, tangent, halfHeight, safeHeight);
  const back = buildSurfaceOutline(s.backCenter, lens.r2, s.backVertex, lens.center, tangent, halfHeight, safeHeight);

  // One closed path all the way around — front bottom-to-top, then back
  // top-to-bottom — used for both the fill and the stroke, so the flat
  // rim edges at top and bottom get outlined too, not just filled.
  const traceClosedPath = () => {
    ctx.beginPath();
    ctx.moveTo(front[0].x, front[0].y);
    for (const p of front) ctx.lineTo(p.x, p.y);
    for (let i = back.length - 1; i >= 0; i--) ctx.lineTo(back[i].x, back[i].y);
    ctx.closePath();
  };

  traceClosedPath();
  const gradient = ctx.createLinearGradient(s.frontVertex.x, s.frontVertex.y, s.backVertex.x, s.backVertex.y);
  gradient.addColorStop(0, 'rgba(142, 203, 255, 0.03)');
  gradient.addColorStop(0.5, COLORS.lensFill);
  gradient.addColorStop(1, 'rgba(142, 203, 255, 0.03)');
  ctx.fillStyle = gradient;
  ctx.fill();

  traceClosedPath();
  ctx.strokeStyle = isSelected ? COLORS.selected : COLORS.lens;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const f = Optics.effectiveFocalLength(lens, 550);
  if (isFinite(f)) drawFocalTicks(ctx, lens.center, s.axis, Math.abs(f));
  drawLabel(ctx, lens.center, s.axis, Optics.glassLabel(lens.glass), -18);
}

// Samples the gap between the front and back surfaces from the axis
// outward, and returns the largest half-height (up to the aperture and an
// 85%-of-radius cap on each surface) at which the two surfaces are still
// separated by a minimum clearance. Works regardless of which surface is
// convex/concave/flat-ish, since it just measures the actual gap directly
// rather than assuming a particular monotonic formula.
function computeSafeAperture(lens, s, halfHeight) {
  const MIN_GAP = 2;
  const halfThickness = lens.thickness / 2;
  const upperBound = Math.min(halfHeight, Math.abs(lens.r1) * 0.85, Math.abs(lens.r2) * 0.85);
  const steps = 40;
  let safe = 0;
  for (let i = 0; i <= steps; i++) {
    const tau = (upperBound * i) / steps;
    const frontOffset = surfaceAxialOffset(tau, lens.r1, -halfThickness);
    const backOffset = surfaceAxialOffset(tau, lens.r2, halfThickness);
    if (backOffset - frontOffset < MIN_GAP) break;
    safe = tau;
  }
  return safe;
}

// Axial (along-axis) position of a surface at tangential height `tau`,
// relative to the lens center, for a surface with signed radius `radius`
// whose vertex sits at `baseOffset` along the axis.
function surfaceAxialOffset(tau, radius, baseOffset) {
  const absR = Math.abs(radius);
  const ratio = Math.min(1, tau / absR);
  const oneMinusCos = 1 - Math.sqrt(Math.max(0, 1 - ratio * ratio));
  return baseOffset + radius * oneMinusCos;
}

function buildSurfaceOutline(surfaceCenter, radius, vertex, elCenter, tangent, halfHeight, safeHeight) {
  const vertexDir = Optics.normalize(Optics.sub(vertex, surfaceCenter));
  const absR = Math.abs(radius);
  const thetaMax = Math.asin(Math.min(1, safeHeight / absR));

  const segments = 20;
  const arcPoints = [];
  for (let i = 0; i <= segments; i++) {
    const theta = -thetaMax + (2 * thetaMax * i) / segments;
    arcPoints.push({
      x: surfaceCenter.x + absR * (Math.cos(theta) * vertexDir.x + Math.sin(theta) * tangent.x),
      y: surfaceCenter.y + absR * (Math.cos(theta) * vertexDir.y + Math.sin(theta) * tangent.y),
    });
  }

  const bottomCorner = Optics.add(elCenter, Optics.scale(tangent, -halfHeight));
  const topCorner = Optics.add(elCenter, Optics.scale(tangent, halfHeight));
  return [bottomCorner, ...arcPoints, topCorner];
}

function drawFocalTicks(ctx, center, axis, f) {
  for (const sign of [1, -1]) {
    const p = Optics.add(center, Optics.scale(axis, sign * f));
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 5, p.y - 5);
    ctx.lineTo(p.x + 5, p.y + 5);
    ctx.moveTo(p.x - 5, p.y + 5);
    ctx.lineTo(p.x + 5, p.y - 5);
    ctx.stroke();
  }
}

// ---------- mirror ----------

function drawMirror(ctx, mirror, isSelected) {
  const { a, b } = Optics.elementEndpoints(mirror);
  const axis = Optics.fromAngle(mirror.angle);

  ctx.strokeStyle = COLORS.mirrorBack;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(a.x - axis.x * 3, a.y - axis.y * 3);
  ctx.lineTo(b.x - axis.x * 3, b.y - axis.y * 3);
  ctx.stroke();

  const bulge = mirror.surface === 'concave' ? -10 : mirror.surface === 'convex' ? 10 : 0;

  ctx.strokeStyle = isSelected ? COLORS.selected : COLORS.mirror;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  if (bulge === 0) {
    ctx.lineTo(b.x, b.y);
  } else {
    ctx.quadraticCurveTo(mirror.center.x + axis.x * bulge, mirror.center.y + axis.y * bulge, b.x, b.y);
  }
  ctx.stroke();

  drawAxisLine(ctx, mirror);
  const label = mirror.surface === 'flat' ? 'flat mirror' : `${mirror.surface} mirror, R = ${Math.round(mirror.radius)}mm`;
  drawLabel(ctx, mirror.center, axis, label);
}

// ---------- prism ----------

function drawPrism(ctx, prism, isSelected) {
  const { apex, face1, face2 } = Optics.buildPrismFaces(prism);

  ctx.beginPath();
  ctx.moveTo(apex.x, apex.y);
  ctx.lineTo(face1.b.x, face1.b.y);
  ctx.lineTo(face2.b.x, face2.b.y);
  ctx.closePath();
  ctx.fillStyle = COLORS.prismFill;
  ctx.fill();
  ctx.strokeStyle = isSelected ? COLORS.selected : COLORS.prism;
  ctx.lineWidth = 3;
  ctx.stroke();

  drawAxisLine(ctx, prism);
  drawLabel(ctx, prism.center, Optics.fromAngle(prism.angle), `${prism.apexAngle}\u00B0 prism \u2014 ${Optics.glassLabel(prism.glass)}`, -18);
}

// ---------- source ----------

function drawSource(ctx, source, isSelected) {
  const color = source.whiteLight ? '#ffffff' : Optics.wavelengthToRGB(source.wavelength);
  ctx.fillStyle = isSelected ? COLORS.selected : color;
  ctx.beginPath();
  ctx.arc(source.position.x, source.position.y, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(source.position.x, source.position.y, 12, 0, Math.PI * 2);
  ctx.stroke();

  const label = source.whiteLight ? 'white light' : `${source.mode}, ${source.wavelength}nm`;
  drawLabel(ctx, source.position, Optics.fromAngle(source.angle), label);
}

// ---------- image-formation marker ----------

function drawImageMarker(ctx, source, lens, info) {
  if (!info.valid || info.parallel) return;
  const axis = Optics.fromAngle(lens.angle);
  const raw = Optics.dot(Optics.sub(source.position, lens.center), axis);
  const sideSign = raw >= 0 ? -1 : 1; // image forms on the opposite side from the source
  const imagePoint = Optics.add(lens.center, Optics.scale(axis, sideSign * info.imageDistance));

  ctx.strokeStyle = info.real ? COLORS.imageReal : COLORS.imageVirtual;
  ctx.lineWidth = 2;
  ctx.setLineDash(info.real ? [] : [5, 5]);
  ctx.beginPath();
  ctx.arc(imagePoint.x, imagePoint.y, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(imagePoint.x, imagePoint.y - 16);
  ctx.lineTo(imagePoint.x, imagePoint.y + 16);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillStyle = info.real ? COLORS.imageReal : COLORS.imageVirtual;
  ctx.textAlign = 'center';
  ctx.fillText(info.real ? 'real image' : 'virtual image', imagePoint.x, imagePoint.y - 22);
}

// ---------- aberration analysis plots (ray fan / LSA) ----------
// Small dedicated-canvas plots in the style of a lens-design tool's ray
// aberration fan and longitudinal spherical aberration charts.

function clearPlot(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0d1319';
  ctx.fillRect(0, 0, w, h);
}

function drawPlotFrame(ctx, w, h, pad, xLabel, yLabel) {
  ctx.strokeStyle = 'rgba(147, 163, 179, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, pad, w - 2 * pad, h - 2 * pad);
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(147, 163, 179, 0.7)';
  ctx.textAlign = 'center';
  ctx.fillText(xLabel, w / 2, h - 3);
  ctx.save();
  ctx.translate(9, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function drawPlotPlaceholder(ctx, w, h, text) {
  ctx.fillStyle = 'rgba(147, 163, 179, 0.55)';
  ctx.font = '10.5px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2 + 3);
}

// Ray aberration fan: transverse ray aberration (ΔY, µm) at the paraxial
// image plane vs. normalized pupil coordinate (Pᵧ, -1..1) -- the classic
// lens-design "ray fan" plot. A perfect (unaberrated) lens plots as a flat
// line at ΔY=0; the bow shape here is real spherical aberration.
function drawRayFanPlot(canvas, fan) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  clearPlot(ctx, w, h);
  const pad = 20;
  drawPlotFrame(ctx, w, h, pad, 'pupil coordinate (Pᵧ)', 'ΔY (µm)');

  if (!fan) {
    drawPlotPlaceholder(ctx, w, h, 'no real image to analyze');
    return;
  }

  const values = fan.samples.map((s) => s.transverseAberration * 1000); // mm -> µm
  const maxAbs = Math.max(1e-6, ...values.map(Math.abs));
  const plotW = w - 2 * pad, plotH = h - 2 * pad;
  const xOf = (p) => pad + ((p + 1) / 2) * plotW;
  const yOf = (v) => pad + plotH / 2 - (v / maxAbs) * (plotH / 2 - 4);

  ctx.strokeStyle = 'rgba(255, 210, 63, 0.4)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pad, yOf(0));
  ctx.lineTo(w - pad, yOf(0));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = COLORS.lens;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  fan.samples.forEach((s, i) => {
    const x = xOf(s.pupilFraction), y = yOf(s.transverseAberration * 1000);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = 'rgba(230, 238, 246, 0.55)';
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`±${maxAbs.toFixed(1)}µm full scale`, w - pad - 2, pad + 10);
}

// Longitudinal spherical aberration (LSA): each ray's own focus shift from
// the paraxial focus (mm) vs. the pupil coordinate it passed through
// (Pᵧ, -1..1, plotted vertically per lens-design convention). Marginal
// rays bowing toward negative LSA is the classic signature of undercorrected
// spherical aberration in a simple converging lens.
function drawLSAPlot(canvas, fan) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  clearPlot(ctx, w, h);
  const pad = 20;
  drawPlotFrame(ctx, w, h, pad, 'LSA (mm)', 'pupil (Pᵧ)');

  if (!fan) {
    drawPlotPlaceholder(ctx, w, h, 'no real image to analyze');
    return;
  }

  const lsas = fan.samples.map((s) => s.longitudinalAberration);
  const maxAbs = Math.max(1e-6, ...lsas.map(Math.abs));
  const plotW = w - 2 * pad, plotH = h - 2 * pad;
  const xOf = (v) => pad + plotW / 2 + (v / maxAbs) * (plotW / 2 - 4);
  const yOf = (p) => pad + ((1 - p) / 2) * plotH; // +pupil plots toward the top

  ctx.strokeStyle = 'rgba(255, 210, 63, 0.4)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(xOf(0), pad);
  ctx.lineTo(xOf(0), h - pad);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = COLORS.prism;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  fan.samples.forEach((s, i) => {
    const x = xOf(s.longitudinalAberration), y = yOf(s.pupilFraction);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = 'rgba(230, 238, 246, 0.55)';
  ctx.font = '9px "IBM Plex Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`±${maxAbs.toFixed(2)}mm full scale`, w - pad - 2, pad + 10);
}

window.Render = {
  COLORS,
  drawBreadboard,
  drawOpticalAxis,
  drawRayPath,
  drawLens,
  drawMirror,
  drawPrism,
  drawSource,
  drawImageMarker,
  drawRayFanPlot,
  drawLSAPlot,
};
