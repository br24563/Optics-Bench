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

function drawBreadboard(ctx, width, height) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.fillStyle = COLORS.gridDot;
  for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawOpticalAxis(ctx, width, axisY, isSnapping) {
  ctx.strokeStyle = isSnapping ? COLORS.selected : COLORS.opticalAxis;
  ctx.lineWidth = isSnapping ? 2 : 1.5;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(0, axisY);
  ctx.lineTo(width, axisY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ruler ticks every 50px so drag distances have a visual reference.
  ctx.strokeStyle = 'rgba(255, 210, 63, 0.25)';
  ctx.font = '10px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(255, 210, 63, 0.45)';
  for (let x = 0; x < width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, axisY - 4);
    ctx.lineTo(x, axisY + 4);
    ctx.stroke();
    if (x % 100 === 0) ctx.fillText(String(x), x + 3, axisY - 7);
  }

  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(255, 210, 63, 0.55)';
  ctx.fillText('optical axis — drag to reposition', 10, axisY - 12);
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

function drawIdealLens(ctx, lens, isSelected) {
  const { a, b } = Optics.elementEndpoints(lens);
  const converging = lens.focalLength > 0;
  const axis = Optics.fromAngle(lens.angle);
  const bulge = converging ? 10 : -8;

  ctx.strokeStyle = isSelected ? COLORS.selected : COLORS.lens;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(lens.center.x + axis.x * bulge, lens.center.y + axis.y * bulge, b.x, b.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(lens.center.x - axis.x * bulge, lens.center.y - axis.y * bulge, b.x, b.y);
  ctx.stroke();

  drawFocalTicks(ctx, lens.center, axis, Math.abs(lens.focalLength));
  drawLabel(ctx, lens.center, axis, `f = ${lens.focalLength > 0 ? '+' : ''}${Math.round(lens.focalLength)}px`, -18);
}

function drawRealisticLens(ctx, lens, isSelected) {
  const s = Optics.buildLensSurfaces(lens);
  const tangent = { x: -s.axis.y, y: s.axis.x };
  const halfHeight = lens.height / 2;

  ctx.strokeStyle = isSelected ? COLORS.selected : COLORS.lens;
  ctx.fillStyle = COLORS.lensFill;
  ctx.lineWidth = 3;

  drawSurfaceArc(ctx, s.frontCenter, s.frontRadius, lens.center, tangent, halfHeight);
  drawSurfaceArc(ctx, s.backCenter, s.backRadius, lens.center, tangent, halfHeight);

  const f = Optics.effectiveFocalLength(lens, 550);
  if (isFinite(f)) drawFocalTicks(ctx, lens.center, s.axis, Math.abs(f));
  const glassLabel = (Optics.GLASS_PRESETS[lens.glass] || Optics.GLASS_PRESETS.crown).label;
  drawLabel(ctx, lens.center, s.axis, glassLabel, -18);
}

function drawSurfaceArc(ctx, surfaceCenter, radius, elCenter, tangent, halfHeight) {
  const topRef = Optics.add(elCenter, Optics.scale(tangent, halfHeight));
  const botRef = Optics.add(elCenter, Optics.scale(tangent, -halfHeight));
  const a1 = Math.atan2(topRef.y - surfaceCenter.y, topRef.x - surfaceCenter.x);
  const a2 = Math.atan2(botRef.y - surfaceCenter.y, botRef.x - surfaceCenter.x);
  ctx.beginPath();
  ctx.arc(surfaceCenter.x, surfaceCenter.y, radius, a1, a2, false);
  ctx.stroke();
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
  const label = mirror.surface === 'flat' ? 'flat mirror' : `${mirror.surface} mirror, R = ${Math.round(mirror.radius)}px`;
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
  const glassLabel = (Optics.GLASS_PRESETS[prism.glass] || Optics.GLASS_PRESETS.crown).label;
  drawLabel(ctx, prism.center, Optics.fromAngle(prism.angle), `${prism.apexAngle}\u00B0 prism \u2014 ${glassLabel}`, -18);
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
};
